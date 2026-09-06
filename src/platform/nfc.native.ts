import { Platform } from 'react-native';
import { validateTagUrl } from './nfc.url';

type NfcModule = typeof import('react-native-nfc-manager');
type WriteOperation = { module: NfcModule | null; cancelled: boolean };
let activeWrite: WriteOperation | null = null;

export async function writeTagUrl(value: string): Promise<void> {
  const url = validateTagUrl(value);
  if (activeWrite) throw new Error('Já existe uma gravação NFC em andamento.');
  const operation: WriteOperation = { module: null, cancelled: false };
  activeWrite = operation;
  let module: NfcModule;
  try { module = await import('react-native-nfc-manager'); }
  catch { activeWrite = null; throw new Error('A gravação NFC precisa do aplicativo SeekerTag instalado. Por enquanto, você pode usar a etiqueta com QR code.'); }
  const manager = module.default;
  operation.module = module;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  try {
    if (!(await manager.isSupported())) throw new Error('Este aparelho não tem NFC. Use a etiqueta com QR code.');
    await manager.start();
    if (Platform.OS === 'android' && !(await manager.isEnabled())) throw new Error('Ative o NFC nas configurações do aparelho e tente novamente.');
    if (operation.cancelled) throw new Error('Gravação cancelada.');
    timeout = setTimeout(() => {
      timedOut = true;
      void manager.cancelTechnologyRequest().catch(() => {});
    }, 30_000);
    await manager.requestTechnology(module.NfcTech.Ndef, { alertMessage: 'Aproxime uma etiqueta NFC regravável do aparelho.' });
    if (operation.cancelled) throw new Error('Gravação cancelada.');
    const bytes = module.Ndef.encodeMessage([module.Ndef.uriRecord(url)]);
    const status = await manager.ndefHandler.getNdefStatus();
    if (status.status === module.NdefStatus.NotSupported) throw new Error('Esta etiqueta não aceita o formato NDEF. Use uma etiqueta NDEF regravável.');
    if (status.status === module.NdefStatus.ReadOnly) throw new Error('Esta etiqueta está protegida contra gravação. Use uma etiqueta regravável.');
    if (status.capacity < bytes.length) throw new Error('Esta etiqueta tem pouca memória para o link. Use uma etiqueta com mais capacidade.');
    await manager.ndefHandler.writeNdefMessage(bytes);
    if (Platform.OS === 'ios') await manager.setAlertMessageIOS('Etiqueta SeekerTag gravada!');
  } catch (error) {
    if (timedOut) throw new Error('Tempo esgotado. Aproxime a etiqueta NFC e tente novamente.');
    if (operation.cancelled) throw new Error('Gravação cancelada.');
    if (error instanceof Error && /^(Este aparelho|Ative|Esta etiqueta)/.test(error.message)) throw error;
    throw new Error('Não foi possível gravar. Mantenha uma etiqueta NDEF regravável perto do aparelho e tente novamente.');
  } finally {
    if (timeout) clearTimeout(timeout);
    await manager.cancelTechnologyRequest().catch(() => {});
    if (activeWrite === operation) activeWrite = null;
  }
}

export async function cancelNfcWrite(): Promise<void> {
  if (activeWrite) activeWrite.cancelled = true;
  await activeWrite?.module?.default.cancelTechnologyRequest().catch(() => {});
}
