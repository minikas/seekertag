import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import bs58 from 'bs58';
import { createSignInMessage } from '@solana/wallet-standard-util';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createApp } from '../app.js';
import { createOAuthProviders, verifyIdentityToken } from '../oauth.js';

const origin = 'https://api.seekertag.example';
const hash = value => createHash('sha256').update(value).digest('base64url');
async function harness(options = {}) {
  const app = createApp({ dbPath: ':memory:', publicUrl: origin, rateLimits: false, oauthProviders: {}, ...options });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api`;
  async function request(path, body, token, extra = {}) {
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', redirect: 'manual', headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra.headers }, ...(body === undefined ? {} : { body: extra.rawBody ?? JSON.stringify(body) }) });
    const text = await response.text();
    return { status: response.status, data: text ? JSON.parse(text) : undefined, location: response.headers.get('location') };
  }
  return { app, request, close: async () => { await new Promise(resolve => server.close(resolve)); app.locals.close(); } };
}
function wallet() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const address = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);
  return { address: address.toString('base64'), subject: bs58.encode(address), sign(payload) { const message = createSignInMessage({ ...payload, address: bs58.encode(address) }); return { address: address.toString('base64'), signedMessage: Buffer.from(message).toString('base64'), signature: sign(null, message, privateKey).toString('base64') }; } };
}
async function walletAuth(h, key, mode = 'login', token) {
  const start = await h.request('/auth/wallet/challenge', { mode }, token); assert.equal(start.status, 200);
  return h.request('/auth/wallet/verify', { challengeId: start.data.challengeId, ...key.sign(start.data.payload) }, token);
}
async function legacy(h, email = 'legacy@example.com') { return (await h.request('/auth/register', { name: 'Conta existente', email, password: 'correct horse battery' })).data; }
function oauthFixture(identity = { subject: 'google-account-1', email: 'social@example.com', name: 'Pessoa Google' }) {
  return { authorizationUrl({ state, nonce, redirectUri }) { return `https://accounts.example/authorize?${new URLSearchParams({ state, nonce, redirect_uri: redirectUri })}`; }, async exchange({ code }) { if (code !== 'valid-code') throw new Error('Denied'); return identity; } };
}
async function oauthReturn(h, provider = 'google', mode = 'login', token, options = {}) {
  const verifier = randomBytes(32).toString('base64url');
  const start = await h.request(`/auth/oauth/${provider}/start`, { mode, codeChallenge: hash(verifier) }, token); assert.equal(start.status, 200, JSON.stringify(start.data));
  const state = new URL(start.data.url).searchParams.get('state');
  const query = new URLSearchParams({ state, code: options.code || 'valid-code' });
  const callback = provider === 'apple' ? await h.request('/auth/oauth/apple/callback', {}, undefined, { rawBody: query.toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'https://appleid.apple.com' } }) : await h.request(`/auth/oauth/google/callback?${query}`);
  assert.equal(callback.status, 303, JSON.stringify(callback.data));
  const location = new URL(callback.location);
  assert.equal(location.origin, 'null'); assert.equal(location.protocol, 'seekertag:');
  assert.equal(location.searchParams.has('token'), false);
  return { flowId: start.data.flowId, code: location.searchParams.get('code'), verifier, state };
}

test('wallet sign-in verifies Ed25519, creates one passwordless account and resumes it', async t => {
  const h = await harness(); t.after(h.close); const key = wallet();
  const first = await walletAuth(h, key); assert.equal(first.status, 200);
  assert.equal(first.data.user.email, null); assert.equal(first.data.user.hasPassword, false);
  assert.deepEqual(first.data.user.providers, ['solana']); assert.equal(first.data.user.walletAddress, key.subject);
  assert.equal((await h.request('/auth/me', undefined, first.data.token)).data.user.id, first.data.user.id);
  const second = await walletAuth(h, key); assert.equal(second.data.user.id, first.data.user.id);
  assert.notEqual(second.data.token, first.data.token);
  assert.equal(h.app.locals.db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1);
});

