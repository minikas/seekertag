// Repackages JavaScript only into the previously built/tested native shells.
// Any native config, dependency or packaged asset change requires a full build.
// Candidates are never promoted automatically; run the native smoke first.
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const platform = process.argv[2];
if (!['ios', 'android'].includes(platform)) throw new Error('Use node scripts/rebundle-native.mjs ios|android.');
if (process.platform !== 'darwin') throw new Error('Este fluxo validado exige macOS com Xcode e Android SDK.');
const backend = process.env.EXPO_PUBLIC_API_URL;
let api;
try { api = new URL(backend); } catch { throw new Error('Defina EXPO_PUBLIC_API_URL com uma API acessível ao dispositivo, terminada em /api.'); }
if (!['http:', 'https:'].includes(api.protocol) || api.username || api.password || api.search || api.hash || !api.pathname.endsWith('/api')) throw new Error('EXPO_PUBLIC_API_URL deve ser HTTP(S), sem credenciais, terminada em /api.');
const env = { ...process.env, NODE_ENV: 'production', EXPO_PUBLIC_API_URL: backend };
delete env.SKIP_BUNDLING;
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, env, encoding: 'utf8', ...options });
  if (result.error) throw new Error(`${command} não pôde executar: ${result.error.code || 'erro de processo'}`);
  if (result.status !== 0) throw new Error(`${command} falhou (${result.status}): ${(result.stderr || result.stdout || '').slice(-3000)}`);
  return result.stdout?.trim() || '';
}
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const fileHash = path => digest(readFileSync(path));
const baselineCommit = 'ae2605987d845f270758b98745f2da92e05ce230';
const nativePaths = ['app.json', 'app.config.js', 'app.config.ts', 'plugins', 'assets'];
function canonical(value) { if (Array.isArray(value)) return value.map(canonical); if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])); return value; }
const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
// Compare actual installed native dependency declarations, not test/package scripts.
const originalPackage = JSON.parse(run('git', ['show', `${baselineCommit}:package.json`]));
const currentPackage = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
// Only permit promoting the already-installed pure-JS hash implementation.
const currentDependencies = { ...currentPackage.dependencies };
const hashPromotion = !originalPackage.dependencies['@noble/hashes'] && currentDependencies['@noble/hashes'] === '2.4.0';
if (hashPromotion) delete currentDependencies['@noble/hashes'];
if (!equal(originalPackage.dependencies, currentDependencies) || !equal(originalPackage.overrides, currentPackage.overrides)) throw new Error('Dependências nativas mudaram; faça um build completo.');
const originalLock = JSON.parse(run('git', ['show', `${baselineCommit}:package-lock.json`]));
const currentLock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
if (hashPromotion) {
  if (originalLock.packages['node_modules/@noble/hashes']?.version !== '2.4.0' || currentLock.packages[''].dependencies['@noble/hashes'] !== '2.4.0') throw new Error('A promoção JS não corresponde ao nó já instalado.');
  delete currentLock.packages[''].dependencies['@noble/hashes'];
  const hashRoot = join(root, 'node_modules/@noble/hashes');
  const hashPackage = JSON.parse(readFileSync(join(hashRoot, 'package.json'), 'utf8'));
  function nativeFiles(directory) { return readdirSync(directory, { withFileTypes: true }).some(entry => entry.isDirectory() ? nativeFiles(join(directory, entry.name)) : /\.(podspec|swift|m|mm|h|java|kt|c|cpp|node|wasm)$/.test(entry.name) || entry.name === 'react-native.config.js'); }
  if (hashPackage.version !== '2.4.0' || hashPackage.gypfile || hashPackage.codegenConfig || nativeFiles(hashRoot)) throw new Error('A dependência de hash instalada não é a implementação JS esperada.');
}
if (!equal(originalLock, currentLock)) throw new Error('O grafo de dependências mudou; faça um build completo.');
const changed = run('git', ['diff', '--name-only', baselineCommit, '--', ...nativePaths]);
const untracked = run('git', ['ls-files', '--others', '--exclude-standard', '--', ...nativePaths]);
if (changed || untracked) throw new Error(`Configuração/lockfile/assets mudaram; faça build completo: ${[changed, untracked].filter(Boolean).join(', ')}`);
function sourceFingerprint() {
  const files = run('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', 'src', 'App.tsx', 'index.ts', 'assets', 'plugins', 'app.json', 'package.json', 'package-lock.json']).split('\n').filter(Boolean).sort();
  return digest(files.map(path => `${path}:${fileHash(join(root, path))}`).join('\n'));
}
const sourceBefore = sourceFingerprint();
const baseline = join(root, 'artifacts/native-rebundle-base'); mkdirSync(baseline, { recursive: true });
const candidate = join(root, 'artifacts/native-candidates', new Date().toISOString().replace(/[:.]/g, '-') + `-${platform}`); mkdirSync(candidate, { recursive: true });
const baseApk = join(baseline, 'SeekerTag-preview.apk');
const baseApp = join(baseline, 'SeekerTag-ios-simulator.app');
const expectedApk = '50d1c34ad473fa78214faf449474d8a5657c1a92c57248bd6d8156f720ecb2b1';
const expectedIosBinary = '723691b9f17781a55c909f393262a49c05e0ecc8f85c62c5c490398cad4ef8df';
const expectedIosBundle = '6e81c7c4689207b7788b2cfd42b1091662fb9e2252d6d66fef0ff8443503c2ce';
function assertIosBase(app) {
  if (fileHash(join(app, 'SeekerTag')) !== expectedIosBinary || fileHash(join(app, 'main.jsbundle')) !== expectedIosBundle) throw new Error('A base iOS não corresponde ao build nativo validado. Preserve a base original ou faça build completo.');
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
  const info = JSON.parse(run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', join(app, 'Info.plist')]));
  if (info.CFBundleIdentifier !== 'app.seekertag.mobile' || !info.CFBundleSupportedPlatforms?.includes('iPhoneSimulator') || info.UIUserInterfaceStyle !== 'Dark') throw new Error('Manifesto iOS incompatível com a base esperada.');
}
if (platform === 'ios') {
  if (!existsSync(baseApp)) { const original = join(root, 'artifacts/SeekerTag-ios-simulator.app'); assertIosBase(original); cpSync(original, baseApp, { recursive: true }); }
  assertIosBase(baseApp);
} else {
  if (!existsSync(baseApk)) { const original = join(root, 'artifacts/SeekerTag-preview.apk'); if (fileHash(original) !== expectedApk) throw new Error('APK de base diferente do build validado; use a base original ou faça build completo.'); cpSync(original, baseApk); }
  if (fileHash(baseApk) !== expectedApk) throw new Error('A base Android foi alterada.');
}
const bundle = join(candidate, platform === 'ios' ? 'main.jsbundle' : 'index.android.bundle');
const assets = join(candidate, 'exported-assets'); mkdirSync(assets, { recursive: true });
console.log(`Gerando candidato ${platform} para ${api.origin}; artefatos entregues serão preservados.`);
run('npx', ['expo', 'export:embed', '--entry-file', 'index.ts', '--platform', platform, '--dev', 'false', '--bytecode', '--max-workers', '2', '--bundle-output', bundle, '--assets-dest', assets], { stdio: 'inherit' });
const header = readFileSync(bundle).subarray(0, 12);
let artifact;
if (platform === 'ios') {
  if (!header.equals(readFileSync(join(baseApp, 'main.jsbundle')).subarray(0, 12))) throw new Error('Versão/magic Hermes incompatível com o runtime iOS.');
  artifact = join(candidate, 'SeekerTag-ios-simulator.app'); cpSync(baseApp, artifact, { recursive: true });
  cpSync(bundle, join(artifact, 'main.jsbundle')); cpSync(assets, artifact, { recursive: true });
  // Preserve the simulator executable's existing identity and signing metadata.
  // Do not disable code signing; SecureStore must run with a valid simulator app.
  run('/usr/bin/codesign', ['--force', '--sign', '-', '--preserve-metadata=identifier,entitlements,flags,runtime', artifact]);
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', artifact]);
} else {
  const sdk = process.env.ANDROID_HOME || join(homedir(), 'Library/Android/sdk');
  const buildTools = join(sdk, 'build-tools', readdirSync(join(sdk, 'build-tools')).filter(name => /^\d/.test(name)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).at(-1));
  if (!env.JAVA_HOME) env.JAVA_HOME = run('/usr/libexec/java_home', ['-v', '17']);
  const signer = join(buildTools, 'apksigner'); const aligner = join(buildTools, 'zipalign');
  const baselineSignature = run(signer, ['verify', '--print-certs', baseApk]).match(/certificate SHA-256 digest: (\w+)/)?.[1];
  if (!baselineSignature) throw new Error('Não foi possível verificar a assinatura da base Android.');
  const unsigned = join(candidate, 'unsigned.apk');
  // Preserve every ZIP entry and compression mode; only JS is replaced.
  // Native resource names are compiled, so new or changed assets require aapt/full build.
  run('python3', ['-c', `import sys,zipfile,pathlib,hashlib,re
base,bundle,assets,out=sys.argv[1:]
new=pathlib.Path(bundle).read_bytes()
with zipfile.ZipFile(base) as source:
 old=source.read('assets/index.android.bundle')
 if old[:12] != new[:12]: raise RuntimeError('Hermes bytecode/runtime mismatch')
 hashes={hashlib.sha256(source.read(name)).hexdigest() for name in source.namelist() if not name.endswith('/')}
 for asset in pathlib.Path(assets).rglob('*'):
  if asset.is_file() and hashlib.sha256(asset.read_bytes()).hexdigest() not in hashes: raise RuntimeError('New/changed native asset requires full build: '+asset.name)
 with zipfile.ZipFile(out,'w') as target:
  for info in source.infolist():
   if re.match(r'META-INF/[^/]+\\.(SF|RSA|DSA|EC)$',info.filename) or info.filename=='META-INF/MANIFEST.MF': continue
   target.writestr(info,new if info.filename=='assets/index.android.bundle' else source.read(info.filename))
`, baseApk, bundle, assets, unsigned]);
  const aligned = join(candidate, 'aligned.apk'); artifact = join(candidate, 'SeekerTag-preview.apk');
  run(aligner, ['-P', '16', '-f', '4', unsigned, aligned]);
  run(signer, ['sign', '--ks', join(root, 'android/app/debug.keystore'), '--ks-key-alias', 'androiddebugkey', '--ks-pass', 'pass:android', '--key-pass', 'pass:android', '--out', artifact, aligned]);
  const signature = run(signer, ['verify', '--verbose', '--print-certs', artifact]);
  if (!signature.includes(`certificate SHA-256 digest: ${baselineSignature}`)) throw new Error('A assinatura do candidato mudou de identidade.');
  run(aligner, ['-c', '-P', '16', '4', artifact]);
  run('python3', ['-c', `import sys,zipfile
with zipfile.ZipFile(sys.argv[1]) as old, zipfile.ZipFile(sys.argv[2]) as new:
 for name in old.namelist():
  if name=='assets/index.android.bundle' or name.startswith('META-INF/'): continue
  if old.read(name)!=new.read(name): raise RuntimeError('Native ZIP entry changed: '+name)
`, baseApk, artifact]);
}
if (sourceFingerprint() !== sourceBefore) throw new Error('A fonte mudou durante o bundle. Preserve este candidato apenas para diagnóstico; gere outro antes de testar/promover.');
const verification = { platform, createdAt: new Date().toISOString(), baselineCommit, nativeShellUnchanged: true, nativeConfigurationUnchanged: true, sourceFingerprint: sourceBefore, hermesBytecodeVersion: header.readUInt32LE(8), bundleSha256: fileHash(bundle), apiOrigin: api.origin, signatureVerified: true, artifact, ...(platform === 'android' ? { sha256: fileHash(artifact), alignment: '16 KiB ELF / 4-byte ZIP checked' } : {}), runtimeSmoke: 'pending; candidate is not promoted automatically' };
writeFileSync(join(candidate, 'verification.json'), JSON.stringify(verification, null, 2) + '\n');
console.log(JSON.stringify(verification, null, 2));
