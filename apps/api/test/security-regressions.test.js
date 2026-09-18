import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, request as httpRequest } from 'node:http';
import { createApp } from '../app.js';

async function start(t, options = {}) {
  const app = createApp({ dbPath: ':memory:', rewardChain: null, oauthProviders: {}, ...options });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => server.close(resolve)); app.locals.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { app, server, base };
}

async function call(base, path, body, token, headers = {}) {
  const response = await fetch(`${base}/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, data: await response.json() };
}

test('one private reverse proxy isolates client quotas and replaces spoofed forwarding headers', async t => {
  const { base } = await start(t, { trustedProxyHops: 1 });
  // Exercise a real HTTP proxy boundary. IPv4 and IPv6 loopback represent two
  // clients, while every backend socket still originates at 127.0.0.1.
  const proxy = createServer((req, res) => {
    const upstream = httpRequest(`${base}${req.url}`, {
      method: req.method,
      headers: { ...req.headers, host: new URL(base).host, 'x-forwarded-for': req.socket.remoteAddress },
    }, response => { res.writeHead(response.statusCode, response.headers); response.pipe(res); });
    upstream.on('error', () => { res.writeHead(502); res.end(); });
    req.pipe(upstream);
  });
  proxy.listen(0, '::');
  await once(proxy, 'listening');
  t.after(() => new Promise(resolve => proxy.close(resolve)));
  const first = `http://127.0.0.1:${proxy.address().port}`;
  const second = `http://[::1]:${proxy.address().port}`;
  for (let i = 0; i < 30; i++) {
    assert.equal((await call(first, '/auth/wallet/challenge', {}, null, { 'X-Forwarded-For': `198.51.100.${i}` })).status, 200);
  }
  assert.equal((await call(first, '/auth/wallet/challenge', {}, null, { 'X-Forwarded-For': '203.0.113.99' })).status, 429);
  assert.equal((await call(second, '/auth/wallet/challenge', {}, null, { 'X-Forwarded-For': '203.0.113.99' })).status, 200);
});

test('direct deployments ignore forwarding headers and reject unsupported proxy configurations', async t => {
  for (const trustedProxyHops of [true, '1', -1, 2, NaN]) {
    assert.throws(() => createApp({ dbPath: ':memory:', rewardChain: null, oauthProviders: {}, trustedProxyHops }), /TRUST_PROXY_HOPS/);
  }
  const { base } = await start(t);
  for (let i = 0; i < 30; i++) assert.equal((await call(base, '/auth/wallet/challenge', {}, null, { 'X-Forwarded-For': `198.51.100.${i}` })).status, 200);
  assert.equal((await call(base, '/auth/wallet/challenge', {}, null, { 'X-Forwarded-For': '203.0.113.1' })).status, 429);
});

test('claiming a mailbox cannot receive an email-addressed transfer; explicit account IDs still work', async t => {
  const { base } = await start(t, { rateLimits: false });
  const password = 'temporary test password';
  const owner = (await call(base, '/auth/register', { name: 'Owner', email: 'owner@example.test', password })).data;
  const claimant = (await call(base, '/auth/register', { name: 'Claimant', email: 'intended-recipient@example.test', password })).data;
  const { tag } = (await call(base, '/tags', { name: 'Transfer regression' }, owner.token)).data;
  for (const recipientField of ['recipient', 'email']) {
    const denied = await call(base, `/tags/${tag.id}/transfer`, { [recipientField]: 'intended-recipient@example.test', password }, owner.token);
    assert.equal(denied.status, 400);
    assert.equal(denied.data.code, 'RECIPIENT_ID_REQUIRED');
  }
  assert.equal((await call(base, `/tags/${tag.id}`, undefined, owner.token)).status, 200);
  assert.equal((await call(base, `/tags/${tag.id}`, undefined, claimant.token)).status, 404);
  assert.equal((await call(base, `/tags/${tag.id}/transfer`, { recipient: claimant.user.id, password }, owner.token)).status, 200);
  assert.equal((await call(base, `/tags/${tag.id}`, undefined, claimant.token)).status, 200);
  assert.equal((await call(base, `/tags/${tag.id}`, undefined, owner.token)).status, 404);
});
