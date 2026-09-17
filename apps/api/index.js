import { createApp } from './app.js';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.PORT || 4318);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535.');
const app = createApp({
  dbPath: process.env.DATABASE_PATH || fileURLToPath(new URL('./data/seekertag.sqlite', import.meta.url)),
  publicUrl: process.env.PUBLIC_URL || `http://localhost:${port}`,
  corsOrigins: (process.env.CORS_ORIGINS || '').split(',').map((value) => value.trim()).filter(Boolean),
});
const server = app.listen(port, process.env.HOST || '0.0.0.0', () => {
  console.log(`SeekerTag API ready on port ${port}`);
});
function shutdown() {
  server.close(() => { app.locals.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
