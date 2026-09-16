import { Platform } from 'react-native';
import { Buffer } from 'buffer';
import type { Transaction } from '@solana/web3.js';
import type { Web3MobileWallet } from '@solana-mobile/mobile-wallet-adapter-protocol-web3js';
import { assertWalletAddress, encodeBase58, WalletConnection } from './wallet.types';
import type { RewardConfig } from '../rewards.types';

let authorization: { token: string; cluster: RewardConfig['cluster'] } | null = null;

async function authorize(wallet: Web3MobileWallet, cluster: RewardConfig['cluster'], expectedAddress?: string) {
  if (cluster === 'localnet') throw new Error('Use a carteira de teste no navegador para a rede local. Para testar no Android, use uma versão do app configurada para devnet.');
  const result = await wallet.authorize({ chain: cluster === 'mainnet-beta' ? 'solana:mainnet' : `solana:${cluster}`, identity: { name: 'SeekerTag' }, auth_token: authorization?.cluster === cluster ? authorization.token : undefined });
  const account = expectedAddress ? result.accounts.find(item => encodeBase58(Buffer.from(item.address, 'base64')) === expectedAddress) : result.accounts[0];
  if (!account) throw new Error('Autorize a mesma conta usada nesta recompensa.');
  const bytes = Buffer.from(account.address, 'base64');
  if (bytes.length !== 32) throw new Error('A carteira retornou um endereço inválido.');
  const address = assertWalletAddress(encodeBase58(bytes));
  authorization = { token: result.auth_token, cluster };
  return { address, label: account.label || 'Carteira Solana', base64Address: account.address };
}

function requireAndroid() {
  if (Platform.OS !== 'android') throw new Error('A conexão de carteira está disponível no Android. Você pode usar todas as etiquetas sem conectar uma carteira.');
}

export async function connectWallet(cluster: RewardConfig['cluster'] = 'mainnet-beta'): Promise<WalletConnection> {
  requireAndroid();
  // Load only on demand: the core app remains usable inside Expo Go.
  const { transact } = await import('@solana-mobile/mobile-wallet-adapter-protocol-web3js');
  return transact(wallet => authorize(wallet, cluster));
}

export async function signWalletMessage(message: string, address: string, cluster: RewardConfig['cluster']): Promise<string> {
  requireAndroid();
  const { transact } = await import('@solana-mobile/mobile-wallet-adapter-protocol-web3js');
  return transact(async wallet => {
    const account = await authorize(wallet, cluster, address);
    const payload = Buffer.from(message, 'utf8');
    const [signed] = await wallet.signMessages({ addresses: [account.base64Address], payloads: [payload] });
    // MWA 2.0 appends one 64-byte signature to the original message per requested account.
    if (!signed || signed.length !== payload.length + 64 || !Buffer.from(signed.subarray(0, payload.length)).equals(payload)) throw new Error('A carteira retornou uma mensagem assinada diferente da solicitada.');
    return Buffer.from(signed.subarray(payload.length)).toString('base64');
  });
}

/** Call only after validateRewardTransaction has rebuilt the exact permitted instructions. */
export async function sendWalletTransaction(transaction: Transaction, address: string, cluster: RewardConfig['cluster']): Promise<string> {
  requireAndroid();
  const { transact } = await import('@solana-mobile/mobile-wallet-adapter-protocol-web3js');
  return transact(async wallet => {
    await authorize(wallet, cluster, address);
    const [signature] = await wallet.signAndSendTransactions({ transactions: [transaction], skipPreflight: false, commitment: 'confirmed' });
    if (!signature || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature)) throw new Error('Envio sem comprovante válido. Atualize a confirmação antes de tentar novamente.');
    return signature;
  });
}

export async function disconnectWallet(): Promise<void> {
  if (!authorization) return;
  const token = authorization.token;
  const { transact } = await import('@solana-mobile/mobile-wallet-adapter-protocol-web3js');
  await transact(wallet => wallet.deauthorize({ auth_token: token }));
  authorization = null;
}
