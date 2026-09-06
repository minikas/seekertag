import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

const hash = value => createHash('sha256').update(value).digest('hex');
const MINUTE = 60_000;
const RETRY_WINDOW = 23 * 60 * MINUTE;

class NotificationError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}
const fail = (status, message, code = 'NOTIFICATION_ERROR') => { throw new NotificationError(status, message, code); };

export function publicEmailOrigin(origin) {
  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    return url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash &&
      host.includes('.') && !host.endsWith('.localhost') && !host.endsWith('.local') && !host.endsWith('.localdomain') && !host.endsWith('.internal') && !host.endsWith('.lan') && !host.endsWith('.home.arpa') && !host.endsWith('.test') &&
      !host.endsWith('.invalid') && !host.endsWith('.example') && !/^\d+\.\d+\.\d+\.\d+$/.test(host) && !host.includes(':');
  } catch { return false; }
}

// Credentials remain in the process environment, never in API responses or logs.
export function createResendTransport({ apiKey, from, fetchImpl = fetch } = {}) {
  if (!apiKey || !from) return null;
  if (typeof from !== 'string' || /[\r\n]/.test(from) || !/@/.test(from)) throw new Error('Configure NOTIFICATION_FROM com um remetente válido.');
  return async ({ to, subject, text, idempotencyKey, signal }) => {
    const signals = [AbortSignal.timeout(15_000), ...(signal ? [signal] : [])];
    let response;
    try {
      response = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST', signal: AbortSignal.any(signals),
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ from, to: [to], subject, text }),
      });
    } catch {
      const error = new Error('EMAIL_TRANSPORT'); error.retryable = true; throw error;
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(`EMAIL_HTTP_${response.status}`);
      error.retryable = response.status >= 500 || response.status === 429 || (response.status === 409 && data.name === 'concurrent_idempotent_requests');
      throw error;
    }
    if (typeof data.id !== 'string') { const error = new Error('EMAIL_RESPONSE'); error.retryable = true; throw error; }
    return { id: data.id };
  };
}