test('localized wallet statements remain bound to the exact signed challenge', async t => {
  const h = await harness(); t.after(h.close); const key = wallet();
  for (const [language, prefix] of [['pt', 'Entrar no'], ['en', 'Sign in'], ['es', 'Entrar en']]) {
    const start = (await h.request('/auth/wallet/challenge', { language })).data;
    assert.ok(start.payload.statement.startsWith(prefix));
    const altered = { ...start.payload, statement: 'Different request' };
    assert.equal((await h.request('/auth/wallet/verify', { challengeId: start.challengeId, ...key.sign(altered) })).status, 401);
    assert.equal((await h.request('/auth/wallet/verify', { challengeId: start.challengeId, ...key.sign(start.payload) })).status, 200);
  }
  assert.equal(h.app.locals.db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1);
});

test('wallet login rejects forged, wrong address/domain/nonce, expired and replayed signatures', async t => {
  const h = await harness(); t.after(h.close); const key = wallet();
  const start = (await h.request('/auth/wallet/challenge', {})).data;
  const proof = { challengeId: start.challengeId, ...key.sign(start.payload) };
  for (const payload of [{ ...proof, signature: randomBytes(64).toString('base64') }, { ...proof, address: wallet().address }, { challengeId: start.challengeId, ...key.sign({ ...start.payload, domain: 'evil.example' }) }, { challengeId: start.challengeId, ...key.sign({ ...start.payload, nonce: 'notthenonce' }) }]) assert.equal((await h.request('/auth/wallet/verify', payload)).status, 401);
  assert.equal((await h.request('/auth/wallet/verify', proof)).status, 200);
  assert.equal((await h.request('/auth/wallet/verify', proof)).status, 401);
  const expired = (await h.request('/auth/wallet/challenge', {})).data;
  h.app.locals.db.prepare('UPDATE auth_flows SET expires_at=0 WHERE id=?').run(expired.challengeId);
  assert.equal((await h.request('/auth/wallet/verify', { challengeId: expired.challengeId, ...key.sign(expired.payload) })).status, 401);
  assert.equal(h.app.locals.db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1);
});

test('linking requires the initiating live session and never takes a wallet from another account', async t => {
  const h = await harness(); t.after(h.close); const old = await legacy(h); const other = await legacy(h, 'other@example.com'); const key = wallet();
  assert.equal((await h.request('/auth/wallet/challenge', { mode: 'link' })).status, 401);
  const start = (await h.request('/auth/wallet/challenge', { mode: 'link' }, old.token)).data;
  const proof = { challengeId: start.challengeId, ...key.sign(start.payload) };
  assert.equal((await h.request('/auth/wallet/verify', proof, other.token)).status, 401);
  const linked = await h.request('/auth/wallet/verify', proof, old.token); assert.equal(linked.status, 200); assert.equal(linked.data.user.id, old.user.id); assert.equal(linked.data.token, undefined);
  assert.equal((await walletAuth(h, key)).data.user.id, old.user.id);
  assert.equal((await walletAuth(h, key, 'link', other.token)).status, 409);
  assert.equal((await walletAuth(h, wallet(), 'link', old.token)).status, 409);
  const revoked = (await h.request('/auth/wallet/challenge', { mode: 'link' }, other.token)).data;
  await h.request('/auth/logout', {}, other.token);
  assert.equal((await h.request('/auth/wallet/verify', { challengeId: revoked.challengeId, ...wallet().sign(revoked.payload) }, other.token)).status, 401);
});

