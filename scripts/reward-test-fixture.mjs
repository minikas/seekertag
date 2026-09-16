import assert from 'node:assert/strict';
import { createPrivateKey, sign } from 'node:crypto';
import { once } from 'node:events';
import { Keypair, LAMPORTS_PER_SOL, Transaction } from '@solana/web3.js';
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from '@solana/spl-token';
import { createApp } from '../server/app.js';
import { freePort, pause, startRewardValidator } from './reward-localnet.mjs';

export function signTestMessage(wallet, message) {
  const prefix = Buffer.from('302e020100300506032b657004220420', 'hex');
  const key = createPrivateKey({ key: Buffer.concat([prefix, Buffer.from(wallet.secretKey.subarray(0, 32))]), format: 'der', type: 'pkcs8' });
  return sign(null, Buffer.from(message), key).toString('base64');
}

/** Entirely ephemeral test identities and currency. Does not read existing wallets. */
export async function startRewardFixture({ webDistPath, prepareWeb } = {}) {
  const validator = await startRewardValidator();
  const { connection, programId, genesisHash, url } = validator;
  const ownerWallet = Keypair.generate(); const finderWallet = Keypair.generate();
  let server; let app;
  try {
    const block = await connection.getLatestBlockhash();
    const signature = await connection.requestAirdrop(ownerWallet.publicKey, 50 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction({ signature, ...block }, 'confirmed');
    const mint = await createMint(connection, ownerWallet, ownerWallet.publicKey, null, 6);
    const ownerToken = await getOrCreateAssociatedTokenAccount(connection, ownerWallet, mint, ownerWallet.publicKey);
    await mintTo(connection, ownerWallet, mint, ownerToken.address, ownerWallet, 1_000_000_000_000n);
    // Production reconciliation deliberately reads finalized state. Wait for the
    // setup accounts before exposing this test configuration to the API.
    for (let i = 0; i < 100; i++) {
      const account = await connection.getAccountInfo(ownerToken.address, 'finalized');
      if (account && account.data.readBigUInt64LE(64) > 0n) break;
      if (i === 99) throw new Error('Local test mint did not finalize.');
      await pause(400);
    }
    const port = await freePort();
    const origin = `http://127.0.0.1:${port}`;
    const env = { SKR_REWARDS_ENABLED: 'true', SKR_CLUSTER: 'localnet', SKR_RPC_URL: url, SKR_GENESIS_HASH: genesisHash, SKR_PROGRAM_ID: programId.toBase58(), SKR_MINT: mint.toBase58() };
    await prepareWeb?.({ origin, env });
    app = createApp({ dbPath: ':memory:', publicUrl: origin, rateLimits: false, webDistPath, rewards: { env } });
    server = app.listen(port, '127.0.0.1');
    await once(server, 'listening');
    const request = async (path, { token, method = 'GET', body } = {}) => {
      const response = await fetch(`${origin}/api${path}`, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, data: await response.json() };
    };
    async function submit(prepared, wallet = ownerWallet) {
      const transaction = Transaction.from(Buffer.from(prepared.transaction, 'base64'));
      assert.equal(transaction.feePayer.toBase58(), wallet.publicKey.toBase58());
      transaction.sign(wallet);
      const signature = await connection.sendRawTransaction(transaction.serialize());
      const confirmation = await connection.confirmTransaction({ signature, blockhash: transaction.recentBlockhash, lastValidBlockHeight: prepared.lastValidBlockHeight }, 'finalized');
      assert.equal(confirmation.value.err, null);
      return signature;
    }
    const stop = async () => {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      app.locals.close();
      await validator.stop();
    };
    return { ...validator, app, origin, env, request, submit, mint, ownerWallet, finderWallet, ownerToken, stop };
  } catch (error) {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    app?.locals.close(); await validator.stop(); throw error;
  }
}
