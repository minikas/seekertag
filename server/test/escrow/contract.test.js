import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Keypair, PublicKey, Transaction, SystemProgram } from '@solana/web3.js';
import { getTransactionDecoder } from '@solana/kit';
import { LiteSVM, FailedTransactionMetadata } from 'litesvm';
import { PROGRAM, TOKEN_PROGRAM, escrowAddress, vaultAddress, tokenAddress, rewardInstructions, decodeEscrow, verifyRewardTransaction } from '../../../shared/escrow-wire.ts';
import { MAINNET_MINTS, amountToUnits, unitsToAmount } from '../../../shared/reward.ts';

const binary = fileURLToPath(new URL('../../../artifacts/escrow/seekertag_escrow.so', import.meta.url));
function fixture(mintAddress = null) {
  const svm = new LiteSVM();
  svm.addProgramFromFile(PROGRAM.toBase58(), binary);
  const clock = svm.getClock(); clock.unixTimestamp = 1_800_000_000n; svm.setClock(clock);
  const owner = Keypair.generate(); const verifier = Keypair.generate(); const finder = Keypair.generate(); const attacker = Keypair.generate();
  for (const account of [owner, verifier, finder, attacker]) svm.airdrop(account.publicKey.toBase58(), 10_000_000_000n);
  const spec = { kind: 'fund', payer: owner.publicKey.toBase58(), verifier: verifier.publicKey.toBase58(), rewardId: randomBytes(32).toString('hex'), amountUnits: '20000000', days: 30, mint: mintAddress };
  const escrow = escrowAddress(spec.payer, spec.rewardId); const vault = vaultAddress(escrow);
  const state = () => decodeEscrow(svm.getAccount(escrow.toBase58()).data);
  function send(changes = {}, signers = [owner], edit = tx => tx) {
    svm.expireBlockhash();
    const transaction = edit(new Transaction({ feePayer: owner.publicKey, recentBlockhash: svm.latestBlockhash() }).add(...rewardInstructions({ ...spec, ...changes })));
    transaction.partialSign(...signers);
    return svm.sendTransaction(getTransactionDecoder().decode(transaction.serialize({ requireAllSignatures: false, verifySignatures: false })));
  }
  function expectOK(result) { assert.ok(!(result instanceof FailedTransactionMetadata), result instanceof FailedTransactionMetadata ? result.meta().logs().join('\n') : ''); }
  function expectFail(result) { assert.ok(result instanceof FailedTransactionMetadata, 'Expected the actual SBF program to reject the transaction'); }
  function setClock(timestamp) { const next = svm.getClock(); next.unixTimestamp = BigInt(timestamp); svm.setClock(next); }
  function writeAccount(address, data) {
    svm.setAccount({ address: address.toBase58(), executable: false, programAddress: TOKEN_PROGRAM.toBase58(), lamports: svm.minimumBalanceForRentExemption(BigInt(data.length)), data });
  }
  function tokenBalance(address) { const a = svm.getAccount(address.toBase58()); return a.exists ? Buffer.from(a.data).readBigUInt64LE(64) : 0n; }
  if (mintAddress) {
    const mint = new PublicKey(mintAddress); const data = Buffer.alloc(82);
    data.writeUInt32LE(1, 0); owner.publicKey.toBuffer().copy(data, 4); data.writeBigUInt64LE(100_000_000n, 36); data[44] = 6; data[45] = 1;
    writeAccount(mint, data);
    const source = Buffer.alloc(165); mint.toBuffer().copy(source); owner.publicKey.toBuffer().copy(source, 32); source.writeBigUInt64LE(100_000_000n, 64); source[108] = 1;
    writeAccount(tokenAddress(owner.publicKey, mint), source);
  }
  return { svm, owner, verifier, finder, attacker, spec, escrow, vault, state, send, expectOK, expectFail, setClock, tokenBalance, writeAccount };
}

