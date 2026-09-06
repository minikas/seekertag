import { validateTagUrl } from './nfc.url';

type WebNdefReader = { write(message: { records: { recordType: 'url'; data: string }[] }, options: { signal: AbortSignal; overwrite: boolean }): Promise<void> };
type WebNfcGlobal = typeof globalThis & { NDEFReader?: new () => WebNdefReader };
let activeWrite: AbortController | null = null;

export async function writeTagUrl(value: string): Promise<void> {
  const url = validateTagUrl(value);
  const Reader = (globalThis as WebNfcGlobal).NDEFReader;
  if (!Reader || !globalThis.isSecureContext) {
    throw new Error('Este navegador não grava NFC. Use o app Android em um aparelho com NFC ou imprima o QR code.');
  }
  if (activeWrite) throw new Error('Já existe uma gravação NFC em andamento.');
  const controller = new AbortController();
  activeWrite = controller;
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    await new Reader().write({ records: [{ recordType: 'url', data: url }] }, { signal: controller.signal, overwrite: true });
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Gravação encerrada. Aproxime a etiqueta e tente novamente.');
    if (error instanceof Error && error.name === 'NotAllowedError') throw new Error('Permita o acesso ao NFC no navegador para gravar a etiqueta.');
    throw new Error('Não foi possível gravar. Ative o NFC e aproxime uma etiqueta NDEF regravável.');
  } finally {
    clearTimeout(timeout);
    if (activeWrite === controller) activeWrite = null;
  }
}

export async function cancelNfcWrite(): Promise<void> { activeWrite?.abort(); }
