import { readFileSync } from 'node:fs';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, SYSVAR_CLOCK_PUBKEY } from '@solana/web3.js';
import bs58 from 'bs58';
import { PROGRAM, TOKEN_PROGRAM, escrowAddress, vaultAddress, tokenAddress, rewardInstructions, decodeEscrow, verifyRewardTransaction } from '../../shared/escrow-wire.ts';
import { ESCROW_SPACE, MAINNET_MINTS, REWARD_DECIMALS } from '../../shared/reward.ts';

const GENESIS = { mainnet: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', devnet: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1' };
export class RewardChainError extends Error {}
export function rewardChainFromEnv() {
  if (!process.env.REWARD_VERIFIER_KEYPAIR) return null;
  const network = process.env.REWARD_NETWORK || 'devnet';
  if (network === 'mainnet' && process.env.REWARDS_ALLOW_MAINNET !== 'true') throw new Error('Set REWARDS_ALLOW_MAINNET=true explicitly for a reviewed mainnet deployment.');
  const verifier = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.REWARD_VERIFIER_KEYPAIR, 'utf8'))));
  const rpcUrl = process.env.REWARD_RPC_URL || (network === 'mainnet' ? 'https://api.mainnet-beta.solana.com' : 'https://api.devnet.solana.com');
  return createRewardChain({ network, rpcUrl, verifier, testMints: {
    USDC: process.env.REWARD_TEST_USDC_MINT || '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', SKR: process.env.REWARD_TEST_SKR_MINT,
  } });
}
export function createRewardChain({ network, rpcUrl, verifier, testMints = {} }) {
  if (!['mainnet', 'devnet', 'localnet'].includes(network)) throw new Error('Invalid reward network');
  const url = new URL(rpcUrl);
  if (url.username || url.password || (url.protocol !== 'https:' && !(network === 'localnet' && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw new Error('Reward RPC must use HTTPS (or loopback for localnet)');
  const mints = network === 'mainnet' ? MAINNET_MINTS : testMints;
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
  const config = { network, verifier: verifier.publicKey.toBase58(), currencies: ['SOL', ...['USDC', 'SKR'].filter(c => !!mints[c])], program: PROGRAM.toBase58(), minDays: 1, maxDays: 365 };
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
    return { ...selected, availableUnits: available.toString(), solLamports: sol.toString() };
  }
  async function prepare(spec) {
    await ready();
    if (spec.verifier !== config.verifier) throw new RewardChainError('O verificador desta reserva não está disponível.');
    const latest = await connection.getLatestBlockhash('confirmed');
    const transaction = new Transaction({ feePayer: new PublicKey(spec.payer), recentBlockhash: latest.blockhash }).add(...rewardInstructions(spec));
    const fee = await connection.getFeeForMessage(transaction.compileMessage(), 'confirmed');
    if (fee.value == null) throw new RewardChainError('Não foi possível calcular a taxa. Tente novamente.');
    let rent = 0;
    if (spec.kind === 'fund') rent = await connection.getMinimumBalanceForRentExemption(ESCROW_SPACE) + (spec.mint ? await connection.getMinimumBalanceForRentExemption(165) : 0);
    if (spec.mint && ['release', 'refund'].includes(spec.kind)) {
      const owners = spec.kind === 'release' ? [spec.payer, spec.recipient] : [spec.payer];
      const accounts = await connection.getMultipleAccountsInfo(owners.map(owner => tokenAddress(new PublicKey(owner), new PublicKey(spec.mint))), 'confirmed');
      rent += accounts.filter(account => !account).length * await connection.getMinimumBalanceForRentExemption(165);
    }
    if (spec.kind === 'release') transaction.partialSign(verifier);
    return { transaction: transaction.serialize({ requireAllSignatures: false }).toString('base64'), feeLamports: String(fee.value), rentLamports: String(rent), lastValidBlockHeight: latest.lastValidBlockHeight };
  }
  async function read(reward) {
    await ready();
    const escrow = escrowAddress(reward.payer, reward.seed);
    const result = await connection.getAccountInfoAndContext(escrow, 'finalized'); const account = result.value;
    if (!account) return null;
    if (!account.owner.equals(PROGRAM)) throw new RewardChainError('Não foi possível validar a reserva na rede.');
    const value = decodeEscrow(account.data);
    if (value.payer !== reward.payer || value.rewardId !== reward.seed || value.verifier !== reward.verifier || value.mint !== (reward.mint || SystemProgram.programId.toBase58()) || value.amountUnits !== reward.amount_units || !Number.isSafeInteger(value.refundAfter) || value.refundAfter <= value.depositedAt) throw new RewardChainError('Não foi possível validar a reserva na rede.');
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
    async blockHeight() { return connection.getBlockHeight('finalized'); },
    async clock() { const value = await connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY, 'confirmed'); if (!value || value.data.length !== 40) throw new RewardChainError('Não foi possível verificar o horário da rede.'); return Number(value.data.readBigInt64LE(32)); },
  };
}
