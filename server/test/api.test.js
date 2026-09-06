import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, statSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { PDFDocument as ParsedPDF, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { createApp } from '../app.js';

async function harness(options = {}) {
  const app = createApp({ dbPath: ':memory:', rateLimits: false, ...options });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api`;
  async function request(path, { method = 'GET', token, body, rawBody, headers = {}, root = false } = {}) {
    const response = await fetch((root ? base.slice(0, -4) : base) + path, { method, headers: { ...(body !== undefined || rawBody !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, ...(rawBody !== undefined ? { body: rawBody } : body !== undefined ? { body: JSON.stringify(body) } : {}) });
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
  return { app, base, request, register, tag, report, close };
}

// Forward to the real API, fully consume its committed response, then destroy
// the client connection. This models response loss after a successful write.
async function discardedPost(h, path, { token, body }, expected = 201) {
  let upstreamStatus;
  const proxy = createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const upstream = await fetch(h.base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: Buffer.concat(chunks) });
      upstreamStatus = upstream.status;
      await upstream.arrayBuffer();
      res.destroy();
    } catch (error) { res.destroy(error); }
  });
  proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening');
  try {
    await assert.rejects(fetch(`http://127.0.0.1:${proxy.address().port}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), /fetch failed/);
    assert.equal(upstreamStatus, expected, 'API completed the POST before its response was discarded');
  } finally { await new Promise((resolve) => proxy.close(resolve)); }
}

const newOperationKey = () => randomBytes(32).toString('hex');

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
  const spoofedRole = await h.request(`/finder/reports/${found.report.id}/messages`, { token: found.token, method: 'POST', body: { body: 'A real finder message', role: 'owner', reportId: another.report.id } });
  assert.equal(spoofedRole.status, 201); assert.equal(spoofedRole.data.message.role, 'finder');
  assert.equal((await h.request(`/finder/reports/${another.report.id}`, { token: another.token })).data.messages.length, 1);
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
  const otherSession = (await first.request('/auth/login', { method: 'POST', body: { email: owner.user.email, password: 'correct horse battery' } })).data.token;
  assert.equal((await first.request('/auth/logout', { token: otherSession, method: 'POST' })).status, 204);
  assert.equal((await first.request('/auth/me', { token: owner.token })).status, 200, 'logging out one device preserves another session');
  await first.close();
  const raw = readFileSync(dbPath).toString('latin1');
  for (const value of [owner.token, owner.recoveryCode, found.token, 'correct horse battery']) assert.ok(!raw.includes(value));
  assert.equal(statSync(dbPath).mode & 0o777, 0o600);
  const second = await harness({ dbPath }); t.after(second.close);
  assert.equal((await second.request('/auth/me', { token: owner.token })).status, 200);
  assert.equal((await second.request('/auth/me', { token: otherSession })).status, 401, 'logout revocation survives restart');
  assert.equal((await second.request(`/tags/${tag.id}`, { token: owner.token })).data.tag.name, tag.name);
  assert.equal((await second.request(`/finder/reports/${found.report.id}`, { token: found.token })).data.messages.length, 1);
  const exported = await second.request('/account/export', { token: owner.token });
  assert.equal(exported.status, 200); assert.equal(exported.data.tags.length, 1); assert.equal(exported.data.reports.length, 1);
  const text = JSON.stringify(exported.data);
  for (const value of ['password_hash', 'recovery_hash', 'capability_hash', owner.token, found.token]) assert.ok(!text.includes(value));
  const restored = await second.request('/auth/recover', { method: 'POST', body: { email: owner.user.email, recoveryCode: owner.recoveryCode, password: 'new pass after restart' } });
  assert.equal(restored.status, 200, 'recovery code survives restart');
  assert.equal((await second.request('/tags', { token: restored.data.token })).data.tags[0].id, tag.id);
  assert.equal((await second.request('/auth/me', { token: owner.token })).status, 401);
});

