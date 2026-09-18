import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ComputeBudgetInstruction, ComputeBudgetProgram, Keypair, Transaction } from '@solana/web3.js';
import { rewardInstructions, verifyRewardTransaction } from '@seekertag/shared/escrow-wire';
import { MAINNET_MINTS, REWARD_PROGRAM, solAccountTopUpTotal } from '@seekertag/shared/reward';
import { validateRewardIntent } from '../../src/reward.model.ts';

test('reviewed compute budget survives wallet signing and refuses fee or instruction changes', () => {
  const owner = Keypair.generate(); const verifier = Keypair.generate(); const treasury = Keypair.generate(); const finder = Keypair.generate();
  for (const mint of [null, MAINNET_MINTS.USDC, MAINNET_MINTS.SKR]) {
    for (const kind of ['fund', 'renew', 'release', 'refund']) {
      const spec = { kind, payer: owner.publicKey.toBase58(), verifier: verifier.publicKey.toBase58(),
        treasury: treasury.publicKey.toBase58(), feeBps: 500,
        recipient: finder.publicKey.toBase58(), rewardId: '12'.repeat(32), reportHash: '34'.repeat(32),
        mint, amountUnits: '1000000', durationSeconds: 3600, computeBudget: 'fixed-v2' };
      const tx = new Transaction({ feePayer: owner.publicKey, recentBlockhash: Keypair.generate().publicKey.toBase58() }).add(...rewardInstructions(spec));
      const budget = tx.instructions.filter(ix => ix.programId.equals(ComputeBudgetProgram.programId));
      assert.equal(budget.length, 2);
      assert.equal(ComputeBudgetInstruction.decodeSetComputeUnitLimit(budget[0]).units, 200_000);
      assert.equal(ComputeBudgetInstruction.decodeSetComputeUnitPrice(budget[1]).microLamports, 100_000n);
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
  const owner = Keypair.generate(); const verifier = Keypair.generate(); const treasury = Keypair.generate();
  const spec = { kind: 'fund', payer: owner.publicKey.toBase58(), verifier: verifier.publicKey.toBase58(), treasury: treasury.publicKey.toBase58(), feeBps: 500,
    rewardId: '56'.repeat(32), mint: null, amountUnits: '1000000', days: 30 };
  const tx = new Transaction({ feePayer: owner.publicKey, recentBlockhash: Keypair.generate().publicKey.toBase58() }).add(...rewardInstructions(spec));
  assert.equal(tx.instructions.length, 1);
  tx.sign(owner);
  assert.ok(verifyRewardTransaction(tx.serialize().toString('base64'), spec).verifySignatures());
  const previous = { ...spec, computeBudget: 'fixed-v1' };
  assert.equal(ComputeBudgetInstruction.decodeSetComputeUnitPrice(rewardInstructions(previous)[1]).microLamports, 1_000n);
  assert.throws(() => rewardInstructions({ ...spec, computeBudget: 'unknown' }));
});

test('replays the Seeker Wallet fee replacement captured after native signing', () => {
  const owner = Keypair.generate(); const verifier = Keypair.generate(); const treasury = Keypair.generate();
  const base = { kind: 'fund', payer: owner.publicKey.toBase58(), verifier: verifier.publicKey.toBase58(), treasury: treasury.publicKey.toBase58(), feeBps: 500,
    rewardId: '78'.repeat(32), mint: MAINNET_MINTS.SKR, amountUnits: '1000000', durationSeconds: 3600 };
  for (const version of ['fixed-v1', 'fixed-v2']) {
    const spec = { ...base, computeBudget: version };
    const prepared = new Transaction({ feePayer: owner.publicKey, recentBlockhash: Keypair.generate().publicKey.toBase58() }).add(...rewardInstructions(spec));
    const signed = Transaction.from(prepared.serialize({ requireAllSignatures: false }));
    // Actual returned instruction: 03 a086010000000000 (100,000 micro-lamports).
    signed.instructions[1].data = Buffer.from('03a086010000000000', 'hex');
    signed.sign(owner);
    if (version === 'fixed-v1') {
      assert.throws(() => verifyRewardTransaction(signed.serialize().toString('base64'), spec));
    } else {
      const checked = verifyRewardTransaction(signed.serialize().toString('base64'), spec);
      assert.ok(checked.serializeMessage().equals(prepared.serializeMessage()));
      assert.ok(checked.verifySignatures());
    }
  }
});

test('SOL complements are bounded integers restricted to the two settlement destinations', () => {
  const [owner, verifier, treasury, finder] = Array.from({ length: 4 }, () => Keypair.generate().publicKey.toBase58());
  const spec = { kind: 'release', payer: owner, verifier, treasury, recipient: finder, feeBps: 500, rewardId: 'ab'.repeat(32), reportHash: 'cd'.repeat(32),
    mint: null, amountUnits: '20000', solAccountTopUps: { recipientLamports: '871880', treasuryLamports: '889880' } };
  assert.equal(solAccountTopUpTotal(spec), 1761760n);
  assert.equal(rewardInstructions(spec).length, 3);
  for (const topUps of [
    null, [], {}, { recipientLamports: '1' },
    { recipientLamports: '871880', treasuryLamports: '889880', address: owner },
    ...['-1', '1.5', '01', '1e3', '1000001', '18446744073709551616', 1].map(value => ({ recipientLamports: value, treasuryLamports: '0' })),
  ]) assert.throws(() => rewardInstructions({ ...spec, solAccountTopUps: topUps }));
  for (const changes of [
    { kind: 'fund', durationSeconds: 3600 }, { kind: 'renew', durationSeconds: 3600 }, { kind: 'refund' },
    { mint: MAINNET_MINTS.USDC }, { amountUnits: '1' }, { recipient: treasury },
  ]) assert.throws(() => rewardInstructions({ ...spec, ...changes }));
  assert.doesNotThrow(() => rewardInstructions({ ...spec, amountUnits: '1', solAccountTopUps: { recipientLamports: '890879', treasuryLamports: '0' } }));
  assert.doesNotThrow(() => rewardInstructions({ ...spec, recipient: treasury, solAccountTopUps: { recipientLamports: '870880', treasuryLamports: '0' } }));
});

test('reviewed SOL account cost must include the complete complement debit', () => {
  const [owner, verifier, treasury, finder] = Array.from({ length: 4 }, () => Keypair.generate().publicKey.toBase58());
  const config = { network: 'devnet', verifier, verifiers: [verifier], treasury, feeBps: 500, program: REWARD_PROGRAM, currencies: ['SOL'], mints: {} };
  const intent = { kind: 'release', currency: 'SOL', amount: '0.00002', recipient: finder, reportHash: 'cd'.repeat(32) };
  const spec = { kind: 'release', payer: owner, verifier, treasury, recipient: finder, feeBps: 500, rewardId: 'ab'.repeat(32), reportHash: intent.reportHash,
    mint: null, amountUnits: '20000', solAccountTopUps: { recipientLamports: '871880', treasuryLamports: '889880' } };
  const operation = { network: 'devnet', currency: 'SOL', spec, feeLamports: '30000', rentLamports: '1761760' };
  assert.doesNotThrow(() => validateRewardIntent(operation, intent, config, owner));
  for (const rentLamports of ['0', '1761759', '1761761', '-1', '01761760', undefined]) {
    assert.throws(() => validateRewardIntent({ ...operation, rentLamports }, intent, config, owner));
  }
});
