import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { firebaseMessage, firebasePushFromEnv, readFirebaseAccount, firebaseFailure } from '../firebase-push.js';

test('FCM displays a background notification and preserves typed Expo navigation data', () => {
  const data = { messageId: 7, reportId: 'report-7', userId: 'user-1', finder: false, apiOrigin: 'https://api.example.com' };
  const message = firebaseMessage({ token: 'native-fcm-token', title: 'Nova mensagem · Chaves', body: 'Encontrei suas chaves', data });
  assert.deepEqual(message.notification, { title: 'Nova mensagem · Chaves', body: 'Encontrei suas chaves' });
  assert.deepEqual(JSON.parse(message.data.body), data);
  assert(Object.values(message.data).every(value => typeof value === 'string'));
  assert.equal(message.data.title, message.notification.title);
  assert.equal(message.data.message, message.notification.body);
  assert.equal(message.android.notification.channelId, 'messages');
  assert.equal(message.android.restrictedPackageName, 'app.seekertag.mobile');
  assert.equal(message.android.notification.tag, message.data.tag);
});

test('Firebase is optional but incomplete or mismatched server credentials fail without exposing their contents', t => {
  const dir = mkdtempSync(join(tmpdir(), 'seekertag-firebase-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'account.json');
  assert.equal(firebasePushFromEnv({}), null);
  assert.throws(() => firebasePushFromEnv({ FIREBASE_PROJECT_ID: 'seekertag-qa' }), /configure both/);
  writeFileSync(file, 'secret-invalid-json');
  assert.throws(() => readFirebaseAccount(file, 'seekertag-qa'), error => !error.message.includes('secret-invalid-json') && error.message.includes('could not read'));
  writeFileSync(file, JSON.stringify({ project_info: { project_id: 'seekertag-qa' } }));
  assert.throws(() => readFirebaseAccount(file, 'seekertag-qa'), /private service-account/);
  writeFileSync(file, JSON.stringify({ type: 'service_account', project_id: 'another-project', client_email: 'service@example.com', private_key: 'secret-key' }));
  assert.throws(() => readFirebaseAccount(file, 'seekertag-qa'), /same project/);
});

test('only unusable tokens and permanent payload errors are discarded; auth and transport failures retry', () => {
  assert.equal(firebaseFailure({ code: 'messaging/registration-token-not-registered' }), 'remove-device');
  assert.equal(firebaseFailure({ code: 'messaging/invalid-payload' }), 'discard');
  for (const code of ['messaging/server-unavailable', 'messaging/authentication-error', 'messaging/mismatched-credential', 'app/network-error']) {
    assert.equal(firebaseFailure({ code }), 'retry');
  }
});