test('download artifacts have valid byte signatures and canonical QR URL ignores Host header', async (t) => {
  const h = await harness({ publicUrl: 'https://tags.example.com' }); t.after(h.close);
  const owner = await h.register(); const tag = await h.tag(owner);
  const poison = await h.request(`/tags/${tag.id}`, { token: owner.token, headers: { Host: 'attacker.example' } });
  assert.equal(poison.data.tag.publicUrl, `https://tags.example.com/found/${tag.code}`);
  const png = await h.request(`/tags/${tag.id}/qr.png`, { token: owner.token, headers: { Host: 'attacker.example' } });
  assert.equal(png.status, 200); assert.equal(png.headers.get('content-type'), 'image/png'); assert.equal(png.bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a'); assert.ok(png.bytes.length > 1000);
  const bitmap = PNG.sync.read(png.bytes);
  assert.equal(bitmap.width, 900); assert.equal(bitmap.height, 900);
  const decoded = jsQR(new Uint8ClampedArray(bitmap.data), bitmap.width, bitmap.height);
  assert.equal(decoded?.data, tag.publicUrl, 'independent QR decoder reads the canonical finder URL from actual pixels');
  const pdf = await h.request(`/tags/${tag.id}/label.pdf`, { token: owner.token });
  assert.equal(pdf.status, 200); assert.equal(pdf.headers.get('content-type'), 'application/pdf'); assert.equal(pdf.bytes.subarray(0, 5).toString(), '%PDF-'); assert.ok(pdf.bytes.length > 1000);
  const document = await ParsedPDF.load(pdf.bytes);
  assert.equal(document.getPageCount(), 1);
  const size = document.getPage(0).getSize();
  assert.ok(Math.abs(size.width - 595.28) < 0.1 && Math.abs(size.height - 841.89) < 0.1, 'printable label sheet is one A4 page');
  assert.equal(document.isEncrypted, false);
  assert.match(pdf.headers.get('content-disposition'), /^attachment; filename="seekertag-[\w-]+\.pdf"$/);
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
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const h = await harness({ rateLimits: true }); t.after(h.close);
  const owner = await h.register(); const tag = await h.tag(owner);
  for (let n = 0; n < 6; n++) await h.report(tag, `Found ${n}`);
  const rejected = await h.request(`/public/tags/${tag.code}/reports`, { method: 'POST', headers: { 'X-Forwarded-For': '203.0.113.99' }, body: { message: 'spam' } });
  assert.equal(rejected.status, 429); assert.ok(Number(rejected.headers.get('retry-after')) > 0);
  t.mock.timers.tick(600_001);
  assert.equal((await h.request(`/public/tags/${tag.code}/reports`, { method: 'POST', body: { message: 'After the real quota window' } })).status, 201, 'quota reopens after its window; forwarding headers cannot bypass it');
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
  for (const path of ['/', '/saved', '/saved/', '/owner-chat/thread-id', '/found/valid-public-code', '/found/code/', '/chat/90ca2a78-39f7-4f11-b716-a4e9b3d0809']) {
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
    for (const path of ['/', '/saved', '/owner-chat/thread-id', '/found/valid-code', '/chat/thread-id']) assert.equal((await h.request(path, { root: true, method })).status, 404, `${method} ${path}`);
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

test('concurrent resolves close every open report once, and a later lost incident can be recovered independently', async (t) => {
  const h = await harness(); t.after(h.close);
  const owner = await h.register(); const tag = await h.tag(owner);
  const a = await h.report(tag); const b = await h.report(tag);
  await h.request(`/tags/${tag.id}`, { method: 'PATCH', token: owner.token, body: { status: 'paused' } });
  const results = await Promise.all([a, b, a].map((found) => h.request(`/reports/${found.report.id}/resolve`, { method: 'POST', token: owner.token })));
  assert.ok(results.every((result) => result.status === 200 && result.data.report.status === 'resolved'));
  let current = (await h.request(`/tags/${tag.id}`, { token: owner.token })).data.tag;
  assert.equal(current.recoveryCount, 1); assert.equal(current.openReportCount, 0); assert.equal(current.status, 'active');
  const rejected = await h.request(`/reports/${a.report.id}/messages`, { method: 'POST', token: owner.token, body: { body: 'Already resolved' } });
  assert.equal(rejected.status, 409); assert.equal(rejected.data.code, 'REPORT_RESOLVED');
  await h.request(`/tags/${tag.id}`, { method: 'PATCH', token: owner.token, body: { status: 'lost' } });
  const later = await h.report(tag, 'A different day and a new recovery.');
  // Retrying an old resolution cannot close a future incident or count it again.
  await h.request(`/reports/${a.report.id}/resolve`, { method: 'POST', token: owner.token });
  assert.equal((await h.request(`/reports/${later.report.id}`, { token: owner.token })).data.report.status, 'open');
  assert.equal((await h.request(`/tags/${tag.id}`, { token: owner.token })).data.tag.recoveryCount, 1);
  await h.request(`/reports/${later.report.id}/resolve`, { method: 'POST', token: owner.token });
  current = (await h.request(`/tags/${tag.id}`, { token: owner.token })).data.tag;
  assert.equal(current.recoveryCount, 2); assert.equal(current.reportCount, 3);
  assert.equal((await h.request(`/tags/${tag.id}/history`, { token: owner.token })).data.events.filter((event) => event.type === 'returned').length, 2);
});

test('concurrent transfer has one winner, and an in-flight transfer cannot outlive logout', async (t) => {
  const h = await harness(); t.after(h.close);
  const owner = await h.register(); const first = await h.register(); const second = await h.register();
  const tag = await h.tag(owner);
  const results = await Promise.all([first, second].map((recipient) => h.request(`/tags/${tag.id}/transfer`, { method: 'POST', token: owner.token, body: { email: recipient.user.email, password: 'correct horse battery' } })));
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 404]);
  const winner = results[0].status === 200 ? first : second;
  const loser = results[0].status === 200 ? second : first;
  assert.equal((await h.request(`/tags/${tag.id}`, { token: winner.token })).status, 200);
  assert.equal((await h.request(`/tags/${tag.id}`, { token: loser.token })).status, 404);
  const another = await h.tag(owner);
  const [transfer, logout] = await Promise.all([
    h.request(`/tags/${another.id}/transfer`, { method: 'POST', token: owner.token, body: { email: first.user.email, password: 'correct horse battery' } }),
    h.request('/auth/logout', { method: 'POST', token: owner.token }),
  ]);
  assert.equal(logout.status, 204); assert.equal(transfer.status, 401, 'authorization is checked again after asynchronous password hashing');
  assert.equal((await h.request(`/tags/${another.id}`, { token: first.token })).status, 404);
  const loggedIn = await h.request('/auth/login', { method: 'POST', body: { email: owner.user.email, password: 'correct horse battery' } });
  assert.equal((await h.request(`/tags/${another.id}`, { token: loggedIn.data.token })).status, 200);
});

test('resolution racing transfer preserves old conversation ownership and never transfers an open report', async (t) => {
  const h = await harness(); t.after(h.close);
  const owner = await h.register(); const recipient = await h.register(); const tag = await h.tag(owner); const found = await h.report(tag);
  const [transfer, resolved] = await Promise.all([
    h.request(`/tags/${tag.id}/transfer`, { method: 'POST', token: owner.token, body: { email: recipient.user.email, password: 'correct horse battery' } }),
    h.request(`/reports/${found.report.id}/resolve`, { method: 'POST', token: owner.token }),
  ]);
  assert.equal(resolved.status, 200);
  assert.ok([200, 409].includes(transfer.status), 'valid serialization either resolves then transfers or rejects the still-open report');
  if (transfer.status === 409) {
    assert.equal(transfer.data.code, 'OPEN_REPORTS');
    assert.equal((await h.request(`/tags/${tag.id}/transfer`, { method: 'POST', token: owner.token, body: { email: recipient.user.email, password: 'correct horse battery' } })).status, 200);
  }
  assert.equal((await h.request(`/reports/${found.report.id}`, { token: owner.token })).data.report.status, 'resolved');
  assert.equal((await h.request(`/reports/${found.report.id}`, { token: recipient.token })).status, 404);
  assert.equal((await h.request(`/finder/reports/${found.report.id}`, { token: found.token })).data.report.status, 'resolved');
  assert.equal((await h.request(`/finder/reports/${found.report.id}/messages`, { method: 'POST', token: found.token, body: { body: 'Cannot message a future owner through the old conversation.' } })).status, 409);
  assert.equal((await h.request(`/tags/${tag.id}`, { token: recipient.token })).data.tag.openReportCount, 0);
});

test('concurrent registration commits one account and rejected target transfers leave the owner unchanged', async (t) => {
  const h = await harness(); t.after(h.close);
  const registration = { name: 'Same account', email: 'same@example.com', password: 'correct horse battery' };
  const attempts = await Promise.all([registration, { ...registration, email: ' SAME@EXAMPLE.COM ' }].map((body) => h.request('/auth/register', { method: 'POST', body })));
  assert.deepEqual(attempts.map((result) => result.status).sort(), [201, 409]);
  const owner = attempts.find((result) => result.status === 201).data;
  const tag = await h.tag(owner);
  const self = await h.request(`/tags/${tag.id}/transfer`, { method: 'POST', token: owner.token, body: { email: owner.user.email, password: 'correct horse battery' } });
  assert.equal(self.status, 400);
  const absent = await h.request(`/tags/${tag.id}/transfer`, { method: 'POST', token: owner.token, body: { email: 'missing@example.com', password: 'correct horse battery' } });
  assert.equal(absent.status, 404); assert.equal(absent.data.code, 'RECIPIENT_NOT_FOUND');
  assert.equal((await h.request(`/tags/${tag.id}`, { token: owner.token })).data.tag.id, tag.id);
  assert.equal((await h.request(`/tags/${tag.id}/history`, { token: owner.token })).data.events.length, 1);
});

test('exact text/reward boundaries, malformed JSON and control characters are validated without partial writes', async (t) => {
  const h = await harness(); t.after(h.close);
  const owner = await h.register();
  const tag = await h.tag(owner, { name: 'N'.repeat(80), category: 'C'.repeat(32), color: '#B9C79B', description: 'D'.repeat(500), publicMessage: 'P'.repeat(500), rewardAmount: 1_000_000, rewardCurrency: 'SOL' });
  for (const body of [{ publicMessage: 'P'.repeat(501) }, { category: 'C'.repeat(33) }, { color: {} }, { name: 'Control\u0000character' }, { name: 5 }, { rewardAmount: 1_000_001 }, { rewardAmount: null }, { status: null }]) {
    const result = await h.request(`/tags/${tag.id}`, { method: 'PATCH', token: owner.token, body });
    assert.equal(result.status, 400, JSON.stringify(body));
    assert.equal((await h.request(`/tags/${tag.id}`, { token: owner.token })).data.tag.publicMessage.length, 500);
  }
  for (const rawBody of ['{"name":', 'null', 'true', '"scalar"']) assert.equal((await h.request('/tags', { method: 'POST', token: owner.token, rawBody })).status, 400);
  for (const message of ['', ' \n\t ', 'x'.repeat(2001), 'Bad\u0007message', {}]) assert.equal((await h.request(`/public/tags/${tag.code}/reports`, { method: 'POST', body: { message } })).status, 400);
  assert.equal((await h.request(`/public/tags/${tag.code}/reports`, { method: 'POST', body: { message: 'valid', finderName: 'x'.repeat(61) } })).status, 400);
  const found = await h.request(`/public/tags/${tag.code}/reports`, { method: 'POST', body: { message: 'x'.repeat(2000) } });
  assert.equal(found.status, 201); assert.equal(found.data.report.finderName, 'Pessoa que encontrou');
  const text = 'Olá <script>alert("literal text")</script> — chave 🔑';
  const reply = await h.request(`/reports/${found.data.report.id}/messages`, { method: 'POST', token: owner.token, body: { body: text } });
  assert.equal(reply.data.message.body, text, 'message relay preserves text and never executes it');
  assert.equal((await h.request(`/finder/reports/${found.data.report.id}/messages`, { method: 'POST', token: found.data.token, body: { body: 'x'.repeat(2001) } })).status, 400);
  assert.equal((await h.request(`/reports/${found.data.report.id}`, { token: owner.token })).data.messages.length, 2);
});

test('account tag capacity permits the last slot and rejects creates/transfers beyond it atomically', async (t) => {
  const h = await harness(); t.after(h.close);
  const owner = await h.register(); const recipient = await h.register(); const tag = await h.tag(owner);
  const db = h.app.locals.db;
  const insert = db.prepare("INSERT INTO tags(id,code,owner_id,name,category,color,status,created_at,updated_at) VALUES(?,?,?,'Capacity fixture','other','#FFFFFF','active',?,?)");
  const timestamp = new Date().toISOString();
  db.exec('BEGIN');
  for (let i = 0; i < 499; i++) insert.run(randomUUID(), randomUUID(), recipient.user.id, timestamp, timestamp);
  db.exec('COMMIT');
  await h.tag(recipient, { name: '500th tag' });
  const overflow = await h.request('/tags', { method: 'POST', token: recipient.token, body: { name: '501st tag' } });
  assert.equal(overflow.status, 409); assert.equal(overflow.data.code, 'TAG_LIMIT');
  const transfer = await h.request(`/tags/${tag.id}/transfer`, { method: 'POST', token: owner.token, body: { email: recipient.user.email, password: 'correct horse battery' } });
  assert.equal(transfer.status, 409); assert.equal(transfer.data.code, 'TAG_LIMIT');
  assert.equal((await h.request('/tags', { token: recipient.token })).data.tags.length, 500);
  assert.equal((await h.request(`/tags/${tag.id}`, { token: owner.token })).status, 200);
});

test('report capacity reopens after resolution and conversation message cap rejects both roles', async (t) => {
  const h = await harness(); t.after(h.close);
  const owner = await h.register(); const tag = await h.tag(owner); const found = await h.report(tag);
  const db = h.app.locals.db; const timestamp = new Date().toISOString();
  const insertReport = db.prepare("INSERT INTO reports(id,tag_id,owner_id,tag_name,tag_code,finder_name,capability_hash,status,created_at,updated_at) VALUES(?,?,?,?,?,'Fixture',?,'open',?,?)");
  const insertMessage = db.prepare("INSERT INTO messages(report_id,role,body,created_at) VALUES(?,'finder','Earlier message',?)");
  db.exec('BEGIN');
  for (let i = 0; i < 99; i++) insertReport.run(randomUUID(), tag.id, owner.user.id, tag.name, tag.code, randomUUID(), timestamp, timestamp);
  for (let i = 0; i < 998; i++) insertMessage.run(found.report.id, timestamp);
  db.exec('COMMIT');
  const reportOverflow = await h.request(`/public/tags/${tag.code}/reports`, { method: 'POST', body: { message: '101st open report' } });
  assert.equal(reportOverflow.status, 429); assert.equal(reportOverflow.data.code, 'REPORT_LIMIT');
  assert.equal((await h.request(`/finder/reports/${found.report.id}/messages`, { method: 'POST', token: found.token, body: { body: '1000th message' } })).status, 201);
  for (const [path, token] of [[`/finder/reports/${found.report.id}/messages`, found.token], [`/reports/${found.report.id}/messages`, owner.token]]) {
    const overflow = await h.request(path, { method: 'POST', token, body: { body: 'Over capacity' } });
    assert.equal(overflow.status, 409); assert.equal(overflow.data.code, 'MESSAGE_LIMIT');
  }
  assert.equal((await h.request(`/reports/${found.report.id}`, { token: owner.token })).data.messages.length, 1000);
  await h.request(`/reports/${found.report.id}/resolve`, { method: 'POST', token: owner.token });
  const next = await h.report(tag);
  assert.equal((await h.request(`/tags/${tag.id}`, { token: owner.token })).data.tag.openReportCount, 1);
  assert.equal(next.report.messageCount, 1);
});

test('rate limits isolate finder/owner buckets, normalize account keys, and reopen after their windows', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const h = await harness({ rateLimits: true }); t.after(h.close);
  const owner = await h.register(); const tag = await h.tag(owner); const found = await h.report(tag);
  for (let i = 0; i < 10; i++) assert.equal((await h.request('/auth/login', { method: 'POST', body: { email: i % 2 ? owner.user.email.toUpperCase() : ` ${owner.user.email} `, password: 'invalid password here' } })).status, 401);
  const blockedLogin = await h.request('/auth/login', { method: 'POST', body: { email: owner.user.email, password: 'correct horse battery' } });
  assert.equal(blockedLogin.status, 429); assert.equal(blockedLogin.data.code, 'RATE_LIMITED');
  for (let i = 0; i < 30; i++) assert.equal((await h.request(`/finder/reports/${found.report.id}/messages`, { method: 'POST', token: found.token, body: { body: `Finder ${i}` } })).status, 201);
  assert.equal((await h.request(`/finder/reports/${found.report.id}/messages`, { method: 'POST', token: found.token, body: { body: 'Spam' } })).status, 429);
  assert.equal((await h.request(`/reports/${found.report.id}/messages`, { method: 'POST', token: owner.token, body: { body: 'Owner can still respond' } })).status, 201);
  t.mock.timers.tick(60_001);
  assert.equal((await h.request(`/finder/reports/${found.report.id}/messages`, { method: 'POST', token: found.token, body: { body: 'After cooldown' } })).status, 201);
  t.mock.timers.tick(15 * 60_000);
  assert.equal((await h.request('/auth/login', { method: 'POST', body: { email: owner.user.email, password: 'correct horse battery' } })).status, 200);
});

test('global quota and owner write quota cannot be bypassed by spoofed forwarding headers', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const h = await harness({ rateLimits: true }); t.after(h.close);
  const owner = await h.register(); const tag = await h.tag(owner);
  for (let i = 0; i < 99; i++) assert.equal((await h.request(`/tags/${tag.id}`, { method: 'PATCH', token: owner.token, body: { name: `Name ${i}` } })).status, 200);
  const denied = await h.request(`/tags/${tag.id}`, { method: 'PATCH', token: owner.token, body: { name: 'Over quota' }, headers: { 'X-Forwarded-For': '198.51.100.3' } });
  assert.equal(denied.status, 429); assert.equal((await h.request(`/tags/${tag.id}`, { token: owner.token })).data.tag.name, 'Name 98');
  t.mock.timers.tick(60_001);
  for (let i = 0; i < 300; i++) assert.equal((await h.request('/health')).status, 200);
  const globalDenied = await h.request('/health', { headers: { 'X-Forwarded-For': '198.51.100.4' } });
  assert.equal(globalDenied.status, 429); assert.equal(globalDenied.headers.get('retry-after'), '60');
  t.mock.timers.tick(60_001);
  assert.equal((await h.request(`/tags/${tag.id}`, { method: 'PATCH', token: owner.token, body: { name: 'Recovered after cooldown' } })).status, 200);
});

