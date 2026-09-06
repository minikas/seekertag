import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../app.js';
import { createResendTransport, publicEmailOrigin } from '../notifications.js';

const MINUTE = 60_000;
const operationKey = () => randomBytes(32).toString('hex');
const codeFrom = (email) => /confirmação é (\d{6})/.exec(email.text)?.[1];

async function harness({ dbPath = ':memory:', publicUrl = 'https://tags.example.com', sendEmail, now = Date.now(), disabled = false } = {}) {
  let time = now;
  const emails = [];
  const transport = async (email) => { emails.push(email); return sendEmail ? sendEmail(email) : { id: `synthetic-${emails.length}` }; };
  const app = createApp({ dbPath, publicUrl, rateLimits: false, notifications: { enabled: false, ...(disabled ? {} : { sendEmail: transport }), now: () => time, startWorker: false } });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const request = async (path, { method = 'GET', token, body } = {}) => {
    const response = await fetch(base + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: response.status === 204 ? null : await response.json() };
  };
  let accountCount = 0;
  const register = async () => {
    const result = await request('/auth/register', { method: 'POST', body: { name: 'Pessoa dona', email: `notify-${++accountCount}@example.com`, password: 'synthetic password only' } });
    assert.equal(result.status, 201); return result.data;
  };
  const startVerification = (owner, key = operationKey()) => request('/account/notifications/verification', { method: 'POST', token: owner.token, body: { operationKey: key } });
  const verify = (owner, code) => request('/account/notifications/verify', { method: 'POST', token: owner.token, body: { code } });
  const enable = async (owner) => {
    const requested = await startVerification(owner); assert.equal(requested.status, 200);
    const code = codeFrom(emails.at(-1)); assert.match(code, /^\d{6}$/);
    const result = await verify(owner, code); assert.equal(result.status, 200); assert.equal(result.data.enabled, true);
    return code;
  };
  const createTag = async (owner) => {
    const result = await request('/tags', { method: 'POST', token: owner.token, body: { name: 'Objeto privado', description: 'Contato privado 11 99999-0000', publicMessage: 'Mensagem pública', rewardAmount: 90 } });
    assert.equal(result.status, 201); return result.data.tag;
  };
  const report = async (tag, key = operationKey()) => {
    const result = await request(`/public/tags/${tag.code}/reports`, { method: 'POST', body: { finderName: 'Finder particular', message: 'Meu contato privado é 11 98888-7777.', operationKey: key } });
    assert.equal(result.status, 201); return result.data;
  };
  const jobs = () => app.locals.db.prepare('SELECT * FROM notification_jobs ORDER BY created_at,id').all();
  return { app, request, emails, register, startVerification, verify, enable, createTag, report, jobs, process: () => app.locals.notifications.processQueue(), tick: ms => { time += ms; }, time: () => time, close: async () => { await new Promise(resolve => server.close(resolve)); app.locals.close(); } };
}