test('passwordless transfer requires one-use reauthentication bound to the owner session', async t => {
  const h = await harness(); t.after(h.close); const key = wallet(); const owner = (await walletAuth(h, key)).data; const target = (await walletAuth(h, wallet())).data;
  const tag = (await h.request('/tags', { name: 'Chaves', category: 'Chaves' }, owner.token)).data.tag;
  assert.equal((await h.request(`/tags/${tag.id}/transfer`, { recipient: target.user.walletAddress }, owner.token)).status, 400);
  assert.equal((await walletAuth(h, wallet(), 'reauth', owner.token)).status, 403);
  const proof = (await walletAuth(h, key, 'reauth', owner.token)).data.proof;
  const anotherSession = (await walletAuth(h, key)).data;
  assert.equal((await h.request(`/tags/${tag.id}/transfer`, { recipient: target.user.walletAddress, proof }, anotherSession.token)).status, 401);
  assert.equal((await h.request(`/tags/${tag.id}/transfer`, { recipient: target.user.walletAddress, proof }, owner.token)).status, 200);
  assert.equal((await h.request('/tags', undefined, target.token)).data.tags[0].id, tag.id);
  const next = (await h.request('/tags', { name: 'Segunda etiqueta' }, owner.token)).data.tag;
  assert.equal((await h.request(`/tags/${next.id}/transfer`, { recipient: target.user.id, proof }, owner.token)).status, 401);
});

test('OAuth callbacks bind provider, state and app proof; codes cannot be intercepted or replayed', async t => {
  const h = await harness({ oauthProviders: { google: oauthFixture() } }); t.after(h.close);
  assert.equal((await h.request('/auth/providers')).data.google, true);
  assert.equal((await h.request('/auth/oauth/google/callback?state=invalid&code=valid-code')).status, 400);
  const result = await oauthReturn(h);
  assert.equal((await h.request(`/auth/oauth/google/callback?state=${result.state}&code=valid-code`)).status, 400);
  assert.equal((await h.request('/auth/oauth/exchange', { ...result, verifier: randomBytes(32).toString('base64url') })).status, 401);
  const session = await h.request('/auth/oauth/exchange', result); assert.equal(session.status, 200);
  assert.equal(session.data.user.email, 'social@example.com'); assert.equal(session.data.user.hasPassword, false);
  assert.deepEqual(session.data.user.providers, ['google']);
  assert.equal((await h.request('/auth/oauth/exchange', result)).status, 401);
  const next = await h.request('/auth/oauth/exchange', await oauthReturn(h)); assert.equal(next.data.user.id, session.data.user.id);
  assert.equal((await h.request('/auth/recover', { email: session.data.user.email, recoveryCode: 'bad', password: 'long enough password' })).status, 401);
});

test('Apple form_post works on Android; provider failures and unconfigured logins fail closed', async t => {
  const h = await harness({ oauthProviders: { apple: oauthFixture({ subject: 'apple1', email: null, name: 'Conta Apple' }) } }); t.after(h.close);
  assert.deepEqual((await h.request('/auth/providers')).data, { solana: true, google: false, apple: true });
  assert.equal((await h.request('/auth/oauth/google/start', { codeChallenge: hash('valid-verifier') })).status, 503);
  const result = await h.request('/auth/oauth/exchange', await oauthReturn(h, 'apple'));
  assert.equal(result.status, 200); assert.deepEqual(result.data.user.providers, ['apple']); assert.equal(result.data.user.email, null);
  const rejected = await oauthReturn(h, 'apple', 'login', undefined, { code: 'rejected-code' });
  assert.equal((await h.request('/auth/oauth/exchange', rejected)).status, 401);
  assert.equal(h.app.locals.db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1);
  const local = await harness({ publicUrl: 'http://127.0.0.1:4318', oauthProviders: { apple: oauthFixture() } }); t.after(local.close);
  assert.equal((await local.request('/auth/providers')).data.apple, false);
});

