// Development utility: hard-wired to devnet and keys generated for this project.
// It never reads the Solana CLI's default wallet or connects to mainnet.
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import { TOKEN_PROGRAM, tokenAddress, createTokenAccount, PROGRAM } from '@seekertag/shared/escrow-wire';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const keyDir = `${root}artifacts/reward-keys`;
export const configPath = `${root}artifacts/rewards-devnet.json`;
export const connection = new Connection('https://api.devnet.solana.com', { commitment: 'finalized', fetch: (url, options = {}) => fetch(url, { ...options, signal: AbortSignal.timeout(15000) }) });
export function key(name, create = false) {
  mkdirSync(keyDir, { recursive: true, mode: 0o700 });
  const path = `${keyDir}/${name}.json`;
  if (!existsSync(path) && create) writeFileSync(path, JSON.stringify(Array.from(Keypair.generate().secretKey)), { mode: 0o600, flag: 'wx' });
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, 'utf8'))));
}
export async function assertDevnet() {
  if (await connection.getGenesisHash() !== 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG') throw new Error('Refusing a network other than devnet.');
}
export async function send(instructions, payer, additionalSigners = []) {
  const recent = await connection.getLatestBlockhash('confirmed');
  const transaction = new Transaction({ feePayer: payer.publicKey, recentBlockhash: recent.blockhash }).add(...instructions);
  transaction.sign(payer, ...additionalSigners);
  const signature = await connection.sendRawTransaction(transaction.serialize(), { skipPreflight: false, preflightCommitment: 'confirmed' });
  await waitFor(signature, recent.lastValidBlockHeight);
  return signature;
}
export async function waitFor(signature, lastValidBlockHeight) {
  for (let n = 0; n < 120; n++) {
    const status = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
    if (status?.err) throw new Error(`Devnet transaction failed: ${JSON.stringify(status.err)}`);
    if (status?.confirmationStatus === 'finalized') return;
    if (lastValidBlockHeight && await connection.getBlockHeight('finalized') > lastValidBlockHeight) throw new Error(`Transaction expired: ${signature}`);
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  throw new Error(`Confirmation timed out; check signature before retrying: ${signature}`);
}
function mintTo(mint, recipient, payer, amount) {
  const data = Buffer.alloc(10); data[0] = 14; data.writeBigUInt64LE(amount, 1); data[9] = 6;
  return new TransactionInstruction({ programId: TOKEN_PROGRAM, keys: [{ pubkey: mint, isSigner: false, isWritable: true }, { pubkey: tokenAddress(recipient, mint), isSigner: false, isWritable: true }, { pubkey: payer.publicKey, isSigner: true, isWritable: false }], data });
}
export async function initialize() {
  await assertDevnet(); const payer = key('devnet-payer'); const verifier = key('verifier', true);
  if (!(await connection.getAccountInfo(PROGRAM))?.executable) throw new Error('Deploy the escrow program to devnet first.');
  const mints = {};
  for (const symbol of ['USDC', 'SKR']) {
    const mint = key(`devnet-test-${symbol.toLowerCase()}`, true); mints[symbol] = mint.publicKey.toBase58();
    const existing = await connection.getAccountInfo(mint.publicKey);
    if (existing) {
      if (!existing.owner.equals(TOKEN_PROGRAM) || existing.data.length !== 82 || existing.data[44] !== 6 || existing.data[45] !== 1 || !new PublicKey(existing.data.subarray(4, 36)).equals(payer.publicKey)) throw new Error('Existing test mint does not match this development authority.');
      continue;
    }
    const data = Buffer.alloc(35); data[0] = 20; data[1] = 6; payer.publicKey.toBuffer().copy(data, 2); data[34] = 0;
    await send([
      SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: mint.publicKey, space: 82, lamports: await connection.getMinimumBalanceForRentExemption(82), programId: TOKEN_PROGRAM }),
      new TransactionInstruction({ programId: TOKEN_PROGRAM, keys: [{ pubkey: mint.publicKey, isSigner: false, isWritable: true }], data }),
    ], payer, [mint]);
    console.log(`${symbol} test mint: ${mints[symbol]}`);
  }
  const config = { network: 'devnet', rpc: 'https://api.devnet.solana.com', program: PROGRAM.toBase58(), verifier: verifier.publicKey.toBase58(), treasury: payer.publicKey.toBase58(), feeBps: 500, mints };
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  return config;
}
export async function topUp(address, config, sol = 1, tokens = 50) {
  await assertDevnet();
  const payer = key('devnet-payer'); const recipient = new PublicKey(address);
  if (!PublicKey.isOnCurve(recipient.toBytes()) || config.network !== 'devnet') throw new Error('Invalid devnet destination.');
  const instructions = [];
  const balance = await connection.getBalance(recipient, 'finalized'); const target = Math.round(sol * 1e9);
  if (balance < target) instructions.push(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: recipient, lamports: target - balance }));
  for (const currency of ['USDC', 'SKR']) {
    const mint = new PublicKey(config.mints[currency]);
    const expected = key(`devnet-test-${currency.toLowerCase()}`).publicKey;
    if (!mint.equals(expected)) throw new Error('Refusing a mint outside this project’s devnet fixtures.');
    const account = await connection.getAccountInfo(tokenAddress(recipient, mint), 'finalized');
    const current = account ? account.data.readBigUInt64LE(64) : 0n; const target = BigInt(tokens) * 1_000_000n;
    if (current < target) instructions.push(createTokenAccount(payer.publicKey, recipient, mint), mintTo(mint, recipient, payer, target - current));
  }
  if (instructions.length) console.log(`Devnet top-up confirmed: ${await send(instructions, payer)}`);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  if (command === 'init') await initialize();
  else if (command === 'fund' && process.argv[3]) await topUp(process.argv[3], JSON.parse(readFileSync(configPath, 'utf8')));
  else throw new Error('Usage: node scripts/devnet-rewards.mjs init | fund PUBLIC_ADDRESS');
}