test('email is unavailable without transport/public HTTPS; notification preferences require owner authorization and verification', async (t) => {
  for (const origin of ['http://tags.example.com', 'https://localhost', 'https://192.168.1.44', 'https://[::1]', 'https://device.local', 'https://device.localdomain', 'https://device.internal', 'https://device.lan', 'https://device.home.arpa', 'https://device.test', 'https://local.example', 'https://example.com/path', 'https://user:password@example.com', 'https://example.com?q=1']) assert.equal(publicEmailOrigin(origin), false, origin);
  assert.equal(publicEmailOrigin('https://tags.example.com'), true);
  const unavailable = await harness({ disabled: true }); t.after(unavailable.close);
  const user = await unavailable.register();
  assert.deepEqual((await unavailable.request('/account/notifications', { token: user.token })).data, { available: false, verified: false, enabled: false, pending: false, failedCount: 0 });
  assert.equal((await unavailable.startVerification(user)).status, 503); assert.equal(unavailable.emails.length, 0);
  const local = await harness({ publicUrl: 'http://192.168.1.44:4318' }); t.after(local.close);
  assert.equal((await local.startVerification(await local.register())).status, 503); assert.equal(local.emails.length, 0);
  const h = await harness(); t.after(h.close);
  const owner = await h.register(); const tag = await h.createTag(owner); const found = await h.report(tag);
  assert.equal((await h.request('/account/notifications')).status, 401);
  assert.equal((await h.request('/account/notifications', { token: found.token })).status, 401);
  assert.equal((await h.request('/account/notifications', { method: 'PATCH', token: owner.token, body: { enabled: true } })).status, 409);
  assert.equal((await h.request('/account/notifications', { method: 'PATCH', token: owner.token, body: { enabled: 'true' } })).status, 400);
  for (const key of ['', 'a'.repeat(63), 'z'.repeat(64), null]) assert.equal((await h.startVerification(owner, key)).status, 400);
  assert.equal(h.emails.length, 0); assert.equal(h.jobs().length, 0);
});

test('OTP requires server secret; verification is owner-scoped, replayable, private and cannot undo a later opt-out', async (t) => {
  const h = await harness(); t.after(h.close);
  const owner = await h.register(); const stranger = await h.register();
  const serverSecret = Buffer.from(h.app.locals.db.prepare("SELECT value FROM notification_secrets WHERE name='verification'").get().value);
  assert.equal(serverSecret.length, 32);
  let key; let oldPublicCode; let expected;
  do {
    key = operationKey();
    oldPublicCode = String(createHmac('sha256', key).update(`seekertag.email-code:${owner.user.id}`).digest().readUInt32BE(0) % 1_000_000).padStart(6, '0');
    expected = String(createHmac('sha256', serverSecret).update(`seekertag.email-code:${owner.user.id}:${key}`).digest().readUInt32BE(0) % 1_000_000).padStart(6, '0');
  } while (expected === oldPublicCode);
  const requested = await h.startVerification(owner, key);
  assert.equal(requested.status, 200); assert.equal(requested.data.pending, true);
  const sent = h.emails[0]; const code = codeFrom(sent);
  assert.equal(code, expected); assert.notEqual(code, oldPublicCode); assert.equal(sent.to, owner.user.email);
  assert.equal(JSON.stringify(requested.data).includes(code), false);
  assert.equal((await h.verify(owner, oldPublicCode)).data.code, 'VERIFICATION_INVALID');
  assert.equal((await h.verify(stranger, code)).status, 400);
  const verified = await h.verify(owner, code); assert.equal(verified.status, 200); assert.equal(verified.data.verified, true); assert.equal(verified.data.pending, false);
  const replay = await h.verify(owner, code); assert.deepEqual(replay.data, verified.data);
  await h.request('/account/notifications', { method: 'PATCH', token: owner.token, body: { enabled: false } });
  assert.equal((await h.verify(owner, code)).data.enabled, false);
  // Even an outstanding second challenge cannot re-enable notifications after opt-out.
  await h.startVerification(owner); const laterCode = codeFrom(h.emails.at(-1));
  await h.request('/account/notifications', { method: 'PATCH', token: owner.token, body: { enabled: false } });
  assert.equal((await h.verify(owner, laterCode)).data.enabled, false);
  assert.equal(h.app.locals.db.prepare('SELECT COUNT(*) AS n FROM email_verifications').get().n, 0);
  const backup = JSON.stringify((await h.request('/account/export', { token: owner.token })).data);
  for (const secret of [key, code, serverSecret.toString('hex'), serverSecret.toString('base64')]) assert.equal(backup.includes(secret), false);
});

