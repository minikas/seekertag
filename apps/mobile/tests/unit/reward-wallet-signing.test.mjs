import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { rewardInstructions, verifyRewardTransaction } from '@seekertag/shared/escrow-wire';

const source = ts.transpileModule(readFileSync(new URL('../../src/platform/reward-wallet.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
function harness({ obsoleteResponse = false } = {}) {
  const owner = Keypair.generate(), verifier = Keypair.generate();
  const spec = { kind: 'release', payer: owner.publicKey.toBase58(), verifier: verifier.publicKey.toBase58(), treasury: Keypair.generate().publicKey.toBase58(),
    feeBps: 500, recipient: Keypair.generate().publicKey.toBase58(), rewardId: '12'.repeat(32), reportHash: '34'.repeat(32), mint: null, amountUnits: '1000000', computeBudget: 'fixed-v2' };
  function operation() {
    const tx = new Transaction({ feePayer: owner.publicKey, recentBlockhash: Keypair.generate().publicKey.toBase58() }).add(...rewardInstructions(spec));
    tx.partialSign(verifier);
    return { network: 'devnet', spec, transaction: tx.serialize({ requireAllSignatures: false }).toString('base64') };
  }
  const reviewed = operation(), fresh = operation(), events = [], payloads = [];
  const dependencies = {
    buffer: { Buffer }, '@solana/web3.js': { PublicKey }, '@seekertag/shared/wallet-address': {},
    '@seekertag/shared/escrow-wire': { verifyRewardTransaction }, '../api': {},
    './wallet-return': { waitForWalletReturn: async () => { events.push('return'); } },
    '@solana-mobile/mobile-wallet-adapter-protocol': { transact: async callback => callback({
      authorize: async () => { events.push('authorize'); return { accounts: [{ address: owner.publicKey.toBuffer().toString('base64') }], auth_token: 'test-authorization' }; },
      signTransactions: async ({ payloads: requested }) => {
        events.push('sign'); payloads.push(...requested);
        const tx = Transaction.from(Buffer.from(obsoleteResponse ? reviewed.transaction : requested[0], 'base64'));
        tx.partialSign(owner);
        return { signed_payloads: [tx.serialize().toString('base64')] };
      },
    }) },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', source)(name => { assert.ok(name in dependencies, name); return dependencies[name]; }, module, module.exports);
  return { ...module.exports, reviewed, fresh, events, payloads };
}

test('MWA renews after authorization, signs fresh bytes and preserves the verifier signature', async () => {
  const h = harness();
  const signed = await h.signReward(h.reviewed, async () => { h.events.push('refresh'); return h.fresh; });
  assert.deepEqual(h.events, ['authorize', 'refresh', 'sign', 'return']);
  assert.deepEqual(h.payloads, [h.fresh.transaction]);
  const tx = verifyRewardTransaction(signed, h.fresh.spec);
  assert.ok(tx.verifySignatures()); assert.equal(tx.signatures.length, 2);
  assert.equal(tx.recentBlockhash, Transaction.from(Buffer.from(h.fresh.transaction, 'base64')).recentBlockhash);
});

test('a changed review exits the wallet session without requesting a signature', async () => {
  const h = harness();
  assert.equal(await h.signReward(h.reviewed, async () => null), null);
  assert.deepEqual(h.events, ['authorize', 'return']);
  assert.equal(h.payloads.length, 0);
});

test('MWA rejects a signed response using the pre-refresh blockhash', async () => {
  const h = harness({ obsoleteResponse: true });
  await assert.rejects(h.signReward(h.reviewed, async () => h.fresh), /assinatura não corresponde/);
});