test('CORS preflight permits only configured origins and private exports require owner authentication', async (t) => {
  const h = await harness({ publicUrl: 'https://tags.example.com', corsOrigins: ['https://admin.example.com'] }); t.after(h.close);
  const owner = await h.register(); const stranger = await h.register(); const tag = await h.tag(owner); const found = await h.report(tag);
  for (const origin of ['https://tags.example.com', 'https://admin.example.com', 'http://localhost:8081']) {
    const preflight = await h.request('/tags', { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'PATCH', 'Access-Control-Request-Headers': 'authorization,content-type' } });
    assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
    assert.match(preflight.headers.get('access-control-allow-headers'), /Authorization/);
    assert.equal(preflight.headers.get('access-control-allow-credentials'), null);
  }
  for (const origin of ['https://evil.example', 'null', 'https://tags.example.com.evil.example']) assert.equal((await h.request('/tags', { method: 'OPTIONS', headers: { Origin: origin } })).status, 403);
  assert.equal((await h.request('/account/export')).status, 401);
  assert.equal((await h.request('/account/export', { token: found.token })).status, 401);
  const privateExport = await h.request('/account/export', { token: stranger.token });
  assert.deepEqual(privateExport.data.tags, []); assert.deepEqual(privateExport.data.reports, []);
  const ownerExport = await h.request('/account/export', { token: owner.token });
  assert.equal(ownerExport.data.tags[0].id, tag.id);
  assert.equal(ownerExport.headers.get('cache-control'), 'no-store');
  assert.equal(ownerExport.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(ownerExport.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(ownerExport.headers.get('x-powered-by'), null);
});

test('lost committed POST responses replay one tag, one report/capability, and one message per role', async (t) => {
  const h = await harness(); t.after(h.close);
  const owner = await h.register(); const stranger = await h.register();
  const tagBody = { name: 'Etiqueta repetível', operationKey: newOperationKey() };
  await discardedPost(h, '/tags', { token: owner.token, body: tagBody });
  const creates = await Promise.all([1, 2, 3].map(() => h.request('/tags', { method: 'POST', token: owner.token, body: tagBody })));
  creates.forEach((result) => assert.equal(result.status, 201));
  const tag = creates[0].data.tag;
  assert.equal(new Set(creates.map((result) => result.data.tag.id)).size, 1);
  assert.equal((await h.request('/tags', { token: owner.token })).data.tags.length, 1);
  const path = `/public/tags/${tag.code}/reports`;
  const reportBody = { finderName: 'Alex', message: 'Achei o objeto.', operationKey: newOperationKey() };
  await discardedPost(h, path, { body: reportBody });
  const reports = await Promise.all([1, 2, 3].map(() => h.request(path, { method: 'POST', body: reportBody })));
  const found = reports[0].data;
  reports.forEach((result) => { assert.equal(result.status, 201); assert.deepEqual(result.data, found); });
  assert.equal((await h.request('/reports', { token: owner.token })).data.reports.length, 1);
  const operations = [];
  for (const [route, token, role] of [[`/reports/${found.report.id}/messages`, owner.token, 'owner'], [`/finder/reports/${found.report.id}/messages`, found.token, 'finder']]) {
    const body = { body: `Mensagem ${role}`, operationKey: newOperationKey() };
    await discardedPost(h, route, { token, body });
    const replies = await Promise.all([1, 2].map(() => h.request(route, { method: 'POST', token, body })));
    assert.equal(replies[0].status, 201); assert.deepEqual(replies[0].data, replies[1].data);
    assert.equal(replies[0].data.message.role, role);
    operations.push({ route, token, body, result: replies[0].data });
  }
  assert.equal((await h.request(`/reports/${found.report.id}`, { token: owner.token })).data.messages.length, 3);
  await h.request(`/tags/${tag.id}`, { method: 'PATCH', token: owner.token, body: { status: 'paused' } });
  const reportReplay = await h.request(path, { method: 'POST', body: reportBody });
  assert.equal(reportReplay.status, 201); assert.equal(reportReplay.data.token, found.token);
  assert.equal(reportReplay.data.report.id, found.report.id);
  await h.request(`/reports/${found.report.id}/resolve`, { method: 'POST', token: owner.token });
  for (const operation of operations) {
    const replay = await h.request(operation.route, { method: 'POST', token: operation.token, body: operation.body });
    assert.equal(replay.status, 201); assert.deepEqual(replay.data, operation.result);
    const fresh = await h.request(operation.route, { method: 'POST', token: operation.token, body: { ...operation.body, operationKey: newOperationKey() } });
    assert.equal(fresh.status, 409); assert.equal(fresh.data.code, 'REPORT_RESOLVED');
  }
  assert.equal((await h.request(operations[0].route, { method: 'POST', token: stranger.token, body: operations[0].body })).status, 404);
  assert.equal((await h.request(operations[1].route, { method: 'POST', token: owner.token, body: operations[1].body })).status, 404);
  await h.request('/auth/logout', { method: 'POST', token: owner.token });
  assert.equal((await h.request('/tags', { method: 'POST', token: owner.token, body: tagBody })).status, 401);
  assert.equal((await h.request(operations[0].route, { method: 'POST', token: owner.token, body: operations[0].body })).status, 401);
});

test('operation conflicts never mutate data, validation/failed writes reserve no keys, legacy clients still create independently', async (t) => {
  const h = await harness(); t.after(h.close);
  const owner = await h.register();
  for (const operationKey of [null, 12, '', 'a'.repeat(63), 'g'.repeat(64), 'a'.repeat(65)]) {
    const invalid = await h.request('/tags', { method: 'POST', token: owner.token, body: { name: 'Invalid', operationKey } });
    assert.equal(invalid.status, 400); assert.equal(invalid.data.code, 'INVALID_OPERATION_KEY');
  }
  const key = newOperationKey();
  const first = await h.request('/tags', { method: 'POST', token: owner.token, body: { name: 'Objeto', operationKey: key } });
  const tag = first.data.tag;
  const normalized = await h.request('/tags', { method: 'POST', token: owner.token, body: { operationKey: key.toUpperCase(), name: ' Objeto ', status: 'active', category: 'other' } });
  assert.equal(normalized.status, 201); assert.equal(normalized.data.tag.id, tag.id);
  const tagConflict = await h.request('/tags', { method: 'POST', token: owner.token, body: { name: 'Diferente', operationKey: key } });
  assert.equal(tagConflict.status, 409); assert.equal(tagConflict.data.code, 'OPERATION_CONFLICT');
  const reportKey = newOperationKey(); const path = `/public/tags/${tag.code}/reports`;
  await h.request(`/tags/${tag.id}`, { method: 'PATCH', token: owner.token, body: { status: 'paused' } });
  assert.equal((await h.request(path, { method: 'POST', body: { message: 'Mensagem', operationKey: reportKey } })).status, 410);
  assert.equal(h.app.locals.db.prepare('SELECT COUNT(*) AS n FROM operations').get().n, 1);
  await h.request(`/tags/${tag.id}`, { method: 'PATCH', token: owner.token, body: { status: 'active' } });
  const found = (await h.request(path, { method: 'POST', body: { message: 'Mensagem', operationKey: reportKey } })).data;
  assert.equal((await h.request(path, { method: 'POST', body: { message: 'Outro texto', operationKey: reportKey } })).data.code, 'OPERATION_CONFLICT');
  const messageKey = newOperationKey();
  for (const [route, token] of [[`/reports/${found.report.id}/messages`, owner.token], [`/finder/reports/${found.report.id}/messages`, found.token]]) {
    assert.equal((await h.request(route, { method: 'POST', token, body: { body: 'Texto', operationKey: messageKey } })).status, 201);
    assert.equal((await h.request(route, { method: 'POST', token, body: { body: 'Texto alterado', operationKey: messageKey } })).data.code, 'OPERATION_CONFLICT');
  }
  const legacy1 = await h.report(tag); const legacy2 = await h.report(tag);
  assert.notEqual(legacy1.report.id, legacy2.report.id);
  assert.equal((await h.request(`/reports/${found.report.id}`, { token: owner.token })).data.messages.length, 3);
});

test('operation replay survives restart without storing operation keys, finder capabilities, recovery codes or plaintext passwords', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'seekertag-idempotency-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const dbPath = join(directory, 'db.sqlite');
  let h = await harness({ dbPath });
  const owner = await h.register(); const target = await h.register();
  const tagBody = { name: 'Persistente', operationKey: newOperationKey() };
  const tag = (await h.request('/tags', { method: 'POST', token: owner.token, body: tagBody })).data.tag;
  const reportBody = { message: 'Achei', operationKey: newOperationKey() };
  const path = `/public/tags/${tag.code}/reports`;
  const found = (await h.request(path, { method: 'POST', body: reportBody })).data;
  const recoveryBody = { password: 'correct horse battery', operationKey: newOperationKey() };
  const issued = await h.request('/account/recovery-code', { method: 'POST', token: owner.token, body: recoveryBody });
  assert.equal(issued.status, 200);
  await h.close();
  const disk = readFileSync(dbPath);
  for (const value of [owner.token, found.token, tagBody.operationKey, reportBody.operationKey, recoveryBody.operationKey, issued.data.recoveryCode, issued.data.recoveryCode.replaceAll('-', ''), recoveryBody.password]) assert.equal(disk.includes(Buffer.from(value)), false, 'raw credentials must not occur in database bytes');
  h = await harness({ dbPath }); t.after(h.close);
  assert.equal((await h.request('/tags', { method: 'POST', token: owner.token, body: tagBody })).data.tag.id, tag.id);
  assert.deepEqual((await h.request(path, { method: 'POST', body: reportBody })).data, found);
  assert.deepEqual((await h.request('/account/recovery-code', { method: 'POST', token: owner.token, body: recoveryBody })).data, issued.data);
  await h.request(`/reports/${found.report.id}/close`, { method: 'POST', token: owner.token, body: { reason: 'no_return' } });
  assert.equal((await h.request(`/tags/${tag.id}/transfer`, { method: 'POST', token: owner.token, body: { email: target.user.email, password: recoveryBody.password } })).status, 200);
  assert.equal((await h.request('/tags', { method: 'POST', token: owner.token, body: tagBody })).status, 404);
  const replay = await h.request(path, { method: 'POST', body: reportBody });
  assert.equal(replay.status, 201); assert.equal(replay.data.token, found.token); assert.equal(replay.data.report.tagName, 'Persistente');
  assert.equal((await h.request('/reports', { token: target.token })).data.reports.length, 0);
});

