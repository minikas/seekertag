import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, randomBytes } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const platform = process.env.NATIVE_PLATFORM;
const device = process.env.NATIVE_DEVICE_ID;
if (!['ios', 'android'].includes(platform) || !device) throw new Error('Defina NATIVE_PLATFORM=ios|android e NATIVE_DEVICE_ID para um simulador/emulador já iniciado com o aplicativo instalado.');
const base = process.env.EXPO_PUBLIC_API_URL;
let url;
try { url = new URL(base); } catch { throw new Error('Defina EXPO_PUBLIC_API_URL igual à API embutida no aplicativo instalado.'); }
if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !url.pathname.endsWith('/api')) throw new Error('A URL deve ser HTTP(S), sem credenciais e terminada em /api.');
const run = `${platform}-${Date.now()}-${randomUUID().slice(0, 6)}`;
const secrets = [];
function redact(value) { return secrets.reduce((text, secret) => text.split(secret).join('[REDACTED]'), String(value)); }
async function request(path, token, body) {
  // Maestro runs synchronously for minutes. Do not retain an idle HTTP socket
  // across that blocked event loop and accidentally reuse it after server expiry.
  const result = await fetch(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Connection: 'close', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000) });
  if (!result.ok) throw new Error(`API ${path}: HTTP ${result.status}`);
  return result.json();
}
async function account(role) {
  const password = randomBytes(18).toString('base64url');
  secrets.push(password);
  const email = `native-${role}-${run}@example.com`;
  const result = await request('/auth/register', null, { name: `Native QA ${role}`, email, password });
  secrets.push(result.token, result.recoveryCode);
  return { email, password, token: result.token };
}
const owner = await account('owner');
const fixture = await account('fixture');
const objectName = `Chaves QA ${run}`;
const publicName = `Mochila QA ${run}`;
const message = `Encontrei o objeto no teste ${run}.`;
const { tag } = await request('/tags', fixture.token, { name: publicName, category: 'Mochila' });
const variables = { QA_EMAIL: owner.email, QA_PASSWORD: owner.password, QA_OBJECT_NAME: objectName, QA_PUBLIC_URL: tag.publicUrl, QA_PUBLIC_OBJECT_NAME: publicName, QA_MESSAGE: message };
const work = mkdtempSync(join(tmpdir(), 'seekertag-native-'));
const output = resolve(root, `artifacts/native-${platform}`);
mkdirSync(output, { recursive: true });
console.log(`Executando Maestro ${platform} contra ${url.origin}; cria duas contas e objetos sintéticos nessa API. Não usa banco isolado automaticamente.`);
let passed = false;
try {
  const args = ['test', '--device', device, '--platform', platform, '--no-ansi', '--test-output-dir', work, '--debug-output', work, '--format', 'JUNIT', '--output', join(work, 'report.xml')];
  for (const [key, value] of Object.entries(variables)) args.push('-e', `${key}=${value}`);
  args.push(resolve(root, 'tests/native/core.yaml'));
  const result = spawnSync('maestro', args, { cwd: root, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, timeout: 15 * 60 * 1000 });
  const log = redact(`${result.stdout || ''}\n${result.stderr || ''}`);
  writeFileSync(join(output, 'maestro.log'), log);
  console.log(log);
  if (result.error) throw new Error(redact(result.error.message));
  if (result.status !== 0) throw new Error(`Maestro falhou (${result.status}); veja ${output}/maestro.log.`);
  const { tags } = await request('/tags', owner.token);
  const { reports } = await request('/reports', fixture.token);
  if (!tags.some(item => item.name === objectName && item.category === 'Chaves')) throw new Error('O objeto criado pela UI não está salvo na API.');
  if (!reports.some(item => item.tagId === tag.id && item.lastMessage === message)) throw new Error('O aviso enviado pela UI não está salvo na API.');
  passed = true;
} finally {
  if (existsSync(join(work, 'report.xml'))) writeFileSync(join(output, 'report.xml'), redact(readFileSync(join(work, 'report.xml'), 'utf8')));
  function screenshots(dir) { for (const entry of readdirSync(dir, { withFileTypes: true })) { const path = join(dir, entry.name); if (entry.isDirectory()) screenshots(path); else if (/^native-.*\.png$/.test(entry.name)) copyFileSync(path, join(output, entry.name)); } }
  screenshots(work);
  writeFileSync(join(output, 'result.json'), JSON.stringify({ platform, device, apiOrigin: url.origin, run, passed, checks: ['login', 'create object in UI and verify API', 'generated QR display', 'owner session after process restart', 'manual label URL', 'finder report and verify API', 'finder access after process restart and rescan'], hardwareNotTested: ['optical QR scan', 'physical NFC write', 'wallet authorization'], finishedAt: new Date().toISOString() }, null, 2));
  // Maestro's full command dump can contain synthetic credentials. Only keep
  // redacted reports and explicitly named screenshots, never that private dump.
  rmSync(work, { recursive: true, force: true });
}
console.log(`Native ${platform}: PASS. Evidências: artifacts/native-${platform}/`);
