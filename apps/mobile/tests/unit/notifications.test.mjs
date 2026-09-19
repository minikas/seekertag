import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newNotifications, notificationTarget } from '../../src/notifications.model.ts';

test('notification taps reject other accounts, API instances and invalid navigation payloads', () => {
  const data = { messageId: 12, reportId: 'report-1', userId: 'user-1', finder: false, apiOrigin: 'https://example.com' };
  assert.deepEqual(notificationTarget(data, data.userId, data.apiOrigin), data);
  for (const changes of [{ userId: 'other' }, { apiOrigin: 'https://other.com' }, { reportId: '../tags' }, { finder: 'false' }, { messageId: 0 }, { messageId: 1.5 }]) {
    assert.equal(notificationTarget({ ...data, ...changes }, data.userId, data.apiOrigin), null);
  }
});

test('local alerts exclude old history, read messages and the currently visible conversation', () => {
  const items = [{ id: 15, read: false, reportId: 'new' }, { id: 14, read: false, reportId: 'active' },
    { id: 13, read: true, reportId: 'read' }, { id: 10, read: false, reportId: 'old' }];
  assert.deepEqual(newNotifications(items, 10, 'active').map(item => item.id), [15]);
  assert.deepEqual(newNotifications(items, 15, 'active'), []);
});