test('a lost recovery response can be repaired by new-password login and repeatable authenticated recovery-code issuance', async (t) => {
  const h = await harness(); t.after(h.close);
  const owner = await h.register(); const newPassword = 'replacement password after recovery';
  await discardedPost(h, '/auth/recover', { body: { email: owner.user.email, recoveryCode: owner.recoveryCode, password: newPassword } }, 200);
  assert.equal((await h.request('/auth/me', { token: owner.token })).status, 401);
  const loggedIn = await h.request('/auth/login', { method: 'POST', body: { email: owner.user.email, password: newPassword } });
  assert.equal(loggedIn.status, 200);
  const token = loggedIn.data.token;
  const body = { password: newPassword, operationKey: newOperationKey() };
  assert.equal((await h.request('/account/recovery-code', { method: 'POST', token, body: { password: newPassword } })).status, 400);
  assert.equal((await h.request('/account/recovery-code', { method: 'POST', token, body: { ...body, password: 'incorrect password' } })).status, 401);
  await discardedPost(h, '/account/recovery-code', { token, body }, 200);
  const attempts = await Promise.all([1, 2].map(() => h.request('/account/recovery-code', { method: 'POST', token, body })));
  assert.equal(attempts[0].status, 200); assert.deepEqual(attempts[0].data, attempts[1].data);
  const replacement = await h.request('/account/recovery-code', { method: 'POST', token, body: { ...body, operationKey: newOperationKey() } });
  assert.notEqual(replacement.data.recoveryCode, attempts[0].data.recoveryCode);
  const stale = await h.request('/account/recovery-code', { method: 'POST', token, body });
  assert.equal(stale.status, 409); assert.equal(stale.data.code, 'OPERATION_SUPERSEDED');
  assert.equal((await h.request('/auth/recover', { method: 'POST', body: { email: owner.user.email, recoveryCode: attempts[0].data.recoveryCode, password: 'another replacement password' } })).status, 401);
  assert.equal((await h.request('/auth/recover', { method: 'POST', body: { email: owner.user.email, recoveryCode: replacement.data.recoveryCode, password: 'another replacement password' } })).status, 200);
  assert.equal((await h.request('/account/recovery-code', { method: 'POST', token, body })).status, 401);
});