test('verification challenges expire, restrict guesses, rate-limit replacement and preserve attempts on retry', async (t) => {
  const h = await harness(); t.after(h.close);
  const owner = await h.register(); const key = operationKey();
  await h.startVerification(owner, key); const code = codeFrom(h.emails.at(-1));
  const wrong = code === '000000' ? '111111' : '000000';
  assert.equal((await h.startVerification(owner)).data.code, 'VERIFICATION_WAIT');
  for (let i = 0; i < 5; i++) assert.equal((await h.verify(owner, wrong)).data.code, 'VERIFICATION_INVALID');
  assert.equal((await h.verify(owner, code)).data.code, 'VERIFICATION_EXPIRED');
  assert.equal((await h.startVerification(owner, key)).data.code, 'VERIFICATION_EXPIRED');
  assert.equal((await h.request('/account/notifications', { token: owner.token })).data.pending, false);
  h.tick(MINUTE + 1);
  const nextKey = operationKey(); assert.equal((await h.startVerification(owner, nextKey)).status, 200);
  const nextCode = codeFrom(h.emails.at(-1));
  const wrongNext = nextCode === '000000' ? '111111' : '000000';
  await h.verify(owner, wrongNext);
  await h.startVerification(owner, nextKey);
  assert.equal(h.app.locals.db.prepare('SELECT attempts FROM email_verifications WHERE user_id=?').get(owner.user.id).attempts, 1);
  h.tick(15 * MINUTE);
  assert.equal((await h.verify(owner, nextCode)).data.code, 'VERIFICATION_EXPIRED');
  assert.equal((await h.startVerification(owner, nextKey)).data.code, 'VERIFICATION_EXPIRED');
  assert.equal((await h.startVerification(owner)).status, 200);
});

test('uncertain verification delivery resumes after restart with identical code and provider key, without storing client secret', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'seekertag-notify-verification-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const dbPath = join(directory, 'db.sqlite');
  let h = await harness({ dbPath, sendEmail: async () => { throw new Error('Provider response lost after accepting message'); } });
  const owner = await h.register(); const key = operationKey();
  const uncertain = await h.startVerification(owner, key);
  assert.equal(uncertain.status, 502); assert.equal(uncertain.data.code, 'EMAIL_DELIVERY_UNCERTAIN');
  assert.equal((await h.request('/account/notifications', { token: owner.token })).data.pending, true);
  const first = h.emails[0]; const code = codeFrom(first);
  const stored = h.app.locals.db.prepare('SELECT * FROM email_verifications WHERE user_id=?').get(owner.user.id);
  assert.notEqual(stored.code_hash, code); assert.equal(stored.code_hash.length, 64);
  await h.close(); assert.equal(readFileSync(dbPath).includes(Buffer.from(key)), false);
  h = await harness({ dbPath }); t.after(h.close);
  assert.equal((await h.startVerification(owner, key)).status, 200);
  const replay = h.emails[0]; assert.equal(replay.text, first.text); assert.equal(replay.idempotencyKey, first.idempotencyKey); assert.equal(replay.to, first.to);
  assert.equal((await h.verify(owner, code)).data.enabled, true);
});

test('upgrading an old database invalidates predictable pending OTPs while preserving verified preferences', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'seekertag-notify-upgrade-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const dbPath = join(directory, 'db.sqlite');
  let h = await harness({ dbPath });
  const verified = await h.register(); await h.enable(verified);
  const pending = await h.register(); const key = operationKey(); await h.startVerification(pending, key);
  const oldCode = String(createHmac('sha256', key).update(`seekertag.email-code:${pending.user.id}`).digest().readUInt32BE(0) % 1_000_000).padStart(6, '0');
  h.app.locals.db.prepare('UPDATE email_verifications SET code_hash=? WHERE user_id=?').run(createHash('sha256').update(`${pending.user.id}:${oldCode}`).digest('hex'), pending.user.id);
  h.app.locals.db.exec('DROP TABLE notification_secrets');
  await h.close(); h = await harness({ dbPath }); t.after(h.close);
  assert.equal((await h.verify(pending, oldCode)).data.code, 'VERIFICATION_EXPIRED');
  assert.equal((await h.request('/account/notifications', { token: pending.token })).data.pending, false);
  assert.equal((await h.request('/account/notifications', { token: verified.token })).data.enabled, true);
  assert.equal((await h.startVerification(pending, key)).status, 200);
  assert.equal((await h.verify(pending, codeFrom(h.emails.at(-1)))).data.enabled, true);
});

