/** This optional device connection does not authenticate ownership on the server. */
export type WalletConnection = { address: string; label: string };

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function encodeBase58(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let result = '';
  while (value > 0n) { result = ALPHABET[Number(value % 58n)] + result; value /= 58n; }
  for (const byte of bytes) { if (byte !== 0) break; result = '1' + result; }
  return result;
}

export function assertWalletAddress(address: string): string {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) throw new Error('A carteira retornou um endereço Solana inválido.');
  let value = 0n;
  for (const char of address) value = value * 58n + BigInt(ALPHABET.indexOf(char));
  let byteLength = 0;
  while (value > 0n) { byteLength++; value /= 256n; }
  for (const char of address) { if (char !== '1') break; byteLength++; }
  if (byteLength !== 32) throw new Error('A carteira retornou um endereço Solana inválido.');
  return address;
}
