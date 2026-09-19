import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newNotifications, notificationTarget, notificationInbox, updateReadNotifications } from '../../src/notifications.model.ts';

test('notification taps reject other accounts, API instances and invalid navigation payloads', () => {
  const data = { messageId: 12, reportId: 'report-1', userId: 'user-1', finder: false, apiOrigin: 'https://example.com' };
  assert.deepEqual(notificationTarget(data, data.userId, data.apiOrigin), data);
  for (const changes of [{ userId: 'other' }, { apiOrigin: 'https://other.com' }, { reportId: '../tags' }, { finder: 'no' }, { messageId: 0 }, { messageId: 1.5 }]) {
    assert.equal(notificationTarget({ ...data, ...changes }, data.userId, data.apiOrigin), null);
  }
});

test('local alerts exclude old history, read messages and the currently visible conversation', () => {
  const items = [{ id: 15, read: false, reportId: 'new' }, { id: 14, read: false, reportId: 'active' },
    { id: 13, read: true, reportId: 'read' }, { id: 10, read: false, reportId: 'old' }];
  assert.deepEqual(newNotifications(items, 10, 'active').map(item => item.id), [15]);
  assert.deepEqual(newNotifications(items, 15, 'active'), []);
});


test('Android notification taps normalize raw FCM transport without weakening account and origin checks', () => {
  const data = { messageId: 12, reportId: 'report-1', userId: 'user-1', finder: false, apiOrigin: 'https://example.com' };
  for (const payload of [{ ...data, messageId: '12', finder: 'false' }, { body: JSON.stringify(data) }, { dataString: JSON.stringify(data) }]) {
    assert.deepEqual(notificationTarget(payload, data.userId, data.apiOrigin), data);
    assert.equal(notificationTarget(payload, 'other-user', data.apiOrigin), null);
    assert.equal(notificationTarget(payload, data.userId, 'https://other.example'), null);
  }
  for (const payload of [{ body: '{' }, { body: 'null' }, { body: '[]' }, { ...data, messageId: '12.1' }, { ...data, finder: 0 }]) {
    assert.equal(notificationTarget(payload, data.userId, data.apiOrigin), null);
  }
});

test('notification pagination deduplicates new boundaries and receipts preserve older history', () => {
  const page = (ids, nextCursor) => ({ notifications: ids.map(id => ({ id, read: false, reportId: id % 2 ? 'other' : 'active' })), latestId: 100, unreadCount: 5, nextCursor });
  const pages = [page([100, 99, 98], 98), page([98, 97, 96], 96)];
  const merged = notificationInbox(pages);
  assert.deepEqual(merged.notifications.map(item => item.id), [100, 99, 98, 97, 96]);
  assert.equal(merged.nextCursor, 96);
  const fresh = { ...pages[0], unreadCount: 2, notifications: pages[0].notifications.map(item => ({ ...item, read: item.reportId === 'active' })) };
  const read = notificationInbox(updateReadNotifications(pages, fresh, 100, 'active'));
  assert.deepEqual(read.notifications.filter(item => item.read).map(item => item.id), [100, 98, 96]);
  assert.equal(read.unreadCount, 2);
  assert.equal(read.nextCursor, 96);
});