test('finder messages group into one private email, replay adds no jobs, and concurrent queue runs send once', async (t) => {
  const h = await harness(); t.after(h.close);
  const owner = await h.register(); await h.enable(owner); const tag = await h.createTag(owner);
  const key = operationKey(); const found = await h.report(tag, key); await h.report(tag, key);
  assert.equal(h.jobs().length, 1);
  const messageKey = operationKey();
  const messageBody = { body: 'Segredo finder: praça às 16h', operationKey: messageKey };
  const path = `/finder/reports/${found.report.id}/messages`;
  const next = await h.request(path, { method: 'POST', token: found.token, body: messageBody });
  await h.request(path, { method: 'POST', token: found.token, body: messageBody });
  await h.request(`/reports/${found.report.id}/messages`, { method: 'POST', token: owner.token, body: { body: 'Resposta particular do dono' } });
  assert.equal(h.jobs().length, 1); assert.equal(h.jobs()[0].message_id, next.data.message.id);
  await h.process(); assert.equal(h.emails.length, 1, 'only verification before grouping window');
  h.tick(30_000); await Promise.all([h.process(), h.process()]);
  assert.equal(h.emails.length, 2); assert.equal(h.jobs()[0].status, 'sent'); assert.equal(h.jobs()[0].attempts, 1);
  const email = h.emails[1]; assert.equal(email.to, owner.user.email);
  assert.ok(email.text.includes(`https://tags.example.com/owner-chat/${found.report.id}`));
  for (const privateValue of [found.token, owner.token, key, messageKey, tag.name, tag.description, tag.publicMessage, '11 98888-7777', 'praça às 16h', 'Finder particular', 'Resposta particular do dono']) assert.equal(email.text.includes(privateValue), false);
  await h.process(); assert.equal(h.emails.length, 2);
});

test('reading, closing, returning and opting out suppress queued messages while unread open conversations can alert', async (t) => {
  const h = await harness(); t.after(h.close);
  const owner = await h.register(); const verifiedCode = await h.enable(owner);
  const found = [];
  for (let i = 0; i < 4; i++) found.push(await h.report(await h.createTag(owner)));
  await h.request(`/reports/${found[0].report.id}/read`, { method: 'POST', token: owner.token, body: { lastMessageId: found[0].messages[0].id } });
  await h.request(`/reports/${found[1].report.id}/close`, { method: 'POST', token: owner.token, body: { reason: 'unwanted' } });
  await h.request(`/reports/${found[2].report.id}/resolve`, { method: 'POST', token: owner.token });
  h.tick(30_000); await h.process();
  assert.equal(h.jobs().filter(job => job.status === 'cancelled').length, 3); assert.equal(h.jobs().filter(job => job.status === 'sent').length, 1);
  assert.equal(h.emails.length, 2); assert.ok(h.emails[1].text.includes(found[3].report.id));
  await h.request(`/finder/reports/${found[3].report.id}/messages`, { method: 'POST', token: found[3].token, body: { body: 'Mais uma mensagem' } });
  assert.equal(h.jobs().filter(job => job.status === 'pending').length, 1);
  await h.request('/account/notifications', { method: 'PATCH', token: owner.token, body: { enabled: false } });
  assert.equal((await h.verify(owner, verifiedCode)).data.enabled, false);
  h.tick(30_000); await h.process(); assert.equal(h.emails.length, 2); assert.equal(h.jobs().filter(job => job.status === 'pending').length, 0);
  await h.request(`/finder/reports/${found[3].report.id}/messages`, { method: 'POST', token: found[3].token, body: { body: 'Sem notificação após desativar' } });
  assert.equal(h.jobs().length, 5);
});

