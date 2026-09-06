import { getRandomBytesAsync } from 'expo-crypto';
export async function createOperationKey(): Promise<string> {
  return Array.from(await getRandomBytesAsync(32), byte => byte.toString(16).padStart(2, '0')).join('');
}
