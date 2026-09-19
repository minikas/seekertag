import { Buffer } from 'buffer';
import { PublicKey } from '@solana/web3.js';
import type { SignInPayload } from '@solana-mobile/mobile-wallet-adapter-protocol';
import { verifyRewardTransaction } from '@seekertag/shared/escrow-wire';
import type { RewardOperation, RewardNetwork } from '@seekertag/shared/reward';
import { api } from '../api';
import { waitForWalletReturn } from './wallet-return';

const authorizations = new Map<RewardNetwork, string>();
export function forgetRewardAuthorization() { authorizations.clear(); }
function cancelled(error: unknown) {
  const code = (error as { code?: number | string })?.code;
  return code === -1 || code === -3 || code === 'ERROR_ASSOCIATION_CANCELLED';
}

export async function signReward(operation: RewardOperation): Promise<string | null> {
  // Inspect the complete transaction before requesting any wallet interaction.
  const original = verifyRewardTransaction(operation.transaction, operation.spec);
  if (operation.network === 'localnet') throw new Error('Use a rede devnet para assinar no Seeker.');
  const { transact } = await import('@solana-mobile/mobile-wallet-adapter-protocol');
  try {
    const signedPayload = await transact(async wallet => {
      const authorization = await wallet.authorize({ chain: `solana:${operation.network}`, identity: { name: 'SeekerTag' }, auth_token: authorizations.get(operation.network) });
      const payer = authorization.accounts.find(account => new PublicKey(Buffer.from(account.address, 'base64')).toBase58() === operation.spec.payer);
      if (!payer) throw new Error('Use a carteira que fez o depósito.');
      authorizations.set(operation.network, authorization.auth_token);
      const result = await wallet.signTransactions({ payloads: [operation.transaction] });
      if (result.signed_payloads.length !== 1) throw new Error('A carteira retornou uma transação inválida.');
      const signed = verifyRewardTransaction(result.signed_payloads[0], operation.spec);
      if (!signed.serializeMessage().equals(original.serializeMessage()) || !signed.verifySignatures()) throw new Error('A assinatura não corresponde à transação solicitada.');
      return result.signed_payloads[0];
    });
    await waitForWalletReturn();
    return signedPayload;
  } catch (error) {
    if (cancelled(error)) return null;
    if (/timed?\s*out|timeout/i.test(error instanceof Error ? error.message : String(error))) {
      throw new Error('A carteira não respondeu a tempo. Toque em Assinar na carteira para tentar novamente.');
    }
    throw error instanceof Error ? error : new Error('Não foi possível abrir a carteira. Tente novamente.');
  }
}

export async function confirmFinderWallet(reportId: string, token: string, language: string): Promise<string | null> {
  const base = `/finder/reports/${reportId}/reward/wallet`;
  const { challengeId, payload } = await api<{ challengeId: string; payload: SignInPayload }>(`${base}/challenge`, token, { language });
  const { transact } = await import('@solana-mobile/mobile-wallet-adapter-protocol');
  let result;
  try {
    result = await transact(async wallet => {
      const auth = await wallet.authorize({ chain: 'solana:mainnet', identity: { name: 'SeekerTag', uri: payload.uri }, sign_in_payload: payload });
      if (!auth.sign_in_result) throw new Error('Sua carteira precisa oferecer Sign In With Solana. Atualize a carteira ou use a Seed Vault Wallet do Seeker.');
      return auth.sign_in_result;
    });
  } catch (error) { if (cancelled(error)) return null; throw error; }
  await waitForWalletReturn();
  const verified = await api<{ recipient: string }>(`${base}/verify`, token, { challengeId, address: result.address, signedMessage: result.signed_message, signature: result.signature });
  return verified.recipient;
}