test('uncertain notification retry keeps identical payload/key; definitive failures and exhausted retries are bounded and private', async (t) => {
  let mode = 'uncertain'; let notifications = 0;
  const h = await harness({ sendEmail: async email => {
    if (email.subject.includes('Confirme')) return { id: 'verification' };
    notifications++;
    if (mode === 'uncertain' && notifications === 1) throw new Error('accepted but response lost');
    if (mode === 'reject') { const error = new Error('secret-provider-body'); error.retryable = false; throw error; }
    if (mode === 'always-fail') throw new Error('private network details');
    return { id: 'accepted' };
  } }); t.after(h.close);
  const owner = await h.register(); await h.enable(owner); const tag = await h.createTag(owner); await h.report(tag);
  h.tick(30_000); await h.process();
  assert.equal(h.jobs()[0].status, 'pending'); assert.equal(h.jobs()[0].attempts, 1);
  await h.process(); assert.equal(notifications, 1);
  h.tick(MINUTE); await h.process();
  assert.equal(h.jobs()[0].status, 'sent'); assert.equal(notifications, 2);
  assert.equal(h.emails[1].idempotencyKey, h.emails[2].idempotencyKey); assert.equal(h.emails[1].text, h.emails[2].text);
  mode = 'reject'; const rejected = await h.report(tag); h.tick(30_000); await h.process();
  assert.equal(h.jobs().find(job => job.report_id === rejected.report.id).error_code, 'EMAIL_REJECTED');
  mode = 'always-fail'; const exhausted = await h.report(tag);
  for (let attempt = 0; attempt < 6; attempt++) { h.tick(33 * MINUTE); await h.process(); }
  const final = h.jobs().find(job => job.report_id === exhausted.report.id);
  assert.equal(final.attempts, 6); assert.equal(final.status, 'failed'); assert.equal(final.error_code, 'EMAIL_UNCONFIRMED');
  const state = await h.request('/account/notifications', { token: owner.token }); assert.equal(state.data.failedCount, 2);
  assert.equal(JSON.stringify(state.data).includes('secret-provider'), false); assert.equal(JSON.stringify(h.jobs()).includes('private network'), false);
});

test('verified preferences, queue, grouping and unread suppression survive restart', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'seekertag-notify-queue-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const dbPath = join(directory, 'db.sqlite');
  let h = await harness({ dbPath });
  const owner = await h.register(); await h.enable(owner); const tag = await h.createTag(owner); const found = await h.report(tag);
  const readFound = await h.report(tag);
  await h.request(`/reports/${readFound.report.id}/read`, { method: 'POST', token: owner.token, body: { lastMessageId: readFound.messages[0].id } });
  const previousJob = h.jobs().find(job => job.report_id === found.report.id); const time = h.time();
  await h.close(); h = await harness({ dbPath, now: time + 30_000 }); t.after(h.close);
  assert.equal((await h.request('/account/notifications', { token: owner.token })).data.enabled, true);
  await h.process(); assert.equal(h.emails.length, 1); assert.equal(h.emails[0].idempotencyKey, `seekertag-notification-${previousJob.id}`);
  assert.equal(h.jobs().find(job => job.report_id === readFound.report.id).status, 'cancelled');
  assert.equal(h.jobs().find(job => job.report_id === found.report.id).status, 'sent');
});

