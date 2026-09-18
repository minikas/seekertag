import { readFileSync } from 'node:fs';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, SYSVAR_CLOCK_PUBKEY } from '@solana/web3.js';
import bs58 from 'bs58';
import { PROGRAM, TOKEN_PROGRAM, escrowAddress, vaultAddress, tokenAddress, rewardInstructions, decodeEscrow, verifyRewardTransaction } from '@seekertag/shared/escrow-wire';
import { DEFAULT_REWARD_PLATFORM_FEE_BPS, ESCROW_SPACE, MAINNET_MINTS, MAX_REWARD_PLATFORM_FEE_BPS, REWARD_DECIMALS, REWARD_COMPUTE_UNITS, REWARD_COMPUTE_UNIT_PRICE } from '@seekertag/shared/reward';

const GENESIS = { mainnet: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d', devnet: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG', testnet: '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY' };
export class RewardChainError extends Error {}
export function rewardChainFromEnv() {
  if (!process.env.REWARD_VERIFIER_KEYPAIR) return null;
  const network = process.env.REWARD_NETWORK || 'devnet';
  if (network === 'mainnet' && process.env.REWARDS_ALLOW_MAINNET !== 'true') throw new Error('Set REWARDS_ALLOW_MAINNET=true explicitly for a reviewed mainnet deployment.');
  const loadKeypair = path => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, 'utf8'))));
  const verifier = loadKeypair(process.env.REWARD_VERIFIER_KEYPAIR);
  const legacyVerifiers = (process.env.REWARD_LEGACY_VERIFIER_KEYPAIRS || '').split(',').map(path => path.trim()).filter(Boolean).map(loadKeypair);
  if (!process.env.REWARD_TREASURY) throw new Error('Set REWARD_TREASURY to the public address that receives platform fees.');
  const feeBps = process.env.REWARD_FEE_BPS === undefined ? DEFAULT_REWARD_PLATFORM_FEE_BPS : Number(process.env.REWARD_FEE_BPS);
  const rpcUrl = process.env.REWARD_RPC_URL || (network === 'mainnet' ? 'https://api.mainnet.solana.com' : network === 'testnet' ? 'https://api.testnet.solana.com' : 'https://api.devnet.solana.com');
  return createRewardChain({ network, rpcUrl, verifier, legacyVerifiers, treasury: process.env.REWARD_TREASURY, feeBps, testMints: {
    USDC: process.env.REWARD_TEST_USDC_MINT || (network === 'devnet' ? '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU' : undefined), SKR: process.env.REWARD_TEST_SKR_MINT,
  } });
}
export function createRewardChain({ network, rpcUrl, verifier, legacyVerifiers = [], treasury, feeBps = DEFAULT_REWARD_PLATFORM_FEE_BPS, testMints = {} }) {
  if (!['mainnet', 'devnet', 'testnet', 'localnet'].includes(network)) throw new Error('Invalid reward network');
  const url = new URL(rpcUrl);
  if (url.username || url.password || (url.protocol !== 'https:' && !(network === 'localnet' && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw new Error('Reward RPC must use HTTPS (or loopback for localnet)');
  const mints = network === 'mainnet' ? MAINNET_MINTS : testMints;
  const treasuryKey = new PublicKey(treasury);
  if (!PublicKey.isOnCurve(treasuryKey.toBytes())) throw new Error('Treasury must be an on-curve wallet distinct from every verifier');
  const verifierKeys = new Map([verifier, ...legacyVerifiers].map(keypair => [keypair.publicKey.toBase58(), keypair]));
  if (verifierKeys.size !== legacyVerifiers.length + 1) throw new Error('Verifier key list contains duplicates');
  if (verifierKeys.has(treasuryKey.toBase58())) throw new Error('Treasury must be an on-curve wallet distinct from every verifier');
  if (!Number.isInteger(feeBps) || feeBps < 1 || feeBps > MAX_REWARD_PLATFORM_FEE_BPS) throw new Error('Reward fee must be between 1 and 1000 basis points');
  for (const mint of Object.values(mints)) if (mint) new PublicKey(mint);
  const fetchRpc = (url, options = {}) => fetch(url, { ...options, signal: AbortSignal.timeout(8000) });
  const connection = new Connection(rpcUrl, { commitment: 'finalized', fetch: fetchRpc, disableRetryOnRateLimit: true });
  let readyUntil = 0;
  async function ready() {
    if (Date.now() < readyUntil) return;
    const [genesis, program] = await Promise.all([connection.getGenesisHash(), connection.getAccountInfo(PROGRAM, 'finalized')]);
    if ((network !== 'localnet' && genesis !== GENESIS[network]) || !program?.executable) throw new RewardChainError('O contrato de recompensa ainda não está disponível nesta rede.');
    readyUntil = Date.now() + 60_000;
  }
  const config = { network, verifier: verifier.publicKey.toBase58(), verifiers: [...verifierKeys.keys()], treasury: treasuryKey.toBase58(), feeBps, currencies: ['SOL', ...['USDC', 'SKR'].filter(c => !!mints[c])], mints, program: PROGRAM.toBase58(), minDays: 1, maxDays: 365, minSeconds: 3_600, maxSeconds: 5 * 365 * 86_400 };
  function asset(currency) {
    if (!config.currencies.includes(currency)) throw new RewardChainError('Esta moeda não está disponível para depósito nesta rede.');
    return { currency, decimals: REWARD_DECIMALS[currency], mint: currency === 'SOL' ? null : mints[currency] };
  }
  function token(account, expectedMint, expectedOwner) {
    if (!account) return 0n;
    const data = Buffer.from(account.data);
    if (!account.owner.equals(TOKEN_PROGRAM) || data.length !== 165 || new PublicKey(data.subarray(0, 32)).toBase58() !== expectedMint || new PublicKey(data.subarray(32, 64)).toBase58() !== expectedOwner || data[108] !== 1) throw new RewardChainError('A conta de tokens está indisponível ou congelada.');
    return data.readBigUInt64LE(64);
  }
  async function balance(payer, currency) {
    await ready(); const selected = asset(currency); const owner = new PublicKey(payer);
    if (!PublicKey.isOnCurve(owner.toBytes())) throw new RewardChainError('Carteira de pagamento inválida.');
    const keys = selected.mint ? [owner, new PublicKey(selected.mint), tokenAddress(owner, new PublicKey(selected.mint))] : [owner];
    const accounts = await connection.getMultipleAccountsInfo(keys, 'confirmed');
    if (accounts[0] && !accounts[0].owner.equals(SystemProgram.programId)) throw new RewardChainError('Carteira de pagamento inválida.');
    if (!Number.isSafeInteger(accounts[0]?.lamports || 0)) throw new RewardChainError('Não foi possível validar o saldo desta carteira.');
    const sol = BigInt(accounts[0]?.lamports || 0);
    let available = sol;
    if (selected.mint) {
      const mint = accounts[1];
      if (!mint?.owner.equals(TOKEN_PROGRAM) || mint.data.length !== 82 || mint.data[44] !== selected.decimals || mint.data[45] !== 1) throw new RewardChainError('O token configurado não corresponde à moeda da recompensa.');
      available = token(accounts[2], selected.mint, payer);
    }
    // Preview budget only: the actual fee/rent is rechecked when preparing the deposit.
    // Funding has one signature and uses the fixed-v2 compute budget.
    const rent = await connection.getMinimumBalanceForRentExemption(ESCROW_SPACE)
      + (selected.mint ? await connection.getMinimumBalanceForRentExemption(165) : 0);
    const reserve = BigInt(rent) + 5_000n + BigInt(Math.ceil(REWARD_COMPUTE_UNITS * REWARD_COMPUTE_UNIT_PRICE / 1_000_000));
    const fundable = sol < reserve ? 0n : selected.mint ? available : sol - reserve;
    return { ...selected, availableUnits: available.toString(), solLamports: sol.toString(), fundableUnits: fundable.toString(), reserveLamports: reserve.toString() };
  }
  async function prepare(spec) {
    await ready();
    const signingVerifier = verifierKeys.get(spec.verifier);
    // Owner-only operations must remain available after losing a legacy key.
    if (spec.kind === 'release' && !signingVerifier) throw new RewardChainError('O verificador desta reserva não está disponível.');
    if (spec.kind === 'fund' && spec.verifier !== config.verifier) throw new RewardChainError('A configuração do verificador mudou. Prepare o depósito novamente.');
    if (spec.kind === 'fund' && (spec.treasury !== config.treasury || spec.feeBps !== config.feeBps)) throw new RewardChainError('A configuração da comissão mudou. Prepare o depósito novamente.');
    const latest = await connection.getLatestBlockhash('confirmed');
    const transaction = new Transaction({ feePayer: new PublicKey(spec.payer), recentBlockhash: latest.blockhash }).add(...rewardInstructions(spec));
    const fee = await connection.getFeeForMessage(transaction.compileMessage(), 'confirmed');
    if (fee.value == null) throw new RewardChainError('Não foi possível calcular a taxa. Tente novamente.');
    let rent = 0;
    if (spec.kind === 'fund') rent = await connection.getMinimumBalanceForRentExemption(ESCROW_SPACE) + (spec.mint ? await connection.getMinimumBalanceForRentExemption(165) : 0);
    if (spec.mint && ['release', 'refund'].includes(spec.kind)) {
      const owners = spec.kind === 'release' ? [spec.payer, spec.recipient, spec.treasury] : [spec.payer];
      const accounts = await connection.getMultipleAccountsInfo(owners.map(owner => tokenAddress(new PublicKey(owner), new PublicKey(spec.mint))), 'confirmed');
      rent += accounts.filter(account => !account).length * await connection.getMinimumBalanceForRentExemption(165);
    }
    if (spec.kind === 'release') transaction.partialSign(signingVerifier);
    return { transaction: transaction.serialize({ requireAllSignatures: false }).toString('base64'), feeLamports: String(fee.value), rentLamports: String(rent), lastValidBlockHeight: latest.lastValidBlockHeight };
  }
  async function read(reward, minContextSlot) {
    await ready();
    const escrow = escrowAddress(reward.payer, reward.seed);
    const result = await connection.getAccountInfoAndContext(escrow, { commitment: 'finalized', ...(minContextSlot === undefined ? {} : { minContextSlot }) }); const account = result.value;
    if (!account) return null;
    if (!account.owner.equals(PROGRAM) || !Number.isSafeInteger(account.lamports)) throw new RewardChainError('Não foi possível validar a reserva na rede.');
    const value = decodeEscrow(account.data);
    if (value.payer !== reward.payer || value.rewardId !== reward.seed || value.verifier !== reward.verifier || value.treasury !== reward.treasury || value.feeBps !== reward.fee_bps || value.mint !== (reward.mint || SystemProgram.programId.toBase58()) || value.amountUnits !== reward.amount_units || !Number.isSafeInteger(value.refundAfter) || value.refundAfter <= value.depositedAt) throw new RewardChainError('Não foi possível validar a reserva na rede.');
    if (value.status === 1) {
      if (reward.mint) {
        const vault = await connection.getAccountInfo(vaultAddress(escrow), { commitment: 'finalized', minContextSlot: result.context.slot });
        if (token(vault, reward.mint, escrow.toBase58()) < BigInt(reward.amount_units)) throw new RewardChainError('Não foi possível validar o saldo da reserva.');
      } else if (BigInt(account.lamports) < BigInt(reward.amount_units) + BigInt(await connection.getMinimumBalanceForRentExemption(ESCROW_SPACE))) throw new RewardChainError('Não foi possível validar o saldo da reserva.');
    }
    return value;
  }
  function signedPayload(encoded, prepared, spec) {
    if (typeof encoded !== 'string' || encoded.length > 2400 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new RewardChainError('Transação assinada inválida.');
    try {
      const signed = verifyRewardTransaction(encoded, spec);
      const original = verifyRewardTransaction(prepared, spec);
      if (!signed.serializeMessage().equals(original.serializeMessage()) || !signed.verifySignatures() || !signed.signature) throw new Error();
      return { signature: bs58.encode(signed.signature), encoded: signed.serialize().toString('base64') };
    } catch { throw new RewardChainError('A assinatura não corresponde à transação solicitada.'); }
  }
  return { config, asset, balance, prepare, read, signedPayload,
    async send(encoded) { return connection.sendRawTransaction(Buffer.from(encoded, 'base64'), { skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 3 }); },
    async signatureState(signature) { return (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0]; },
    async finality() { const epoch = await connection.getEpochInfo('finalized'); return { height: epoch.blockHeight, slot: epoch.absoluteSlot }; },
    async clock() { const value = await connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY, 'confirmed'); if (!value || value.data.length !== 40) throw new RewardChainError('Não foi possível verificar o horário da rede.'); return Number(value.data.readBigInt64LE(32)); },
  };
}
