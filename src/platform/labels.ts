import { LabelDownload, labelFileName } from './label.types';

/** Download through an authenticated request; never put an access token in a URL. */
export async function downloadLabel({ url, token, fileName }: LabelDownload): Promise<void> {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, credentials: 'omit' });
  if (!response.ok) throw new Error('Não foi possível baixar a etiqueta. Entre novamente e tente outra vez.');
  const blob = await response.blob();
  if (!blob.type.includes('application/pdf')) throw new Error('O servidor não devolveu uma etiqueta PDF válida.');
  const localUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = localUrl;
  link.download = labelFileName(fileName);
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(localUrl), 60_000);
}
