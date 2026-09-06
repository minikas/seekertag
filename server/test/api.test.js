import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, statSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createApp } from '../app.js';

async function harness(options = {}) {
  const app = createApp({ dbPath: ':memory:', rateLimits: false, ...options });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api`;
  async function request(path, { method = 'GET', token, body, headers = {}, root = false } = {}) {
    const response = await fetch((root ? base.slice(0, -4) : base) + path, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const bytes = Buffer.from(await response.arrayBuffer());
    let data;
    if (bytes.length && response.headers.get('content-type')?.includes('application/json')) data = JSON.parse(bytes.toString());
    return { status: response.status, data, bytes, headers: response.headers };
  }
  let userCount = 0;
  async function register(name = 'Pessoa dona', mail) {
    const result = await request('/auth/register', { method: 'POST', body: { name, email: mail || `person${++userCount}@example.com`, password: 'correct horse battery' } });
    assert.equal(result.status, 201, JSON.stringify(result.data));
    return result.data;
  }
  async function tag(owner, fields = {}) {
    const result = await request('/tags', { method: 'POST', token: owner.token, body: { name: 'Mochila preta', category: 'Mochila', color: '#BCD5A6', description: 'Nota privada: 11 99999-0000', publicMessage: 'Obrigado por ajudar!', ...fields } });
    assert.equal(result.status, 201, JSON.stringify(result.data));
    return result.data.tag;
  }
  async function report(tag, message = 'Encontrei sua mochila na recepção.') {
    const result = await request(`/public/tags/${tag.code}/reports`, { method: 'POST', body: { finderName: 'Alex', message } });
    assert.equal(result.status, 201, JSON.stringify(result.data));
    return result.data;
  }
  const close = async () => { await new Promise((resolve) => server.close(resolve)); app.locals.close(); };
  return { app, request, register, tag, report, close };
}

test('complete return lifecycle relays messages, preserves privacy, and records exactly one recovery', async (t) => {
  const h = await harness(); t.after(h.close);
  const owner = await h.register('Dona Maria', 'private-owner@example.com');
  const tag = await h.tag(owner, { rewardAmount: 25, rewardCurrency: 'BRL' });
  assert.equal(tag.status, 'active'); assert.equal(tag.reportCount, 0);
  assert.match(tag.publicUrl, /^http:\/\/localhost:8081\/found\/[\w-]{16}$/);
  const publicResult = await h.request(`/public/tags/${tag.code}`);
  assert.equal(publicResult.status, 200);
  assert.deepEqual(Object.keys(publicResult.data.tag).sort(), ['category', 'code', 'color', 'name', 'publicMessage', 'rewardAmount', 'rewardCurrency', 'status']);
  assert.ok(!JSON.stringify(publicResult.data).includes('private-owner'));
  assert.ok(!JSON.stringify(publicResult.data).includes('99999'));
  assert.equal((await h.request(`/tags/${tag.id}`, { token: owner.token, method: 'PATCH', body: { status: 'lost' } })).data.tag.status, 'lost');
  const found = await h.report(tag);
  const another = await h.report(tag, 'Também vi o item na recepção.');
  assert.equal(found.messages.length, 1);
  const reply = await h.request(`/reports/${found.report.id}/messages`, { token: owner.token, method: 'POST', body: { body: 'Obrigado! Podemos nos encontrar na recepção?' } });
  assert.equal(reply.status, 201); assert.equal(reply.data.message.role, 'owner');
  const finderThread = await h.request(`/finder/reports/${found.report.id}`, { token: found.token });
  assert.equal(finderThread.data.messages.length, 2); assert.equal(finderThread.data.messages[1].body, reply.data.message.body);
  assert.equal((await h.request(`/finder/reports/${found.report.id}/messages`, { token: found.token, method: 'POST', body: { body: 'Sim, às 15h.' } })).status, 201);
  const ownerThread = await h.request(`/reports/${found.report.id}`, { token: owner.token });
  assert.equal(ownerThread.data.messages.length, 3);
  assert.equal((await h.request('/reports', { token: owner.token })).data.reports.length, 2);
  const resolve = await h.request(`/reports/${found.report.id}/resolve`, { token: owner.token, method: 'POST' });
  assert.equal(resolve.data.report.status, 'resolved');
  assert.equal((await h.request(`/finder/reports/${another.report.id}`, { token: another.token })).data.report.status, 'resolved');
  assert.equal((await h.request(`/reports/${found.report.id}/resolve`, { token: owner.token, method: 'POST' })).status, 200);
  const current = (await h.request(`/tags/${tag.id}`, { token: owner.token })).data.tag;
  assert.equal(current.status, 'active'); assert.equal(current.recoveryCount, 1); assert.equal(current.openReportCount, 0); assert.ok(current.returnedAt);
  assert.equal((await h.request(`/finder/reports/${found.report.id}/messages`, { token: found.token, method: 'POST', body: { body: 'A resolved thread cannot be spammed.' } })).status, 409);
  const history = (await h.request(`/tags/${tag.id}/history`, { token: owner.token })).data.events;
  assert.deepEqual(history.map((e) => e.type), ['returned', 'status_changed', 'created']);
});

test('owner authorization and finder capabilities cannot be swapped or supplied in query parameters', async (t) => {
  const h = await harness(); t.after(h.close);
  const owner = await h.register(); const stranger = await h.register(); const tag = await h.tag(owner); const found = await h.report(tag);
  for (const suffix of ['', '/history', '/qr.png', '/label.pdf']) assert.equal((await h.request(`/tags/${tag.id}${suffix}`, { token: stranger.token })).status, 404);
  assert.equal((await h.request(`/tags/${tag.id}`, { method: 'PATCH', token: stranger.token, body: { name: 'stolen' } })).status, 404);
  for (const path of ['/tags', `/tags/${tag.id}`, `/reports/${found.report.id}`]) assert.equal((await h.request(path)).status, 401);
  assert.equal((await h.request(`/reports/${found.report.id}`, { token: stranger.token })).status, 404);
  assert.equal((await h.request(`/reports/${found.report.id}/messages`, { token: stranger.token, method: 'POST', body: { body: 'intrusion' } })).status, 404);
  assert.equal((await h.request(`/reports/${found.report.id}/resolve`, { token: stranger.token, method: 'POST' })).status, 404);
  assert.equal((await h.request(`/finder/reports/${found.report.id}?token=${found.token}`)).status, 401);
  assert.equal((await h.request(`/finder/reports/${found.report.id}`, { token: owner.token })).status, 404);
  assert.equal((await h.request('/tags', { token: found.token })).status, 401);
  const another = await h.report(tag);
  assert.equal((await h.request(`/finder/reports/${found.report.id}`, { token: another.token })).status, 404);
  assert.equal((await h.request(`/finder/reports/${found.report.id}/messages`, { token: another.token, method: 'POST', body: { body: 'intrusion' } })).status, 404);
});

test('paused labels stop lookup, new reports, and message writes; reactivation resumes relay', async (t) => {
  const h = await harness(); t.after(h.close);
  const owner = await h.register(); const tag = await h.tag(owner); const found = await h.report(tag);
  assert.equal((await h.request(`/tags/${tag.id}`, { token: owner.token, method: 'PATCH', body: { status: 'paused' } })).status, 200);
  assert.equal((await h.request(`/public/tags/${tag.code}`)).status, 410);
  assert.equal((await h.request(`/public/tags/${tag.code}/reports`, { method: 'POST', body: { message: 'new report' } })).status, 410);
  assert.equal((await h.request(`/finder/reports/${found.report.id}/messages`, { token: found.token, method: 'POST', body: { body: 'hello' } })).status, 410);
  assert.equal((await h.request(`/reports/${found.report.id}/messages`, { token: owner.token, method: 'POST', body: { body: 'hello' } })).status, 410);
  assert.equal((await h.request(`/finder/reports/${found.report.id}`, { token: found.token })).data.tag.status, 'paused');
  await h.request(`/tags/${tag.id}`, { token: owner.token, method: 'PATCH', body: { status: 'active' } });
  assert.equal((await h.request(`/finder/reports/${found.report.id}/messages`, { token: found.token, method: 'POST', body: { body: 'hello again' } })).status, 201);
});

test('transfer needs current password and resolved reports, clears private information, isolates old chat history', async (t) => {
  const h = await harness(); t.after(h.close);
  const original = await h.register('Owner 1', 'first@example.com'); const recipient = await h.register('Owner 2', 'second@example.com'); const tag = await h.tag(original, { rewardAmount: 30 }); const found = await h.report(tag);
  const transfer = (passwordValue = 'correct horse battery') => h.request(`/tags/${tag.id}/transfer`, { token: original.token, method: 'POST', body: { email: recipient.user.email, password: passwordValue } });
  assert.equal((await transfer('wrong password here')).status, 401);
  assert.equal((await transfer()).data.code, 'OPEN_REPORTS');
  await h.request(`/reports/${found.report.id}/resolve`, { token: original.token, method: 'POST' });
  assert.equal((await transfer()).status, 200);
  assert.equal((await h.request(`/tags/${tag.id}`, { token: original.token })).status, 404);
  const transferred = (await h.request(`/tags/${tag.id}`, { token: recipient.token })).data.tag;
  assert.equal(transferred.code, tag.code); assert.equal(transferred.description, ''); assert.equal(transferred.publicMessage, ''); assert.equal(transferred.rewardAmount, 0); assert.equal(transferred.recoveryCount, 0); assert.equal(transferred.reportCount, 0);
  assert.equal((await h.request(`/reports/${found.report.id}`, { token: recipient.token })).status, 404);
  assert.equal((await h.request('/reports', { token: recipient.token })).data.reports.length, 0);
  assert.equal((await h.request(`/reports/${found.report.id}`, { token: original.token })).status, 200);
  const postTransfer = await h.report(tag);
  assert.equal((await h.request(`/reports/${postTransfer.report.id}`, { token: original.token })).status, 404);
  assert.equal((await h.request(`/reports/${postTransfer.report.id}`, { token: recipient.token })).status, 200);
  const events = (await h.request(`/tags/${tag.id}/history`, { token: recipient.token })).data.events;
  assert.deepEqual(events.map((e) => e.type), ['transferred_in']);
});

test('recovery codes are one-use, rotate password and recovery code, revoke all sessions', async (t) => {
  const h = await harness(); t.after(h.close);
  const owner = await h.register(); await h.tag(owner);
  const login = await h.request('/auth/login', { method: 'POST', body: { email: owner.user.email.toUpperCase(), password: 'correct horse battery' } });
  assert.equal(login.status, 200);
  assert.equal((await h.request('/auth/recover', { method: 'POST', body: { email: owner.user.email, recoveryCode: 'bad-code', password: 'a new secure password' } })).status, 401);
  const recovered = await h.request('/auth/recover', { method: 'POST', body: { email: owner.user.email, recoveryCode: owner.recoveryCode, password: 'a new secure password' } });
  assert.equal(recovered.status, 200); assert.notEqual(recovered.data.recoveryCode, owner.recoveryCode);
  assert.equal((await h.request('/auth/me', { token: owner.token })).status, 401);
  assert.equal((await h.request('/auth/me', { token: login.data.token })).status, 401);
  assert.equal((await h.request('/auth/recover', { method: 'POST', body: { email: owner.user.email, recoveryCode: owner.recoveryCode, password: 'another new password' } })).status, 401);
  assert.equal((await h.request('/auth/login', { method: 'POST', body: { email: owner.user.email, password: 'correct horse battery' } })).status, 401);
  assert.equal((await h.request('/auth/login', { method: 'POST', body: { email: owner.user.email, password: 'a new secure password' } })).status, 200);
  assert.equal((await h.request('/tags', { token: recovered.data.token })).data.tags.length, 1);
  assert.equal((await h.request('/auth/logout', { method: 'POST', token: recovered.data.token })).status, 204);
  assert.equal((await h.request('/auth/me', { token: recovered.data.token })).status, 401);
});

test('sessions, tags, messages and recovery survive restart; raw secrets are never persisted/exported', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'seekertag-test-')); const dbPath = join(directory, 'database.sqlite');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const first = await harness({ dbPath });
  const owner = await first.register(); const tag = await first.tag(owner); const found = await first.report(tag);
  await first.close();
  const raw = readFileSync(dbPath).toString('latin1');
  for (const value of [owner.token, owner.recoveryCode, found.token, 'correct horse battery']) assert.ok(!raw.includes(value));
  assert.equal(statSync(dbPath).mode & 0o777, 0o600);
  const second = await harness({ dbPath }); t.after(second.close);
  assert.equal((await second.request('/auth/me', { token: owner.token })).status, 200);
  assert.equal((await second.request(`/tags/${tag.id}`, { token: owner.token })).data.tag.name, tag.name);
  assert.equal((await second.request(`/finder/reports/${found.report.id}`, { token: found.token })).data.messages.length, 1);
  const exported = await second.request('/account/export', { token: owner.token });
  assert.equal(exported.status, 200); assert.equal(exported.data.tags.length, 1); assert.equal(exported.data.reports.length, 1);
  const text = JSON.stringify(exported.data);
  for (const value of ['password_hash', 'recovery_hash', 'capability_hash', owner.token, found.token]) assert.ok(!text.includes(value));
});

test('download artifacts have valid byte signatures and canonical QR URL ignores Host header', async (t) => {
  const h = await harness({ publicUrl: 'https://tags.example.com' }); t.after(h.close);
  const owner = await h.register(); const tag = await h.tag(owner);
  const poison = await h.request(`/tags/${tag.id}`, { token: owner.token, headers: { Host: 'attacker.example' } });
  assert.equal(poison.data.tag.publicUrl, `https://tags.example.com/found/${tag.code}`);
  const png = await h.request(`/tags/${tag.id}/qr.png`, { token: owner.token });
  assert.equal(png.status, 200); assert.equal(png.headers.get('content-type'), 'image/png'); assert.equal(png.bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a'); assert.ok(png.bytes.length > 1000);
  const pdf = await h.request(`/tags/${tag.id}/label.pdf`, { token: owner.token });
  assert.equal(pdf.status, 200); assert.equal(pdf.headers.get('content-type'), 'application/pdf'); assert.equal(pdf.bytes.subarray(0, 5).toString(), '%PDF-'); assert.ok(pdf.bytes.length > 1000);
  assert.throws(() => createApp({ publicUrl: 'javascript:alert(1)', dbPath: ':memory:' }));
  assert.throws(() => createApp({ publicUrl: 'https://user:pass@example.com', dbPath: ':memory:' }));
});