test('social login never merges a legacy account by email; linking preserves objects and sessions', async t => {
  const h = await harness({ oauthProviders: { google: oauthFixture({ subject: 'google-legacy', email: 'legacy@example.com', name: 'Pessoa Google' }) } }); t.after(h.close);
  const old = await legacy(h); const tag = (await h.request('/tags', { name: 'Objeto antigo' }, old.token)).data.tag;
  assert.equal((await h.request('/auth/oauth/exchange', await oauthReturn(h))).status, 409);
  const linked = await h.request('/auth/oauth/exchange', await oauthReturn(h, 'google', 'link', old.token), old.token);
  assert.equal(linked.status, 200); assert.equal(linked.data.user.id, old.user.id); assert.equal(linked.data.user.hasPassword, true);
  const login = (await h.request('/auth/oauth/exchange', await oauthReturn(h))).data;
  assert.equal(login.user.id, old.user.id); assert.equal((await h.request('/tags', undefined, login.token)).data.tags[0].id, tag.id);
  assert.equal((await h.request('/auth/me', undefined, old.token)).status, 200);
});

test('legacy database migration preserves IDs, credentials, sessions and foreign keys across restart', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'seekertag-auth-migration-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dbPath = join(dir, 'test.sqlite');
  const db = new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,recovery_hash TEXT NOT NULL,created_at TEXT NOT NULL) STRICT;
    CREATE TABLE sessions(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires_at INTEGER NOT NULL) STRICT;`);
  db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run('legacy-id', 'Legacy', 'old@example.com', 'original-hash', 'original-recovery', '2026-01-01');
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run('old-session', 'legacy-id', Date.now() + 100000); db.close();
  const first = await harness({ dbPath });
  assert.equal(first.app.locals.db.prepare('SELECT password_hash FROM users').get().password_hash, 'original-hash');
  assert.equal(first.app.locals.db.prepare('SELECT user_id FROM sessions').get().user_id, 'legacy-id');
  assert.deepEqual(first.app.locals.db.prepare('PRAGMA foreign_key_check').all(), []);
  const key = wallet(); const created = (await walletAuth(first, key)).data; await first.close();
  const reopened = await harness({ dbPath }); t.after(reopened.close);
  assert.equal((await walletAuth(reopened, key)).data.user.id, created.user.id);
  assert.equal(reopened.app.locals.db.prepare('SELECT recovery_hash FROM users WHERE id=?').get('legacy-id').recovery_hash, 'original-recovery');
});

test('OIDC checks the signature, issuer, audience, nonce, expiry and verified email', async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey); jwk.kid = 'test-key';
  const keys = createLocalJWKSet({ keys: [jwk] });
  const claims = { sub: 'google-sub', nonce: 'expected-nonce', email: 'Person@Example.com', email_verified: true };
  async function token(overrides = {}, issuer = 'https://accounts.google.com', aud = 'client-id', key = privateKey) { return new SignJWT({ ...claims, ...overrides }).setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).setIssuer(issuer).setAudience(aud).setIssuedAt().setExpirationTime(overrides.exp ?? '5m').sign(key); }
  const config = { clientId: 'client-id', nonce: 'expected-nonce', keys };
  assert.equal((await verifyIdentityToken('google', await token(), config)).email, 'person@example.com');
  assert.equal((await verifyIdentityToken('google', await token({ email_verified: false }), config)).email, null);
  for (const bad of [await token({ nonce: 'wrong' }), await token({}, 'https://evil.example'), await token({}, undefined, 'other-client'), await token({ exp: 1 }), await token({ azp: 'other-client' }), await token({}, undefined, undefined, (await generateKeyPair('RS256')).privateKey)]) await assert.rejects(verifyIdentityToken('google', bad, config));
  const apple = await token({ email_verified: 'true' }, 'https://appleid.apple.com'); assert.equal((await verifyIdentityToken('apple', apple, config)).subject, 'google-sub');
  assert.deepEqual(createOAuthProviders({}), {});
  const configured = createOAuthProviders({ GOOGLE_CLIENT_ID: 'client-id', GOOGLE_CLIENT_SECRET: 'test-only-secret' });
  const url = new URL(configured.google.authorizationUrl({ state: 'state', nonce: 'nonce', redirectUri: origin + '/callback', verifier: 'verifier' }));
  assert.equal(url.searchParams.get('code_challenge'), hash('verifier')); assert.equal(url.searchParams.has('client_secret'), false);
});
