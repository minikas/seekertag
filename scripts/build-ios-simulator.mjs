import { existsSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (process.platform !== 'darwin') throw new Error('O build iOS requer macOS, Xcode e CocoaPods.');
const backend = process.env.EXPO_PUBLIC_API_URL;
let api;
try { api = new URL(backend); } catch { throw new Error('Defina EXPO_PUBLIC_API_URL para a API acessível pelo simulador, terminada em /api.'); }
if (!['http:', 'https:'].includes(api.protocol) || api.username || api.password || api.search || api.hash || !api.pathname.endsWith('/api')) throw new Error('EXPO_PUBLIC_API_URL deve ser HTTP(S), sem credenciais, terminada em /api.');
const device = process.env.IOS_SIMULATOR_UDID;
if (!device || !/^[A-Fa-f0-9-]{36}$/.test(device)) throw new Error('Defina IOS_SIMULATOR_UDID com um simulador disponível em xcrun simctl list devices available.');
const env = { ...process.env, NODE_ENV: 'production', EXPO_PUBLIC_API_URL: backend, COCOAPODS_DISABLE_STATS: 'true' };
delete env.SKIP_BUNDLING;
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const incremental = process.argv.includes('--incremental') && existsSync(resolve(root, 'ios/Pods/Manifest.lock'));
if (!incremental) {
  run('npx', ['expo', 'prebuild', '--platform', 'ios', '--no-install', '--no-clean']);
  run('pod', ['install'], resolve(root, 'ios'));
}
const derived = resolve(root, 'artifacts/ios-derived');
console.log(`Build iOS Simulator arm64 para ${api.origin}. Não gera IPA nem assinatura para aparelho físico.`);
// Keep Xcode's simulator signing enabled. It adds simulated application/Keychain
// entitlements to the executable; CODE_SIGNING_ALLOWED=NO breaks SecureStore.
run('xcodebuild', [
  '-workspace', 'ios/SeekerTag.xcworkspace', '-scheme', 'SeekerTag',
  '-configuration', 'Release', '-sdk', 'iphonesimulator',
  '-destination', `platform=iOS Simulator,id=${device}`,
  '-derivedDataPath', derived, '-jobs', '2', 'ARCHS=arm64', 'ONLY_ACTIVE_ARCH=YES',
  'CODE_SIGNING_ALLOWED=YES', 'CODE_SIGN_IDENTITY=-', 'CODE_SIGN_STYLE=Automatic',
  'COMPILER_INDEX_STORE_ENABLE=NO', 'DEBUG_INFORMATION_FORMAT=dwarf', 'build',
]);
const source = resolve(derived, 'Build/Products/Release-iphonesimulator/SeekerTag.app');
if (!existsSync(resolve(source, 'main.jsbundle'))) throw new Error('O build não gerou main.jsbundle; artefato standalone incompleto.');
const destination = resolve(root, 'artifacts/SeekerTag-ios-simulator.app');
mkdirSync(dirname(destination), { recursive: true });
rmSync(destination, { recursive: true, force: true });
cpSync(source, destination, { recursive: true });
console.log('Pronto: artifacts/SeekerTag-ios-simulator.app. Instale com xcrun simctl install no simulador escolhido.');