test('validation rejects oversized bodies, invalid credentials and mass-assignment fields do not change ownership', async (t) => {
  const h = await harness(); t.after(h.close);
  assert.equal((await h.request('/auth/register', { method: 'POST', body: { name: 'x', email: 'invalid', password: 'correct horse battery' } })).status, 400);
  assert.equal((await h.request('/auth/register', { method: 'POST', body: { name: 'x', email: 'x@y.com', password: 'short' } })).status, 400);
  const owner = await h.register(); const other = await h.register(); const tag = await h.tag(owner);
  const patch = await h.request(`/tags/${tag.id}`, { token: owner.token, method: 'PATCH', body: { ownerId: other.user.id, recoveryCount: 900, name: 'Updated' } });
  assert.equal(patch.status, 200); assert.equal(patch.data.tag.recoveryCount, 0);
  assert.equal((await h.request(`/tags/${tag.id}`, { token: other.token })).status, 404);
  for (const body of [{ name: '' }, { name: 'x'.repeat(81) }, { rewardAmount: -1 }, { rewardAmount: '10' }, { rewardCurrency: 'FAKE' }, { status: 'returned' }, { description: 'x'.repeat(501) }]) assert.equal((await h.request(`/tags/${tag.id}`, { method: 'PATCH', token: owner.token, body })).status, 400);
  assert.equal((await h.request('/tags', { method: 'POST', token: owner.token, body: { name: 'x'.repeat(20_000) } })).status, 413);
  assert.equal((await h.request('/tags', { method: 'POST', token: owner.token, body: [] })).status, 400);
  assert.equal((await h.request('/auth/me', { token: owner.token, headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await h.request('/auth/me', { token: owner.token, headers: { Origin: 'http://localhost:8081' } })).headers.get('access-control-allow-origin'), 'http://localhost:8081');
  assert.equal((await h.request(`/public/tags/' OR 1=1--`)).status, 404);
});

test('anonymous reports are limited per IP and Authorization secrets do not appear in API errors', async (t) => {
  const h = await harness({ rateLimits: true }); t.after(h.close);
  const owner = await h.register(); const tag = await h.tag(owner);
  for (let n = 0; n < 6; n++) await h.report(tag, `Found ${n}`);
  const rejected = await h.request(`/public/tags/${tag.code}/reports`, { method: 'POST', body: { message: 'spam' } });
  assert.equal(rejected.status, 429); assert.ok(Number(rejected.headers.get('retry-after')) > 0);
  const error = await h.request('/finder/reports/missing', { token: owner.token });
  assert.ok(!JSON.stringify(error.data).includes(owner.token));
});

test('static Expo export serves app routes and assets while unknown API/non-GET paths stay JSON 404', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'seekertag-web-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const dist = join(directory, 'dist');
  mkdirSync(join(dist, 'assets'), { recursive: true });
  mkdirSync(join(dist, 'api'));
  writeFileSync(join(dist, 'index.html'), '<!doctype html><html><body>SeekerTag exported app</body></html>');
  writeFileSync(join(dist, 'assets', 'app.js'), 'globalThis.seekerTagExport = true;');
  writeFileSync(join(dist, 'api', 'unknown'), 'API fallback must never serve this file');
  const h = await harness({ webDistPath: dist }); t.after(h.close);
  for (const path of ['/', '/found/valid-public-code', '/found/code/', '/chat/90ca2a78-39f7-4f11-b716-a4e9b3d0809']) {
    const page = await h.request(path, { root: true });
    assert.equal(page.status, 200, path); assert.match(page.headers.get('content-type'), /text\/html/);
    assert.match(page.bytes.toString(), /SeekerTag exported app/); assert.equal(page.headers.get('cache-control'), 'no-store');
  }
  const asset = await h.request('/assets/app.js', { root: true });
  assert.equal(asset.status, 200); assert.match(asset.headers.get('content-type'), /javascript/); assert.match(asset.bytes.toString(), /seekerTagExport/);
  assert.equal((await h.request('/assets/app.js', { root: true, method: 'HEAD' })).status, 200);
  for (const path of ['/api/unknown', '/api/found/valid-code', '/assets/missing.js', '/found', '/chat', '/unknown']) {
    const missing = await h.request(path, { root: true });
    assert.equal(missing.status, 404, path); assert.equal(missing.data.code, 'NOT_FOUND');
  }
  for (const method of ['POST', 'PATCH', 'DELETE', 'HEAD']) {
    for (const path of ['/', '/found/valid-code', '/chat/thread-id']) assert.equal((await h.request(path, { root: true, method })).status, 404, `${method} ${path}`);
  }
  assert.equal((await h.request('/health')).data.ok, true);
});

test('static export rejects hidden files, encoded traversal, escaping symlinks, and invalid export roots', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'seekertag-static-security-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const dist = join(directory, 'dist'); mkdirSync(dist);
  writeFileSync(join(dist, 'index.html'), '<html>Public app</html>');
  writeFileSync(join(directory, 'secret.txt'), 'PRIVATE_OUTSIDE_ROOT');
  writeFileSync(join(dist, '.env'), 'PRIVATE_DOTFILE');
  symlinkSync(join(directory, 'secret.txt'), join(dist, 'leak.txt'));
  const h = await harness({ webDistPath: dist }); t.after(h.close);
  for (const path of ['/..%2fsecret.txt', '/%2e%2e%2fsecret.txt', '/assets%2f..%2f..%2fsecret.txt', '/..%5csecret.txt', '/.env', '/%2eenv', '/leak.txt', '/%00']) {
    const result = await h.request(path, { root: true });
    assert.equal(result.status, 404, path); assert.ok(!result.bytes.toString().includes('PRIVATE_'));
  }
  assert.equal((await h.request('/%E0%A4%A', { root: true })).status, 400);
  assert.throws(() => createApp({ dbPath: ':memory:', webDistPath: join(directory, 'missing') }), /WEB_DIST_PATH/);
  const bad = join(directory, 'bad-export'); mkdirSync(bad);
  symlinkSync(join(directory, 'secret.txt'), join(bad, 'index.html'));
  assert.throws(() => createApp({ dbPath: ':memory:', webDistPath: bad }), /WEB_DIST_PATH/);
  const noWeb = await harness(); t.after(noWeb.close);
  assert.equal((await noWeb.request('/', { root: true })).status, 404);
});