test('changing PUBLIC_URL rebases only unattempted jobs; obsolete uncertain jobs and retry windows never send stale/LAN URLs', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'seekertag-notify-origin-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const dbPath = join(directory, 'db.sqlite');
  let h = await harness({ dbPath, publicUrl: 'http://192.168.1.44:4318' });
  const owner = await h.register();
  // Simulates an existing verified account after the service was temporarily
  // restarted with a LAN configuration; no message is sent through that origin.
  h.app.locals.db.prepare('INSERT INTO notification_settings(user_id,verified_at,enabled) VALUES(?,?,1)').run(owner.user.id, new Date(h.time()).toISOString());
  const tag = await h.createTag(owner); const local = await h.report(tag);
  h.tick(30_000); await h.process(); assert.equal(h.emails.length, 0);
  let time = h.time(); await h.close();
  let reject = false;
  h = await harness({ dbPath, now: time, publicUrl: 'https://new.example.com', sendEmail: async () => { if (reject) throw new Error('uncertain response'); return { id: 'ok' }; } });
  await h.process(); assert.equal(h.emails.length, 1); assert.ok(h.emails[0].text.includes(`https://new.example.com/owner-chat/${local.report.id}`)); assert.equal(h.emails[0].text.includes('192.168.'), false);
  reject = true; const uncertain = await h.report(tag); h.tick(30_000); await h.process();
  assert.equal(h.jobs().find(job => job.report_id === uncertain.report.id).attempts, 1);
  time = h.time(); await h.close();
  h = await harness({ dbPath, now: time + MINUTE, publicUrl: 'https://final.example.com' }); t.after(h.close);
  await h.process(); assert.equal(h.emails.length, 0);
  assert.equal(h.jobs().find(job => job.report_id === uncertain.report.id).error_code, 'PUBLIC_URL_CHANGED');
  const expired = await h.report(tag); h.tick(30_000);
  h.app.locals.db.prepare('UPDATE notification_jobs SET attempts=1,first_attempt_at=? WHERE report_id=?').run(h.time() - 23 * 60 * MINUTE, expired.report.id);
  await h.process(); assert.equal(h.emails.length, 0);
  assert.equal(h.jobs().find(job => job.report_id === expired.report.id).error_code, 'RETRY_WINDOW_EXPIRED');
});

test('Resend adapter sends only expected HTTPS payload and classifies errors without exposing provider bodies or credentials', async () => {
  assert.equal(createResendTransport({}), null);
  assert.throws(() => createResendTransport({ apiKey: 'synthetic-key', from: 'bad\r\n@example.com' }), /remetente/);
  const calls = [];
  let response = new Response(JSON.stringify({ id: 'synthetic-message-id' }), { status: 200 });
  const transport = createResendTransport({ apiKey: 'synthetic-api-secret', from: 'SeekerTag <sender@example.com>', fetchImpl: async (url, options) => { calls.push({ url, options }); if (response instanceof Error) throw response; return response; } });
  const envelope = { to: 'owner@example.com', subject: 'Assunto', text: 'Mensagem genérica', idempotencyKey: 'synthetic-operation' };
  assert.deepEqual(await transport(envelope), { id: 'synthetic-message-id' });
  assert.equal(calls[0].url, 'https://api.resend.com/emails'); assert.equal(calls[0].options.headers['Idempotency-Key'], envelope.idempotencyKey);
  assert.deepEqual(JSON.parse(calls[0].options.body), { from: 'SeekerTag <sender@example.com>', to: [envelope.to], subject: envelope.subject, text: envelope.text });
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  for (const [status, name, retryable] of [[429, 'rate_limit', true], [503, 'server_error', true], [409, 'concurrent_idempotent_requests', true], [409, 'invalid_idempotent_request', false], [422, 'validation_error', false]]) {
    response = new Response(JSON.stringify({ name, message: 'private-provider-details' }), { status });
    await assert.rejects(transport(envelope), error => error.retryable === retryable && !error.message.includes('private-provider-details') && !error.message.includes('synthetic-api-secret'));
  }
  response = new Error('network with private diagnostics');
  await assert.rejects(transport(envelope), error => error.retryable === true && error.message === 'EMAIL_TRANSPORT');
  response = new Response('invalid response JSON', { status: 200 });
  await assert.rejects(transport(envelope), error => error.retryable === true && error.message === 'EMAIL_RESPONSE');
});
