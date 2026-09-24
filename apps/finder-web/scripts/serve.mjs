import { createServer, request as requestUpstream } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildValidator, buildQrScanner } from './validator.mjs';

const sourceRoot = fileURLToPath(new URL('../public/', import.meta.url));
const productionRoot = fileURLToPath(new URL('../dist/', import.meta.url));
const securityHeaders = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'none'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data: blob:; media-src 'self' blob:; object-src 'none'; script-src 'self'; style-src 'self'",
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
};
const mime = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function proxy(req, res, apiOrigin) {
  const target = new URL(req.url, apiOrigin);
  const headers = { ...req.headers, host: target.host };
  delete headers.connection;
  const upstream = requestUpstream(target, { method: req.method, headers }, response => {
    res.writeHead(response.statusCode || 502, response.headers);
    response.pipe(res);
  });
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'API local indisponível.', code: 'API_UNAVAILABLE' }));
  });
  req.pipe(upstream);
}

async function sendFile(req, res, root, relativePath, headers = {}) {
  const file = resolve(root, relativePath);
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  if (!file.startsWith(prefix)) throw new Error('INVALID_PATH');
  const body = await readFile(file);
  res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', ...headers });
  res.end(req.method === 'HEAD' ? undefined : body);
}

export function createFinderServer({ root = sourceRoot, apiOrigin = 'http://127.0.0.1:4318' } = {}) {
  let validator;
  let scanner;
  const canonicalApi = new URL(apiOrigin);
  return createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (pathname === '/api' || pathname.startsWith('/api/')) return proxy(req, res, canonicalApi);
      if (!['GET', 'HEAD'].includes(req.method)) throw new Error('NOT_FOUND');
      if (/^\/(found|chat)\/[A-Za-z0-9_-]+\/?$/.test(pathname)) {
        await sendFile(req, res, root, 'index.html', securityHeaders);
        return;
      }
      if (pathname.startsWith('/finder-assets/')) {
        const asset = pathname.slice('/finder-assets/'.length);
        if (root === sourceRoot && asset === 'qr-scanner.js') {
          scanner ||= buildQrScanner().catch(error => { scanner = null; throw error; });
          const body = await scanner;
          res.writeHead(200, { 'Content-Type': mime['.js'], 'Cache-Control': 'no-cache' });
          res.end(req.method === 'HEAD' ? undefined : body);
          return;
        }
        if (root === sourceRoot && asset === 'wallet-validator.js') {
          validator ||= buildValidator().catch(error => { validator = null; throw error; });
          const body = await validator;
          res.writeHead(200, { 'Content-Type': mime['.js'], 'Cache-Control': 'no-cache' });
          res.end(req.method === 'HEAD' ? undefined : body);
          return;
        }
        if (!asset || asset.includes('/')) throw new Error('NOT_FOUND');
        await sendFile(req, res, root, asset, { 'Cache-Control': 'no-cache' });
        return;
      }
      throw new Error('NOT_FOUND');
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Página não encontrada');
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.FINDER_PORT || 4321);
  const root = process.argv.includes('--production') ? productionRoot : sourceRoot;
  const server = createFinderServer({ root, apiOrigin: process.env.FINDER_API_ORIGIN });
  server.listen(port, '127.0.0.1', () => {
    console.log(`SeekerTag Finder → http://127.0.0.1:${server.address().port}`);
  });
}
