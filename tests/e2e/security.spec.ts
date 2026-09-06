import { test, expect, type APIRequestContext } from '@playwright/test';

const api = process.env.API_URL || 'http://127.0.0.1:4329/api';

async function account(request: APIRequestContext, suffix: string) {
  const email = `qa-${suffix}-${crypto.randomUUID()}@example.test`;
  const password = crypto.randomUUID();
  const response = await request.post(`${api}/auth/register`, {
    data: { name: 'Pessoa QA', email, password },
  });
  expect(response.ok()).toBeTruthy();
  const data = await response.json();
  return { ...data, email, password, headers: { Authorization: `Bearer ${data.token}` } };
}

test('public QR, privacy, paused state, ownership and transfer survive real HTTP requests', async ({ request }) => {
  const owner = await account(request, 'owner');
  const stranger = await account(request, 'stranger');
  const created = await request.post(`${api}/tags`, {
    headers: owner.headers,
    data: {
      name: 'Mala de teste privada', category: 'Mala', color: '#B6D5C6',
      description: 'PRIVATE_INTERNAL_NOTE_742', publicMessage: 'Obrigado por cuidar dela.',
    },
  });
  expect(created.ok()).toBeTruthy();
  const { tag } = await created.json();
  expect(typeof tag.code).toBe('string');
  expect(tag.code.length).toBeGreaterThanOrEqual(16);

  const publicResponse = await request.get(`${api}/public/tags/${tag.code}`);
  expect(publicResponse.status()).toBe(200);
  const publicBody = await publicResponse.json();
  expect(publicBody.tag.name).toBe('Mala de teste privada');
  const publicText = JSON.stringify(publicBody);
  expect(publicText.includes(owner.email)).toBeFalsy();
  expect(publicText.includes('PRIVATE_INTERNAL_NOTE_742')).toBeFalsy();
  for (const key of ['email', 'password', 'ownerId', 'token', 'description', 'recoveryCode']) {
    expect(Object.keys(publicBody.tag).includes(key), `public tag must omit ${key}`).toBeFalsy();
  }

  for (const route of ['', '/qr.png', '/label.pdf']) {
    const denied = await request.get(`${api}/tags/${tag.id}${route}`, { headers: stranger.headers });
    expect(denied.status()).toBe(404);
  }
  const qr = await request.get(`${api}/tags/${tag.id}/qr.png`, { headers: owner.headers });
  expect(qr.status()).toBe(200);
  expect((await qr.body()).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  const pdf = await request.get(`${api}/tags/${tag.id}/label.pdf`, { headers: owner.headers });
  expect(pdf.status()).toBe(200);
  expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');

  const paused = await request.patch(`${api}/tags/${tag.id}`, { headers: owner.headers, data: { status: 'paused' } });
  expect(paused.ok()).toBeTruthy();
  expect((await request.get(`${api}/public/tags/${tag.code}`)).status()).toBe(410);
  expect((await request.post(`${api}/public/tags/${tag.code}/reports`, { data: { message: 'Achei na estação.' } })).status()).toBe(410);
  expect((await request.patch(`${api}/tags/${tag.id}`, { headers: owner.headers, data: { status: 'lost' } })).ok()).toBeTruthy();

  const found = await request.post(`${api}/public/tags/${tag.code}/reports`, { data: { finderName: 'Ana', message: 'Achei na estação.' } });
  expect(found.ok()).toBeTruthy();
  const conversation = await found.json();
  const finderHeaders = { Authorization: `Bearer ${conversation.token}` };
  expect((await request.get(`${api}/finder/reports/${conversation.report.id}`)).status()).toBe(401);
  expect((await request.get(`${api}/finder/reports/${conversation.report.id}`, { headers: stranger.headers })).status()).toBeGreaterThanOrEqual(400);
  expect((await request.get(`${api}/reports/${conversation.report.id}`, { headers: stranger.headers })).status()).toBe(404);
  expect((await request.post(`${api}/reports/${conversation.report.id}/resolve`, { headers: stranger.headers })).status()).toBe(404);
  expect((await request.post(`${api}/tags/${tag.id}/transfer`, { headers: owner.headers, data: { email: stranger.email, password: owner.password } })).status()).toBe(409);

  const reply = await request.post(`${api}/reports/${conversation.report.id}/messages`, {
    headers: owner.headers, data: { body: 'Posso pegar às 18h?' },
  });
  expect(reply.ok()).toBeTruthy();
  const finderRead = await request.get(`${api}/finder/reports/${conversation.report.id}`, { headers: finderHeaders });
  expect(finderRead.status()).toBe(200);
  const finderBody = await finderRead.json();
  expect(finderBody.messages.some((message: { body: string }) => message.body === 'Posso pegar às 18h?')).toBeTruthy();
  expect(JSON.stringify(finderBody).includes(owner.email)).toBeFalsy();
  expect(JSON.stringify(finderBody).includes('PRIVATE_INTERNAL_NOTE_742')).toBeFalsy();

  const resolved = await request.post(`${api}/reports/${conversation.report.id}/resolve`, { headers: owner.headers });
  expect(resolved.ok()).toBeTruthy();
  expect((await request.post(`${api}/finder/reports/${conversation.report.id}/messages`, { headers: finderHeaders, data: { body: 'Should remain closed' } })).status()).toBe(409);
  expect((await request.post(`${api}/tags/${tag.id}/transfer`, { headers: owner.headers, data: { email: stranger.email, password: 'incorrect-test-value' } })).status()).toBeGreaterThanOrEqual(400);
  expect((await request.post(`${api}/tags/${tag.id}/transfer`, { headers: owner.headers, data: { email: stranger.email, password: owner.password } })).ok()).toBeTruthy();
  expect((await request.get(`${api}/tags/${tag.id}`, { headers: owner.headers })).status()).toBe(404);
  expect((await request.get(`${api}/tags/${tag.id}`, { headers: stranger.headers })).status()).toBe(200);
  expect((await request.get(`${api}/reports/${conversation.report.id}`, { headers: stranger.headers })).status()).toBe(404);
  expect((await request.get(`${api}/public/tags/${tag.code}`)).status()).toBe(200);
});

test('recovery invalidates old sessions and old recovery code', async ({ request }) => {
  const owner = await account(request, 'recovery');
  const nextPassword = crypto.randomUUID();
  const recovery = await request.post(`${api}/auth/recover`, {
    data: { email: owner.email, recoveryCode: owner.recoveryCode, password: nextPassword },
  });
  expect(recovery.ok()).toBeTruthy();
  const recovered = await recovery.json();
  expect((await request.get(`${api}/auth/me`, { headers: owner.headers })).status()).toBe(401);
  expect((await request.get(`${api}/auth/me`, { headers: { Authorization: `Bearer ${recovered.token}` } })).status()).toBe(200);
  expect((await request.post(`${api}/auth/recover`, { data: { email: owner.email, recoveryCode: owner.recoveryCode, password: nextPassword } })).status()).toBeGreaterThanOrEqual(400);
  expect((await request.post(`${api}/auth/login`, { data: { email: owner.email, password: owner.password } })).status()).toBe(401);
  expect((await request.post(`${api}/auth/login`, { data: { email: owner.email, password: nextPassword } })).ok()).toBeTruthy();
});
