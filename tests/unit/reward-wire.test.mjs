import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ComputeBudgetInstruction, ComputeBudgetProgram, Keypair, Transaction } from '@solana/web3.js';
import { rewardInstructions, verifyRewardTransaction } from '../../shared/escrow-wire.ts';
import { MAINNET_MINTS } from '../../shared/reward.ts';

test('reviewed compute budget survives wallet signing and refuses fee or instruction changes', () => {
  const owner = Keypair.generate(); const verifier = Keypair.generate(); const finder = Keypair.generate();
  for (const mint of [null, MAINNET_MINTS.USDC, MAINNET_MINTS.SKR]) {
    for (const kind of ['fund', 'renew', 'release', 'refund']) {
      const spec = { kind, payer: owner.publicKey.toBase58(), verifier: verifier.publicKey.toBase58(),
        recipient: finder.publicKey.toBase58(), rewardId: '12'.repeat(32), reportHash: '34'.repeat(32),
        mint, amountUnits: '1000000', durationSeconds: 3600, computeBudget: 'fixed-v1' };
      const tx = new Transaction({ feePayer: owner.publicKey, recentBlockhash: Keypair.generate().publicKey.toBase58() }).add(...rewardInstructions(spec));
      const budget = tx.instructions.filter(ix => ix.programId.equals(ComputeBudgetProgram.programId));
      assert.equal(budget.length, 2);
      assert.equal(ComputeBudgetInstruction.decodeSetComputeUnitLimit(budget[0]).units, 200_000);
      assert.equal(ComputeBudgetInstruction.decodeSetComputeUnitPrice(budget[1]).microLamports, 1_000n);
      if (kind === 'release') tx.partialSign(verifier);
      const reviewed = tx.serializeMessage();
      tx.partialSign(owner);
      const checked = verifyRewardTransaction(tx.serialize().toString('base64'), spec);
      assert.ok(checked.verifySignatures());
      assert.ok(checked.serializeMessage().equals(reviewed));
      const encode = changed => changed.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
      const repriced = Transaction.from(tx.serialize());
      repriced.instructions[1] = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000_000 });
      assert.throws(() => verifyRewardTransaction(encode(repriced), spec));
      const duplicate = Transaction.from(tx.serialize()).add(ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }));
      assert.throws(() => verifyRewardTransaction(encode(duplicate), spec));
      const removed = Transaction.from(tx.serialize()); removed.instructions.shift();
      assert.throws(() => verifyRewardTransaction(encode(removed), spec));
    }
  }
});

test('persisted operations without a budget keep their original instruction format', () => {
  const owner = Keypair.generate();
  const spec = { kind: 'fund', payer: owner.publicKey.toBase58(), verifier: Keypair.generate().publicKey.toBase58(),
    rewardId: '56'.repeat(32), mint: null, amountUnits: '1000000', days: 30 };
  const tx = new Transaction({ feePayer: owner.publicKey, recentBlockhash: Keypair.generate().publicKey.toBase58() }).add(...rewardInstructions(spec));
  assert.equal(tx.instructions.length, 1);
  tx.sign(owner);
  assert.ok(verifyRewardTransaction(tx.serialize().toString('base64'), spec).verifySignatures());
  assert.throws(() => rewardInstructions({ ...spec, computeBudget: 'unknown' }));
});
