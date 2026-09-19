import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../app.js';

async function setup(t, pushSender) {
  const app = createApp({ dbPath: ':memory:', rateLimits: false, pushSender: pushSender || null });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => server.close(resolve)); app.locals.close(); });
  async function request(path, token, body, method = body === undefined ? 'GET' : 'POST') {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, data: response.status === 204 ? null : await response.json() };
  }
  let count = 0;
  async function account() {
    const result = await request('/auth/register', null, { name: 'Notification QA', email: `person-${++count}@example.com`, password: 'notification test password' });
    assert.equal(result.status, 201); return result.data;
  }
  const owner = await account(), finder = await account(), stranger = await account();
  const { data: { tag } } = await request('/tags', owner.token, { name: 'Keys', category: 'Chaves' });
  async function report(token = finder.token) {
    const result = await request(`/public/tags/${tag.code}/reports`, token, { finderName: 'Finder', message: 'Found your keys' });
    assert.equal(result.status, 201); return result.data;
  }
  return { app, request, owner, finder, stranger, report, tag };
}

test('inbox includes first contact and replies only for their intended participants', async t => {
  const h = await setup(t);
  const found = await h.report();
  const list = (await h.request('/notifications', h.owner.token)).data;
  assert.equal(list.unreadCount, 1);
  assert.deepEqual(list.notifications[0], { id: found.messages[0].id, reportId: found.report.id,
    tagName: 'Keys', senderName: 'Finder', finder: false, body: 'Found your keys', createdAt: found.messages[0].createdAt, read: false });
  assert.equal((await h.request('/notifications', h.finder.token)).data.unreadCount, 0);
  assert.equal((await h.request('/notifications', h.stranger.token)).data.notifications.length, 0);
  assert.equal((await h.request('/notifications')).status, 401);
  const reply = (await h.request(`/reports/${found.report.id}/messages`, h.owner.token, { body: 'Thank you!' })).data.message;
  const finderInbox = (await h.request('/notifications', h.finder.token)).data;
  assert.equal(finderInbox.notifications[0].id, reply.id);
  assert.equal(finderInbox.notifications[0].finder, true);
  assert.equal((await h.request('/notifications', h.owner.token)).data.unreadCount, 1);
  const anonymous = await h.report(null);
  await h.request(`/reports/${anonymous.report.id}/messages`, h.owner.token, { body: 'Saved later' });
  await h.request(`/finder/reports/${anonymous.report.id}/account`, h.finder.token, { token: anonymous.token });
  assert.equal((await h.request('/notifications', h.finder.token)).data.unreadCount, 2);
});

test('read watermarks are scoped, monotonic, and do not consume concurrent or future messages', async t => {
  const h = await setup(t), a = await h.report(), b = await h.report();
  const firstId = a.messages[0].id;
  await h.request('/notifications/read', h.stranger.token, { throughId: 999999, reportId: a.report.id });
  assert.equal((await h.request('/notifications', h.owner.token)).data.unreadCount, 2);
  await h.request('/notifications/read', h.owner.token, { throughId: 999999, reportId: a.report.id });
  assert.equal((await h.request('/notifications', h.owner.token)).data.unreadCount, 1);
  await h.request(`/finder/reports/${a.report.id}/messages`, a.token, { body: 'A new arrival' });
  assert.equal((await h.request('/notifications', h.owner.token)).data.unreadCount, 2);
  await h.request('/notifications/read', h.owner.token, { throughId: b.messages[0].id });
  const result = (await h.request('/notifications', h.owner.token)).data;
  assert.equal(result.unreadCount, 1);
  assert.equal(result.notifications[0].read, false);
  await h.request('/notifications/read', h.owner.token, { throughId: firstId });
  assert.equal((await h.request('/notifications', h.owner.token)).data.unreadCount, 1);
  for (const throughId of [0, -1, '12', 1.5, null]) assert.equal((await h.request('/notifications/read', h.owner.token, { throughId })).status, 400);
});

test('pagination preserves ordering and unread count across the entire inbox', async t => {
  const h = await setup(t), a = await h.report();
  for (let i = 0; i < 54; i++) await h.request(`/finder/reports/${a.report.id}/messages`, a.token, { body: `Message ${i}` });
  const first = (await h.request('/notifications', h.owner.token)).data;
  assert.equal(first.notifications.length, 50); assert.equal(first.unreadCount, 55);
  const second = (await h.request(`/notifications?before=${first.nextCursor}`, h.owner.token)).data;
  assert.equal(second.notifications.length, 5); assert.equal(second.nextCursor, null);
  assert.equal(second.unreadCount, 55);
  assert.ok(first.notifications.at(-1).id > second.notifications[0].id);
  assert.equal((await h.request('/notifications?before=no', h.owner.token)).status, 400);
});

const registration = token => ({ token, language: 'en', provider: 'fcm', projectId: 'seekertag-qa' });