test('SOL is locked on chain, can be renewed, and only refunded to its depositor after expiry', () => {
  const f = fixture(); f.expectOK(f.send());
  assert.equal(f.state().amountUnits, f.spec.amountUnits);
  assert.equal(f.state().status, 1);
  const originalEnd = f.state().refundAfter;
  f.expectFail(f.send({ kind: 'refund' }));
  f.expectOK(f.send({ kind: 'renew', days: 7 }));
  assert.equal(f.state().refundAfter, originalEnd + 7 * 86_400);
  f.setClock(originalEnd); f.expectFail(f.send({ kind: 'refund' }));
  f.setClock(f.state().refundAfter);
  const before = f.svm.getBalance(f.spec.payer);
  f.expectOK(f.send({ kind: 'refund' }));
  assert.equal(f.svm.getBalance(f.spec.payer) - before, BigInt(f.spec.amountUnits) - 5_000n);
  assert.equal(f.state().status, 3);
  f.expectFail(f.send({ kind: 'refund' }));
  f.expectFail(f.send({ kind: 'renew', days: 1 }));
  f.expectFail(f.send()); // Permanent receipt prohibits reuse of the deposit ID.
});

test('SOL release needs both owner and verifier; receipt binds the finder and report', () => {
  const f = fixture(); f.expectOK(f.send());
  const release = { kind: 'release', recipient: f.finder.publicKey.toBase58(), reportHash: randomBytes(32).toString('hex') };
  f.expectFail(f.send(release, [f.owner], tx => { tx.instructions[0].keys[1].isSigner = false; return tx; }));
  f.expectFail(f.send(release, [f.verifier, f.attacker], tx => { tx.feePayer = f.attacker.publicKey; tx.instructions[0].keys[0].isSigner = false; return tx; }));
  f.expectFail(f.send({ ...release, verifier: f.attacker.publicKey.toBase58() }, [f.owner, f.attacker]));
  const before = f.svm.getBalance(release.recipient);
  f.expectOK(f.send(release, [f.owner, f.verifier]));
  assert.equal(f.svm.getBalance(release.recipient) - before, BigInt(f.spec.amountUnits));
  assert.equal(f.state().recipient, release.recipient);
  assert.equal(f.state().reportHash, release.reportHash);
  assert.equal(f.state().status, 2);
  f.expectFail(f.send(release, [f.owner, f.verifier]));
  f.setClock(f.state().refundAfter); f.expectFail(f.send({ kind: 'refund' }));
});

for (const [symbol, mintAddress] of Object.entries(MAINNET_MINTS)) {
  test(`${symbol} deposits and pays SPL tokens, preserving the amount and closing the vault`, () => {
    const f = fixture(mintAddress); const mint = new PublicKey(mintAddress);
    f.expectOK(f.send());
    assert.equal(f.tokenBalance(f.vault), 20_000_000n);
    assert.equal(f.state().mint, mintAddress);
    // Another wallet cannot replace the original depositor in the accounts list.
    f.expectFail(f.send({ kind: 'refund', payer: f.attacker.publicKey.toBase58() }, [f.owner, f.attacker]));
    f.expectOK(f.send({ kind: 'release', recipient: f.finder.publicKey.toBase58(), reportHash: randomBytes(32).toString('hex') }, [f.owner, f.verifier]));
    assert.equal(f.tokenBalance(tokenAddress(f.finder.publicKey, mint)), 20_000_000n);
    assert.equal(f.svm.getAccount(f.vault.toBase58()).exists, false);
    assert.equal(f.state().status, 2);
  });
  test(`${symbol} refund respects renewed expiry and returns tokens to the original wallet`, () => {
    const f = fixture(mintAddress); const mint = new PublicKey(mintAddress);
    f.expectOK(f.send()); f.expectFail(f.send({ kind: 'refund' }));
    f.expectOK(f.send({ kind: 'renew', days: 1 }));
    f.setClock(f.state().refundAfter); f.expectOK(f.send({ kind: 'refund' }));
    assert.equal(f.tokenBalance(tokenAddress(f.owner.publicKey, mint)), 100_000_000n);
    assert.equal(f.state().status, 3);
    assert.equal(f.svm.getAccount(f.vault.toBase58()).exists, false);
  });
}

