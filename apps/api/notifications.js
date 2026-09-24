import { firebaseFailure } from './firebase-push.js';

// The inbox is derived from received messages, so existing conversations appear
// after upgrading. Read watermarks are per participant and survive reinstalls.
export function createNotifications({ db, get, all, run, fail, publicOrigin, pushSender }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS notification_reads (
      user_id TEXT NOT NULL REFERENCES users(id), report_id TEXT NOT NULL REFERENCES reports(id),
      message_id INTEGER NOT NULL, PRIMARY KEY(user_id, report_id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS push_devices (
      token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
      session_hash TEXT NOT NULL, language TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS push_devices_user ON push_devices(user_id);
    CREATE TABLE IF NOT EXISTS push_jobs (
      id INTEGER PRIMARY KEY, token TEXT NOT NULL REFERENCES push_devices(token) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id), message_id INTEGER NOT NULL REFERENCES messages(id),
      attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL, receipt_id TEXT,
      UNIQUE(token, message_id)
    ) STRICT;
  `);
  if (!db.prepare('PRAGMA table_info(push_devices)').all().some(column => column.name === 'project_id')) {
    db.exec("ALTER TABLE push_devices ADD COLUMN project_id TEXT;");
  }
  db.exec('CREATE INDEX IF NOT EXISTS push_jobs_due ON push_jobs(next_at);');
  const received = `FROM messages m JOIN reports r ON r.id=m.report_id
    LEFT JOIN notification_reads n ON n.report_id=r.id AND n.user_id=?
    WHERE ((r.owner_id=? AND m.role='finder') OR (r.finder_user_id=? AND m.role='owner'))`;
  const args = id => [id, id, id];
  const view = row => ({ id: row.id, reportId: row.report_id, tagName: row.tag_name,
    senderName: row.role === 'finder' ? row.finder_name : null, finder: row.role === 'owner',
    ...(row.kind === 'wallet_confirmed' ? { kind: row.kind } : {}), body: row.body, createdAt: row.created_at, read: row.id <= (row.read_id || 0) });
  function inbox(userId, before) {
    const rows = all(`SELECT m.*,r.tag_name,r.finder_name,n.message_id AS read_id ${received}
      ${before ? 'AND m.id < ?' : ''} ORDER BY m.id DESC LIMIT 51`, ...args(userId), ...(before ? [before] : []));
    const unreadCount = get(`SELECT COUNT(*) AS n ${received} AND m.id > COALESCE(n.message_id,0)`, ...args(userId)).n;
    const latestId = get(`SELECT COALESCE(MAX(m.id),0) AS id ${received}`, ...args(userId)).id;
    return { notifications: rows.slice(0, 50).map(view), unreadCount, latestId, nextCursor: rows.length > 50 ? rows[49].id : null };
  }
  function positive(value) {
    if (!Number.isSafeInteger(value) || value < 1) fail(400, 'Notificação inválida.', 'INVALID_NOTIFICATION');
    return value;
  }
  function markRead(userId, throughId, reportId) {
    positive(throughId);
    // Clamp to actual received messages: a future watermark must never swallow
    // messages that arrive while the screen or mark-all request is loading.
    run(`INSERT INTO notification_reads(user_id,report_id,message_id)
      SELECT ?,m.report_id,MAX(m.id) ${received} AND m.id<=? ${reportId ? 'AND m.report_id=?' : ''} GROUP BY m.report_id
      ON CONFLICT(user_id,report_id) DO UPDATE SET message_id=MAX(notification_reads.message_id,excluded.message_id)`,
    userId, ...args(userId), throughId, ...(reportId ? [reportId] : []));
  }
  function install(app, requireOwner, writeLimit) {
    app.get('/api/notifications', requireOwner, (req, res) => {
      const before = req.query.before === undefined ? undefined : positive(Number(req.query.before));
      res.json(inbox(req.user.id, before));
    });
    app.post('/api/notifications/read', requireOwner, writeLimit, (req, res) => {
      if (req.body.reportId !== undefined && (typeof req.body.reportId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(req.body.reportId))) fail(400, 'Conversa inválida.');
      markRead(req.user.id, req.body.throughId, req.body.reportId);
      res.json(inbox(req.user.id));
    });
    app.post('/api/notifications/devices', requireOwner, writeLimit, (req, res) => {
      const { token, language = 'pt', provider, projectId } = req.body;
      if (provider !== 'fcm' || typeof projectId !== 'string' || !/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(projectId)) fail(400, 'Dispositivo inválido.');
      if (pushSender && projectId !== pushSender.projectId) fail(409, 'Este aplicativo usa outro projeto de notificações.', 'PUSH_PROJECT_MISMATCH');
      if (typeof token !== 'string' || !/^[A-Za-z0-9_:\-]{20,4096}$/.test(token)) fail(400, 'Dispositivo inválido.');
      if (!['pt', 'en', 'es'].includes(language)) fail(400, 'Idioma inválido.');
      // A device that changes accounts must lose the previous account's queue.
      run('DELETE FROM push_jobs WHERE token=? AND (user_id<>? OR EXISTS (SELECT 1 FROM push_devices d WHERE d.token=? AND d.project_id IS NOT ?))', token, req.user.id, token, projectId);
      run(`INSERT INTO push_devices(token,user_id,session_hash,language,project_id) VALUES(?,?,?,?,?)
        ON CONFLICT(token) DO UPDATE SET user_id=excluded.user_id,session_hash=excluded.session_hash,language=excluded.language,project_id=excluded.project_id`,
      token, req.user.id, req.sessionHash, language, projectId);
      res.json({ enabled: !!pushSender, provider: 'fcm' });
    });
    app.delete('/api/notifications/devices', requireOwner, (req, res) => {
      run('DELETE FROM push_devices WHERE token=? AND user_id=?', String(req.body.token || ''), req.user.id);
      res.sendStatus(204);
    });
  }
  function enqueue(report, role, messageId) {
    const recipient = role === 'finder' ? report.owner_id : report.finder_user_id;
    if (!recipient || !pushSender) return;
    run(`INSERT OR IGNORE INTO push_jobs(token,user_id,message_id,next_at)
      SELECT d.token,d.user_id,?,? FROM push_devices d JOIN sessions s ON s.hash=d.session_hash
      WHERE d.user_id=? AND d.project_id=? AND s.user_id=d.user_id AND s.expires_at>?`, messageId, Date.now(), recipient, pushSender.projectId, Date.now());
  }
  const title = { pt: 'Nova mensagem', en: 'New message', es: 'Nuevo mensaje' };
  const walletTitle = { pt: 'Carteira de recebimento confirmada', en: 'Receiving wallet confirmed', es: 'Cartera de recepción confirmada' };
  let closed = false, flushing = false;
  async function flush() {
    if (closed || flushing || !pushSender) return;
    flushing = true;
    try {
      // Logout, recovery, expiry and account switching revoke push delivery.
      run(`DELETE FROM push_devices WHERE NOT EXISTS (SELECT 1 FROM sessions s
        WHERE s.hash=push_devices.session_hash AND s.user_id=push_devices.user_id AND s.expires_at>?)`, Date.now());
      const jobs = all(`SELECT j.*,d.language,m.body,m.role,m.report_id,m.kind,r.tag_name
        FROM push_jobs j JOIN push_devices d ON d.token=j.token AND d.user_id=j.user_id
        JOIN messages m ON m.id=j.message_id JOIN reports r ON r.id=m.report_id
        WHERE j.next_at<=? AND d.project_id=? ORDER BY j.id LIMIT 30`, Date.now(), pushSender.projectId);
      for (const job of jobs) {
        if (closed) break;
        if (!get(`SELECT d.token FROM push_devices d JOIN sessions s ON s.hash=d.session_hash
          WHERE d.token=? AND d.user_id=? AND d.project_id=? AND s.user_id=d.user_id AND s.expires_at>?`, job.token, job.user_id, pushSender.projectId, Date.now())) continue;
        if (job.attempts >= 8 || get('SELECT message_id FROM notification_reads WHERE user_id=? AND report_id=?', job.user_id, job.report_id)?.message_id >= job.message_id) {
          run('DELETE FROM push_jobs WHERE id=? AND token=? AND user_id=? AND message_id=?', job.id, job.token, job.user_id, job.message_id); continue;
        }
        try {
          await pushSender.send({ token: job.token, title: `${job.kind === 'wallet_confirmed' ? walletTitle[job.language] : title[job.language]} · ${job.tag_name}`, body: job.kind === 'wallet_confirmed' ? walletTitle[job.language] : job.body.slice(0, 240),
            data: { messageId: job.message_id, reportId: job.report_id, userId: job.user_id, finder: job.role === 'owner', apiOrigin: publicOrigin } });
          if (!closed) run('DELETE FROM push_jobs WHERE id=? AND token=? AND user_id=? AND message_id=?', job.id, job.token, job.user_id, job.message_id);
        } catch (error) {
          if (closed) break;
          const action = firebaseFailure(error);
          if (action === 'remove-device') run('DELETE FROM push_devices WHERE token=? AND user_id=?', job.token, job.user_id);
          else if (action === 'discard') run('DELETE FROM push_jobs WHERE id=? AND token=? AND user_id=? AND message_id=?', job.id, job.token, job.user_id, job.message_id);
          else run('UPDATE push_jobs SET attempts=attempts+1,next_at=? WHERE id=? AND token=? AND user_id=? AND message_id=?', Date.now() + Math.min(3600000, 5000 * 2 ** job.attempts), job.id, job.token, job.user_id, job.message_id);
          // Never log device tokens, message content or the SDK's raw error.
          console.warn('FCM delivery:', action);
        }
      }
    } finally { flushing = false; }
  }
  const timer = setInterval(() => { void flush().catch(() => console.warn('Push queue unavailable')); }, 5000);
  timer.unref();
  return { install, enqueue, flush, inbox, close: () => { closed = true; clearInterval(timer); } };
}
