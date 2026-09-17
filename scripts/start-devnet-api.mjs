import { readFileSync } from 'node:fs';
import { configPath, keyDir, key, assertDevnet } from './devnet-rewards.mjs';
import { REWARD_PROGRAM } from '@seekertag/shared/reward';

await assertDevnet();
const config = JSON.parse(readFileSync(configPath, 'utf8'));
if (config.network !== 'devnet' || config.program !== REWARD_PROGRAM || config.verifier !== key('verifier').publicKey.toBase58()) throw new Error('Devnet configuration does not match the expected program and verifier.');
Object.assign(process.env, {
  HOST: process.env.HOST || '127.0.0.1', PUBLIC_URL: process.env.PUBLIC_URL || 'http://127.0.0.1:4318',
  REWARD_NETWORK: 'devnet', REWARD_RPC_URL: 'https://api.devnet.solana.com', REWARDS_ALLOW_MAINNET: 'false',
  REWARD_VERIFIER_KEYPAIR: `${keyDir}/verifier.json`, REWARD_TEST_USDC_MINT: config.mints.USDC, REWARD_TEST_SKR_MINT: config.mints.SKR,
});
await import('../apps/api/index.js');
