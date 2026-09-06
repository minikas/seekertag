import { assertWalletAddress, WalletConnection } from './wallet.types';

type InjectedWallet = {
  publicKey?: { toString(): string };
  connect(): Promise<{ publicKey: { toString(): string } }>;
  disconnect(): Promise<void>;
};
type WalletWindow = typeof globalThis & { phantom?: { solana?: InjectedWallet }; solflare?: InjectedWallet; solana?: InjectedWallet };
let connectedProvider: InjectedWallet | null = null;

export async function connectWallet(): Promise<WalletConnection> {
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

export async function disconnectWallet(): Promise<void> {
  if (connectedProvider) await connectedProvider.disconnect();
  connectedProvider = null;
}
