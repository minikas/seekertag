export async function createOperationKey(): Promise<string> {
  if (!globalThis.crypto?.getRandomValues) throw new Error('Este navegador não permite preparar um envio seguro. Abra a instalação em um navegador compatível.');
  return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
}
