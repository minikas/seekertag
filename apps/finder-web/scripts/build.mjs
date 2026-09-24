import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { buildValidator, buildQrScanner } from './validator.mjs';

const output = new URL('../dist/', import.meta.url);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(new URL('../public/', import.meta.url), output, { recursive: true });
await writeFile(new URL('wallet-validator.js', output), await buildValidator());
await writeFile(new URL('qr-scanner.js', output), await buildQrScanner());
console.log('Finder web built: apps/finder-web/dist');
