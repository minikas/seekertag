import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { createFinderServer } from '../scripts/serve.mjs';

const publicRoot = fileURLToPath(new URL('../public/', import.meta.url));

test('finder web remains a standalone static client without browser-readable capabilities', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const script = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(html, /src="\/finder-assets\/app\.js"/);
  assert.match(html, /href="\/finder-assets\/styles\.css"/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)/i);
  assert.doesNotMatch(html, /<style\b/i);
  assert.match(script, /fetch\(path/);
  assert.match(script, /\/api\/public\/tags\//);
  assert.doesNotMatch(script, /Authorization|seekertag_finder/);
});

test('development server owns finder routes and proxies only API traffic', async (t) => {
  const api = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': 'probe=ok; HttpOnly; Path=/api' });
    res.end(JSON.stringify({ path: req.url }));
  });
  api.listen(0, '127.0.0.1');
  await once(api, 'listening');
  t.after(() => new Promise(resolve => api.close(resolve)));

  const finder = createFinderServer({ root: publicRoot, apiOrigin: `http://127.0.0.1:${api.address().port}` });
  finder.listen(0, '127.0.0.1');
  await once(finder, 'listening');
  t.after(() => new Promise(resolve => finder.close(resolve)));
  const origin = `http://127.0.0.1:${finder.address().port}`;

  const page = await fetch(`${origin}/found/valid-code`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /^text\/html/);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  assert.match(await page.text(), /id="report-form"/);

  const asset = await fetch(`${origin}/finder-assets/app.js`);
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('content-type'), /javascript/);
  assert.equal((await fetch(`${origin}/found/code/extra`)).status, 404);
  assert.equal((await fetch(`${origin}/finder-assets/../package.json`)).status, 404);

  const proxied = await fetch(`${origin}/api/probe?value=1`);
  assert.deepEqual(await proxied.json(), { path: '/api/probe?value=1' });
  assert.match(proxied.headers.get('set-cookie'), /probe=ok/);
});
