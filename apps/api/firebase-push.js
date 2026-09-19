import { readFileSync } from 'node:fs';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';

export function readFirebaseAccount(file, expectedProjectId) {
  let account;
  try { account = JSON.parse(readFileSync(file, 'utf8')); }
  catch { throw new Error('Firebase: could not read the service-account JSON from FIREBASE_SERVICE_ACCOUNT_FILE.'); }
  if (account?.type !== 'service_account' || typeof account.project_id !== 'string'
    || typeof account.client_email !== 'string' || typeof account.private_key !== 'string') {
    throw new Error('Firebase: use the private service-account JSON on the server, not google-services.json.');
  }
  if (account.project_id !== expectedProjectId) throw new Error('Firebase: the service account and FIREBASE_PROJECT_ID must belong to the same project.');
  return account;
}

export function firebasePushFromEnv(env = process.env) {
  const file = env.FIREBASE_SERVICE_ACCOUNT_FILE;
  const projectId = env.FIREBASE_PROJECT_ID;
  if (!file && !projectId) return null;
  if (!file || !projectId) throw new Error('Firebase: configure both FIREBASE_PROJECT_ID and FIREBASE_SERVICE_ACCOUNT_FILE.');
  const account = readFirebaseAccount(file, projectId);
  const name = `seekertag-push-${projectId}`;
  const app = getApps().find(app => app.name === name) || initializeApp({ credential: cert(account), projectId }, name);
  return { projectId, send: message => getMessaging(app).send(firebaseMessage(message)) };
}

export function firebaseMessage({ token, title, body, data }) {
  const tag = `message-${data.userId}-${data.messageId}`;
  return {
    token,
    // Notification + data lets Android show the alert even without a running JS
    // process. Expo parses data.body on both foreground and cold-start taps.
    notification: { title, body },
    data: { body: JSON.stringify(data), title, message: body, channelId: 'messages', tag },
    android: {
      priority: 'high', ttl: 86400000, restrictedPackageName: 'app.seekertag.mobile',
      notification: { channelId: 'messages', sound: 'default', tag, visibility: 'private', defaultVibrateTimings: true },
    },
  };
}

export function firebaseFailure(error) {
  if (['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(error?.code)) return 'remove-device';
  if (['messaging/invalid-argument', 'messaging/invalid-payload', 'messaging/payload-size-limit-exceeded'].includes(error?.code)) return 'discard';
  return 'retry';
}
