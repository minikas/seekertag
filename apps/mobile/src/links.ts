export type Route = { code?: string; chatId?: string };

/** Links select a resource on the configured API; they never select a server. */
export function readRoute(value: string, apiUrl: string): Route | null {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash) return null;
    const origin = new URL(apiUrl).origin;
    let path = url.pathname;
    if (url.protocol === 'seekertag:') {
      if (url.port || url.searchParams.getAll('origin').length !== 1 || url.searchParams.get('origin') !== origin) return null;
      path = url.hostname ? `/${url.hostname}${path}` : path;
    } else if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) {
      return null;
    }
    const match = /^\/(found|chat)\/([A-Za-z0-9_-]+)\/?$/.exec(path);
    if (!match) return null;
    return match[1] === 'found' ? { code: match[2] } : { chatId: match[2] };
  } catch {
    return null;
  }
}

export function nativeTagUrl(publicUrl: string): string {
  const url = new URL(publicUrl);
  const route = readRoute(publicUrl, url.origin);
  if (!route?.code) throw new Error('Link de etiqueta inválido.');
  return `seekertag:///found/${route.code}?origin=${encodeURIComponent(url.origin)}`;
}
