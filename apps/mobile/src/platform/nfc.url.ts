export function validateTagUrl(value: string): string {
  let parsed: URL;
  try { parsed = new URL(value); }
  catch { throw new Error('A etiqueta precisa de um link válido do SeekerTag.'); }
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('A etiqueta precisa de um link HTTP ou HTTPS do SeekerTag.');
  }
  return parsed.toString();
}
