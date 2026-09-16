import { validateTagUrl } from './nfc.url';

type NfcModule = typeof import('react-native-nfc-manager');
type WriteOperation = {
  module: NfcModule | null;
  cancelled: boolean;
  cancellation?: Promise<void>;
  stopping?: Promise<void>;
  finished: Promise<void>;
};
let activeWrite: WriteOperation | null = null;

export async function writeTagUrl(value: string): Promise<void> {
  const url = validateTagUrl(value);
  if (activeWrite) throw new Error('Já existe uma gravação NFC em andamento.');
  let finish!: () => void;
  const operation: WriteOperation = { module: null, cancelled: false, finished: new Promise(resolve => { finish = resolve; }) };
  activeWrite = operation;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const checkCancelled = () => {
    if (operation.cancelled || timedOut) throw new Error('Gravação cancelada.');
  };
  try {
    try { operation.module = await import('react-native-nfc-manager'); }
    catch { throw new Error('A gravação NFC precisa do aplicativo SeekerTag instalado. Por enquanto, você pode usar a etiqueta com QR code.'); }
    checkCancelled();
    const module = operation.module;
    const manager = module.default;
    if (!(await manager.isSupported())) throw new Error('Este aparelho não tem NFC. Use a etiqueta com QR code.');
    checkCancelled();
    await manager.start();
    checkCancelled();
    if (!(await manager.isEnabled())) throw new Error('Ative o NFC nas configurações do aparelho e tente novamente.');
    checkCancelled();
    timeout = setTimeout(() => {
      timedOut = true;
      operation.cancellation = manager.cancelTechnologyRequest({ delayMsAndroid: 0 }).catch(() => {});
    }, 30_000);
    await manager.requestTechnology(module.NfcTech.Ndef);
    checkCancelled();
    const bytes = module.Ndef.encodeMessage([module.Ndef.uriRecord(url)]);
    const status = await manager.ndefHandler.getNdefStatus();
    checkCancelled();
    if (status.status === module.NdefStatus.NotSupported) throw new Error('Esta etiqueta não aceita o formato NDEF. Use uma etiqueta NDEF regravável.');
    if (status.status === module.NdefStatus.ReadOnly) throw new Error('Esta etiqueta está protegida contra gravação. Use uma etiqueta regravável.');
    if (status.capacity < bytes.length) throw new Error('Esta etiqueta tem pouca memória para o link. Use uma etiqueta com mais capacidade.');
    await manager.ndefHandler.writeNdefMessage(bytes);
    checkCancelled();
  } catch (error) {
    if (timedOut) throw new Error('Tempo esgotado. Aproxime a etiqueta NFC e tente novamente.');
    if (operation.cancelled) throw new Error('Gravação cancelada.');
    if (error instanceof Error && /^(Este aparelho|Ative|Esta etiqueta|A gravação NFC)/.test(error.message)) throw error;
    throw new Error('Não foi possível gravar. Mantenha uma etiqueta NDEF regravável perto do aparelho e tente novamente.');
  } finally {
    if (timeout) clearTimeout(timeout);
    // Keep the session locked through cleanup, including cancellation during setup.
    await operation.cancellation;
    await operation.module?.default.cancelTechnologyRequest({ delayMsAndroid: 0 }).catch(() => {});
    if (activeWrite === operation) activeWrite = null;
    finish();
  }
}

export async function cancelNfcWrite(): Promise<void> {
  const operation = activeWrite;
  if (!operation) return;
  operation.cancelled = true;
  if (!operation.stopping) operation.stopping = (async () => {
    // requestTechnology registers Android discovery asynchronously. A cancellation
    // during that registration can arrive before the native request exists.
    while (activeWrite === operation) {
      operation.cancellation = operation.module?.default.cancelTechnologyRequest({ delayMsAndroid: 0 }).catch(() => {});
      await operation.cancellation;
      if (activeWrite !== operation) break;
      await new Promise<void>(resolve => {
        const retry = setTimeout(resolve, 50);
        void operation.finished.then(() => { clearTimeout(retry); resolve(); });
      });
    }
  })();
  await operation.stopping;
}
