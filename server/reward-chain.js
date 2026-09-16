import { Connection, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync, unpackAccount, unpackMint } from '@solana/spl-token';
import { commitRewardInstruction, waiveRewardInstruction, createRewardInstruction, decodeReward, deriveRewardAddresses, refundRewardInstruction, releaseRewardInstruction, renewRewardInstruction } from '../shared/reward-protocol.mjs';

export const SKR_MINT = 'SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3';
const GENESIS = { 'mainnet-beta': '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', devnet: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1' };
const LOADERS = new Set(['BPFLoader1111111111111111111111111111111111', 'BPFLoader2111111111111111111111111111111111', 'BPFLoaderUpgradeab1e11111111111111111111111', 'LoaderV411111111111111111111111111111111111']);

export function rewardConfig(env = process.env) {
  const cluster = env.SKR_CLUSTER || 'devnet';
  const config = { enabled: env.SKR_REWARDS_ENABLED === 'true', cluster, assetLabel: cluster === 'mainnet-beta' ? 'SKR' : 'Test SKR', mint: env.SKR_MINT || null, programId: env.SKR_PROGRAM_ID || null, rpcUrl: env.SKR_RPC_URL, genesisHash: GENESIS[cluster] || env.SKR_GENESIS_HASH };
  if (!config.enabled) return { ...config, reason: 'SKR escrow is not configured.' };
  try {
    if (!['mainnet-beta', 'devnet', 'localnet'].includes(cluster)) throw new Error();
    if (!config.genesisHash || !config.rpcUrl) throw new Error();
    const url = new URL(config.rpcUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.hash) throw new Error();
    if (cluster !== 'localnet' && url.protocol !== 'https:') throw new Error();
    config.programId = new PublicKey(config.programId).toBase58();
    config.mint = new PublicKey(config.mint).toBase58();
    if (cluster === 'mainnet-beta' && config.mint !== SKR_MINT) throw new Error();
    if (cluster !== 'mainnet-beta' && config.mint === SKR_MINT) throw new Error();
  } catch { return { ...config, enabled: false, reason: 'SKR escrow configuration is invalid.' }; }
  return config;
}

const invalid = () => { throw new Error('REWARD_CHAIN_INVALID'); };
const same = (a, b) => new PublicKey(a).equals(new PublicKey(b));

// RPC URLs are server configuration only. No endpoint accepts an RPC address.
export function createRewardChain(config, injectedConnection) {
  const connection = injectedConnection || (config.enabled ? new Connection(config.rpcUrl, {
    commitment: 'finalized', disableRetryOnRateLimit: true,
    fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(12_000) }),
  }) : null);
  async function network() {
    if (!config.enabled || !connection) invalid();
    if (await connection.getGenesisHash() !== config.genesisHash) invalid();
  }
  function checkProgramAndMint(program, mint) {
    if (!program?.executable || !LOADERS.has(program.owner.toBase58())) invalid();
    if (!mint || mint.data.length !== 82) invalid();
    const token = unpackMint(new PublicKey(config.mint), mint, TOKEN_PROGRAM_ID);
    if (!token.isInitialized || token.decimals !== 6 || token.freezeAuthority !== null) invalid();
  }
  async function ready() {
    await network();
    const [program, mint] = await connection.getMultipleAccountsInfo([new PublicKey(config.programId), new PublicKey(config.mint)], 'finalized');
    checkProgramAndMint(program, mint);
  }
  async function inspect(row) {
    await network();
    if (row.cluster !== config.cluster || row.mint !== config.mint || row.program_id !== config.programId || row.genesis_hash !== config.genesisHash) invalid();
    const addresses = deriveRewardAddresses(config.programId, row.wallet, Buffer.from(row.reference, 'hex'));
    if (!same(addresses.reward, row.address) || !same(addresses.vault, row.vault)) invalid();
    // The receipt read must be at least as recent as the finalized block-height
    // observation used to retire an ambiguous prepared transaction.
    const epoch = await connection.getEpochInfo({ commitment: 'finalized' });
    const snapshot = await connection.getMultipleAccountsInfoAndContext([addresses.reward, addresses.vault, new PublicKey(config.programId), new PublicKey(config.mint)], { commitment: 'finalized', minContextSlot: epoch.absoluteSlot });
    if (snapshot.context.slot < epoch.absoluteSlot) invalid();
    const [account, vaultAccount, program, mint] = snapshot.value;
    checkProgramAndMint(program, mint);
    // Sending SOL to a future PDA does not initialize a receipt. The contract
    // accepts such prefunding; a public draft must not be griefable by donations.
    if (!account || account.owner.equals(SystemProgram.programId) && !account.executable && account.data.length === 0) {
      if (row.chain_status !== 'draft') invalid();
      return { receipt: null, blockHeight: epoch.blockHeight };
    }
    if (!account.owner.equals(new PublicKey(config.programId)) || account.executable) invalid();
    const receipt = decodeReward(account.data);
    if (!receipt.owner.equals(new PublicKey(row.wallet)) || !receipt.mint.equals(new PublicKey(row.mint)) || receipt.rewardId.toString('hex') !== row.reference || receipt.amount !== BigInt(row.amount_units) || receipt.decimals !== 6 || receipt.rewardBump !== addresses.rewardBump || receipt.vaultBump !== addresses.vaultBump || receipt.expiresAt < BigInt(row.expires_at) || receipt.createdAt <= 0n) invalid();
    if (row.chain_status === 'paid' && receipt.status !== 'paid' || row.chain_status === 'refunded' && receipt.status !== 'refunded') invalid();
    if (!vaultAccount || vaultAccount.data.length !== 165) invalid();
    const vault = unpackAccount(addresses.vault, vaultAccount, TOKEN_PROGRAM_ID);
    if (!vault.mint.equals(new PublicKey(row.mint)) || !vault.owner.equals(addresses.reward) || !vault.isInitialized || vault.isFrozen || vault.delegate !== null || vault.closeAuthority !== null || vault.delegatedAmount !== 0n) invalid();
    if (['funded', 'committed'].includes(receipt.status) && vault.amount < receipt.amount) invalid();
    if (receipt.status === 'funded' && (receipt.recipient !== null || receipt.reportRef.some((b) => b !== 0) || receipt.settledAt !== 0n)) invalid();
    if (['paid', 'refunded'].includes(receipt.status) && receipt.settledAt <= 0n) invalid();
    if (receipt.status === 'refunded' && (receipt.recipient !== null || receipt.reportRef.some((b) => b !== 0))) invalid();
    return { receipt, blockHeight: epoch.blockHeight };
  }
  async function prepare(row, intent) {
    await ready();
    const owner = new PublicKey(row.wallet);
    const mint = new PublicKey(row.mint);
    const common = { programId: new PublicKey(row.program_id), owner, mint, rewardId: Buffer.from(row.reference, 'hex') };
    const transaction = new Transaction();
    if (intent.action === 'fund') transaction.add(createRewardInstruction({ ...common, amount: BigInt(row.amount_units), expiresAt: BigInt(intent.target_expiry) }));
    if (intent.action === 'renew') transaction.add(renewRewardInstruction({ ...common, expiresAt: BigInt(intent.target_expiry) }));
    if (intent.action === 'commit') transaction.add(commitRewardInstruction({ ...common, recipient: new PublicKey(intent.recipient_wallet), reportRef: Buffer.from(intent.report_reference, 'hex'), expectedSeq: BigInt(intent.claim_seq) }));
    if (intent.action === 'waive') transaction.add(waiveRewardInstruction({ ...common, recipient: new PublicKey(intent.recipient_wallet), claimSeq: BigInt(intent.claim_seq) }));
    if (intent.action === 'release' || intent.action === 'refund') {
      const recipient = new PublicKey(intent.action === 'release' ? intent.recipient_wallet : row.wallet);
      const destination = getAssociatedTokenAddressSync(mint, recipient);
      transaction.add(createAssociatedTokenAccountIdempotentInstruction(owner, destination, recipient, mint));
      transaction.add(intent.action === 'release' ? releaseRewardInstruction({ ...common, recipient, claimSeq: BigInt(intent.claim_seq), destination }) : refundRewardInstruction({ ...common, destination }));
    }
    const latest = await connection.getLatestBlockhash('finalized');
    transaction.feePayer = intent.action === 'waive' ? new PublicKey(intent.recipient_wallet) : owner;
    transaction.recentBlockhash = latest.blockhash;
    return { transaction: transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64'), blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight };
  }
  async function verifySignature(signature, intents) {
    if (typeof signature !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(signature)) return { invalid: true };
    await network();
    const tx = await connection.getTransaction(signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 });
    if (!tx) return { pending: true };
    if (!tx.meta || tx.meta.err) return { failed: true };
    const message = Buffer.from(tx.transaction.message.serialize());
    const intent = intents.find((candidate) => candidate.transaction && Transaction.from(Buffer.from(candidate.transaction, 'base64')).serializeMessage().equals(message));
    if (!intent) return { invalid: true };
    return { intentId: intent.id };
  }
  return { ready, inspect, prepare, verifySignature };
}