test('FCM first contact targets the owner and invalid tokens are removed', async t => {
  const calls = []; let invalid = false;
  const h = await setup(t, { projectId: 'seekertag-qa', send: async message => {
    calls.push(message);
    if (invalid) throw Object.assign(new Error('Unregistered'), { code: 'messaging/registration-token-not-registered' });
    return 'projects/seekertag-qa/messages/first';
  } });
  const device = 'fcm_notification_device_123';
  const registered = await h.request('/notifications/devices', h.owner.token, registration(device));
  assert.equal(registered.status, 200); assert.equal(registered.data.enabled, true);
  const found = await h.report();
  await h.app.locals.notifications.flush();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].token, device);
  assert.equal(calls[0].title, 'New message · Keys');
  assert.equal(calls[0].data.userId, h.owner.user.id);
  assert.equal(calls[0].data.reportId, found.report.id);
  assert.equal(calls[0].data.finder, false);
  assert.equal(h.app.locals.db.prepare('SELECT COUNT(*) AS n FROM push_jobs').get().n, 0);
  invalid = true; await h.report(); await h.app.locals.notifications.flush();
  assert.equal(h.app.locals.db.prepare('SELECT COUNT(*) AS n FROM push_devices').get().n, 0);
  assert.equal(h.app.locals.db.prepare('SELECT COUNT(*) AS n FROM push_jobs').get().n, 0);
});

test('FCM retries temporary failures and revokes delivery on account switching, read, logout and expiry', async t => {
  let fail = true; const sent = [];
  const h = await setup(t, { projectId: 'seekertag-qa', send: async message => {
    if (fail) throw Object.assign(new Error('Offline'), { code: 'messaging/server-unavailable' });
    sent.push(message); return 'projects/seekertag-qa/messages/retry';
  } });
  const device = 'fcm_notification_device_456';
  await h.request('/notifications/devices', h.owner.token, registration(device));
  await h.report(); await h.app.locals.notifications.flush();
  assert.equal(h.app.locals.db.prepare('SELECT attempts FROM push_jobs').get().attempts, 1);
  fail = false; h.app.locals.db.exec('UPDATE push_jobs SET next_at=0'); await h.app.locals.notifications.flush();
  assert.equal(sent.length, 1);
  await h.request('/notifications/devices', h.finder.token, registration(device));
  assert.equal(h.app.locals.db.prepare('SELECT COUNT(*) AS n FROM push_jobs').get().n, 0);
  const found = await h.report();
  const reply = (await h.request(`/reports/${found.report.id}/messages`, h.owner.token, { body: 'Owner reply' })).data.message;
  await h.app.locals.notifications.flush();
  assert.equal(sent.at(-1).data.finder, true);
  assert.equal(sent.at(-1).data.userId, h.finder.user.id);
  const read = (await h.request(`/reports/${found.report.id}/messages`, h.owner.token, { body: 'Read before sending' })).data.message;
  await h.request('/notifications/read', h.finder.token, { throughId: read.id, reportId: found.report.id });
  await h.app.locals.notifications.flush(); assert.equal(sent.length, 2);
  await h.request(`/reports/${found.report.id}/messages`, h.owner.token, { body: 'Pending at logout' });
  await h.request('/auth/logout', h.finder.token, {});
  await h.app.locals.notifications.flush(); assert.equal(sent.length, 2);
  await h.request('/notifications/devices', h.owner.token, registration(device));
  await h.report(null); h.app.locals.db.exec('UPDATE sessions SET expires_at=0');
  await h.app.locals.notifications.flush(); assert.equal(sent.length, 2);
});

test('device registration validates Firebase project and reports when server credentials are absent', async t => {
  const h = await setup(t);
  const device = 'fcm_notification_device_unconfigured';
  const response = await h.request('/notifications/devices', h.owner.token, registration(device));
  assert.deepEqual(response.data, { enabled: false, provider: 'fcm' });
  await h.report();
  assert.equal(h.app.locals.db.prepare('SELECT COUNT(*) AS n FROM push_jobs').get().n, 0);
  const enabled = await setup(t, { projectId: 'seekertag-qa', send: async () => 'unused' });
  assert.equal((await enabled.request('/notifications/devices', enabled.owner.token, { ...registration(device), projectId: 'another-project' })).status, 409);
  for (const body of [{ ...registration(device), provider: 'expo' }, { ...registration(device), token: 'bad token' }, { ...registration(device), language: 'fr' }]) {
    assert.equal((await enabled.request('/notifications/devices', enabled.owner.token, body)).status, 400);
  }
});

test('an in-flight delivery cannot delete a new account job that reused the same SQLite row ID', async t => {
  let finish; const pending = new Promise(resolve => { finish = resolve; });
  let began; const started = new Promise(resolve => { began = resolve; });
  const h = await setup(t, { projectId: 'seekertag-qa', send: () => { began(); return pending; } });
  const device = 'fcm_notification_race_device';
  await h.request('/notifications/devices', h.owner.token, registration(device));
  const found = await h.report();
  const flushing = h.app.locals.notifications.flush(); await started;
  await h.request('/notifications/devices', h.finder.token, registration(device));
  await h.request(`/reports/${found.report.id}/messages`, h.owner.token, { body: 'Reply for new account' });
  finish('sent'); await flushing;
  const job = h.app.locals.db.prepare('SELECT user_id FROM push_jobs').get();
  assert.equal(job.user_id, h.finder.user.id);
});
