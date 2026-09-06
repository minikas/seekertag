import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const platform = process.env.NATIVE_PLATFORM; const device = process.env.NATIVE_DEVICE_ID; const flow = process.argv[2];
if (!['ios', 'android'].includes(platform) || !device || !['composer', 'ios-services'].includes(flow) || (flow === 'ios-services' && platform !== 'ios')) throw new Error('Use NATIVE_PLATFORM=ios|android NATIVE_DEVICE_ID=<id> node scripts/test-native-extra.mjs composer|ios-services, depois do core.');
const previous = JSON.parse(readFileSync(resolve(root, `artifacts/native-${platform}/result.json`), 'utf8'));
if (!previous.passed || previous.device !== device) throw new Error('O core precisa passar neste mesmo dispositivo antes do teste complementar.');
const output = resolve(root, `artifacts/native-${platform}/${flow}`); mkdirSync(output, { recursive: true });
const work = mkdtempSync(join(tmpdir(), 'seekertag-native-extra-')); let passed = false;
try {
  const args = ['test', '--device', device, '--platform', platform, '--no-ansi', '--test-output-dir', work, '--debug-output', work, '--format', 'JUNIT', '--output', join(work, 'report.xml'), '-e', `QA_PUBLIC_OBJECT_NAME=Mochila QA ${previous.run}`, resolve(root, `tests/native/${flow}.yaml`)];
  const result = spawnSync('maestro', args, { cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, timeout: 5 * 60 * 1000 });
  const log = `${result.stdout || ''}\n${result.stderr || ''}`; writeFileSync(join(output, 'maestro.log'), log); console.log(log);
  if (result.error) throw new Error(`Maestro ${flow} não concluiu: ${result.error.code || 'erro de processo'}`);
  if (result.status !== 0) throw new Error(`Maestro ${flow} falhou (${result.status}).`);
  passed = true;
} finally {
  if (existsSync(join(work, 'report.xml'))) copyFileSync(join(work, 'report.xml'), join(output, 'report.xml'));
  function screenshots(dir) { for (const entry of readdirSync(dir, { withFileTypes: true })) { const path = join(dir, entry.name); if (entry.isDirectory()) screenshots(path); else if (/^native-.*\.png$/.test(entry.name)) copyFileSync(path, join(output, entry.name)); } }
  screenshots(work);
  writeFileSync(join(output, 'result.json'), JSON.stringify({ platform, device, flow, passed, coreRun: previous.run, apiOrigin: previous.apiOrigin, finishedAt: new Date().toISOString() }, null, 2));
  rmSync(work, { recursive: true, force: true });
}