test('recovery-code issuance cannot outlive concurrent logout or invalidate the existing recovery code', async (t) => {
  const h = await harness(); t.after(h.close);
  const owner = await h.register();
  const attempt = h.request('/account/recovery-code', { method: 'POST', token: owner.token, body: { password: 'correct horse battery', operationKey: newOperationKey() } });
  await h.request('/auth/logout', { method: 'POST', token: owner.token });
  assert.equal((await attempt).status, 401);
  assert.equal(h.app.locals.db.prepare('SELECT COUNT(*) AS n FROM operations').get().n, 0);
  assert.equal((await h.request('/auth/recover', { method: 'POST', body: { email: owner.user.email, recoveryCode: owner.recoveryCode, password: 'new password remains valid' } })).status, 200);
});

test('prepared declaration is private and repeatable, unread cursors are owner-only and monotonic across races', async (t) => {
  const h = await harness(); t.after(h.close);
  const owner = await h.register(); const target = await h.register(); const tag = await h.tag(owner);
  assert.equal(tag.preparedAt, null);
  await h.request(`/tags/${tag.id}/qr.png`, { token: owner.token });
  assert.equal((await h.request(`/tags/${tag.id}`, { token: owner.token })).data.tag.preparedAt, null);
  assert.equal((await h.request(`/tags/${tag.id}`, { method: 'PATCH', token: owner.token, body: { prepared: 'true' } })).status, 400);
  assert.equal((await h.request(`/tags/${tag.id}`, { method: 'PATCH', token: target.token, body: { prepared: true } })).status, 404);
  const prepared = (await h.request(`/tags/${tag.id}`, { method: 'PATCH', token: owner.token, body: { prepared: true } })).data.tag;
  assert.ok(prepared.preparedAt);
  assert.equal((await h.request(`/tags/${tag.id}`, { method: 'PATCH', token: owner.token, body: { prepared: true } })).data.tag.preparedAt, prepared.preparedAt);
  assert.equal((await h.request(`/public/tags/${tag.code}`)).data.tag.preparedAt, undefined);
  const found = await h.report(tag); const other = await h.report(tag);
  assert.equal(found.report.unreadCount, 1); assert.equal(found.report.lastMessageRole, 'finder');
  const path = `/reports/${found.report.id}/read`;
  assert.equal((await h.request(path, { method: 'POST', token: target.token, body: { lastMessageId: found.messages[0].id } })).status, 404);
  assert.equal((await h.request(path, { method: 'POST', token: found.token, body: { lastMessageId: found.messages[0].id } })).status, 401);
  for (const lastMessageId of [-1, '1', 1.5, Number.MAX_SAFE_INTEGER, other.messages[0].id]) assert.equal((await h.request(path, { method: 'POST', token: owner.token, body: { lastMessageId } })).status, 400);
  const read = await h.request(path, { method: 'POST', token: owner.token, body: { lastMessageId: found.messages[0].id } });
  assert.equal(read.data.report.unreadCount, 0);
  const reply = await h.request(`/reports/${found.report.id}/messages`, { method: 'POST', token: owner.token, body: { body: 'Obrigado!' } });
  let report = (await h.request(`/reports/${found.report.id}`, { token: owner.token })).data.report;
  assert.equal(report.unreadCount, 0); assert.equal(report.lastMessageRole, 'owner'); assert.equal(report.lastMessageId, reply.data.message.id);
  const message = (await h.request(`/finder/reports/${found.report.id}/messages`, { method: 'POST', token: found.token, body: { body: 'Até logo.' } })).data.message;
  await Promise.all([0, found.messages[0].id].map((lastMessageId) => h.request(path, { method: 'POST', token: owner.token, body: { lastMessageId } })));
  report = (await h.request(`/reports/${found.report.id}`, { token: owner.token })).data.report;
  assert.equal(report.unreadCount, 1); assert.equal(report.lastMessageId, message.id);
  await Promise.all([message.id, found.messages[0].id].map((lastMessageId) => h.request(path, { method: 'POST', token: owner.token, body: { lastMessageId } })));
  assert.equal((await h.request(`/reports/${found.report.id}`, { token: owner.token })).data.report.unreadCount, 0);
  await h.request(`/reports/${found.report.id}/resolve`, { method: 'POST', token: owner.token });
  await h.request(`/tags/${tag.id}/transfer`, { method: 'POST', token: owner.token, body: { email: target.user.email, password: 'correct horse battery' } });
  assert.equal((await h.request(`/tags/${tag.id}`, { token: target.token })).data.tag.preparedAt, null);
  assert.equal((await h.request(path, { method: 'POST', token: target.token, body: { lastMessageId: message.id } })).status, 404);
});

