import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { createHash, createHmac, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync, chmodSync, realpathSync, statSync } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import QRCode from 'qrcode';
import PDFDocument from 'pdfkit';
import { registerNotifications } from './notifications.js';

const scrypt = promisify(scryptCallback);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const secret = () => randomBytes(32).toString('base64url');
const recovery = () => randomBytes(20).toString('hex').toUpperCase().match(/.{1,5}/g).join('-');
const normalizeRecovery = (value) => String(value || '').replaceAll('-', '').trim().toUpperCase();
// Operation keys are client-generated secrets. Domain separation prevents their
// digests in the database from becoming usable finder/recovery credentials.
const derive = (domain, scope, key) => createHmac('sha256', Buffer.from(key, 'hex')).update(`SeekerTag/${domain}/v1\0${scope}`).digest();

class HttpError extends Error {
  constructor(status, error, code = 'INVALID_REQUEST') { super(error); this.status = status; this.code = code; }
}
const fail = (status, message, code) => { throw new HttpError(status, message, code); };
function operationKey(value, required = false) {
  if (value === undefined && !required) return null;
  if (typeof value !== 'string' || !/^[a-fA-F0-9]{64}$/.test(value)) fail(400, 'operationKey deve conter 64 caracteres hexadecimais.', 'INVALID_OPERATION_KEY');
  return value.toLowerCase();
}
function string(value, name, max, { optional = false, min = 1, trim = true } = {}) {
  if (value == null && optional) return '';
  if (typeof value !== 'string') fail(400, `${name}: informe um texto válido.`);
  const result = trim ? value.trim() : value;
  if (result.length < min || result.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(result)) fail(400, `${name}: use entre ${min} e ${max} caracteres.`);
  return result;
}
function email(value) {
  const result = string(value, 'E-mail', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) fail(400, 'Informe um e-mail válido.');
  return result;
}
const password = (value) => string(value, 'Senha', 128, { min: 10, trim: false });
async function passwordHash(value) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${(await scrypt(value, salt, 64, { N: 32768, maxmem: 64 * 1024 * 1024 })).toString('hex')}`;
}
async function passwordMatches(value, stored) {
  const [salt, expected] = stored.split(':');
  const actual = await scrypt(value, salt, 64, { N: 32768, maxmem: 64 * 1024 * 1024 });
  return timingSafeEqual(actual, Buffer.from(expected, 'hex'));
}
const userView = (u) => ({ id: u.id, name: u.name, email: u.email, createdAt: u.created_at });

export function createApp({ dbPath = './data/seekertag.sqlite', publicUrl = 'http://localhost:8081', corsOrigins = /** @type {string[]} */ ([]), rateLimits = true, webDistPath = /** @type {string | null} */ (null), notifications = {} } = {}) {
  const canonical = new URL(publicUrl);
  if (!['http:', 'https:'].includes(canonical.protocol) || canonical.username || canonical.password || canonical.search || canonical.hash || canonical.pathname !== '/') throw new Error('PUBLIC_URL must be an http(s) origin without credentials, query, or path.');
  const publicOrigin = canonical.origin;
  let webRoot = null;
  let webIndex = null;
  const isInside = (root, file) => { const path = relative(root, file); return path !== '..' && !path.startsWith(`..${sep}`) && !path.startsWith(sep); };
  if (webDistPath) {
    try {
      webRoot = realpathSync(webDistPath);
      webIndex = realpathSync(join(webRoot, 'index.html'));
      if (!statSync(webRoot).isDirectory() || !statSync(webIndex).isFile() || !isInside(webRoot, webIndex)) throw new Error('Invalid web root');
    } catch { throw new Error('WEB_DIST_PATH must contain a regular index.html inside the exported web directory. Run the Expo web export first.'); }
  }
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(dbPath, { timeout: 5000 });
  if (dbPath !== ':memory:') chmodSync(dbPath, 0o600);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL, recovery_hash TEXT NOT NULL, created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS sessions (
      hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, owner_id TEXT NOT NULL REFERENCES users(id),
      name TEXT NOT NULL, category TEXT NOT NULL, color TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      public_message TEXT NOT NULL DEFAULT '', status TEXT NOT NULL CHECK(status IN ('active','lost','paused')),
      reward_amount REAL NOT NULL DEFAULT 0, reward_currency TEXT NOT NULL DEFAULT 'BRL',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, returned_at TEXT, recovery_count INTEGER NOT NULL DEFAULT 0
    ) STRICT;
    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY, tag_id TEXT NOT NULL REFERENCES tags(id), owner_id TEXT NOT NULL REFERENCES users(id),
      tag_name TEXT NOT NULL, tag_code TEXT NOT NULL, finder_name TEXT NOT NULL,
      capability_hash TEXT UNIQUE NOT NULL, status TEXT NOT NULL CHECK(status IN ('open','resolved')),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, report_id TEXT NOT NULL REFERENCES reports(id),
      role TEXT NOT NULL CHECK(role IN ('owner','finder')), body TEXT NOT NULL, created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS tag_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tag_id TEXT NOT NULL REFERENCES tags(id),
      owner_id TEXT NOT NULL REFERENCES users(id), type TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS operations (
      scope TEXT NOT NULL, key_digest TEXT NOT NULL, payload_digest TEXT NOT NULL,
      resource_id TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY(scope, key_digest)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS tags_owner ON tags(owner_id);
    CREATE INDEX IF NOT EXISTS reports_owner ON reports(owner_id, updated_at);
    CREATE INDEX IF NOT EXISTS reports_tag ON reports(tag_id, owner_id, status);
    CREATE INDEX IF NOT EXISTS messages_report ON messages(report_id, id);
    CREATE INDEX IF NOT EXISTS events_tag ON tag_events(tag_id, owner_id);
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
  `);
  const get = (sql, ...params) => db.prepare(sql).get(...params);
  const all = (sql, ...params) => db.prepare(sql).all(...params);
  const run = (sql, ...params) => db.prepare(sql).run(...params);
  const transaction = (fn) => { db.exec('BEGIN IMMEDIATE'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } };
  // Additive, transactional migrations work for both existing installations and
  // fresh databases. Historical resolutions were all genuine returns.
  transaction(() => {
    const addColumn = (table, name, declaration) => {
      if (!all(`PRAGMA table_info(${table})`).some((column) => column.name === name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${declaration}`);
    };
    addColumn('tags', 'prepared_at', 'TEXT');
    addColumn('reports', 'owner_read_message_id', 'INTEGER NOT NULL DEFAULT 0');
    addColumn('reports', 'closed_reason', 'TEXT');
    addColumn('reports', 'closed_at', 'TEXT');
    run("UPDATE reports SET closed_reason='returned',closed_at=updated_at WHERE status='resolved' AND closed_reason IS NULL");
  });
  function performOperation(key, scope, payload, create, read) {
    return transaction(() => {
      const keyDigest = key && derive('operation-key', scope, key).toString('hex');
      // HMAC also prevents the payload digest from becoming a cheap password
      // oracle for the authenticated recovery-code operation.
      const payloadDigest = key && createHmac('sha256', Buffer.from(key, 'hex')).update(JSON.stringify(payload)).digest('hex');
      const prior = key && get('SELECT * FROM operations WHERE scope=? AND key_digest=?', scope, keyDigest);
      if (prior) {
        if (prior.payload_digest !== payloadDigest) fail(409, 'Esta operação já foi usada com outros dados.', 'OPERATION_CONFLICT');
        return read(prior.resource_id, true);
      }
      const id = create();
      if (key) run('INSERT INTO operations(scope,key_digest,payload_digest,resource_id,created_at) VALUES(?,?,?,?,?)', scope, keyDigest, payloadDigest, String(id), now());
      return read(String(id), false);
    });
  }
  const app = express();
  app.disable('x-powered-by');
  app.locals.db = db;
  app.locals.close = () => db.close();
  const origins = new Set([publicOrigin, 'http://localhost:8081', 'http://127.0.0.1:8081', ...corsOrigins]);
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store', 'Cross-Origin-Resource-Policy': 'cross-origin' });
    const origin = req.headers.origin;
    if (origin && !origins.has(origin)) return res.status(403).json({ error: 'Origem não autorizada.', code: 'ORIGIN_DENIED' });
    if (origin) res.set({ 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS', 'Access-Control-Expose-Headers': 'Content-Disposition' });
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.use(express.json({ limit: '16kb', strict: true }));
  app.use((req, _res, next) => {
    if (['POST', 'PATCH'].includes(req.method) && req.body != null && (Array.isArray(req.body) || typeof req.body !== 'object')) return next(new HttpError(400, 'Envie um objeto JSON.'));
    req.body ??= {};
    next();
  });
  function limiter(limit, windowMs, key = (req) => req.ip) {
    const buckets = new Map();
    let nextSweep = 0;
    return (req, res, next) => {
      if (!rateLimits) return next();
      const time = Date.now();
      if (time >= nextSweep) {
        for (const [entry, bucket] of buckets) if (bucket.expires <= time) buckets.delete(entry);
        nextSweep = time + 60_000;
      }
      const id = key(req);
      let bucket = buckets.get(id);
      if (!bucket || bucket.expires <= time) {
        if (buckets.size >= 20_000) return res.status(429).json({ error: 'Aguarde antes de tentar novamente.', code: 'RATE_LIMITED' });
        bucket = { count: 0, expires: time + windowMs }; buckets.set(id, bucket);
      }
      bucket.count++;
      if (bucket.count > limit) {
        res.set('Retry-After', String(Math.ceil((bucket.expires - time) / 1000)));
        return res.status(429).json({ error: 'Muitas tentativas. Aguarde antes de tentar novamente.', code: 'RATE_LIMITED' });
      }
      next();
    };
  }
  const globalLimit = limiter(300, 60_000);
  app.use('/api', globalLimit);
  const authLimit = limiter(30, 15 * 60_000);
  const accountLimit = limiter(10, 15 * 60_000, (req) => typeof req.body.email === 'string' ? req.body.email.toLowerCase().trim().slice(0, 254) : req.ip);
  const reportLimit = limiter(6, 10 * 60_000);
  const messageLimit = limiter(30, 60_000, (req) => req.user?.id || req.finderReport?.id || req.ip);
  const ownerWriteLimit = limiter(100, 60_000, (req) => req.user.id);
  const makeSession = (userId) => {
    const token = secret();
    run('DELETE FROM sessions WHERE expires_at <= ?', Date.now());
    run('INSERT INTO sessions(hash,user_id,expires_at) VALUES(?,?,?)', hash(token), userId, Date.now() + SESSION_MS);
    return token;
  };
  const bearer = (req) => {
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization || '');
    if (!match) fail(401, 'Entre na sua conta para continuar.', 'UNAUTHORIZED');
    return match[1];
  };
  const requireOwner = (req, _res, next) => {
    const tokenHash = hash(bearer(req));
    const u = get('SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.hash=? AND sessions.expires_at>?', tokenHash, Date.now());
    if (!u) fail(401, 'Sua sessão expirou. Entre novamente.', 'UNAUTHORIZED');
    req.user = u; req.sessionHash = tokenHash; next();
  };
  const notificationService = registerNotifications({ app, db, publicOrigin, requireOwner, limiter, options: notifications });
  app.locals.notifications = notificationService;
  app.locals.close = () => { notificationService.close(); db.close(); };
  const ownerTag = (req) => {
    const tag = get('SELECT * FROM tags WHERE id=? AND owner_id=?', req.params.id, req.user.id);
    if (!tag) fail(404, 'Etiqueta não encontrada.', 'NOT_FOUND');
    return tag;
  };
  const ownerReport = (req) => {
    const report = get('SELECT * FROM reports WHERE id=? AND owner_id=?', req.params.id, req.user.id);
    if (!report) fail(404, 'Conversa não encontrada.', 'NOT_FOUND');
    return report;
  };
  const requireFinder = (req, _res, next) => {
    const report = get('SELECT * FROM reports WHERE id=? AND capability_hash=?', req.params.id, hash(bearer(req)));
    if (!report) fail(404, 'Conversa não encontrada. Use o mesmo dispositivo em que enviou o aviso.', 'NOT_FOUND');
    req.finderReport = report; next();
  };
  const publicTag = (code) => {
    const tag = get('SELECT * FROM tags WHERE code=?', code);
    if (!tag) fail(404, 'Esta etiqueta não foi encontrada.', 'NOT_FOUND');
    if (tag.status === 'paused') fail(410, 'Esta etiqueta está pausada pelo dono.', 'TAG_PAUSED');
    return tag;
  };
  function tagView(t) {
    const counts = get("SELECT COUNT(*) AS total, SUM(CASE WHEN status='open' THEN 1 ELSE 0 END) AS open FROM reports WHERE tag_id=? AND owner_id=?", t.id, t.owner_id);
    return { id: t.id, code: t.code, name: t.name, category: t.category, color: t.color, description: t.description, publicMessage: t.public_message, status: t.status, rewardAmount: t.reward_amount, rewardCurrency: t.reward_currency, publicUrl: `${publicOrigin}/found/${t.code}`, createdAt: t.created_at, updatedAt: t.updated_at, returnedAt: t.returned_at, preparedAt: t.prepared_at, recoveryCount: t.recovery_count, reportCount: counts.total, openReportCount: counts.open || 0 };
  }
  const publicView = (t) => ({ code: t.code, name: t.name, category: t.category, color: t.color, publicMessage: t.public_message, status: t.status, rewardAmount: t.reward_amount, rewardCurrency: t.reward_currency });
  function reportView(r) {
    const last = get('SELECT id,role,body FROM messages WHERE report_id=? ORDER BY id DESC LIMIT 1', r.id);
    const count = get('SELECT COUNT(*) AS n FROM messages WHERE report_id=?', r.id).n;
    const unreadCount = get("SELECT COUNT(*) AS n FROM messages WHERE report_id=? AND role='finder' AND id>?", r.id, r.owner_read_message_id).n;
    return { id: r.id, tagId: r.tag_id, tagName: r.tag_name, tagCode: r.tag_code, finderName: r.finder_name, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at, lastMessage: last?.body || '', lastMessageId: last?.id ?? null, lastMessageRole: last?.role ?? null, messageCount: count, unreadCount, closedReason: r.closed_reason, closedAt: r.closed_at };
  }
  const messageView = (m) => ({ id: m.id, role: m.role, body: m.body, createdAt: m.created_at });
  const messagesFor = (id) => all('SELECT * FROM messages WHERE report_id=? ORDER BY id', id).map(messageView);
  function addMessage(report, role, body, key) {
    return performOperation(key, `message:${role}:${report.id}`, { body }, () => {
      const current = get('SELECT * FROM reports WHERE id=?', report.id);
      if (current.status !== 'open') fail(409, 'Esta conversa está encerrada.', 'REPORT_RESOLVED');
      const tag = get('SELECT * FROM tags WHERE id=?', report.tag_id);
      if (tag.status === 'paused') fail(410, 'Esta etiqueta está pausada pelo dono.', 'TAG_PAUSED');
      if (get('SELECT COUNT(*) AS n FROM messages WHERE report_id=?', report.id).n >= 1000) fail(409, 'Esta conversa atingiu o limite de mensagens.', 'MESSAGE_LIMIT');
      const at = now();
      const result = run('INSERT INTO messages(report_id,role,body,created_at) VALUES(?,?,?,?)', report.id, role, body, at);
      run('UPDATE reports SET updated_at=? WHERE id=?', at, report.id);
      if (role === 'finder') notificationService.enqueueMessage(report.id, Number(result.lastInsertRowid));
      return Number(result.lastInsertRowid);
    }, (id) => messageView(get('SELECT * FROM messages WHERE id=? AND report_id=?', Number(id), report.id)));
  }
  function validateTag(body, previous) {
    const choose = (field, defaultValue) => body[field] !== undefined ? body[field] : defaultValue;
    const values = {
      name: string(choose('name', previous?.name), 'Nome do item', 80),
      category: string(choose('category', previous?.category || 'other'), 'Categoria', 32),
      color: string(choose('color', previous?.color || '#B9C79B'), 'Cor', 32),
      description: string(choose('description', previous?.description || ''), 'Descrição privada', 500, { min: 0 }),
      publicMessage: string(choose('publicMessage', previous?.public_message || ''), 'Mensagem pública', 500, { min: 0 }),
      status: choose('status', previous?.status || 'active'),
      rewardAmount: choose('rewardAmount', previous?.reward_amount || 0),
      rewardCurrency: choose('rewardCurrency', previous?.reward_currency || 'BRL'),
    };
    if (!['active', 'lost', 'paused'].includes(values.status)) fail(400, 'Status inválido.');
    if (typeof values.rewardAmount !== 'number' || !Number.isFinite(values.rewardAmount) || values.rewardAmount < 0 || values.rewardAmount > 1_000_000) fail(400, 'Informe uma recompensa entre 0 e 1.000.000.');
    if (!['BRL', 'USD', 'USDC', 'SOL', 'SKR'].includes(values.rewardCurrency)) fail(400, 'Moeda inválida.');
    return values;
  }

  app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'SeekerTag', publicUrl: publicOrigin }));
  app.post('/api/auth/register', authLimit, async (req, res) => {
    const name = string(req.body.name, 'Nome', 80);
    const address = email(req.body.email);
    const pass = password(req.body.password);
    if (get('SELECT id FROM users WHERE email=?', address)) fail(409, 'Este e-mail já tem uma conta. Entre ou use seu código de recuperação.', 'EMAIL_EXISTS');
    const passwordDigest = await passwordHash(pass);
    const recoveryCode = recovery();
    const user = { id: randomUUID(), name, email: address, created_at: now() };
    const token = transaction(() => {
      // Recheck after the asynchronous password hash to handle concurrent registrations.
      if (get('SELECT id FROM users WHERE email=?', address)) fail(409, 'Este e-mail já tem uma conta.', 'EMAIL_EXISTS');
      run('INSERT INTO users(id,name,email,password_hash,recovery_hash,created_at) VALUES(?,?,?,?,?,?)', user.id, name, address, passwordDigest, hash(normalizeRecovery(recoveryCode)), user.created_at);
      return makeSession(user.id);
    });
    res.status(201).json({ token, user: userView(user), recoveryCode });
  });
  app.post('/api/auth/login', authLimit, accountLimit, async (req, res) => {
    const address = email(req.body.email);
    const pass = password(req.body.password);
    const user = get('SELECT * FROM users WHERE email=?', address);
    // Equal scrypt work for unknown accounts avoids the cheap account-existence timing signal.
    const dummyHash = '00000000000000000000000000000000:' + '0'.repeat(128);
    const matches = await passwordMatches(pass, user?.password_hash || dummyHash);
    if (!user || !matches || get('SELECT password_hash FROM users WHERE id=?', user.id)?.password_hash !== user.password_hash) fail(401, 'E-mail ou senha incorretos.', 'INVALID_CREDENTIALS');
    res.json({ token: makeSession(user.id), user: userView(user) });
  });
  app.post('/api/auth/recover', authLimit, accountLimit, async (req, res) => {
    const address = email(req.body.email);
    const code = string(req.body.recoveryCode, 'Código de recuperação', 100);
    const pass = password(req.body.password);
    const user = get('SELECT * FROM users WHERE email=?', address);
    const expected = hash(normalizeRecovery(code));
    if (!user || !timingSafeEqual(Buffer.from(expected), Buffer.from(user.recovery_hash))) fail(401, 'E-mail ou código de recuperação incorretos.', 'INVALID_CREDENTIALS');
    const digest = await passwordHash(pass);
    const recoveryCode = recovery();
    const token = transaction(() => {
      if (get('SELECT recovery_hash FROM users WHERE id=?', user.id)?.recovery_hash !== expected) fail(401, 'Este código de recuperação já foi usado.', 'INVALID_CREDENTIALS');
      run('UPDATE users SET password_hash=?, recovery_hash=? WHERE id=?', digest, hash(normalizeRecovery(recoveryCode)), user.id);
      run('DELETE FROM sessions WHERE user_id=?', user.id);
      return makeSession(user.id);
    });
    res.json({ token, user: userView(user), recoveryCode });
  });
  app.get('/api/auth/me', requireOwner, (req, res) => res.json({ user: userView(req.user) }));
  app.post('/api/auth/logout', requireOwner, (req, res) => { run('DELETE FROM sessions WHERE hash=?', req.sessionHash); res.sendStatus(204); });
  app.post('/api/account/recovery-code', requireOwner, authLimit, async (req, res) => {
    const pass = password(req.body.password);
    const key = operationKey(req.body.operationKey, true);
    if (!(await passwordMatches(pass, req.user.password_hash))) fail(401, 'Senha incorreta.', 'INVALID_CREDENTIALS');
    const recoveryCode = derive('recovery-code', req.user.id, key).subarray(0, 20).toString('hex').toUpperCase().match(/.{1,5}/g).join('-');
    const digest = hash(normalizeRecovery(recoveryCode));
    const result = performOperation(key, `recovery-code:${req.user.id}`, { password: pass }, () => {
      reauthorize();
      run('UPDATE users SET recovery_hash=? WHERE id=?', digest, req.user.id);
      return req.user.id;
    }, () => {
      reauthorize();
      if (get('SELECT recovery_hash FROM users WHERE id=?', req.user.id).recovery_hash !== digest) fail(409, 'Uma emissão posterior substituiu este código. Emita um novo código.', 'OPERATION_SUPERSEDED');
      return { recoveryCode };
    });
    function reauthorize() {
      if (!get('SELECT hash FROM sessions WHERE hash=? AND user_id=? AND expires_at>?', req.sessionHash, req.user.id, Date.now()) || get('SELECT password_hash FROM users WHERE id=?', req.user.id)?.password_hash !== req.user.password_hash) fail(401, 'Entre novamente para continuar.', 'UNAUTHORIZED');
    }
    res.json(result);
  });
  app.get('/api/account/export', requireOwner, (req, res) => {
    const reports = all('SELECT * FROM reports WHERE owner_id=? ORDER BY created_at', req.user.id);
    res.set('Content-Disposition', 'attachment; filename="seekertag-backup.json"');
    res.json({ exportedAt: now(), user: userView(req.user), tags: all('SELECT * FROM tags WHERE owner_id=? ORDER BY created_at', req.user.id).map(tagView), reports: reports.map((r) => ({ ...reportView(r), messages: messagesFor(r.id) })) });
  });

  app.get('/api/tags', requireOwner, (req, res) => res.json({ tags: all('SELECT * FROM tags WHERE owner_id=? ORDER BY created_at DESC, id DESC', req.user.id).map(tagView) }));
  app.post('/api/tags', requireOwner, ownerWriteLimit, (req, res) => {
    const v = validateTag(req.body);
    const key = operationKey(req.body.operationKey);
    const tag = performOperation(key, `tag:${req.user.id}`, v, () => {
      if (get('SELECT COUNT(*) AS n FROM tags WHERE owner_id=?', req.user.id).n >= 500) fail(409, 'Você atingiu o limite de 500 etiquetas.', 'TAG_LIMIT');
      const id = randomUUID(); const code = randomBytes(12).toString('base64url'); const at = now();
      run('INSERT INTO tags(id,code,owner_id,name,category,color,description,public_message,status,reward_amount,reward_currency,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)', id, code, req.user.id, v.name, v.category, v.color, v.description, v.publicMessage, v.status, v.rewardAmount, v.rewardCurrency, at, at);
      run('INSERT INTO tag_events(tag_id,owner_id,type,status,created_at) VALUES(?,?,?,?,?)', id, req.user.id, 'created', v.status, at);
      return id;
    }, (id) => {
      const current = get('SELECT * FROM tags WHERE id=? AND owner_id=?', id, req.user.id);
      if (!current) fail(404, 'Etiqueta não encontrada.', 'NOT_FOUND');
      return tagView(current);
    });
    res.status(201).json({ tag });
  });
  app.get('/api/tags/:id', requireOwner, (req, res) => res.json({ tag: tagView(ownerTag(req)) }));
  app.patch('/api/tags/:id', requireOwner, ownerWriteLimit, (req, res) => {
    if (req.body.prepared !== undefined && typeof req.body.prepared !== 'boolean') fail(400, 'prepared deve ser verdadeiro ou falso.');
    const tag = transaction(() => {
      const t = ownerTag(req); const v = validateTag(req.body, t); const at = now();
      const preparedAt = req.body.prepared === undefined ? t.prepared_at : req.body.prepared ? t.prepared_at || at : null;
      run('UPDATE tags SET name=?,category=?,color=?,description=?,public_message=?,status=?,reward_amount=?,reward_currency=?,updated_at=?,prepared_at=? WHERE id=?', v.name, v.category, v.color, v.description, v.publicMessage, v.status, v.rewardAmount, v.rewardCurrency, at, preparedAt, t.id);
      if (t.status !== v.status) run('INSERT INTO tag_events(tag_id,owner_id,type,status,created_at) VALUES(?,?,?,?,?)', t.id, req.user.id, 'status_changed', v.status, at);
      return tagView(get('SELECT * FROM tags WHERE id=?', t.id));
    });
    res.json({ tag });
  });
  app.get('/api/tags/:id/history', requireOwner, (req, res) => {
    const tag = ownerTag(req);
    res.json({ events: all('SELECT id,type,status,created_at AS createdAt FROM tag_events WHERE tag_id=? AND owner_id=? ORDER BY id DESC', tag.id, req.user.id) });
  });
  app.post('/api/tags/:id/transfer', requireOwner, authLimit, async (req, res) => {
    const tag = ownerTag(req); const address = email(req.body.email); const pass = password(req.body.password);
    if (!(await passwordMatches(pass, req.user.password_hash))) fail(401, 'Senha incorreta.', 'INVALID_CREDENTIALS');
    transaction(() => {
      // Reauthorize after hashing: recovery/logout/another transfer may occur while scrypt runs.
      const current = get('SELECT * FROM tags WHERE id=? AND owner_id=?', tag.id, req.user.id);
      if (!get('SELECT hash FROM sessions WHERE hash=? AND expires_at>?', req.sessionHash, Date.now()) || get('SELECT password_hash FROM users WHERE id=?', req.user.id)?.password_hash !== req.user.password_hash) fail(401, 'Entre novamente para continuar.', 'UNAUTHORIZED');
      if (!current) fail(404, 'Etiqueta não encontrada.', 'NOT_FOUND');
      const target = get('SELECT id FROM users WHERE email=?', address);
      if (!target) fail(404, 'A pessoa precisa criar uma conta SeekerTag antes da transferência.', 'RECIPIENT_NOT_FOUND');
      if (target.id === req.user.id) fail(400, 'A etiqueta já está na sua conta.');
      if (get("SELECT id FROM reports WHERE tag_id=? AND status='open'", tag.id)) fail(409, 'Conclua as conversas abertas antes de transferir esta etiqueta.', 'OPEN_REPORTS');
      if (get('SELECT COUNT(*) AS n FROM tags WHERE owner_id=?', target.id).n >= 500) fail(409, 'A conta de destino atingiu o limite de etiquetas.', 'TAG_LIMIT');
      const at = now();
      // Public QR remains valid; clear private notes, pledges, and previous recovery metrics before handing over.
      run("UPDATE tags SET owner_id=?,description='',public_message='',reward_amount=0,status='active',updated_at=?,returned_at=NULL,recovery_count=0,prepared_at=NULL WHERE id=?", target.id, at, tag.id);
      run('INSERT INTO tag_events(tag_id,owner_id,type,status,created_at) VALUES(?,?,?,?,?)', tag.id, req.user.id, 'transferred_out', 'active', at);
      run('INSERT INTO tag_events(tag_id,owner_id,type,status,created_at) VALUES(?,?,?,?,?)', tag.id, target.id, 'transferred_in', 'active', at);
    });
    res.json({ ok: true });
  });
  app.get('/api/tags/:id/qr.png', requireOwner, async (req, res) => {
    const tag = ownerTag(req);
    const png = await QRCode.toBuffer(`${publicOrigin}/found/${tag.code}`, { type: 'png', width: 900, margin: 4, errorCorrectionLevel: 'M', color: { dark: '#192219', light: '#FFFFFF' } });
    res.set({ 'Content-Type': 'image/png', 'Content-Disposition': `attachment; filename="seekertag-${tag.code}.png"` }).send(png);
  });
  app.get('/api/tags/:id/label.pdf', requireOwner, async (req, res) => {
    const tag = ownerTag(req); const url = `${publicOrigin}/found/${tag.code}`;
    const format = req.query.format ?? 'standard';
    if (!['standard', 'compact', 'fold'].includes(format)) fail(400, 'Formato de etiqueta inválido.');
    const png = await QRCode.toBuffer(url, { width: 900, margin: 4, errorCorrectionLevel: 'M' });
    const dimensions = { standard: '6 etiquetas de 88,2 x 73 mm', compact: '15 etiquetas de 50 x 40 mm', fold: '4 etiquetas de 90 x 100 mm; dobrada: 90 x 50 mm' };
    const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `SeekerTag — ${tag.name}`, Author: 'SeekerTag', Subject: `${format}: ${dimensions[format]}. A4, escala 100%.` } });
    const chunks = [];
    const pdf = new Promise((resolve, reject) => { doc.on('data', (chunk) => chunks.push(chunk)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });
    doc.fillColor('#213528').fontSize(25).text('SeekerTag', 40, 36);
    doc.fontSize(10).text(`${dimensions[format]}. Imprima em escala 100%.`, 40, 70);
    doc.fontSize(9).fillColor('#5B655C').text('Teste o QR com outro celular antes de usar a etiqueta.', 40, 88);
    const mm = (value) => value * 72 / 25.4;
    const outline = (x, y, width, height) => doc.save().dash(3, { space: 3 }).lineWidth(0.6).strokeColor('#B4BEB2').roundedRect(x, y, width, height, 4).stroke().restore();
    if (format === 'standard') {
      for (let row = 0; row < 3; row++) for (let col = 0; col < 2; col++) {
        const x = 40 + col * 261; const y = 120 + row * 220;
        outline(x, y, 250, 207);
        doc.fillColor('#213528').fontSize(15).text('Encontrou este item?', x + 12, y + 13, { width: 226, align: 'center' });
        doc.fontSize(9).text('Escaneie para falar com o dono.', x + 12, y + 34, { width: 226, align: 'center' });
        doc.image(png, x + 61, y + 52, { width: 128, height: 128 });
        doc.fontSize(8).fillColor('#5B655C').text(`SeekerTag · ${tag.code}`, x + 10, y + 186, { width: 230, align: 'center' });
      }
    } else if (format === 'compact') {
      for (let row = 0; row < 5; row++) for (let col = 0; col < 3; col++) {
        const x = mm(26) + col * mm(54); const y = 120 + row * mm(44); const width = mm(50);
        outline(x, y, width, mm(40));
        doc.fillColor('#213528').fontSize(8).text('Encontrou? Escaneie o QR.', x + 4, y + 7, { width: width - 8, align: 'center' });
        doc.image(png, x + mm(12), y + 21, { width: mm(26), height: mm(26) });
        doc.fontSize(6).fillColor('#5B655C').text(`SeekerTag · ${tag.code}`, x + 3, y + 100, { width: width - 6, align: 'center' });
      }
    } else {
      for (let row = 0; row < 2; row++) for (let col = 0; col < 2; col++) {
        const x = mm(12) + col * mm(96); const y = 120 + row * mm(106); const width = mm(90); const half = mm(50);
        outline(x, y, width, half * 2);
        doc.save().dash(5, { space: 3 }).strokeColor('#859582').lineWidth(0.6).moveTo(x, y + half).lineTo(x + width, y + half).stroke().restore();
        for (let side = 0; side < 2; side++) {
          const top = y + side * half;
          doc.fillColor('#213528').fontSize(11).text('Encontrou este item?', x + 8, top + 7, { width: width - 16, align: 'center' });
          doc.fontSize(7).text('Escaneie para falar com o dono.', x + 8, top + 22, { width: width - 16, align: 'center' });
          doc.image(png, x + (width - mm(30)) / 2, top + 34, { width: mm(30), height: mm(30) });
          doc.fontSize(7).fillColor('#5B655C').text(`SeekerTag · ${tag.code}`, x + 6, top + 124, { width: width - 12, align: 'center' });
        }
      }
      doc.fontSize(8).fillColor('#5B655C').text('Recorte a borda externa. Dobre na linha central e prenda ao item.', 40, 730, { width: 515 });
    }
    doc.end();
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="seekertag-${tag.code}.pdf"` }).send(await pdf);
  });

  app.get('/api/public/tags/:code', (req, res) => res.json({ tag: publicView(publicTag(req.params.code)) }));
  app.post('/api/public/tags/:code/reports', reportLimit, (req, res) => {
    const key = operationKey(req.body.operationKey);
    const finderName = string(req.body.finderName ?? '', 'Como devemos chamar você', 60, { min: 0 }) || 'Pessoa que encontrou';
    const message = string(req.body.message, 'Mensagem', 2000);
    const scope = `public-report:${req.params.code}`;
    const token = key ? derive('finder-capability', scope, key).toString('base64url') : secret();
    const result = performOperation(key, scope, { finderName, message }, () => {
      const tag = publicTag(req.params.code);
      if (get("SELECT COUNT(*) AS n FROM reports WHERE tag_id=? AND status='open'", tag.id).n >= 100) fail(429, 'Esta etiqueta recebeu muitos avisos. Tente novamente mais tarde.', 'REPORT_LIMIT');
      const id = randomUUID(); const at = now();
      run("INSERT INTO reports(id,tag_id,owner_id,tag_name,tag_code,finder_name,capability_hash,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'open',?,?)", id, tag.id, tag.owner_id, tag.name, tag.code, finderName, hash(token), at, at);
      const inserted = run("INSERT INTO messages(report_id,role,body,created_at) VALUES(?,'finder',?,?)", id, message, at);
      notificationService.enqueueMessage(id, Number(inserted.lastInsertRowid));
      return id;
    }, (id) => ({ report: reportView(get('SELECT * FROM reports WHERE id=? AND capability_hash=?', id, hash(token))), token, messages: messagesFor(id) }));
    res.status(201).json(result);
  });
  app.get('/api/reports', requireOwner, (req, res) => res.json({ reports: all('SELECT * FROM reports WHERE owner_id=? ORDER BY updated_at DESC, id DESC', req.user.id).map(reportView) }));
  app.get('/api/reports/:id', requireOwner, (req, res) => { const r = ownerReport(req); res.json({ report: reportView(r), messages: messagesFor(r.id) }); });
  app.post('/api/reports/:id/messages', requireOwner, messageLimit, (req, res) => res.status(201).json({ message: addMessage(ownerReport(req), 'owner', string(req.body.body, 'Mensagem', 2000), operationKey(req.body.operationKey)) }));
  app.post('/api/reports/:id/read', requireOwner, ownerWriteLimit, (req, res) => {
    const id = req.body.lastMessageId;
    if (!Number.isSafeInteger(id) || id < 0) fail(400, 'lastMessageId deve ser um inteiro não negativo.');
    const report = transaction(() => {
      const r = ownerReport(req);
      if (id !== 0 && !get('SELECT id FROM messages WHERE report_id=? AND id=?', r.id, id)) fail(400, 'A mensagem não pertence a esta conversa.');
      run('UPDATE reports SET owner_read_message_id=MAX(owner_read_message_id,?) WHERE id=?', id, r.id);
      return reportView(get('SELECT * FROM reports WHERE id=?', r.id));
    });
    res.json({ report });
  });
  app.post('/api/reports/:id/close', requireOwner, ownerWriteLimit, (req, res) => {
    const reason = req.body.reason;
    if (!['mistake', 'no_return', 'unwanted'].includes(reason)) fail(400, 'Motivo de encerramento inválido.');
    const report = transaction(() => {
      const r = ownerReport(req);
      if (r.status === 'open') {
        const at = now();
        run("UPDATE reports SET status='resolved',closed_reason=?,closed_at=?,updated_at=? WHERE id=?", reason, at, at, r.id);
      } else if (r.closed_reason !== reason) fail(409, 'Esta conversa já foi encerrada com outro motivo.', 'REPORT_RESOLVED');
      return reportView(get('SELECT * FROM reports WHERE id=?', r.id));
    });
    res.json({ report });
  });
  app.post('/api/reports/:id/resolve', requireOwner, ownerWriteLimit, (req, res) => {
    const result = transaction(() => {
      const report = ownerReport(req);
      if (report.status !== 'open') return reportView(report);
      const tag = get('SELECT * FROM tags WHERE id=? AND owner_id=?', report.tag_id, req.user.id);
      if (!tag) fail(409, 'A etiqueta foi transferida.', 'TAG_TRANSFERRED');
      const at = now();
      run("UPDATE reports SET status='resolved',closed_reason='returned',closed_at=?,updated_at=? WHERE tag_id=? AND owner_id=? AND status='open'", at, at, tag.id, req.user.id);
      run("UPDATE tags SET status='active',updated_at=?,returned_at=?,recovery_count=recovery_count+1 WHERE id=?", at, at, tag.id);
      run("INSERT INTO tag_events(tag_id,owner_id,type,status,created_at) VALUES(?,?,'returned','active',?)", tag.id, req.user.id, at);
      return reportView(get('SELECT * FROM reports WHERE id=?', report.id));
    });
    res.json({ report: result });
  });
  app.get('/api/finder/reports/:id', requireFinder, (req, res) => {
    const r = req.finderReport; const tag = get('SELECT * FROM tags WHERE id=?', r.tag_id);
    // A resolved conversation keeps its original item snapshot after ownership changes.
    const tagData = tag.owner_id === r.owner_id ? publicView(tag) : { code: r.tag_code, name: r.tag_name, category: 'other', color: '#B9C79B', publicMessage: '', status: 'active', rewardAmount: 0, rewardCurrency: 'BRL' };
    res.json({ report: reportView(r), messages: messagesFor(r.id), tag: tagData });
  });
  app.post('/api/finder/reports/:id/messages', requireFinder, messageLimit, (req, res) => res.status(201).json({ message: addMessage(req.finderReport, 'finder', string(req.body.body, 'Mensagem', 2000), operationKey(req.body.operationKey)) }));
  const notFound = (_req, res) => res.status(404).json({ error: 'Recurso não encontrado.', code: 'NOT_FOUND' });
  // Keep all unknown API routes as JSON, even when a web export is present.
  app.use('/api', notFound);
  if (webRoot) {
    app.use(async (req, res, next) => {
      if (!['GET', 'HEAD'].includes(req.method)) return next();
      let pathname;
      try { pathname = decodeURIComponent(req.path); } catch { return next(new HttpError(400, 'Endereço inválido.')); }
      // Reject traversal and hidden files before resolving disk paths. Also reject
      // symlinks escaping the export: only real files within webRoot are served.
      if (pathname.includes('\\') || pathname.includes('\0') || pathname.split('/').some((part) => part.startsWith('.')) || /^\/api(?:\/|$)/i.test(pathname)) return notFound(req, res);
      const candidate = resolve(webRoot, `.${pathname}`);
      if (!isInside(webRoot, candidate)) return notFound(req, res);
      let file;
      try {
        file = await realpath(candidate);
        if (!isInside(webRoot, file)) return notFound(req, res);
        if (!(await stat(file)).isFile()) return next();
      } catch (error) {
        if (['ENOENT', 'ENOTDIR', 'EACCES', 'ELOOP'].includes(error.code)) return next();
        throw error;
      }
      return res.sendFile(file, { cacheControl: false, dotfiles: 'deny' }, (error) => { if (error) next(error); });
    });
    app.use((req, res, next) => {
      // Only actual client routes receive the SPA shell; missing assets remain 404.
      if (req.method !== 'GET' || !/^\/(?:$|saved\/?$|(?:found|chat|owner-chat)\/[A-Za-z0-9_-]+\/?$)/.test(req.path)) return next();
      return res.sendFile(webIndex, { cacheControl: false }, (error) => { if (error) next(error); });
    });
  }
  app.use(notFound);
  app.use((err, _req, res, _next) => {
    if (res.headersSent) return res.end();
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'O conteúdo enviado é muito grande.', code: 'BODY_TOO_LARGE' });
    if (err instanceof SyntaxError && err.status === 400) return res.status(400).json({ error: 'JSON inválido.', code: 'INVALID_JSON' });
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code });
    if (Number.isInteger(err.status) && err.status >= 400 && err.status < 500) return res.status(err.status).json({ error: 'Não foi possível acessar este recurso.', code: 'INVALID_REQUEST' });
    // Never include request data, auth tokens, SQL, or stack traces in client-visible errors.
    console.error('SeekerTag: unexpected server error', err.name);
    res.status(500).json({ error: 'Não foi possível concluir. Tente novamente.', code: 'INTERNAL_ERROR' });
  });
  return app;
}
