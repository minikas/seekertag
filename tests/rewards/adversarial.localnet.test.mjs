import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction } from '@solana/web3.js';
import { approve, closeAccount, createMint, getAccount, getOrCreateAssociatedTokenAccount, mintTo, transfer, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { createRewardInstruction, decodeReward, deriveRewardAddresses, releaseRewardInstruction, renewRewardInstruction, commitRewardInstruction, waiveRewardInstruction, REWARD_ACCOUNT_SIZE } from '../../shared/reward-protocol.mjs';
import { validateRewardTransaction } from '../../src/reward-transaction.ts';
import { startRewardValidator } from '../../scripts/reward-localnet.mjs';
import { rejectsInProgram } from '../../scripts/reward-test-assertions.mjs';

test('red team: frontend rejects an API-controlled test-network program and mint despite a plausible preview', async (t) => {
  const saved = Object.fromEntries(['EXPO_PUBLIC_SKR_CLUSTER', 'EXPO_PUBLIC_SKR_PROGRAM_ID', 'EXPO_PUBLIC_SKR_MINT'].map(key => [key, process.env[key]]));
  t.after(() => { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const owner = Keypair.generate().publicKey; const trustedProgram = Keypair.generate().publicKey; const trustedMint = Keypair.generate().publicKey;
  const program = Keypair.generate().publicKey;
  // Public mainnet USDC mint is used only as bytes in an unsigned offline
  // transaction. This test does not connect to mainnet or request a signature.
  const mint = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
  const id = randomBytes(32); const requestedAt = Date.now(); const expiresAt = BigInt(Math.floor(requestedAt / 1000) + 7 * 86400);
  const config = { enabled: true, cluster: 'devnet', mint: mint.toBase58(), programId: program.toBase58(), assetLabel: 'Test SKR' };
  const reward = { id: 'fake-reward', wallet: owner.toBase58(), cluster: 'devnet', amount: '100', expiresAt: new Date(Number(expiresAt) * 1000).toISOString(), address: deriveRewardAddresses(program, owner, id).reward.toBase58(), status: 'draft', assetLabel: 'Test SKR', explorerUrl: null };
  const transaction = new Transaction({ feePayer: owner, recentBlockhash: Keypair.generate().publicKey.toBase58() }).add(createRewardInstruction({ programId: program, owner, mint, rewardId: id, amount: 100_000_000n, expiresAt }));
  const prepared = { action: 'fund', wallet: owner.toBase58(), reward, lastValidBlockHeight: 1000, transaction: transaction.serialize({ requireAllSignatures: false }).toString('base64'), intent: { id: 'fake-intent', rewardId: id.toString('hex'), mint: config.mint, programId: config.programId, amountBaseUnits: '100000000', expiresAt: expiresAt.toString() } };
  const expected = { action: 'fund', wallet: owner.toBase58(), amount: '100', days: 7, previous: null, requestedAt };
  process.env.EXPO_PUBLIC_SKR_CLUSTER = 'devnet';
  process.env.EXPO_PUBLIC_SKR_PROGRAM_ID = trustedProgram.toBase58();
  process.env.EXPO_PUBLIC_SKR_MINT = trustedMint.toBase58();
  assert.throws(() => validateRewardTransaction(prepared, config, expected), 'a pinned build rejects a server-selected program');
  delete process.env.EXPO_PUBLIC_SKR_PROGRAM_ID;
  delete process.env.EXPO_PUBLIC_SKR_MINT;
  assert.throws(() => validateRewardTransaction(prepared, config, expected), 'missing test-network program/mint pins must fail closed too');
});

test('red team: cross-reward, delegated-authority, bump and integer attacks on compiled escrow', { timeout: 180_000 }, async (t) => {
  const validator = await startRewardValidator(); t.after(validator.stop);
  const { connection, programId } = validator;
  const owner = Keypair.generate(); const otherOwner = Keypair.generate(); const finder = Keypair.generate(); const attacker = Keypair.generate();
  const hash = await connection.getLatestBlockhash(); const airdrop = await connection.requestAirdrop(owner.publicKey, 75 * LAMPORTS_PER_SOL);
  await connection.confirmTransaction({ ...hash, signature: airdrop }, 'confirmed');
  const memo = () => new TransactionInstruction({ programId: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'), keys: [], data: Buffer.from(randomBytes(8).toString('hex')) });
  const send = (instructions, payer = owner, extra = []) => sendAndConfirmTransaction(connection, new Transaction().add(memo(), ...(Array.isArray(instructions) ? instructions : [instructions])), [payer, ...extra], { commitment: 'confirmed' });
  const rejected = (instruction, payer = owner, extra = []) => rejectsInProgram(() => send(instruction, payer, extra), programId, connection);
  await send([otherOwner, attacker].map(pair => SystemProgram.transfer({ fromPubkey: owner.publicKey, toPubkey: pair.publicKey, lamports: 5 * LAMPORTS_PER_SOL })));
  const mint = await createMint(connection, owner, owner.publicKey, null, 6);
  const source = await getOrCreateAssociatedTokenAccount(connection, owner, mint, owner.publicKey);
  const otherSource = await getOrCreateAssociatedTokenAccount(connection, owner, mint, otherOwner.publicKey);
  const destination = await getOrCreateAssociatedTokenAccount(connection, owner, mint, finder.publicKey);
  const attackerAta = await getOrCreateAssociatedTokenAccount(connection, owner, mint, attacker.publicKey);
  await mintTo(connection, owner, mint, source.address, owner, 1_000_000_000n);
  await mintTo(connection, owner, mint, otherSource.address, owner, 1_000_000_000n);
  const now = async () => BigInt(await connection.getBlockTime(await connection.getSlot()) ?? Math.floor(Date.now() / 1000));
  async function create({ payer = owner, rewardMint = mint, amount = 10_000_000n } = {}) {
    const rewardId = randomBytes(32); const expiresAt = (await now()) + 3600n;
    const args = { programId, owner: payer.publicKey, mint: rewardMint, rewardId, amount, expiresAt };
    await send(createRewardInstruction(args), payer);
    return { ...args, ...deriveRewardAddresses(programId, payer.publicKey, rewardId) };
  }
  const receipt = async reward => decodeReward((await connection.getAccountInfo(reward.reward)).data);
  const payout = reward => releaseRewardInstruction({ ...reward, recipient: finder.publicKey, claimSeq: 1n });
  const commit = (reward, payer = owner) => send(commitRewardInstruction({ ...reward, recipient: finder.publicKey, reportRef: randomBytes(32), expectedSeq: 0n }), payer);

  await t.test('two valid committed vaults cannot be mixed across rewards or owners', async () => {
    const a = await create(); const b = await create(); const foreign = await create({ payer: otherOwner });
    await commit(a); await commit(b); await commit(foreign, otherOwner);
    for (const substituted of [b, foreign]) {
      const wrongVault = payout(a); wrongVault.keys[2].pubkey = substituted.vault; await rejected(wrongVault);
      const wrongReceipt = payout(a); wrongReceipt.keys[1].pubkey = substituted.reward; await rejected(wrongReceipt);
    }
    const allForeign = payout(a); allForeign.keys[1].pubkey = foreign.reward; allForeign.keys[2].pubkey = foreign.vault; await rejected(allForeign);
    for (const reward of [a, b, foreign]) { assert.equal((await receipt(reward)).status, 'committed'); assert.equal((await getAccount(connection, reward.vault)).amount, reward.amount); }
    assert.equal((await getAccount(connection, destination.address)).amount, 0n);
  });

  await t.test('alternate valid PDA bump, aliased accounts and uninitialized program-owned receipt are rejected', async () => {
    const id = randomBytes(32); const canonical = deriveRewardAddresses(programId, owner.publicKey, id);
    let alternate;
    for (let bump = canonical.rewardBump - 1; bump >= 0; bump--) {
      try { alternate = PublicKey.createProgramAddressSync([Buffer.from('reward'), owner.publicKey.toBuffer(), id, Buffer.from([bump])], programId); break; } catch { /* On-curve candidate. */ }
    }
    assert.ok(alternate);
    const alternateVault = PublicKey.findProgramAddressSync([Buffer.from('vault'), alternate.toBuffer()], programId)[0];
    const args = { programId, owner: owner.publicKey, mint, rewardId: id, amount: 1n, expiresAt: (await now()) + 3600n };
    const alternateBump = createRewardInstruction(args); alternateBump.keys[1].pubkey = alternate; alternateBump.keys[2].pubkey = alternateVault; await rejected(alternateBump);
    const aliased = createRewardInstruction(args); aliased.keys[2].pubkey = canonical.reward; await rejected(aliased);
    assert.equal(await connection.getAccountInfo(canonical.reward), null);
    const fake = Keypair.generate(); const rent = await connection.getMinimumBalanceForRentExemption(REWARD_ACCOUNT_SIZE);
    await send(SystemProgram.createAccount({ fromPubkey: owner.publicKey, newAccountPubkey: fake.publicKey, lamports: rent, space: REWARD_ACCOUNT_SIZE, programId }), owner, [fake]);
    const fakeReceipt = renewRewardInstruction(args); fakeReceipt.keys[1].pubkey = fake.publicKey; await rejected(fakeReceipt);
    assert.ok((await connection.getAccountInfo(fake.publicKey)).data.every(byte => byte === 0));
  });

  await t.test('a delegated source wallet grants no authority over an escrow vault or reward identity', async () => {
    await approve(connection, owner, source.address, attacker.publicKey, owner, 30_000_000n);
    const reward = await create();
    const delegatedSource = createRewardInstruction({ ...reward, owner: attacker.publicKey, rewardId: randomBytes(32), amount: 1n });
    delegatedSource.keys[4].pubkey = source.address;
    await rejected(delegatedSource, attacker);
    await rejectsInProgram(() => transfer(connection, attacker, reward.vault, attackerAta.address, attacker, 1n), TOKEN_PROGRAM_ID, connection);
    await rejectsInProgram(() => closeAccount(connection, attacker, reward.vault, attacker.publicKey, attacker), TOKEN_PROGRAM_ID, connection);
    assert.equal((await getAccount(connection, reward.vault)).amount, reward.amount);
    await commit(reward);
    await send(payout(reward));
    assert.equal((await getAccount(connection, destination.address)).amount, reward.amount);
  });

  await t.test('u64 maximum principal pays exactly without wrapping and terminal account cannot be reused', async () => {
    const hugeMint = await createMint(connection, owner, owner.publicKey, null, 6);
    const hugeSource = await getOrCreateAssociatedTokenAccount(connection, owner, hugeMint, owner.publicKey);
    const hugeDestination = await getOrCreateAssociatedTokenAccount(connection, owner, hugeMint, finder.publicKey);
    const maximum = (1n << 64n) - 1n;
    await mintTo(connection, owner, hugeMint, hugeSource.address, owner, maximum);
    const reward = await create({ rewardMint: hugeMint, amount: maximum });
    assert.equal((await receipt(reward)).amount, maximum); assert.equal((await getAccount(connection, reward.vault)).amount, maximum);
    assert.equal((await getAccount(connection, hugeSource.address)).amount, 0n);
    await commit(reward);
    await send(payout(reward));
    assert.equal((await getAccount(connection, hugeDestination.address)).amount, maximum);
    assert.equal((await getAccount(connection, reward.vault)).amount, 0n);
    await rejected(createRewardInstruction(reward));
    assert.equal((await receipt(reward)).status, 'paid');
  });

  await t.test('malformed widths, oversized data, signed expiry overflow and repeated settlement roll back atomically', async () => {
    const reward = await create();
    for (const width of [0, 1, 48, 50, 512]) {
      const malformed = createRewardInstruction({ ...reward, rewardId: randomBytes(32) }); malformed.data = Buffer.alloc(width); await rejected(malformed);
    }
    for (const expiry of [-1n, -(1n << 63n), (1n << 63n) - 1n]) {
      const invalid = renewRewardInstruction({ ...reward, expiresAt: reward.expiresAt + 1n }); invalid.data.writeBigInt64LE(expiry, 1); await rejected(invalid);
    }
    const before = (await getAccount(connection, destination.address)).amount;
    await commit(reward);
    const single = payout(reward);
    await rejected([single, single]);
    assert.equal((await getAccount(connection, destination.address)).amount, before, 'the first transfer is rolled back if a second settlement in the transaction fails');
    assert.equal((await receipt(reward)).status, 'committed');
    assert.equal((await getAccount(connection, reward.vault)).amount, reward.amount);
    await send(single); assert.equal((await receipt(reward)).status, 'paid');
  });

  await t.test('legacy payout wire, empty commitment identities and untrusted owner signatures cannot bypass commitment', async () => {
    const reward = await create();
    const build = () => commitRewardInstruction({ ...reward, recipient: finder.publicKey, reportRef: randomBytes(32), expectedSeq: 0n });
    const missingOwner = build(); missingOwner.keys[0].isSigner = false;
    await rejected(missingOwner, attacker);
    const foreignOwner = build(); foreignOwner.keys[0].pubkey = attacker.publicKey;
    await rejected(foreignOwner, attacker);
    for (const [offset, width] of [[9, 32], [41, 32]]) {
      const empty = build(); empty.data.fill(0, offset, offset + width); await rejected(empty);
    }
    const futureSequence = build(); futureSequence.data.writeBigUInt64LE(1n, 1); await rejected(futureSequence);
    for (const width of [1, 9, 72, 74]) {
      const malformed = build(); malformed.data = Buffer.alloc(width, 4); await rejected(malformed);
    }
    const legacy = payout(reward);
    legacy.data = Buffer.concat([Buffer.from([1]), finder.publicKey.toBuffer(), randomBytes(32)]);
    await rejected(legacy);
    await rejected(payout(reward));
    assert.equal((await receipt(reward)).status, 'funded');
    assert.equal((await getAccount(connection, reward.vault)).amount, reward.amount);
    await commit(reward);
    await rejected(legacy);
    for (const value of [0n, 2n, (1n << 64n) - 1n]) {
      const wrongRelease = payout(reward); wrongRelease.data.writeBigUInt64LE(value, 1); await rejected(wrongRelease);
      const wrongWaive = waiveRewardInstruction({ ...reward, recipient: finder.publicKey, claimSeq: 1n });
      wrongWaive.data.writeBigUInt64LE(value, 1); await rejected(wrongWaive, owner, [finder]);
    }
    assert.equal((await receipt(reward)).status, 'committed');
    assert.equal((await getAccount(connection, reward.vault)).amount, reward.amount);
  });
});