test('closing one report preserves other conversations and never invents a return, including close/resolve races', async (t) => {
  const h = await harness(); t.after(h.close);
  const owner = await h.register(); const stranger = await h.register(); const tag = await h.tag(owner, { status: 'lost' });
  const a = await h.report(tag); const b = await h.report(tag);
  const path = `/reports/${a.report.id}/close`;
  assert.equal((await h.request(path, { method: 'POST', token: stranger.token, body: { reason: 'unwanted' } })).status, 404);
  assert.equal((await h.request(path, { method: 'POST', token: a.token, body: { reason: 'unwanted' } })).status, 401);
  assert.equal((await h.request(path, { method: 'POST', token: owner.token, body: { reason: 'returned' } })).status, 400);
  const results = await Promise.all([1, 2].map(() => h.request(path, { method: 'POST', token: owner.token, body: { reason: 'mistake' } })));
  assert.deepEqual(results[0].data, results[1].data);
  assert.equal(results[0].data.report.closedReason, 'mistake'); assert.ok(results[0].data.report.closedAt);
  assert.equal((await h.request(`/finder/reports/${a.report.id}`, { token: a.token })).data.report.closedReason, 'mistake');
  assert.equal((await h.request(`/finder/reports/${a.report.id}/messages`, { method: 'POST', token: a.token, body: { body: 'No more' } })).status, 409);
  assert.equal((await h.request(`/reports/${b.report.id}`, { token: owner.token })).data.report.status, 'open');
  const unchanged = (await h.request(`/tags/${tag.id}`, { token: owner.token })).data.tag;
  assert.equal(unchanged.status, 'lost'); assert.equal(unchanged.recoveryCount, 0); assert.equal(unchanged.returnedAt, null); assert.equal(unchanged.openReportCount, 1);
  await h.request(`/reports/${a.report.id}/resolve`, { method: 'POST', token: owner.token });
  assert.equal((await h.request(`/tags/${tag.id}`, { token: owner.token })).data.tag.recoveryCount, 0);
  assert.equal((await h.request(path, { method: 'POST', token: owner.token, body: { reason: 'unwanted' } })).status, 409);
  const race = await Promise.all([
    h.request(`/reports/${b.report.id}/close`, { method: 'POST', token: owner.token, body: { reason: 'no_return' } }),
    h.request(`/reports/${b.report.id}/resolve`, { method: 'POST', token: owner.token }),
  ]);
  assert.equal(race[1].status, 200);
  const finalReport = (await h.request(`/reports/${b.report.id}`, { token: owner.token })).data.report;
  const finalTag = (await h.request(`/tags/${tag.id}`, { token: owner.token })).data.tag;
  assert.ok(['no_return', 'returned'].includes(finalReport.closedReason));
  assert.equal(finalTag.recoveryCount, finalReport.closedReason === 'returned' ? 1 : 0);
  assert.equal((await h.request(`/reports/${a.report.id}`, { token: owner.token })).data.report.closedReason, 'mistake');
});

