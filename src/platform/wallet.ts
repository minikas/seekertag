import { Buffer } from 'buffer';
import { Transaction } from '@solana/web3.js';
import { assertWalletAddress, WalletConnection } from './wallet.types';
import type { RewardConfig } from '../rewards.types';

type InjectedWallet = {
  publicKey?: { toString(): string };
  connect(): Promise<{ publicKey: { toString(): string } }>;
  disconnect(): Promise<void>;
  signMessage?(message: Uint8Array, encoding?: string): Promise<{ signature: Uint8Array; publicKey?: { toString(): string } }>;
  signAndSendTransaction?(transaction: Transaction, options?: { skipPreflight: boolean }): Promise<{ signature: string }>;
};
type WalletWindow = typeof globalThis & { phantom?: { solana?: InjectedWallet }; solflare?: InjectedWallet; solana?: InjectedWallet };
let connectedProvider: InjectedWallet | null = null;

export async function connectWallet(_cluster?: RewardConfig['cluster']): Promise<WalletConnection> {
  const scope = globalThis as WalletWindow;
  const provider = scope.phantom?.solana ?? scope.solflare ?? scope.solana;
  if (!provider) throw new Error('Abra o SeekerTag no navegador da sua carteira Solana ou use o app Android. A carteira é opcional.');
  try {
    const response = await provider.connect();
    const address = assertWalletAddress(response.publicKey.toString());
    connectedProvider = provider;
    return { address, label: scope.phantom?.solana === provider ? 'Phantom' : scope.solflare === provider ? 'Solflare' : 'Carteira Solana' };
  } catch {
    throw new Error('A conexão não foi autorizada pela carteira. Você pode tentar novamente quando quiser.');
  }
}

function currentProvider(address: string): InjectedWallet {
  if (!connectedProvider || connectedProvider.publicKey?.toString() !== address) throw new Error('A conta da carteira mudou. Conecte novamente antes de continuar.');
  return connectedProvider;
}

export async function signWalletMessage(message: string, address: string, _cluster: RewardConfig['cluster']): Promise<string> {
  const provider = currentProvider(address);
  if (!provider.signMessage) throw new Error('Esta carteira não permite comprovar o endereço. Use uma carteira com assinatura de mensagens.');
  const result = await provider.signMessage(Buffer.from(message, 'utf8'), 'utf8');
  if (result.publicKey && result.publicKey.toString() !== address) throw new Error('A mensagem foi assinada por outra conta.');
  currentProvider(address);
  if (result.signature.length !== 64) throw new Error('A carteira retornou uma assinatura inválida.');
  return Buffer.from(result.signature).toString('base64');
}

/** Call only after validateRewardTransaction has rebuilt the exact permitted instructions. */
export async function sendWalletTransaction(transaction: Transaction, address: string, _cluster: RewardConfig['cluster']): Promise<string> {
  const provider = currentProvider(address);
  if (!provider.signAndSendTransaction) throw new Error('Esta carteira não permite enviar transações. Use Phantom, Solflare ou o app Android.');
  const result = await provider.signAndSendTransaction(transaction, { skipPreflight: false });
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(result.signature)) throw new Error('Envio sem comprovante válido. Atualize a confirmação antes de tentar novamente.');
  return result.signature;
}

export async function disconnectWallet(): Promise<void> {
  if (connectedProvider) await connectedProvider.disconnect();
  connectedProvider = null;
}