test('SPL vault donations do not prevent release or change the promised payout', () => {
  const f = fixture(MAINNET_MINTS.USDC); f.expectOK(f.send());
  const account = f.svm.getAccount(f.vault.toBase58()); const data = Buffer.from(account.data); data.writeBigUInt64LE(21_000_000n, 64); f.writeAccount(f.vault, data);
  f.expectOK(f.send({ kind: 'release', recipient: f.finder.publicKey.toBase58(), reportHash: randomBytes(32).toString('hex') }, [f.owner, f.verifier]));
  const mint = new PublicKey(MAINNET_MINTS.USDC);
  assert.equal(f.tokenBalance(tokenAddress(f.finder.publicKey, mint)), 20_000_000n);
  assert.equal(f.tokenBalance(tokenAddress(f.owner.publicKey, mint)), 81_000_000n);
});

test('the SBF program rejects invalid duration, zero deposit, shortening and wrong destinations', () => {
  const f = fixture();
  f.expectFail(f.send({}, [f.owner], tx => { tx.instructions[0].data.writeUInt16LE(0, 48); return tx; }));
  f.expectFail(f.send({}, [f.owner], tx => { tx.instructions[0].data.writeUInt16LE(366, 48); return tx; }));
  f.expectFail(f.send({}, [f.owner], tx => { tx.instructions[0].data.writeBigUInt64LE(0n, 40); return tx; }));
  f.expectOK(f.send());
  f.expectFail(f.send({ kind: 'renew', days: 365 }));
  f.expectFail(f.send({ kind: 'renew', days: 1 }, [f.owner], tx => { tx.instructions[0].data.writeUInt16LE(0, 8); return tx; }));
  f.expectFail(f.send({ kind: 'release', recipient: f.finder.publicKey.toBase58(), reportHash: randomBytes(32).toString('hex') }, [f.owner, f.verifier], tx => { tx.instructions[0].keys[3].pubkey = f.owner.publicKey; return tx; }));
  assert.equal(f.state().status, 1);
});

test('wallet validation rejects added transfers, changed recipients, amounts and payer', () => {
  const f = fixture();
  const make = () => new Transaction({ feePayer: f.owner.publicKey, recentBlockhash: f.svm.latestBlockhash() }).add(...rewardInstructions(f.spec));
  const encode = tx => tx.serialize({ requireAllSignatures: false }).toString('base64');
  assert.doesNotThrow(() => verifyRewardTransaction(encode(make()), f.spec));
  const injected = make().add(SystemProgram.transfer({ fromPubkey: f.owner.publicKey, toPubkey: f.attacker.publicKey, lamports: 1_000_000 }));
  assert.throws(() => verifyRewardTransaction(encode(injected), f.spec));
  const changed = make(); changed.instructions[0].data.writeBigUInt64LE(99_000_000n, 40);
  assert.throws(() => verifyRewardTransaction(encode(changed), f.spec));
  const payer = make(); payer.feePayer = f.attacker.publicKey;
  assert.throws(() => verifyRewardTransaction(encode(payer), f.spec));
});

test('reward amounts use exact integers with per-token precision', () => {
  assert.equal(amountToUnits('0.000000001', 9), 1n);
  assert.equal(amountToUnits('0.000001', 6), 1n);
  assert.equal(amountToUnits('999999.999999999', 9), 999999999999999n);
  assert.equal(unitsToAmount('999999999999999', 9), '999999.999999999');
  for (const value of ['0', '-1', '1e3', '0.0000001', '1000000.000001', 'NaN', 'Infinity', '1,5']) assert.throws(() => amountToUnits(value, 6), value);
});

test('wallet inspection preserves the signed message across different JS locale sorting implementations', () => {
  const f = fixture(MAINNET_MINTS.SKR);
  const tx = new Transaction({ feePayer: f.owner.publicKey, recentBlockhash: f.svm.latestBlockhash() }).add(...rewardInstructions(f.spec));
  tx.sign(f.owner); const encoded = tx.serialize().toString('base64'); const originalMessage = tx.serializeMessage();
  const sort = String.prototype.localeCompare;
  try {
    String.prototype.localeCompare = function (other) { return -sort.call(this, other); };
    const checked = verifyRewardTransaction(encoded, f.spec);
    assert.ok(checked.verifySignatures());
    assert.ok(checked.serializeMessage().equals(originalMessage));
    const changed = Transaction.from(Buffer.from(encoded, 'base64'));
    changed.instructions[0].keys[2].isWritable = true;
    assert.throws(() => verifyRewardTransaction(changed.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64'), f.spec));
  } finally { String.prototype.localeCompare = sort; }
});
