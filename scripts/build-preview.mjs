import { networkInterfaces, homedir } from 'node:os';
import { existsSync, copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mobileRoot = resolve(root, 'apps/mobile');
const candidates = Object.values(networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal && /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(i.address));
const host = process.env.SEEKERTAG_LAN_HOST || candidates[0]?.address;
const backend = process.env.EXPO_PUBLIC_API_URL || (host ? `http://${host}:4318/api` : '');
let apiUrl;
try { apiUrl = new URL(backend); } catch { throw new Error('Defina EXPO_PUBLIC_API_URL, por exemplo https://seu-servidor/api, ou conecte-se ao Wi-Fi.'); }
if (!['http:', 'https:'].includes(apiUrl.protocol) || apiUrl.username || apiUrl.password || apiUrl.search || apiUrl.hash || !apiUrl.pathname.endsWith('/api')) {
  throw new Error('EXPO_PUBLIC_API_URL deve ser um endereço HTTP(S) público, sem credenciais, terminado em /api.');
}
const env = { ...process.env, NODE_ENV: 'production', EXPO_PUBLIC_API_URL: backend, CMAKE_BUILD_PARALLEL_LEVEL: '2' };
if (!env.ANDROID_HOME && process.platform === 'darwin') env.ANDROID_HOME = resolve(homedir(), 'Library/Android/sdk');
if (!env.ANDROID_SDK_ROOT && env.ANDROID_HOME) env.ANDROID_SDK_ROOT = env.ANDROID_HOME;
if (!env.JAVA_HOME && process.platform === 'darwin') {
  const java = spawnSync('/usr/libexec/java_home', ['-v', '17'], { encoding: 'utf8' });
  if (java.status === 0) env.JAVA_HOME = java.stdout.trim();
}
function run(command, args, cwd = mobileRoot) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(`Criando APK de teste arm64 para ${apiUrl.origin}. O computador e o celular devem alcançar esse servidor.`);
// Use --incremental only when app.json, plugins and native dependencies have not changed.
const buildFile = resolve(mobileRoot, 'android/app/build.gradle');
const incremental = process.argv.includes('--incremental') && existsSync(buildFile) && readFileSync(buildFile, 'utf8').includes('SeekerTag: package only');
if (!incremental) run('npx', ['expo', 'prebuild', '--platform', 'android', '--no-install']);
run(process.platform === 'win32' ? 'gradlew.bat' : './gradlew', [
  // Gradle does not track EXPO_PUBLIC_* in the bundle task inputs. Regenerate
  // JavaScript even for incremental native builds when the API origin changes.
  ':app:createBundleReleaseJsAndAssets', '--rerun',
  ':app:assembleRelease', '-PreactNativeArchitectures=arm64-v8a', '--max-workers=2', '--no-daemon', '--console=plain',
  '-Dorg.gradle.jvmargs=-Xmx1536m -XX:MaxMetaspaceSize=512m',
], resolve(mobileRoot, 'android'));
mkdirSync(resolve(root, 'artifacts'), { recursive: true });
copyFileSync(resolve(mobileRoot, 'android/app/build/outputs/apk/release/app-release.apk'), resolve(root, 'artifacts/SeekerTag-preview.apk'));
console.log('APK pronto: artifacts/SeekerTag-preview.apk. Assinatura de teste; não é uma publicação em loja.');
