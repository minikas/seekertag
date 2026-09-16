import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction } from '@solana/web3.js';
import { createAccount, createMint, getOrCreateAssociatedTokenAccount, mintTo, getAccount, transfer } from '@solana/spl-token';
import { createRewardInstruction, decodeReward, deriveRewardAddresses, releaseRewardInstruction, refundRewardInstruction, renewRewardInstruction, commitRewardInstruction, waiveRewardInstruction } from '../../shared/reward-protocol.mjs';
import { startRewardValidator, pause } from '../../scripts/reward-localnet.mjs';
import { rejectsInProgram } from '../../scripts/reward-test-assertions.mjs';

test('compiled escrow moves real SPL tokens on an isolated local Solana validator', { timeout: 180_000 }, async t => {
  const validator = await startRewardValidator();
  t.after(validator.stop);
  const { connection, programId } = validator;
  const owner = Keypair.generate(); const finder = Keypair.generate(); const intruder = Keypair.generate();
  const latest = await connection.getLatestBlockhash();
  const airdrop = await connection.requestAirdrop(owner.publicKey, 50 * LAMPORTS_PER_SOL);
  await connection.confirmTransaction({ signature: airdrop, ...latest }, 'confirmed');
  const mint = await createMint(connection, owner, owner.publicKey, null, 6);
  const source = await getOrCreateAssociatedTokenAccount(connection, owner, mint, owner.publicKey);
  const destination = await getOrCreateAssociatedTokenAccount(connection, owner, mint, finder.publicKey);
  await mintTo(connection, owner, mint, source.address, owner, 10_000_000_000n);

  const now = async () => BigInt(await connection.getBlockTime(await connection.getSlot()) ?? Math.floor(Date.now() / 1000));
  // Unique test memo ensures repeated instructions execute anew, rather than
  // being treated as an idempotent resubmission of the same signed transaction.
  const send = (instructions, extraSigners = []) => sendAndConfirmTransaction(connection, new Transaction().add(new TransactionInstruction({ programId: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'), keys: [], data: Buffer.from(randomBytes(8).toString('hex')) }), ...(Array.isArray(instructions) ? instructions : [instructions])), [owner, ...extraSigners], { commitment: 'confirmed' });
  const rejected = (instruction, signers) => rejectsInProgram(() => send(instruction, signers), programId, connection);
  const state = async id => decodeReward((await connection.getAccountInfo(deriveRewardAddresses(programId, owner.publicKey, id).reward)).data);
  async function create({ amount = 100_000_000n, seconds = 3600n, id = randomBytes(32), prefund = false } = {}) {
    const expiresAt = (await now()) + seconds;
    const addresses = deriveRewardAddresses(programId, owner.publicKey, id);
    if (prefund) {
      const lamports = await connection.getMinimumBalanceForRentExemption(0);
      await send([
        SystemProgram.transfer({ fromPubkey: owner.publicKey, toPubkey: addresses.reward, lamports }),
        SystemProgram.transfer({ fromPubkey: owner.publicKey, toPubkey: addresses.vault, lamports }),
      ]);
    }
    const args = { programId, owner: owner.publicKey, mint, rewardId: id, amount, expiresAt };
    await send(createRewardInstruction(args));
    return { ...args, ...addresses };
  }
  async function expire(expiry) {
    for (let i = 0; i < 80 && (await now()) < expiry; i++) await pause(250);
    assert.ok((await now()) >= expiry, 'validator clock must cross the expiry');
  }
  async function commit(reward, recipient = finder.publicKey, expectedSeq = 0n, reportRef = randomBytes(32)) {
    await send(commitRewardInstruction({ ...reward, recipient, expectedSeq, reportRef }));
    return { recipient, claimSeq: expectedSeq + 1n, reportRef };
  }

  await t.test('deposit, renewal and exact single payout preserve the receipt address', async () => {
    const before = (await getAccount(connection, source.address)).amount;
    const reward = await create();
    assert.equal((await getAccount(connection, source.address)).amount, before - reward.amount);
    assert.equal((await getAccount(connection, reward.vault)).amount, reward.amount);
    assert.equal((await state(reward.rewardId)).status, 'funded');
    await rejected(refundRewardInstruction(reward));
    await rejected(renewRewardInstruction({ ...reward, expiresAt: reward.expiresAt }));
    const expiry = reward.expiresAt + 30n * 86400n;
    await send(renewRewardInstruction({ ...reward, expiresAt: expiry }));
    assert.equal((await state(reward.rewardId)).expiresAt, expiry);
    const reportRef = randomBytes(32);
    const release = releaseRewardInstruction({ ...reward, recipient: finder.publicKey, claimSeq: 1n });
    await rejected(release);
    await commit(reward, finder.publicKey, 0n, reportRef);
    const committed = await state(reward.rewardId);
    assert.equal(committed.status, 'committed');
    assert.equal(committed.claimSeq, 1n);
    assert.equal(committed.recipient.toBase58(), finder.publicKey.toBase58());
    assert.equal((await getAccount(connection, reward.vault)).amount, reward.amount);
    await send(release);
    const paid = await state(reward.rewardId);
    assert.equal(paid.status, 'paid'); assert.equal(paid.recipient.toBase58(), finder.publicKey.toBase58());
    assert.deepEqual(paid.reportRef, reportRef);
    assert.equal((await getAccount(connection, destination.address)).amount, reward.amount);
    assert.equal((await getAccount(connection, reward.vault)).amount, 0n);
    await rejected(release);
    await rejected(refundRewardInstruction(reward));
    await rejected(renewRewardInstruction({ ...reward, expiresAt: expiry + 86400n }));
    await rejected(createRewardInstruction(reward));
    await rejected(commitRewardInstruction({ ...reward, recipient: finder.publicKey, reportRef, expectedSeq: 1n }));
    await rejected(waiveRewardInstruction({ ...reward, recipient: finder.publicKey, claimSeq: 1n }), [finder]);
  });

  await t.test('foreign signer, fake token program, substituted vault and recipient are rejected', async () => {
    const reward = await create();
    const fakeOwner = renewRewardInstruction({ ...reward, expiresAt: reward.expiresAt + 1n });
    fakeOwner.keys[0].pubkey = intruder.publicKey;
    await rejected(fakeOwner, [intruder]);
    await commit(reward);
    const release = () => releaseRewardInstruction({ ...reward, recipient: finder.publicKey, claimSeq: 1n });
    const fakeProgram = release(); fakeProgram.keys[5].pubkey = SystemProgram.programId;
    await rejected(fakeProgram);
    const fakeVault = release(); fakeVault.keys[2].pubkey = source.address;
    await rejected(fakeVault);
    const fakeDestination = release(); fakeDestination.keys[4].pubkey = source.address;
    await rejected(fakeDestination);
    assert.equal((await getAccount(connection, reward.vault)).amount, reward.amount);
    assert.equal((await state(reward.rewardId)).status, 'committed');
  });

  await t.test('SOL address squatting and unsolicited token donations do not block settlement', async () => {
    const reward = await create({ prefund: true });
    await transfer(connection, owner, source.address, reward.vault, owner, 17n);
    const before = (await getAccount(connection, destination.address)).amount;
    await commit(reward);
    await send(releaseRewardInstruction({ ...reward, recipient: finder.publicKey, claimSeq: 1n }));
    assert.equal((await getAccount(connection, destination.address)).amount, before + reward.amount);
    assert.equal((await getAccount(connection, reward.vault)).amount, 17n);
  });

  await t.test('missing owner signature, malformed instructions and excessive expiry are rejected', async () => {
    const reward = await create();
    await send(SystemProgram.transfer({ fromPubkey: owner.publicKey, toPubkey: intruder.publicKey, lamports: LAMPORTS_PER_SOL }));
    const missingSignature = renewRewardInstruction({ ...reward, expiresAt: reward.expiresAt + 100n });
    missingSignature.keys[0].isSigner = false;
    await rejectsInProgram(() => sendAndConfirmTransaction(connection, new Transaction().add(missingSignature), [intruder], { commitment: 'confirmed' }), programId, connection);
    const tooFar = createRewardInstruction({ ...reward, rewardId: randomBytes(32), expiresAt: (await now()) + 366n * 86400n });
    await rejected(tooFar);
    const zero = createRewardInstruction({ ...reward, rewardId: randomBytes(32) }); zero.data.writeBigUInt64LE(0n, 33);
    await rejected(zero);
    const malformed = renewRewardInstruction({ ...reward, expiresAt: reward.expiresAt + 100n }); malformed.data = malformed.data.subarray(0, 8);
    await rejected(malformed);
    const extraAccount = renewRewardInstruction({ ...reward, expiresAt: reward.expiresAt + 100n });
    extraAccount.keys.push({ pubkey: intruder.publicKey, isSigner: false, isWritable: false });
    await rejected(extraAccount);
    assert.equal((await state(reward.rewardId)).expiresAt, reward.expiresAt);
  });

  await t.test('freeze-capable mint and a noncanonical recipient token account cannot be substituted', async () => {
    const frozenMint = await createMint(connection, owner, owner.publicKey, owner.publicKey, 6);
    const frozenSource = await getOrCreateAssociatedTokenAccount(connection, owner, frozenMint, owner.publicKey);
    await mintTo(connection, owner, frozenMint, frozenSource.address, owner, 1_000_000n);
    await rejected(createRewardInstruction({ programId, owner: owner.publicKey, mint: frozenMint, rewardId: randomBytes(32), amount: 1n, expiresAt: (await now()) + 3600n }));
    const reward = await create();
    await commit(reward);
    const otherAccount = await createAccount(connection, owner, mint, finder.publicKey, Keypair.generate());
    const instruction = releaseRewardInstruction({ ...reward, recipient: finder.publicKey, claimSeq: 1n });
    instruction.keys[4].pubkey = otherAccount;
    await rejected(instruction);
    const wrongMint = releaseRewardInstruction({ ...reward, recipient: finder.publicKey, claimSeq: 1n });
    wrongMint.keys[3].pubkey = frozenMint;
    await rejected(wrongMint);
    assert.equal((await getAccount(connection, reward.vault)).amount, reward.amount);
  });

  await t.test('two concurrent releases cannot pay two recipients', async () => {
    const reward = await create();
    await commit(reward);
    await getOrCreateAssociatedTokenAccount(connection, owner, mint, intruder.publicKey);
    const before = (await getAccount(connection, destination.address)).amount;
    const outcomes = await Promise.allSettled([
      send(releaseRewardInstruction({ ...reward, recipient: finder.publicKey, claimSeq: 1n })),
      send(releaseRewardInstruction({ ...reward, recipient: intruder.publicKey, claimSeq: 1n })),
    ]);
    assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
    for (const result of outcomes) if (result.status === 'rejected') await rejectsInProgram(() => Promise.reject(result.reason), programId, connection);
    assert.equal((await state(reward.rewardId)).status, 'paid');
    assert.equal((await getAccount(connection, reward.vault)).amount, 0n);
    assert.equal((await getAccount(connection, destination.address)).amount, before + reward.amount);
  });

  await t.test('documented limit: owner may commit to an owner-controlled recipient before any real finder is bound', async () => {
    const reward = await create();
    const before = (await getAccount(connection, source.address)).amount;
    await commit(reward, owner.publicKey);
    await send(releaseRewardInstruction({ ...reward, recipient: owner.publicKey, claimSeq: 1n }));
    assert.equal((await getAccount(connection, source.address)).amount, before + reward.amount);
    assert.equal((await state(reward.rewardId)).status, 'paid');
    // This is an explicit economic limitation, not a guarantee against a dishonest owner.
  });

  await t.test('expired uncommitted reward rejects a new commitment or payment and refunds exactly once', async () => {
    const reward = await create({ seconds: 3n });
    await expire(reward.expiresAt);
    await rejected(releaseRewardInstruction({ ...reward, recipient: finder.publicKey, claimSeq: 1n }));
    await rejected(commitRewardInstruction({ ...reward, recipient: finder.publicKey, reportRef: randomBytes(32), expectedSeq: 0n }));
    const before = (await getAccount(connection, source.address)).amount;
    await send(refundRewardInstruction(reward));
    assert.equal((await getAccount(connection, source.address)).amount, before + reward.amount);
    assert.equal((await state(reward.rewardId)).status, 'refunded');
    await rejected(refundRewardInstruction(reward));
    await rejected(renewRewardInstruction({ ...reward, expiresAt: (await now()) + 3600n }));
  });

  await t.test('commitment blocks owner refund, renewal and rebinding even after expiry; fixed payout still succeeds', async () => {
    const reward = await create({ seconds: 6n });
    await commit(reward);
    const before = (await getAccount(connection, destination.address)).amount;
    const blocked = async () => {
      await rejected(refundRewardInstruction(reward));
      await rejected(renewRewardInstruction({ ...reward, expiresAt: (await now()) + 86400n }));
      await rejected(commitRewardInstruction({ ...reward, recipient: owner.publicKey, reportRef: randomBytes(32), expectedSeq: 1n }));
      await rejected(releaseRewardInstruction({ ...reward, recipient: owner.publicKey, claimSeq: 1n }));
      assert.equal((await state(reward.rewardId)).status, 'committed');
      assert.equal((await getAccount(connection, reward.vault)).amount, reward.amount);
    };
    await blocked();
    await expire(reward.expiresAt);
    await blocked();
    await send(releaseRewardInstruction({ ...reward, recipient: finder.publicKey, claimSeq: 1n }));
    const paid = await state(reward.rewardId);
    assert.ok(paid.settledAt >= reward.expiresAt);
    assert.equal(paid.recipient.toBase58(), finder.publicKey.toBase58());
    assert.equal((await getAccount(connection, destination.address)).amount, before + reward.amount);
  });

  await t.test('only the signed finder can waive; recommit increments sequence and rejects stale owner and finder instructions', async () => {
    const reward = await create();
    const reportRef = randomBytes(32);
    await commit(reward, finder.publicKey, 0n, reportRef);
    const oldRelease = releaseRewardInstruction({ ...reward, recipient: finder.publicKey, claimSeq: 1n });
    const oldWaive = waiveRewardInstruction({ ...reward, recipient: finder.publicKey, claimSeq: 1n });
    const missingSignature = waiveRewardInstruction({ ...reward, recipient: finder.publicKey, claimSeq: 1n });
    missingSignature.keys[0].isSigner = false;
    await rejected(missingSignature);
    await rejected(waiveRewardInstruction({ ...reward, recipient: owner.publicKey, claimSeq: 1n }));
    await rejected(waiveRewardInstruction({ ...reward, recipient: intruder.publicKey, claimSeq: 1n }), [intruder]);
    await send(oldWaive, [finder]);
    const open = await state(reward.rewardId);
    assert.equal(open.status, 'funded'); assert.equal(open.claimSeq, 1n);
    assert.equal(open.recipient, null); assert.deepEqual(open.reportRef, Buffer.alloc(32));
    assert.equal(open.committedAt, 0n); assert.equal(open.expiresAt, reward.expiresAt);
    assert.equal((await getAccount(connection, reward.vault)).amount, reward.amount);
    await rejected(oldWaive, [finder]);
    await rejected(oldRelease);
    await rejected(commitRewardInstruction({ ...reward, recipient: finder.publicKey, reportRef, expectedSeq: 0n }));
    await commit(reward, finder.publicKey, 1n, reportRef);
    assert.equal((await state(reward.rewardId)).claimSeq, 2n);
    await rejected(oldRelease);
    await rejected(oldWaive, [finder]);
    assert.equal((await state(reward.rewardId)).status, 'committed');
    await send(releaseRewardInstruction({ ...reward, recipient: finder.publicKey, claimSeq: 2n }));
    assert.equal((await state(reward.rewardId)).status, 'paid');
  });

  await t.test('finder waiver after expiry only reopens the offer; separate owner refund preserves sequence', async () => {
    const reward = await create({ seconds: 5n });
    await commit(reward);
    await expire(reward.expiresAt);
    const before = (await getAccount(connection, source.address)).amount;
    await send(waiveRewardInstruction({ ...reward, recipient: finder.publicKey, claimSeq: 1n }), [finder]);
    assert.equal((await getAccount(connection, source.address)).amount, before);
    assert.equal((await getAccount(connection, reward.vault)).amount, reward.amount);
    const open = await state(reward.rewardId);
    assert.equal(open.status, 'funded'); assert.equal(open.claimSeq, 1n); assert.equal(open.expiresAt, reward.expiresAt);
    await send(refundRewardInstruction(reward));
    assert.equal((await getAccount(connection, source.address)).amount, before + reward.amount);
    assert.equal((await state(reward.rewardId)).claimSeq, 1n);
  });

  await t.test('expired reward still in the vault renews without another deposit', async () => {
    const reward = await create({ seconds: 3n });
    await expire(reward.expiresAt);
    const before = (await getAccount(connection, source.address)).amount;
    const expiry = (await now()) + 86400n;
    await send(renewRewardInstruction({ ...reward, expiresAt: expiry }));
    assert.equal((await state(reward.rewardId)).expiresAt, expiry);
    assert.equal((await getAccount(connection, source.address)).amount, before);
    assert.equal((await getAccount(connection, reward.vault)).amount, reward.amount);
    await rejected(refundRewardInstruction(reward));
  });

  await t.test('concurrent renewal and refund cannot both settle an expired reward', async () => {
    const reward = await create({ seconds: 3n });
    await expire(reward.expiresAt);
    const outcomes = await Promise.allSettled([
      send(renewRewardInstruction({ ...reward, expiresAt: (await now()) + 3600n })),
      send(refundRewardInstruction(reward)),
    ]);
    assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
    for (const result of outcomes) if (result.status === 'rejected') await rejectsInProgram(() => Promise.reject(result.reason), programId, connection);
    const receipt = await state(reward.rewardId);
    assert.equal((await getAccount(connection, reward.vault)).amount, receipt.status === 'refunded' ? 0n : reward.amount);
  });
});
