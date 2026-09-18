const { readFileSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');

// expo-intent-launcher 57.0.1 returns Intent.toString(), whose data URI is
// redacted to content://authority/... on Android 16. Return Intent.data as
// documented; the redacted URI cannot be recovered on the JavaScript side.
const file = resolve(require.resolve('expo-intent-launcher/package.json'), '../android/src/main/java/expo/modules/intentlauncher/IntentLauncherModule.kt');
const original = 'payload.data?.let { putString(ATTR_DATA, it.toString()) }';
const replacement = 'payload.data?.data?.let { putString(ATTR_DATA, it.toString()) }';
const source = readFileSync(file, 'utf8');
if (!source.includes(replacement)) {
  if (!source.includes(original)) throw new Error('Review the Expo IntentLauncher activity-result patch before building.');
  writeFileSync(file, source.replace(original, replacement));
}
