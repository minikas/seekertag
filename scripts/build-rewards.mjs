import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const directories = [process.env.SOLANA_BIN_DIR, join(root, 'artifacts/solana-tools/solana-release/bin'), ...(process.env.PATH || '').split(delimiter)].filter(Boolean);
const bin = directories.find(directory => existsSync(join(directory, 'cargo-build-sbf')));
if (!bin) throw new Error('Install the official Solana/Agave build tools, or set SOLANA_BIN_DIR. No network deployment is performed by this script.');
const child = spawn(join(bin, 'cargo-build-sbf'), ['--manifest-path', 'programs/reward-escrow/Cargo.toml', '--', '--locked'], { cwd: root, stdio: 'inherit', env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH || ''}` } });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
