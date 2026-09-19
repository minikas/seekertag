import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import configure from '../../app.config.js';

test('Android Firebase configuration rejects private keys and other packages, then exposes only the project ID', t => {
  const dir = mkdtempSync(join(tmpdir(), 'seekertag-firebase-android-'));
  const file = join(dir, 'google-services.json');
  const previous = process.env.GOOGLE_SERVICES_JSON;
  delete process.env.GOOGLE_SERVICES_JSON;
  t.after(() => {
    if (previous === undefined) delete process.env.GOOGLE_SERVICES_JSON;
    else process.env.GOOGLE_SERVICES_JSON = previous;
    rmSync(dir, { recursive: true, force: true });
  });
  const config = { android: { package: 'app.seekertag.mobile', googleServicesFile: file }, extra: { existing: true } };
  assert.throws(() => configure({ config }), /not found/);
  writeFileSync(file, JSON.stringify({ type: 'service_account', private_key: 'private-secret' }));
  assert.throws(() => configure({ config }), /must never be bundled/);
  const firebase = { project_info: { project_id: 'seekertag-qa', project_number: '123456789' },
    client: [{ client_info: { mobilesdk_app_id: '1:123456789:android:abc', android_client_info: { package_name: 'wrong.package' } }, api_key: [{ current_key: 'test-public-key' }] }] };
  writeFileSync(file, JSON.stringify(firebase));
  assert.throws(() => configure({ config }), /download google-services/);
  firebase.client[0].client_info.android_client_info.package_name = config.android.package;
  writeFileSync(file, JSON.stringify(firebase));
  const result = configure({ config });
  assert.deepEqual(result.extra, { existing: true, firebaseProjectId: 'seekertag-qa' });
  assert.equal(result.android.googleServicesFile, file);
});
