import { Platform } from 'react-native';
import { Buffer } from 'buffer';
import { assertWalletAddress, encodeBase58, WalletConnection } from './wallet.types';

let authToken: string | null = null;

export async function connectWallet(): Promise<WalletConnection> {
  if (Platform.OS !== 'android') throw new Error('A conexão de carteira está disponível no Android. Você pode usar todas as etiquetas sem conectar uma carteira.');
  try {
    // Load only on demand: the core app remains usable inside Expo Go.
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
