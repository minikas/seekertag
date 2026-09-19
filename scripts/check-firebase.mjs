import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createPrivateKey } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFirebaseAccount } from '../apps/api/firebase-push.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const configure = require('../apps/mobile/app.config.js');
if (process.argv.includes('--help')) {
  console.log('Usage: npm run check:firebase -- [google-services.json] [service-account.json]\nChecks local files only. Does not send a push or print credentials.');
} else {
  try {
    if (process.argv[2]) process.env.GOOGLE_SERVICES_JSON = resolve(process.argv[2]);
    const { expo } = JSON.parse(readFileSync(resolve(root, 'apps/mobile/app.json'), 'utf8'));
    const config = configure({ config: expo });
    const projectId = config.extra?.firebaseProjectId;
    if (!projectId) throw new Error('Salve google-services.json em apps/mobile/google-services.json ou informe seu caminho.');
    console.log(`Android: ${config.android.package}\nFirebase project: ${projectId}`);
    const accountFile = process.argv[3] || process.env.FIREBASE_SERVICE_ACCOUNT_FILE;
    if (accountFile) {
      const account = readFirebaseAccount(resolve(accountFile), projectId);
      try {
        if (createPrivateKey(account.private_key).asymmetricKeyType !== 'rsa') throw new Error();
      } catch { throw new Error('Firebase: a chave privada da conta de serviço não é uma chave RSA válida.'); }
      console.log('Server key: valid RSA key, same Firebase project.');
    } else console.log('Server key: not checked. Pass its local path as the second argument.');
    console.log('Local configuration validated. FCM permissions and real delivery still require an online test.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
