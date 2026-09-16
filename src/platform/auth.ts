import { Buffer } from 'buffer';
import * as Crypto from 'expo-crypto';
import { api, Provider, User } from '../api';
import { signInWithWallet } from './wallet';

export type AuthMode = 'login' | 'link' | 'reauth';
export type AuthResult = { token?: string; user?: User; proof?: string };
export type AuthAvailability = Record<Provider, boolean>;
export const providerNames: Record<Provider, string> = { solana: 'Seeker / Solana', google: 'Google', apple: 'Apple' };
export const AUTH_RETURN_URL = 'seekertag://auth/callback';

export function isAuthCallback(value: string): boolean {
  try { const url = new URL(value); return url.protocol === 'seekertag:' && url.hostname === 'auth' && url.pathname === '/callback'; }
  catch { return false; }
}

export async function authenticate(provider: Provider, mode: AuthMode = 'login', token?: string, language = 'pt'): Promise<AuthResult | null> {
  if (provider === 'solana') return signInWithWallet(mode, token, language);
  const verifier = Buffer.from(await Crypto.getRandomBytesAsync(32)).toString('base64url');
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, { encoding: Crypto.CryptoEncoding.BASE64 });
  const codeChallenge = digest.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const { flowId, url } = await api<{ flowId: string; url: string }>(`/auth/oauth/${provider}/start`, token, { mode, codeChallenge });
  const WebBrowser = await import('expo-web-browser');
  const result = await WebBrowser.openAuthSessionAsync(url, AUTH_RETURN_URL);
  if (result.type !== 'success') return null;
  if (!isAuthCallback(result.url)) throw new Error('O retorno do login não é válido. Tente novamente.');
  const callback = new URL(result.url);
  if (callback.searchParams.get('state') !== flowId || callback.searchParams.getAll('code').length !== 1) throw new Error('Este retorno não pertence ao login iniciado. Tente novamente.');
  return api<AuthResult>('/auth/oauth/exchange', token, { flowId, code: callback.searchParams.get('code'), verifier });
}