export function registerNotifications({ app, db, publicOrigin, requireOwner, limiter, options = {} }) {
  const clock = options.now || Date.now;
  const explicitTransport = typeof options.sendEmail === 'function';
  const enabled = options.enabled ?? process.env.NOTIFICATIONS_ENABLED === 'true';
  const sendEmail = explicitTransport ? options.sendEmail : enabled && publicEmailOrigin(publicOrigin)
    ? createResendTransport({ apiKey: process.env.RESEND_API_KEY, from: process.env.NOTIFICATION_FROM }) : null;
  // A configured/injected transport must never make a LAN-only link suitable
  // for an email. Tests use a synthetic public HTTPS origin and no real mail.
  const available = Boolean(sendEmail) && publicEmailOrigin(publicOrigin);
  const get = (sql, ...params) => db.prepare(sql).get(...params);
  const all = (sql, ...params) => db.prepare(sql).all(...params);
  const run = (sql, ...params) => db.prepare(sql).run(...params);
  db.exec(`
    CREATE TABLE IF NOT EXISTS notification_secrets (
      name TEXT PRIMARY KEY, value BLOB NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS notification_settings (
      user_id TEXT PRIMARY KEY REFERENCES users(id), verified_at TEXT, enabled INTEGER NOT NULL DEFAULT 0
    ) STRICT;
    CREATE TABLE IF NOT EXISTS email_verifications (
      user_id TEXT PRIMARY KEY REFERENCES users(id), operation_hash TEXT NOT NULL, code_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0
    ) STRICT;
    CREATE TABLE IF NOT EXISTS notification_jobs (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), report_id TEXT NOT NULL REFERENCES reports(id),
      message_id INTEGER NOT NULL REFERENCES messages(id), target_url TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','sent','cancelled','failed')),
      created_at INTEGER NOT NULL, next_attempt_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
      first_attempt_at INTEGER, finished_at INTEGER, error_code TEXT,
      UNIQUE(user_id,message_id)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS notification_due ON notification_jobs(status,next_attempt_at);
  `);
  // A client operation key is a retry proof, NOT proof of mailbox ownership.
  // A persistent server-only secret makes the emailed code unpredictable to
  // the client, while allowing exactly the same email to be retried/restarted.
  const createdSecret = run('INSERT OR IGNORE INTO notification_secrets(name,value) VALUES(?,?)', 'verification', randomBytes(32));
  // Upgrading a database from the initial public-key derivation must invalidate
  // its pending, predictable challenges. Verified preferences remain intact.
  if (createdSecret.changes) run('DELETE FROM email_verifications');
  const verificationSecret = Buffer.from(get('SELECT value FROM notification_secrets WHERE name=?', 'verification').value);
  function settings(userId) {
    const row = get('SELECT * FROM notification_settings WHERE user_id=?', userId);
    const pending = get('SELECT expires_at,attempts FROM email_verifications WHERE user_id=?', userId);
    const failed = get("SELECT COUNT(*) AS n FROM notification_jobs WHERE user_id=? AND status='failed'", userId).n;
    return { available, verified: Boolean(row?.verified_at), enabled: Boolean(row?.enabled), pending: Boolean(pending && pending.expires_at > clock() && pending.attempts < 5), failedCount: failed };
  }
  function operationKey(value) {
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) fail(400, 'Tente pedir o código novamente.', 'OPERATION_REQUIRED');
    return value;
  }
  const route = callback => async (req, res, next) => {
    try { await callback(req, res); }
    catch (error) {
      if (error instanceof NotificationError) return res.status(error.status).json({ error: error.message, code: error.code });
      next(error);
    }
  };
  const requestLimit = limiter(8, 15 * MINUTE, req => req.user.id);
  const verifyLimit = limiter(10, 15 * MINUTE, req => req.user.id);
  app.get('/api/account/notifications', requireOwner, (req, res) => res.json(settings(req.user.id)));
  app.post('/api/account/notifications/verification', requireOwner, requestLimit, route(async (req, res) => {
    if (!available) fail(503, 'Os avisos por e-mail ainda não estão disponíveis.', 'EMAIL_UNAVAILABLE');
    const key = operationKey(req.body.operationKey);
    const userId = req.user.id;
    const operationHash = hash(`verify:${userId}:${key}`);
    const time = clock();
    const previous = get('SELECT * FROM email_verifications WHERE user_id=?', userId);
    const sameOperation = previous?.operation_hash === operationHash;
    if (sameOperation && (previous.expires_at <= time || previous.attempts >= 5)) fail(409, 'Esse pedido expirou. Peça um novo código.', 'VERIFICATION_EXPIRED');
    if (previous && !sameOperation && time - previous.created_at < MINUTE) fail(429, 'Aguarde um minuto antes de pedir outro código.', 'VERIFICATION_WAIT');
    const code = String(createHmac('sha256', verificationSecret).update(`seekertag.email-code:${userId}:${key}`).digest().readUInt32BE(0) % 1_000_000).padStart(6, '0');
    if (!sameOperation) run(`INSERT INTO email_verifications(user_id,operation_hash,code_hash,created_at,expires_at,attempts)
      VALUES(?,?,?,?,?,0) ON CONFLICT(user_id) DO UPDATE SET operation_hash=excluded.operation_hash,
      code_hash=excluded.code_hash,created_at=excluded.created_at,expires_at=excluded.expires_at,attempts=0`,
    userId, operationHash, hash(`${userId}:${code}`), time, time + 15 * MINUTE);
    try {
      await sendEmail({ to: req.user.email, subject: 'Confirme seus avisos do SeekerTag',
        text: `Seu código de confirmação é ${code}. Ele vale por 15 minutos.\n\nDigite-o no SeekerTag para ativar avisos por e-mail. Se você não pediu esse código, ignore esta mensagem.`,
        idempotencyKey: `seekertag-verify-${operationHash}` });
    } catch {
      // The provider may have accepted the email before losing its response.
      // Preserve the challenge and let the same operation safely retry delivery.
      fail(502, 'Não conseguimos confirmar o envio. Se o código chegou, use-o abaixo; caso contrário, tente novamente.', 'EMAIL_DELIVERY_UNCERTAIN');
    }
    res.json(settings(userId));
  }));
  app.post('/api/account/notifications/verify', requireOwner, verifyLimit, route((req, res) => {
    const userId = req.user.id;
    const challenge = get('SELECT * FROM email_verifications WHERE user_id=?', userId);
    if (!challenge && settings(userId).verified) return res.json(settings(userId));
    if (!challenge || challenge.expires_at <= clock() || challenge.attempts >= 5) fail(400, 'Peça um novo código de confirmação.', 'VERIFICATION_EXPIRED');
    const value = typeof req.body.code === 'string' ? req.body.code.trim() : '';
    const matches = /^\d{6}$/.test(value) && timingSafeEqual(Buffer.from(hash(`${userId}:${value}`)), Buffer.from(challenge.code_hash));
    if (!matches) { run('UPDATE email_verifications SET attempts=attempts+1 WHERE user_id=?', userId); fail(400, 'Código incorreto. Confira o e-mail recebido.', 'VERIFICATION_INVALID'); }
    run(`INSERT INTO notification_settings(user_id,verified_at,enabled) VALUES(?,?,1)
      ON CONFLICT(user_id) DO UPDATE SET verified_at=excluded.verified_at,enabled=1`, userId, new Date(clock()).toISOString());
    run('DELETE FROM email_verifications WHERE user_id=?', userId);
    res.json(settings(userId));
  }));
  app.patch('/api/account/notifications', requireOwner, route((req, res) => {
    if (typeof req.body.enabled !== 'boolean') fail(400, 'Escolha se deseja receber os avisos.');
    const state = settings(req.user.id);
    if (req.body.enabled && (!state.available || !state.verified)) fail(409, 'Confirme seu e-mail antes de ativar os avisos.', 'EMAIL_NOT_VERIFIED');
    run(`INSERT INTO notification_settings(user_id,enabled) VALUES(?,?)
      ON CONFLICT(user_id) DO UPDATE SET enabled=excluded.enabled`, req.user.id, Number(req.body.enabled));
    if (!req.body.enabled) {
      run("UPDATE notification_jobs SET status='cancelled',finished_at=? WHERE user_id=? AND status='pending'", clock(), req.user.id);
      // A delayed verification response/retry must not undo a later opt-out.
      run('DELETE FROM email_verifications WHERE user_id=?', req.user.id);
    }
    res.json(settings(req.user.id));
  }));

  // Called within the message transaction, only for a newly created finder message.
  function enqueueMessage(reportId, messageId) {
    const report = get('SELECT * FROM reports WHERE id=?', reportId);
    if (!report || report.status !== 'open') return;
    const preference = get('SELECT * FROM notification_settings WHERE user_id=?', report.owner_id);
    if (!preference?.verified_at || !preference.enabled) return;
    if (get('SELECT id FROM notification_jobs WHERE user_id=? AND message_id=?', report.owner_id, messageId)) return;
    const pending = get("SELECT id FROM notification_jobs WHERE user_id=? AND report_id=? AND status='pending' AND attempts=0 ORDER BY created_at LIMIT 1", report.owner_id, report.id);
    if (pending) { run('UPDATE notification_jobs SET message_id=MAX(message_id,?) WHERE id=?', messageId, pending.id); return; }
    const time = clock();
    run(`INSERT INTO notification_jobs(id,user_id,report_id,message_id,target_url,status,created_at,next_attempt_at)
      VALUES(?,?,?,?,?,'pending',?,?)`, randomUUID(), report.owner_id, report.id, messageId,
    `${publicOrigin}/owner-chat/${report.id}`, time, time + (options.groupDelayMs ?? 30_000));
  }

  let closed = false;
  let running = false;
  let controller = null;
  async function processQueue() {
    if (!available || closed || running) return;
    running = true;
    try {
      const jobs = all("SELECT * FROM notification_jobs WHERE status='pending' AND next_attempt_at<=? ORDER BY next_attempt_at LIMIT 10", clock());
      for (const queued of jobs) {
        if (closed) break;
        const time = clock();
        // Earlier sends await the provider. Refresh each remaining job because
        // another worker or an opt-out may have changed it during that await.
        const job = get("SELECT * FROM notification_jobs WHERE id=? AND status='pending' AND next_attempt_at<=?", queued.id, time);
        if (!job) continue;
        const owner = get(`SELECT u.email,s.enabled,s.verified_at,r.status,r.owner_id,r.owner_read_message_id
          FROM users u JOIN notification_settings s ON s.user_id=u.id JOIN reports r ON r.id=? WHERE u.id=?`, job.report_id, job.user_id);
        if (!owner?.enabled || !owner.verified_at || owner.status !== 'open' || owner.owner_id !== job.user_id || owner.owner_read_message_id >= job.message_id) {
          run("UPDATE notification_jobs SET status='cancelled',finished_at=? WHERE id=? AND status='pending'", time, job.id); continue;
        }
        const currentUrl = `${publicOrigin}/owner-chat/${job.report_id}`;
        if (job.target_url !== currentUrl) {
          if (job.attempts > 0 || job.first_attempt_at !== null) {
            // A provider may already have accepted the previous payload. Never
            // replay its key with another URL, or mail an obsolete/LAN URL.
            run("UPDATE notification_jobs SET status='failed',finished_at=?,error_code='PUBLIC_URL_CHANGED' WHERE id=? AND status='pending'", time, job.id);
            continue;
          }
          const updated = run("UPDATE notification_jobs SET target_url=? WHERE id=? AND status='pending' AND attempts=0", currentUrl, job.id);
          if (!updated.changes) continue;
          job.target_url = currentUrl;
        }
        if (job.first_attempt_at !== null && time - job.first_attempt_at >= RETRY_WINDOW) {
          run("UPDATE notification_jobs SET status='failed',finished_at=?,error_code='RETRY_WINDOW_EXPIRED' WHERE id=?", time, job.id); continue;
        }
        const claimed = run(`UPDATE notification_jobs SET attempts=attempts+1,first_attempt_at=COALESCE(first_attempt_at,?),next_attempt_at=?
          WHERE id=? AND status='pending' AND next_attempt_at<=? AND attempts=? AND target_url=?`, time, time + MINUTE, job.id, time, job.attempts, job.target_url);
        if (!claimed.changes) continue;
        controller = new AbortController();
        try {
          await sendEmail({ to: owner.email, subject: 'Nova mensagem no SeekerTag',
            text: `Você tem uma nova mensagem no SeekerTag.\n\nAbra sua conversa: ${job.target_url}\n\nEntre na sua conta para ler e responder. Você pode desativar estes avisos em Minha conta.`,
            idempotencyKey: `seekertag-notification-${job.id}`, signal: controller.signal });
          if (!closed) run("UPDATE notification_jobs SET status='sent',finished_at=?,error_code=NULL WHERE id=? AND status='pending'", clock(), job.id);
        } catch (error) {
          if (closed) break;
          const attempts = job.attempts + 1;
          const terminal = error.retryable === false || attempts >= 6;
          run(`UPDATE notification_jobs SET status=?,next_attempt_at=?,finished_at=?,error_code=? WHERE id=? AND status='pending'`,
            terminal ? 'failed' : 'pending', clock() + MINUTE * 2 ** Math.min(attempts - 1, 5), terminal ? clock() : null,
            error.retryable === false ? 'EMAIL_REJECTED' : 'EMAIL_UNCONFIRMED', job.id);
        } finally { controller = null; }
      }
    } finally { running = false; }
  }
  const timer = available && options.startWorker !== false ? setInterval(() => void processQueue().catch(() => {
    if (!closed) console.error('SeekerTag: notification worker failed');
  }), options.intervalMs ?? 15_000) : null;
  timer?.unref();
  function close() { closed = true; if (timer) clearInterval(timer); controller?.abort(); }
  return { enqueueMessage, processQueue, close, available };
}
