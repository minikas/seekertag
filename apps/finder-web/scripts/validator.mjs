import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

export async function buildValidator() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../../../packages/shared/wallet-address.ts', import.meta.url))],
    bundle: true, platform: 'browser', format: 'iife', globalName: 'FinderWallet',
    target: 'es2020', minify: true, write: false,
  });
  return result.outputFiles[0].contents;
}
