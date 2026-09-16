import { Buffer } from 'buffer';
import { assertWalletAddress, encodeBase58, WalletConnection } from './wallet.types';
import { api } from '../api';
import type { AuthMode, AuthResult } from './auth';
import type { SignInPayload } from '@solana-mobile/mobile-wallet-adapter-protocol';

let authToken: string | null = null;

export function forgetWalletAuthorization() { authToken = null; }

export async function signInWithWallet(mode: AuthMode, token?: string, language = 'pt'): Promise<AuthResult | null> {
  const { challengeId, payload } = await api<{ challengeId: string; payload: SignInPayload }>('/auth/wallet/challenge', token, { mode, language });
  const { transact } = await import('@solana-mobile/mobile-wallet-adapter-protocol');
  let result;
  try {
    result = await transact(async wallet => {
      const authorization = await wallet.authorize({ chain: 'solana:mainnet', identity: { name: 'SeekerTag', uri: payload.uri }, sign_in_payload: payload });
      if (!authorization.sign_in_result) throw new Error('SIWS_UNSUPPORTED');
      authToken = authorization.auth_token;
      return authorization.sign_in_result;
    });
  } catch (error) {
    const code = (error as { code?: number | string })?.code;
    if (code === -1 || code === -3 || code === 'ERROR_ASSOCIATION_CANCELLED') return null;
    if (error instanceof Error && error.message === 'SIWS_UNSUPPORTED') throw new Error('Sua carteira precisa oferecer Sign In With Solana. Atualize a carteira ou use a Seed Vault Wallet do Seeker.');
    throw new Error('Não foi possível abrir a carteira. Verifique se há uma carteira Solana compatível instalada e tente novamente.');
  }
  return api<AuthResult>('/auth/wallet/verify', token, { challengeId, address: result.address, signedMessage: result.signed_message, signature: result.signature });
}

export async function connectWallet(): Promise<WalletConnection> {
  try {
    // Load the native wallet adapter only when a wallet action is requested.
    const { transact } = await import('@solana-mobile/mobile-wallet-adapter-protocol');
    return await transact(async wallet => {
      const result = await wallet.authorize({ chain: 'solana:mainnet', identity: { name: 'SeekerTag' }, auth_token: authToken ?? undefined });
      const account = result.accounts[0];
      if (!account) throw new Error('Nenhuma conta Solana foi autorizada.');
      const bytes = Buffer.from(account.address, 'base64');
      if (bytes.length !== 32) throw new Error('A carteira retornou um endereço inválido.');
      const address = assertWalletAddress(encodeBase58(bytes));
      authToken = result.auth_token;
      return { address, label: account.label || 'Carteira Solana' };
    });
  } catch {
    throw new Error('Não foi possível conectar a carteira. Use o app SeekerTag instalado no Android, com uma carteira compatível, e aprove a conexão.');
  }
}

export async function disconnectWallet(): Promise<void> {
  if (!authToken) return;
  const token = authToken;
  const { transact } = await import('@solana-mobile/mobile-wallet-adapter-protocol');
  await transact(wallet => wallet.deauthorize({ auth_token: token }));
  authToken = null;
}
