import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { LabelDownload, labelFileName } from './label.types';

export async function downloadLabel({ url, token, fileName }: LabelDownload): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new Error('O compartilhamento de arquivos não está disponível neste aparelho.');
  const destination = new File(Paths.cache, `${Date.now()}-${labelFileName(fileName)}`);
  try {
    const file = await File.downloadFileAsync(url, destination, { headers: { Authorization: `Bearer ${token}` } });
    const bytes = await file.bytes();
    if (String.fromCharCode(...bytes.slice(0, 5)) !== '%PDF-') throw new Error('Invalid PDF');
    await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: 'Salvar ou imprimir etiqueta' });
  } catch {
    if (destination.exists) destination.delete();
    throw new Error('Não foi possível abrir a etiqueta. Confira a conexão e tente novamente.');
  }
  // Keep the cache file available until the receiving app has read the attachment.
  // The OS may reclaim cache files; no owner token is written to this PDF.
}
