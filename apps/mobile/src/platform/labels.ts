import { File, Paths } from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Sharing from 'expo-sharing';
import { LabelDownload, labelFileName } from './label.types';

async function fetchLabel({ url, token, fileName }: LabelDownload): Promise<File> {
  const destination = new File(Paths.cache, `${Date.now()}-${labelFileName(fileName)}`);
  try {
    const file = await File.downloadFileAsync(url, destination, { headers: { Authorization: `Bearer ${token}` } });
    const bytes = await file.bytes();
    if (String.fromCharCode(...bytes.slice(0, 5)) !== '%PDF-') throw new Error('Invalid PDF');
    return file;
  } catch {
    if (destination.exists) destination.delete();
    throw new Error('Não foi possível abrir a etiqueta. Confira a conexão e tente novamente.');
  }
}

async function downloadToFile(request: LabelDownload, destination: File): Promise<void> {
  let cached: File | undefined;
  try {
    // downloadFileAsync requires file:// in Expo 57.0.6; File.write supports
    // the content:// document returned by ACTION_CREATE_DOCUMENT.
    cached = await fetchLabel(request);
    const bytes = await cached.bytes();
    destination.write(bytes);
    const saved = await destination.bytes();
    if (saved.length !== bytes.length || saved.some((byte, index) => byte !== bytes[index])) {
      throw new Error('PDF verification failed');
    }
  } catch {
    try { if (destination.exists) destination.delete(); } catch { /* Preserve the save error. */ }
    throw new Error('Não foi possível salvar o PDF. Escolha Downloads ou outra pasta e tente novamente.');
  } finally {
    try { if (cached?.exists) cached.delete(); } catch { /* Cache eviction can retry later. */ }
  }
}

/** Save a permanent copy through Android's native Save As dialog. */
export async function downloadLabel(request: LabelDownload): Promise<boolean> {
  let destinationUri: string;
  try {
    const result = await IntentLauncher.startActivityAsync('android.intent.action.CREATE_DOCUMENT', {
      category: 'android.intent.category.OPENABLE',
      type: 'application/pdf',
      flags: 0x3, // FLAG_GRANT_READ_URI_PERMISSION | FLAG_GRANT_WRITE_URI_PERMISSION
      extra: { 'android.intent.extra.TITLE': labelFileName(request.fileName) },
    });
    if (result.resultCode !== IntentLauncher.ResultCode.Success) return false;
    // The native compatibility patch returns Intent.data, never Intent.toString().
    if (!result.data?.startsWith('content://') || result.data.endsWith('/...')) throw new Error('invalid destination URI');
    destinationUri = result.data;
  } catch {
    throw new Error('Não foi possível abrir o diálogo para salvar o PDF. Tente novamente ou compartilhe o PDF.');
  }
  const destination = new File(destinationUri);
  await downloadToFile(request, destination);
  return true;
}

export async function shareLabel(request: LabelDownload): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new Error('O compartilhamento de arquivos não está disponível neste aparelho.');
  const file = await fetchLabel(request);
  await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', dialogTitle: request.dialogTitle || 'Compartilhar ou imprimir etiqueta' });
  // The receiving app may still be reading this file after the chooser closes.
}
