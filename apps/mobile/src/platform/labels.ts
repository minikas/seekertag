import { File, Paths } from 'expo-file-system';
import * as LegacyFileSystem from 'expo-file-system/legacy';
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

/** Save a permanent copy through Android's native Save As dialog. */
export async function downloadLabel(request: LabelDownload): Promise<boolean> {
  let destinationUri: string;
  try {
    const result = await IntentLauncher.startActivityAsync('android.intent.action.CREATE_DOCUMENT', {
      category: 'android.intent.category.OPENABLE',
      type: 'application/pdf',
      extra: { 'android.intent.extra.TITLE': labelFileName(request.fileName) },
    });
    if (result.resultCode !== IntentLauncher.ResultCode.Success) return false;
    if (!result.data) throw new Error('missing destination URI');
    destinationUri = result.data;
  } catch {
    throw new Error('Não foi possível abrir o diálogo para salvar o PDF. Tente novamente ou compartilhe o PDF.');
  }
  const cached = await fetchLabel(request);
  try {
    await LegacyFileSystem.writeAsStringAsync(destinationUri, await cached.base64(), { encoding: LegacyFileSystem.EncodingType.Base64 });
    return true;
  } catch {
    throw new Error('Não foi possível salvar o PDF. Escolha Downloads ou outra pasta e tente novamente.');
  } finally {
    if (cached.exists) cached.delete();
  }
}

export async function shareLabel(request: LabelDownload): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new Error('O compartilhamento de arquivos não está disponível neste aparelho.');
  const file = await fetchLabel(request);
  await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', dialogTitle: request.dialogTitle || 'Compartilhar ou imprimir etiqueta' });
  // The receiving app may still be reading this file after the chooser closes.
}