test('expired/malformed sessions and duplicate accounts are rejected; concurrent recovery succeeds only once', async (t) => {
  const h = await harness(); t.after(h.close);
  const owner = await h.register();
  assert.equal((await h.request('/auth/register', { method: 'POST', body: { name: 'Duplicate', email: owner.user.email.toUpperCase(), password: 'correct horse battery' } })).status, 409);
  assert.equal((await h.request('/auth/login', { method: 'POST', body: { email: 'not-registered@example.com', password: 'correct horse battery' } })).status, 401);
  assert.equal((await h.request('/auth/login', { method: 'POST', body: { email: owner.user.email, password: 'wrong password here' } })).status, 401);
  assert.equal((await h.request('/auth/me', { headers: { Authorization: 'Basic abcd' } })).status, 401);
  assert.equal((await h.request('/auth/me', { token: 'malformed' })).status, 401);
  h.app.locals.db.prepare('UPDATE sessions SET expires_at = 0').run();
  assert.equal((await h.request('/auth/me', { token: owner.token })).status, 401);
  const attempts = await Promise.all([1, 2].map(() => h.request('/auth/recover', { method: 'POST', body: { email: owner.user.email, recoveryCode: owner.recoveryCode, password: 'replacement passphrase' } })));
  assert.deepEqual(attempts.map((result) => result.status).sort(), [200, 401]);
  const winner = attempts.find((result) => result.status === 200);
  assert.equal((await h.request('/auth/me', { token: winner.data.token })).status, 200);
});
