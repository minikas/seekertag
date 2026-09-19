import { PublicKey } from '@solana/web3.js';

// Receiving wallets must be ordinary Solana public keys, not program addresses,
// a padded/ambiguous base58 representation. No wallet access is needed.
export function receivingWalletAddress(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 100) return null;
  const address = value.trim();
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return null;
  try {
    const key = new PublicKey(address);
    if (key.equals(PublicKey.default) || key.toBase58() !== address || !PublicKey.isOnCurve(key.toBytes())) return null;
    return address;
  } catch { return null; }
}
