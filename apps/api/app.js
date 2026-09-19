import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import QRCode from 'qrcode';
import { renderLabelPdf } from './label-pdf.js';
import { installAuth, migrateAuth } from './auth.js';
import { createOAuthProviders } from './oauth.js';
import { createCategories } from './categories.js';
import { createNotifications } from './notifications.js';
import { firebasePushFromEnv } from './firebase-push.js';
import { createRewards } from './rewards/index.js';
import { rewardChainFromEnv } from './rewards/chain.js';

const scrypt = promisify(scryptCallback);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const secret = () => randomBytes(32).toString('base64url');
const recovery = () => randomBytes(20).toString('hex').toUpperCase().match(/.{1,5}/g).join('-');
const normalizeRecovery = (value) => String(value || '').replaceAll('-', '').trim().toUpperCase();

class HttpError extends Error {
  constructor(status, error, code = 'INVALID_REQUEST') { super(error); this.status = status; this.code = code; }
}
const fail = (status, message, code) => { throw new HttpError(status, message, code); };
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
  if (!stored) return false;
  const [salt, expected] = stored.split(':');
  const actual = await scrypt(value, salt, 64, { N: 32768, maxmem: 64 * 1024 * 1024 });
  return timingSafeEqual(actual, Buffer.from(expected, 'hex'));
}
export function createApp({ dbPath = './data/seekertag.sqlite', publicUrl = 'http://localhost:4318', corsOrigins = [], rateLimits = true, trustedProxyHops = 0, oauthProviders = createOAuthProviders(), rewardChain = rewardChainFromEnv(), pushSender = firebasePushFromEnv() } = {}) {
  if (![0, 1].includes(trustedProxyHops)) throw new Error('TRUST_PROXY_HOPS must be 0 (direct access) or 1 (one private reverse proxy).');
  const canonical = new URL(publicUrl);
  if (!['http:', 'https:'].includes(canonical.protocol) || canonical.username || canonical.password || canonical.search || canonical.hash || canonical.pathname !== '/') throw new Error('PUBLIC_URL must be an http(s) origin without credentials, query, or path.');
  const publicOrigin = canonical.origin;
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(dbPath, { timeout: 5000 });
  if (dbPath !== ':memory:') chmodSync(dbPath, 0o600);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE,
      password_hash TEXT, recovery_hash TEXT, created_at TEXT NOT NULL
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
      finder_user_id TEXT REFERENCES users(id),
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
    CREATE INDEX IF NOT EXISTS tags_owner ON tags(owner_id);
    CREATE INDEX IF NOT EXISTS reports_owner ON reports(owner_id, updated_at);
    CREATE INDEX IF NOT EXISTS reports_tag ON reports(tag_id, owner_id, status);
    CREATE INDEX IF NOT EXISTS messages_report ON messages(report_id, id);
    CREATE INDEX IF NOT EXISTS events_tag ON tag_events(tag_id, owner_id);
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
  `);
  migrateAuth(db);
  // Older installations created finder conversations without an account. Keep
  // those conversations usable, while allowing their holder to save them.
  if (!db.prepare('PRAGMA table_info(reports)').all().some(column => column.name === 'finder_user_id')) {
    db.exec('ALTER TABLE reports ADD COLUMN finder_user_id TEXT REFERENCES users(id);');
  }
  db.exec('CREATE INDEX IF NOT EXISTS reports_finder_user ON reports(finder_user_id, updated_at);');
  const get = (sql, ...params) => db.prepare(sql).get(...params);
  const all = (sql, ...params) => db.prepare(sql).all(...params);
  const run = (sql, ...params) => db.prepare(sql).run(...params);
  const transaction = (fn) => { db.exec('BEGIN IMMEDIATE'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } };
  const categories = createCategories({ db, get, all, run, transaction, fail });
  const userView = (u) => {
    const identities = all('SELECT provider,subject FROM auth_identities WHERE user_id=? ORDER BY created_at,provider', u.id);
    return { id: u.id, name: u.name, email: u.email, createdAt: u.created_at,
      hasPassword: !!get('SELECT password_hash FROM users WHERE id=?', u.id)?.password_hash,
      providers: identities.map(identity => identity.provider), walletAddress: identities.find(identity => identity.provider === 'solana')?.subject || null };
  };
  const app = express();
  app.disable('x-powered-by');
  // Production has exactly one Caddy ingress and no published API port. Never
  // trust an arbitrary forwarding chain; direct/local deployments default to 0.
  app.set('trust proxy', trustedProxyHops);
  app.locals.db = db;
  app.locals.close = () => { notifications.close(); db.close(); };
  const origins = new Set([publicOrigin, ...corsOrigins]);
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store', 'Cross-Origin-Resource-Policy': 'cross-origin' });
    const origin = req.headers.origin;
    const appleCallback = req.method === 'POST' && req.path === '/api/auth/oauth/apple/callback' && origin === 'https://appleid.apple.com';
    if (origin && !origins.has(origin) && !appleCallback) return res.status(403).json({ error: 'Origem não autorizada.', code: 'ORIGIN_DENIED' });
    if (origin) res.set({ 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS', 'Access-Control-Expose-Headers': 'Content-Disposition' });
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.use(express.json({ limit: '16kb', strict: true }));
  app.use((req, _res, next) => {
    if (['POST', 'PATCH', 'DELETE'].includes(req.method) && req.body != null && (Array.isArray(req.body) || typeof req.body !== 'object')) return next(new HttpError(400, 'Envie um objeto JSON.'));
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
  // Public routes remain usable anonymously. A supplied session must be valid;
  // never silently turn an expired or malformed signed-in request anonymous.
  const optionalOwner = (req, res, next) => req.headers.authorization !== undefined ? requireOwner(req, res, next) : next();
  const { consumeProof } = installAuth({ app, get, all, run, transaction, fail, requireOwner, authLimit, makeSession, userView, publicOrigin, oauthProviders });
  categories.install(app, requireOwner, ownerWriteLimit);
  const notifications = createNotifications({ db, get, all, run, fail, publicOrigin, pushSender });
  notifications.install(app, requireOwner, ownerWriteLimit);
  app.locals.notifications = notifications;
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
    const tokenHash = hash(bearer(req));
    // A finder can use the original device capability or the account to which
    // they explicitly saved this conversation. Neither grants access to other
    // finder conversations.
    const report = get(`SELECT reports.* FROM reports
      LEFT JOIN sessions ON sessions.hash=? AND sessions.expires_at>?
      WHERE reports.id=? AND (reports.capability_hash=? OR reports.finder_user_id=sessions.user_id)`, tokenHash, Date.now(), req.params.id, tokenHash);
    if (!report) fail(404, 'Conversa não encontrada. Use o mesmo dispositivo em que enviou o aviso.', 'NOT_FOUND');
    req.finderReport = report; next();
  };
  const publicTag = (code) => {
    const tag = get('SELECT * FROM tags WHERE code=?', code);
    if (!tag) fail(404, 'Esta etiqueta não foi encontrada.', 'NOT_FOUND');
    if (tag.status === 'paused') fail(410, 'Esta etiqueta está pausada pelo dono.', 'TAG_PAUSED');
    return tag;
  };
  const rewards = createRewards({ db, get, all, run, transaction, fail, chain: rewardChain, publicOrigin, ownerTag, ownerReport, requireOwner, requireFinder, writeLimit: ownerWriteLimit });
  rewards.install(app);
  function tagView(t) {
    const counts = get("SELECT COUNT(*) AS total, SUM(CASE WHEN status='open' THEN 1 ELSE 0 END) AS open FROM reports WHERE tag_id=? AND owner_id=?", t.id, t.owner_id);
    const reward = rewards.view(rewards.current(t));
    return { id: t.id, code: t.code, name: t.name, category: t.category, ...categories.metadata(t.category_id), color: t.color, description: t.description, publicMessage: t.public_message, status: t.status, rewardAmount: t.reward_amount, rewardCurrency: t.reward_currency, publicUrl: `${publicOrigin}/found/${t.code}`, createdAt: t.created_at, updatedAt: t.updated_at, returnedAt: t.returned_at, recoveryCount: t.recovery_count, reportCount: counts.total, openReportCount: counts.open || 0, ...(reward ? { reward } : {}) };
  }
  const publicView = (t) => ({ code: t.code, name: t.name, category: t.category, categoryIcon: categories.metadata(t.category_id).categoryIcon, color: t.color, publicMessage: t.public_message, status: t.status, rewardAmount: t.reward_amount, rewardCurrency: t.reward_currency });
  function reportView(r) {
    const last = get('SELECT body FROM messages WHERE report_id=? ORDER BY id DESC LIMIT 1', r.id);
    const count = get('SELECT COUNT(*) AS n FROM messages WHERE report_id=?', r.id).n;
    return { id: r.id, tagId: r.tag_id, tagName: r.tag_name, tagCode: r.tag_code, finderName: r.finder_name, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at, lastMessage: last?.body || '', messageCount: count };
  }
  const messageView = (m) => ({ id: m.id, role: m.role, body: m.body, createdAt: m.created_at });
  const messagesFor = (id) => all('SELECT * FROM messages WHERE report_id=? ORDER BY id', id).map(messageView);
  function addMessage(report, role, body) {
    if (report.status !== 'open') fail(409, 'A devolução já foi concluída. Esta conversa está encerrada.', 'REPORT_RESOLVED');
    const tag = get('SELECT * FROM tags WHERE id=?', report.tag_id);
    if (tag.status === 'paused') fail(410, 'Esta etiqueta está pausada pelo dono.', 'TAG_PAUSED');
    if (get('SELECT COUNT(*) AS n FROM messages WHERE report_id=?', report.id).n >= 1000) fail(409, 'Esta conversa atingiu o limite de mensagens.', 'MESSAGE_LIMIT');
    const at = now();
    const id = transaction(() => {
      const result = run('INSERT INTO messages(report_id,role,body,created_at) VALUES(?,?,?,?)', report.id, role, body, at);
      run('UPDATE reports SET updated_at=? WHERE id=?', at, report.id);
      notifications.enqueue(report, role, Number(result.lastInsertRowid));
      return Number(result.lastInsertRowid);
    });
    return { id, role, body, createdAt: at };
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
    if (!user?.recovery_hash || !timingSafeEqual(Buffer.from(expected), Buffer.from(user.recovery_hash))) fail(401, 'E-mail ou código de recuperação incorretos.', 'INVALID_CREDENTIALS');
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
  app.post('/api/auth/logout', requireOwner, (req, res) => { run('DELETE FROM push_devices WHERE session_hash=?', req.sessionHash); run('DELETE FROM sessions WHERE hash=?', req.sessionHash); res.sendStatus(204); });
  app.get('/api/account/export', requireOwner, (req, res) => {
    const reports = all('SELECT * FROM reports WHERE owner_id=? ORDER BY created_at', req.user.id);
    res.set('Content-Disposition', 'attachment; filename="seekertag-backup.json"');
    res.json({ exportedAt: now(), user: userView(req.user), tags: all('SELECT * FROM tags WHERE owner_id=? ORDER BY created_at', req.user.id).map(tagView), reports: reports.map((r) => ({ ...reportView(r), messages: messagesFor(r.id) })) });
  });

  app.get('/api/tags', requireOwner, (req, res) => res.json({ tags: all('SELECT * FROM tags WHERE owner_id=? ORDER BY created_at DESC, id DESC', req.user.id).map(tagView) }));
  app.post('/api/tags', requireOwner, ownerWriteLimit, (req, res) => {
    const v = validateTag(req.body);
    const id = randomUUID(); const code = randomBytes(12).toString('base64url'); const at = now();
    transaction(() => {
      const categoryId = categories.forTag(req.user.id, req.body, v);
      run('INSERT INTO tags(id,code,owner_id,name,category,color,description,public_message,status,reward_amount,reward_currency,created_at,updated_at,category_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)', id, code, req.user.id, v.name, v.category, v.color, v.description, v.publicMessage, v.status, v.rewardAmount, v.rewardCurrency, at, at, categoryId);
      run('INSERT INTO tag_events(tag_id,owner_id,type,status,created_at) VALUES(?,?,?,?,?)', id, req.user.id, 'created', v.status, at);
    });
    res.status(201).json({ tag: tagView(get('SELECT * FROM tags WHERE id=?', id)) });
  });
  app.get('/api/tags/:id', requireOwner, async (req, res) => { const tag = ownerTag(req); const reward = await rewards.getState(tag); res.json({ tag: { ...tagView(ownerTag(req)), ...(reward ? { reward } : {}) } }); });
  app.patch('/api/tags/:id', requireOwner, ownerWriteLimit, (req, res) => {
    const t = ownerTag(req); const v = validateTag(req.body, t); const at = now();
    transaction(() => {
      rewards.assertEditable(t.id);
      if (v.rewardAmount !== t.reward_amount || v.rewardCurrency !== t.reward_currency) rewards.assertUnlocked(t.id);
      const categoryId = categories.forTag(req.user.id, req.body, v, t);
      run('UPDATE tags SET name=?,category=?,color=?,description=?,public_message=?,status=?,reward_amount=?,reward_currency=?,updated_at=?,category_id=? WHERE id=?', v.name, v.category, v.color, v.description, v.publicMessage, v.status, v.rewardAmount, v.rewardCurrency, at, categoryId, t.id);
      if (t.status !== v.status) run('INSERT INTO tag_events(tag_id,owner_id,type,status,created_at) VALUES(?,?,?,?,?)', t.id, req.user.id, 'status_changed', v.status, at);
    });
    res.json({ tag: tagView(get('SELECT * FROM tags WHERE id=?', t.id)) });
  });
  app.get('/api/tags/:id/history', requireOwner, (req, res) => {
    const tag = ownerTag(req);
    res.json({ events: all('SELECT id,type,status,created_at AS createdAt FROM tag_events WHERE tag_id=? AND owner_id=? ORDER BY id DESC', tag.id, req.user.id) });
  });
  app.post('/api/tags/:id/transfer', requireOwner, authLimit, async (req, res) => {
    const tag = ownerTag(req);
    const recipient = string(req.body.recipient ?? req.body.email, 'Quem vai receber', 254);
    if (recipient.includes('@')) fail(400, 'Use o ID da conta ou a carteira de quem vai receber.', 'RECIPIENT_ID_REQUIRED');
    const usingPassword = req.body.proof === undefined;
    if (usingPassword) {
      const pass = password(req.body.password);
      if (!(await passwordMatches(pass, req.user.password_hash))) fail(401, 'Senha incorreta.', 'INVALID_CREDENTIALS');
    }
    transaction(() => {
      // Reauthorize after hashing: recovery/logout/another transfer may occur while scrypt runs.
      const current = get('SELECT * FROM tags WHERE id=? AND owner_id=?', tag.id, req.user.id);
      if (!get('SELECT hash FROM sessions WHERE hash=? AND expires_at>?', req.sessionHash, Date.now()) || get('SELECT password_hash FROM users WHERE id=?', req.user.id)?.password_hash !== req.user.password_hash) fail(401, 'Entre novamente para continuar.', 'UNAUTHORIZED');
      if (!usingPassword) consumeProof(req, req.body.proof);
      if (!current) fail(404, 'Etiqueta não encontrada.', 'NOT_FOUND');
      rewards.assertUnlocked(tag.id);
      const target = get("SELECT users.id FROM users LEFT JOIN auth_identities ON auth_identities.user_id=users.id AND auth_identities.provider='solana' WHERE users.id=? OR auth_identities.subject=? LIMIT 1", recipient, recipient);
      if (!target) fail(404, 'A pessoa precisa criar uma conta SeekerTag antes da transferência.', 'RECIPIENT_NOT_FOUND');
      if (target.id === req.user.id) fail(400, 'A etiqueta já está na sua conta.');
      if (get("SELECT id FROM reports WHERE tag_id=? AND status='open'", tag.id)) fail(409, 'Conclua as conversas abertas antes de transferir esta etiqueta.', 'OPEN_REPORTS');
      const at = now();
      // Public QR remains valid; clear private notes, pledges, and previous recovery metrics before handing over.
      const category = categories.transfer(current, target.id);
      run("UPDATE tags SET owner_id=?,category_id=?,category=?,color=?,description='',public_message='',reward_amount=0,status='active',updated_at=?,returned_at=NULL,recovery_count=0 WHERE id=?", target.id, category.id, category.name, category.color, at, tag.id);
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
    const pdf = await renderLabelPdf({ tag, url, language: req.query.lang });
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="seekertag-${tag.code}.pdf"` }).send(pdf);
  });

  app.get('/api/public/tags/:code', optionalOwner, async (req, res) => {
    const tag = publicTag(req.params.code);
    const reward = await rewards.getState(tag);
    const { operation: _operation, ...publicReward } = reward || {};
    res.json({ tag: { ...publicView(tag), ...(reward ? { reward: publicReward } : {}) }, viewerIsOwner: req.user?.id === tag.owner_id });
  });
  app.post('/api/public/tags/:code/reports', optionalOwner, reportLimit, (req, res) => {
    const tag = publicTag(req.params.code);
    if (req.user?.id === tag.owner_id) fail(403, 'Você não pode enviar um aviso para seu próprio objeto.', 'SELF_REPORT');
    const finderName = string(req.body.finderName ?? '', 'Como devemos chamar você', 60, { min: 0 }) || 'Pessoa que encontrou';
    const message = string(req.body.message, 'Mensagem', 2000);
    if (get("SELECT COUNT(*) AS n FROM reports WHERE tag_id=? AND status='open'", tag.id).n >= 100) fail(429, 'Esta etiqueta recebeu muitos avisos. Tente novamente mais tarde.', 'REPORT_LIMIT');
    const id = randomUUID(); const token = secret(); const at = now();
    transaction(() => {
      run("INSERT INTO reports(id,tag_id,owner_id,tag_name,tag_code,finder_name,finder_user_id,capability_hash,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'open',?,?)", id, tag.id, tag.owner_id, tag.name, tag.code, finderName, req.user?.id || null, hash(token), at, at);
      const inserted = run("INSERT INTO messages(report_id,role,body,created_at) VALUES(?,'finder',?,?)", id, message, at);
      notifications.enqueue(get('SELECT * FROM reports WHERE id=?', id), 'finder', Number(inserted.lastInsertRowid));
    });
    res.status(201).json({ report: reportView(get('SELECT * FROM reports WHERE id=?', id)), token, messages: messagesFor(id) });
  });
  app.get('/api/reports', requireOwner, (req, res) => res.json({ reports: all('SELECT * FROM reports WHERE owner_id=? ORDER BY updated_at DESC, id DESC', req.user.id).map(reportView) }));
  app.get('/api/reports/:id', requireOwner, (req, res) => { const r = ownerReport(req); res.json({ report: reportView(r), messages: messagesFor(r.id) }); });
  app.post('/api/reports/:id/messages', requireOwner, messageLimit, (req, res) => res.status(201).json({ message: addMessage(ownerReport(req), 'owner', string(req.body.body, 'Mensagem', 2000)) }));
  app.post('/api/reports/:id/resolve', requireOwner, ownerWriteLimit, async (req, res) => {
    let report = ownerReport(req);
    const tag = get('SELECT * FROM tags WHERE id=? AND owner_id=?', report.tag_id, req.user.id);
    if (tag) await rewards.getState(tag);
    report = ownerReport(req);
    if (report.status === 'open') transaction(() => {
      rewards.assertUnlocked(report.tag_id);
      const tag = get('SELECT * FROM tags WHERE id=? AND owner_id=?', report.tag_id, req.user.id);
      if (!tag) fail(409, 'A etiqueta foi transferida.', 'TAG_TRANSFERRED');
      const at = now();
      run("UPDATE reports SET status='resolved',updated_at=? WHERE tag_id=? AND owner_id=? AND status='open'", at, tag.id, req.user.id);
      run("UPDATE tags SET status='active',updated_at=?,returned_at=?,recovery_count=recovery_count+1 WHERE id=?", at, at, tag.id);
      run("INSERT INTO tag_events(tag_id,owner_id,type,status,created_at) VALUES(?,?,'returned','active',?)", tag.id, req.user.id, at);
    });
    res.json({ report: reportView(get('SELECT * FROM reports WHERE id=?', report.id)) });
  });
  app.get('/api/finder/reports/:id', requireFinder, (req, res) => {
    const r = req.finderReport; const tag = get('SELECT * FROM tags WHERE id=?', r.tag_id);
    // A resolved conversation keeps its original item snapshot after ownership changes.
    const tagData = tag.owner_id === r.owner_id ? publicView(tag) : { code: r.tag_code, name: r.tag_name, category: 'other', color: '#B9C79B', publicMessage: '', status: 'active', rewardAmount: 0, rewardCurrency: 'BRL' };
    res.json({ report: reportView(r), messages: messagesFor(r.id), tag: tagData });
  });
  app.get('/api/finder/tags/:code/report', requireOwner, (req, res) => {
    const tag = publicTag(req.params.code);
    if (tag.owner_id === req.user.id) return res.json({ report: null });
    const report = get("SELECT * FROM reports WHERE tag_id=? AND finder_user_id=? AND status='open' ORDER BY updated_at DESC, id DESC LIMIT 1", tag.id, req.user.id);
    res.json({ report: report ? reportView(report) : null });
  });
  app.post('/api/finder/reports/:id/account', requireOwner, (req, res) => {
    const capability = typeof req.body.token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(req.body.token) ? req.body.token : null;
    if (!capability) fail(401, 'Abra a conversa no aparelho em que você enviou o aviso para salvá-la na conta.', 'FINDER_CAPABILITY_REQUIRED');
    const report = get('SELECT * FROM reports WHERE id=? AND capability_hash=?', req.params.id, hash(capability));
    if (!report) fail(404, 'Conversa não encontrada. Use o mesmo dispositivo em que enviou o aviso.', 'NOT_FOUND');
    if (report.owner_id === req.user.id) fail(403, 'O dono não pode salvar esta conversa como visitante.', 'SELF_REPORT');
    if (report.finder_user_id && report.finder_user_id !== req.user.id) fail(409, 'Esta conversa já foi salva em outra conta.', 'FINDER_ACCOUNT_LINKED');
    if (!report.finder_user_id) run('UPDATE reports SET finder_user_id=? WHERE id=?', req.user.id, report.id);
    res.json({ report: reportView(get('SELECT * FROM reports WHERE id=?', report.id)) });
  });
  app.post('/api/finder/reports/:id/messages', requireFinder, messageLimit, (req, res) => res.status(201).json({ message: addMessage(req.finderReport, 'finder', string(req.body.body, 'Mensagem', 2000)) }));
  const notFound = (_req, res) => res.status(404).json({ error: 'Recurso não encontrado.', code: 'NOT_FOUND' });
  // Printed HTTP links only hand off to the installed mobile app. No HTML or
  // static frontend is served; the origin comes from config, never from Host.
  app.get(/^\/(found|chat)\/([A-Za-z0-9_-]+)\/?$/, (req, res) => {
    const location = `seekertag:///${req.params[0]}/${req.params[1]}?origin=${encodeURIComponent(publicOrigin)}`;
    res.status(302).set('Location', location).end();
  });
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
