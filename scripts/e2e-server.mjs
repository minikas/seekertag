import { createApp } from '../server/app.js';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.E2E_PORT || 4329);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('E2E_PORT must be between 1024 and 65535.');
const origin = `http://127.0.0.1:${port}`;
const webDistPath = resolve(projectRoot, process.env.WEB_DIST_PATH || 'artifacts/test-web');
if (!existsSync(join(webDistPath, 'index.html'))) {
  throw new Error('The isolated web export is missing. Run npm run build:test-web first.');
}
const directory = mkdtempSync(join(tmpdir(), 'seekertag-browser-tests-'));
const app = createApp({
  dbPath: join(directory, 'e2e.sqlite'),
  publicUrl: origin,
  webDistPath,
  // The real API is used. Rate limits have separate server integration tests;
  // browser projects share a single loopback IP and must not throttle each other.
  rateLimits: false,
});
let closed = false;
function cleanup() {
  if (closed) return;
  closed = true;
  app.locals.close();
  rmSync(directory, { recursive: true, force: true });
}
const server = app.listen(port, '127.0.0.1', () => console.log(`Isolated SeekerTag browser test server: ${origin}`));
server.on('error', error => { cleanup(); console.error(error.message); process.exit(1); });
function shutdown() {
  server.close(() => { cleanup(); process.exit(0); });
  server.closeAllConnections();
  setTimeout(() => { cleanup(); process.exit(1); }, 5000).unref();
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
process.once('exit', cleanup);
