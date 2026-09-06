import { createApp } from './app.js';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const port = Number(process.env.PORT || 4318);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535.');
const defaultWebDist = fileURLToPath(new URL('../dist/', import.meta.url));
const webDistPath = process.env.WEB_DIST_PATH || (existsSync(fileURLToPath(new URL('../dist/index.html', import.meta.url))) ? defaultWebDist : null);
const app = createApp({
  dbPath: process.env.DATABASE_PATH || fileURLToPath(new URL('./data/seekertag.sqlite', import.meta.url)),
  publicUrl: process.env.PUBLIC_URL || 'http://localhost:8081',
  corsOrigins: (process.env.CORS_ORIGINS || '').split(',').map((value) => value.trim()).filter(Boolean),
  webDistPath,
});
const server = app.listen(port, process.env.HOST || '0.0.0.0', () => {
  console.log(`SeekerTag API ready on port ${port}`);
  if (webDistPath) console.log('SeekerTag web export served by the same process.');
});
function shutdown() {
  server.close(() => { app.locals.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