test('additive migration preserves legacy objects, chats, sessions, recoveries, and remains safe on a second restart', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'seekertag-migration-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const dbPath = join(directory, 'db.sqlite');
  let h = await harness({ dbPath });
  const owner = await h.register(); const tag = await h.tag(owner); const found = await h.report(tag);
  await h.request(`/reports/${found.report.id}/resolve`, { method: 'POST', token: owner.token });
  // Produce the exact older schema by removing only this release's additions.
  h.app.locals.db.exec('DROP TABLE operations; ALTER TABLE tags DROP COLUMN prepared_at; ALTER TABLE reports DROP COLUMN owner_read_message_id; ALTER TABLE reports DROP COLUMN closed_reason; ALTER TABLE reports DROP COLUMN closed_at;');
  await h.close();
  for (let restart = 0; restart < 2; restart++) {
    h = await harness({ dbPath });
    const migratedTag = (await h.request(`/tags/${tag.id}`, { token: owner.token })).data.tag;
    assert.equal(migratedTag.description, tag.description); assert.equal(migratedTag.recoveryCount, 1); assert.equal(migratedTag.preparedAt, null);
    const migrated = (await h.request(`/finder/reports/${found.report.id}`, { token: found.token })).data;
    assert.deepEqual(migrated.messages, found.messages); assert.equal(migrated.report.closedReason, 'returned'); assert.ok(migrated.report.closedAt);
    assert.equal((await h.request('/auth/me', { token: owner.token })).status, 200);
    await h.close();
  }
  h = await harness({ dbPath }); t.after(h.close);
  assert.equal((await h.request('/auth/recover', { method: 'POST', body: { email: owner.user.email, recoveryCode: owner.recoveryCode, password: 'old recovery remains valid' } })).status, 200);
});

