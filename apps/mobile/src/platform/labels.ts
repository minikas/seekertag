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

function resultDataUri(data: string): string | undefined {
  if (data.startsWith('content://')) return data;
  // expo-intent-launcher on Android serializes the result Intent instead of its
  // data field. Extract the actual SAF URI before handing it to FileSystem.
  return data.match(/\bdat=(content:\/\/[^\s}]+)/)?.[1];
}

async function downloadToFile({ url, token }: LabelDownload, destination: File): Promise<void> {
  try {
    // On Android this streams the response straight into the SAF document. It
    // avoids a second JS-to-native copy, which is unreliable for Downloads'
    // content provider on this device.
    const file = await File.downloadFileAsync(url, destination, {
      headers: { Authorization: `Bearer ${token}` },
      idempotent: true,
    });
    const bytes = await file.bytes();
    if (String.fromCharCode(...bytes.slice(0, 5)) !== '%PDF-') throw new Error('Invalid PDF');
  } catch {
    if (destination.exists) destination.delete();
    throw new Error('Não foi possível baixar e salvar o PDF. Confira a conexão e tente novamente.');
  }
}

/** Save a permanent copy through Android's native Save As dialog. */
export async function downloadLabel(request: LabelDownload): Promise<boolean> {
  let destinationUri: string;
  try {
    const result = await IntentLauncher.startActivityAsync('android.intent.action.CREATE_DOCUMENT', {
      category: 'android.intent.category.OPENABLE',
      type: 'application/pdf',
      // ACTION_CREATE_DOCUMENT grants the returned URI's access. Request both
      // modes explicitly so the Download provider can hand it back writable.
      flags: 0x43,
      extra: { 'android.intent.extra.TITLE': labelFileName(request.fileName) },
    });
    if (result.resultCode !== IntentLauncher.ResultCode.Success) return false;
    if (!result.data) throw new Error('missing destination URI');
    destinationUri = resultDataUri(result.data) ?? '';
    if (!destinationUri) throw new Error('invalid destination URI');
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
