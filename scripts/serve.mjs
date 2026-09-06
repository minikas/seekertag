import { spawn } from 'node:child_process';
const port = process.env.PORT || '4318';
const child = spawn(process.execPath, ['server/index.js'], { stdio: 'inherit', env: { ...process.env, PUBLIC_URL: process.env.PUBLIC_URL || `http://localhost:${port}` } });
child.on('exit', code => process.exit(code ?? 1));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
