import { walletStatement } from './auth-copy.js';
import express from 'express';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import bs58 from 'bs58';
import { verifySignIn } from '@solana/wallet-standard-util';

const secret = () => randomBytes(32).toString('base64url');
const hash = value => createHash('sha256').update(value).digest('hex');
const challengeHash = value => createHash('sha256').update(value).digest('base64url');
const RETURN_URL = 'seekertag://auth/callback';
const FLOW_MS = 10 * 60_000;

export function migrateAuth(db) {
  // Rebuild only users, preserving IDs and every child table/foreign key.
  if (db.prepare('PRAGMA table_info(users)').all().find(column => column.name === 'email')?.notnull) {
    db.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;');
    try {
      db.exec(`CREATE TABLE users_social_migration (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE,
        password_hash TEXT, recovery_hash TEXT, created_at TEXT NOT NULL
      ) STRICT;
      INSERT INTO users_social_migration SELECT id,name,email,password_hash,recovery_hash,created_at FROM users;
      DROP TABLE users;
      ALTER TABLE users_social_migration RENAME TO users;`);
      if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Authentication migration violated a foreign key');
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    finally { db.exec('PRAGMA foreign_keys=ON'); }
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_identities (
      provider TEXT NOT NULL CHECK(provider IN ('solana','google','apple')), subject TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id), email TEXT, created_at TEXT NOT NULL,
      PRIMARY KEY(provider,subject), UNIQUE(user_id,provider)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS auth_flows (
      id TEXT PRIMARY KEY, provider TEXT NOT NULL, mode TEXT NOT NULL,
      user_id TEXT REFERENCES users(id), session_hash TEXT, payload TEXT NOT NULL,
      state_hash TEXT UNIQUE, client_challenge TEXT, handoff_hash TEXT UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending', result TEXT, expires_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS auth_proofs (
      hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), session_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS auth_flows_expiry ON auth_flows(expires_at);
  `);
}

export function installAuth({ app, get, all, run, transaction, fail, requireOwner, authLimit, makeSession, userView, publicOrigin, oauthProviders }) {
  function clean() {
    run('DELETE FROM auth_flows WHERE expires_at <= ?', Date.now());
    run('DELETE FROM auth_proofs WHERE expires_at <= ?', Date.now());
    if (get('SELECT COUNT(*) AS n FROM auth_flows').n >= 10000) fail(429, 'Aguarde antes de tentar novamente.', 'RATE_LIMITED');
  }
  function context(req) {
    const mode = req.body.mode || 'login';
    if (!['login', 'link', 'reauth'].includes(mode)) fail(400, 'Operação de autenticação inválida.');
    if (mode !== 'login') requireOwner(req, null, () => {});
    return { mode, userId: req.user?.id || null, sessionHash: req.sessionHash || null };
  }
  function boundSession(flow, req) {
    if (flow.mode === 'login') return;
    requireOwner(req, null, () => {});
    if (req.user.id !== flow.user_id || req.sessionHash !== flow.session_hash) fail(401, 'Entre novamente e repita a confirmação.', 'UNAUTHORIZED');
  }
  function finish(flow, identity) {
    const existing = get('SELECT * FROM auth_identities WHERE provider=? AND subject=?', flow.provider, identity.subject);
    let userId = existing?.user_id;
    if (flow.mode === 'reauth') {
      if (userId !== flow.user_id) fail(403, 'Use o mesmo acesso vinculado à sua conta.', 'IDENTITY_MISMATCH');
      const proof = secret();
      run('INSERT INTO auth_proofs(hash,user_id,session_hash,expires_at) VALUES(?,?,?,?)', hash(proof), userId, flow.session_hash, Date.now() + 5 * 60_000);
      return { proof };
    }
    if (flow.mode === 'link') {
      if (existing && userId !== flow.user_id) fail(409, 'Este acesso já pertence a outra conta SeekerTag.', 'IDENTITY_EXISTS');
      const linked = get('SELECT subject FROM auth_identities WHERE provider=? AND user_id=?', flow.provider, flow.user_id);
      if (linked && linked.subject !== identity.subject) fail(409, 'Sua conta já tem outro acesso deste provedor.', 'PROVIDER_LINKED');
      userId = flow.user_id;
    }
    if (!existing) {
      // An email is never sufficient proof to merge two accounts.
      const emailOwner = identity.email && get('SELECT id FROM users WHERE email=?', identity.email);
      if (emailOwner && emailOwner.id !== userId) fail(409, 'Este e-mail já tem uma conta. Entre com seu acesso atual e vincule este provedor em Minha conta.', 'ACCOUNT_EXISTS');
      if (!userId) {
        userId = randomUUID();
        run('INSERT INTO users(id,name,email,password_hash,recovery_hash,created_at) VALUES(?,?,?,NULL,NULL,?)', userId, identity.name, identity.email || null, new Date().toISOString());
      }
      run('INSERT INTO auth_identities(provider,subject,user_id,email,created_at) VALUES(?,?,?,?,?)', flow.provider, identity.subject, userId, identity.email || null, new Date().toISOString());
      if (identity.email) run('UPDATE users SET email=COALESCE(email,?) WHERE id=?', identity.email, userId);
    }
    const user = userView(get('SELECT * FROM users WHERE id=?', userId));
    return flow.mode === 'link' ? { user } : { token: makeSession(userId), user };
  }
  function providerFor(value) {
    if (!['google', 'apple'].includes(value)) fail(404, 'Provedor desconhecido.', 'NOT_FOUND');
    const provider = oauthProviders[value];
    if (!provider || !publicOrigin.startsWith('https://')) fail(503, 'Este login ainda não está disponível. Continue com sua carteira ou seu acesso atual.', 'PROVIDER_UNAVAILABLE');
    return provider;
  }
  app.get('/api/auth/providers', (_req, res) => res.json({ solana: true, google: !!oauthProviders.google && publicOrigin.startsWith('https://'), apple: !!oauthProviders.apple && publicOrigin.startsWith('https://') }));
  app.post('/api/auth/wallet/challenge', authLimit, (req, res) => {
    clean();
    const ctx = context(req);
    const id = randomUUID();
    const issued = Date.now();
    const payload = {
      domain: new URL(publicOrigin).host, uri: publicOrigin, version: '1', chainId: 'solana:mainnet',
      statement: walletStatement(req.body.language, ctx.mode),
      nonce: randomBytes(24).toString('hex'), issuedAt: new Date(issued).toISOString(), expirationTime: new Date(issued + 5 * 60_000).toISOString(),
    };
    run('INSERT INTO auth_flows(id,provider,mode,user_id,session_hash,payload,expires_at) VALUES(?,?,?,?,?,?,?)', id, 'solana', ctx.mode, ctx.userId, ctx.sessionHash, JSON.stringify(payload), issued + 5 * 60_000);
    res.json({ challengeId: id, payload });
  });
  app.post('/api/auth/wallet/verify', authLimit, (req, res) => {
    const { challengeId, address, signedMessage, signature } = req.body;
    if (typeof challengeId !== 'string') fail(400, 'Confirmação inválida.');
    const flow = get("SELECT * FROM auth_flows WHERE id=? AND provider='solana' AND expires_at>?", challengeId, Date.now());
    if (!flow) fail(401, 'A confirmação expirou ou já foi usada. Tente novamente.', 'CHALLENGE_EXPIRED');
    boundSession(flow, req);
    let subject;
    try {
      const decode = (value, max) => {
        if (typeof value !== 'string' || !value || value.length > max || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error('Invalid encoding');
        const bytes = Buffer.from(value, 'base64');
        if (bytes.toString('base64') !== value) throw new Error('Noncanonical encoding');
        return bytes;
      };
      const publicKey = decode(address, 44); const sig = decode(signature, 88); const message = decode(signedMessage, 6000);
      if (publicKey.length !== 32 || sig.length !== 64) throw new Error('Invalid key/signature');
      subject = bs58.encode(publicKey);
      // Bind the address in the signed text to the verifying public key as well.
      if (!verifySignIn({ ...JSON.parse(flow.payload), address: subject }, { account: { address: subject, publicKey, chains: [], features: [] }, signedMessage: message, signature: sig, signatureType: 'ed25519' })) throw new Error('Invalid signature');
    } catch { fail(401, 'A carteira não confirmou este pedido de acesso. Tente novamente.', 'INVALID_SIGNATURE'); }
    const result = transaction(() => {
      if (!run('DELETE FROM auth_flows WHERE id=? AND expires_at>?', flow.id, Date.now()).changes) fail(401, 'Confirmação já usada.', 'CHALLENGE_EXPIRED');
      return finish(flow, { subject, name: `Solana ${subject.slice(0, 4)}…${subject.slice(-4)}`, email: null });
    });
    res.json(result);
  });
  app.post('/api/auth/oauth/:provider/start', authLimit, (req, res) => {
    const provider = providerFor(req.params.provider);
    const ctx = context(req);
    const challenge = req.body.codeChallenge;
    if (typeof challenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) fail(400, 'Confirmação do aplicativo inválida.');
    clean();
    const id = randomUUID(); const state = secret();
    const payload = { nonce: secret(), verifier: secret(), redirectUri: `${publicOrigin}/api/auth/oauth/${req.params.provider}/callback` };
    run('INSERT INTO auth_flows(id,provider,mode,user_id,session_hash,payload,state_hash,client_challenge,expires_at) VALUES(?,?,?,?,?,?,?,?,?)', id, req.params.provider, ctx.mode, ctx.userId, ctx.sessionHash, JSON.stringify(payload), hash(state), challenge, Date.now() + FLOW_MS);
    res.json({ flowId: id, url: provider.authorizationUrl({ ...payload, state }) });
  });
  async function callback(req, res) {
    const provider = providerFor(req.params.provider);
    const params = req.method === 'POST' ? req.body : req.query;
    if (typeof params.state !== 'string' || params.state.length > 100) fail(400, 'Retorno de autenticação inválido.');
    const flow = get("SELECT * FROM auth_flows WHERE provider=? AND state_hash=? AND status='pending' AND expires_at>?", req.params.provider, hash(params.state), Date.now());
    if (!flow) fail(400, 'Este pedido expirou ou já foi usado. Volte ao aplicativo.');
    run("UPDATE auth_flows SET status='processing' WHERE id=?", flow.id);
    let result;
    try {
      if (params.error) throw new Error('Authorization cancelled');
      if (typeof params.code !== 'string' || !params.code || params.code.length > 4096) throw new Error('Invalid code');
      result = { identity: await provider.exchange({ ...JSON.parse(flow.payload), code: params.code }) };
    } catch { result = { error: 'Não foi possível concluir o login. Volte ao aplicativo e tente novamente.' }; }
    const code = secret();
    run("UPDATE auth_flows SET status='complete',handoff_hash=?,result=?,payload='{}' WHERE id=?", hash(code), JSON.stringify(result), flow.id);
    // Neither provider tokens nor SeekerTag session tokens travel in a deep link.
    const redirect = new URL(RETURN_URL); redirect.search = new URLSearchParams({ code, state: flow.id }).toString();
    res.status(303).set('Location', redirect.href).end();
  }
  app.get('/api/auth/oauth/:provider/callback', authLimit, callback);
  app.post('/api/auth/oauth/:provider/callback', authLimit, express.urlencoded({ extended: false, limit: '16kb', parameterLimit: 10 }), callback);
  app.post('/api/auth/oauth/exchange', authLimit, (req, res) => {
    const { flowId, code, verifier } = req.body;
    if (typeof flowId !== 'string' || typeof code !== 'string' || code.length > 100 || typeof verifier !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(verifier)) fail(400, 'Retorno de autenticação inválido.');
    const flow = get("SELECT * FROM auth_flows WHERE id=? AND status='complete' AND handoff_hash=? AND expires_at>?", flowId, hash(code), Date.now());
    if (!flow || flow.client_challenge !== challengeHash(verifier)) fail(401, 'Esta confirmação não pertence ao seu aplicativo ou expirou.', 'INVALID_AUTH_CODE');
    boundSession(flow, req);
    const value = JSON.parse(flow.result);
    if (value.error) { run('DELETE FROM auth_flows WHERE id=?', flow.id); fail(401, value.error, 'PROVIDER_REJECTED'); }
    res.json(transaction(() => { run('DELETE FROM auth_flows WHERE id=?', flow.id); return finish(flow, value.identity); }));
  });
  return {
    consumeProof(req, proof) {
      if (typeof proof !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(proof) || !run('DELETE FROM auth_proofs WHERE hash=? AND user_id=? AND session_hash=? AND expires_at>?', hash(proof), req.user.id, req.sessionHash, Date.now()).changes) fail(401, 'Confirme novamente com o acesso da sua conta.', 'REAUTH_REQUIRED');
    },
  };
}
