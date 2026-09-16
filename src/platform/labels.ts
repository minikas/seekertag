import { Directory, File, Paths } from 'expo-file-system';
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

/** Save a permanent copy in the folder the user chooses through Android's picker. */
export async function downloadLabel(request: LabelDownload): Promise<boolean> {
  let directory: Directory;
  try { directory = await Directory.pickDirectoryAsync(); }
  catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ERR_PICKER_CANCELLED') return false;
    throw new Error('Não foi possível acessar a pasta. Escolha uma pasta com permissão para salvar arquivos.');
  }
  const cached = await fetchLabel(request);
  let saved: File | undefined;
  try {
    saved = directory.createFile(labelFileName(request.fileName), 'application/pdf');
    saved.write(await cached.bytes());
    return true;
  } catch {
    if (saved?.exists) saved.delete();
    throw new Error('Não foi possível salvar o PDF nessa pasta. Escolha outra pasta e tente novamente.');
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