test('every printable format is one A4 page with explicit dimensions and embedded QR decoding to the canonical URL', async (t) => {
  const h = await harness({ publicUrl: 'https://tags.example.com' }); t.after(h.close);
  const owner = await h.register(); const stranger = await h.register(); const tag = await h.tag(owner);
  for (const [format, expectedImages, measure] of [['standard', 6, '88,2 x 73'], ['compact', 15, '50 x 40'], ['fold', 8, '90 x 100']]) {
    const path = `/tags/${tag.id}/label.pdf?format=${format}`;
    assert.equal((await h.request(path, { token: stranger.token })).status, 404);
    const result = await h.request(path, { token: owner.token });
    assert.equal(result.status, 200);
    const pdf = await ParsedPDF.load(result.bytes);
    assert.equal(pdf.getPageCount(), 1); assert.ok(pdf.getSubject().includes(measure));
    const page = pdf.getPage(0); assert.ok(Math.abs(page.getWidth() - 595.28) < 0.1); assert.ok(Math.abs(page.getHeight() - 841.89) < 0.1);
    const imageEntries = pdf.context.enumerateIndirectObjects().filter(([, object]) => object instanceof PDFRawStream && object.dict.get(PDFName.of('Subtype')) === PDFName.of('Image') && object.dict.get(PDFName.of('ColorSpace')) === PDFName.of('DeviceRGB'));
    assert.equal(imageEntries.length, expectedImages);
    const image = imageEntries[0][1]; const width = image.dict.get(PDFName.of('Width')).asNumber(); const height = image.dict.get(PDFName.of('Height')).asNumber();
    const rgb = decodePDFRawStream(image).decode();
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let pixel = 0; pixel < width * height; pixel++) { rgba.set(rgb.subarray(pixel * 3, pixel * 3 + 3), pixel * 4); rgba[pixel * 4 + 3] = 255; }
    assert.equal(jsQR(rgba, width, height)?.data, tag.publicUrl);
  }
  for (const suffix of ['?format=unknown', '?format=standard&format=compact']) assert.equal((await h.request(`/tags/${tag.id}/label.pdf${suffix}`, { token: owner.token })).status, 400);
  assert.equal((await h.request(`/tags/${tag.id}`, { token: owner.token })).data.tag.preparedAt, null);
});
