/// <reference types="node" />
import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createApp } from '../../server/app.js';

test('email preferences verify the real challenge, survive a lost response, open the owner conversation and opt out', async ({ page, request }) => {
  // This dedicated real API advertises a public HTTPS origin for email, while
  // the browser reaches its loopback listener. Only the transport is captured;
  // there is no provider request, OTP endpoint, success mock or secret artifact.
  const directory = mkdtempSync(join(tmpdir(), 'seekertag-email-ui-'));
  const server = createServer();
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test address');
  const origin = `http://127.0.0.1:${address.port}`;
  const mail: { text: string; to: string; idempotencyKey: string }[] = [];
  const app = createApp({ dbPath: join(directory, 'test.sqlite'), publicUrl: 'https://seekertag.example.org',
    corsOrigins: [origin], rateLimits: false, webDistPath: resolve('artifacts/test-web'),
    notifications: { startWorker: false, groupDelayMs: 0, sendEmail: async (message: any) => { mail.push(message); return { id: String(mail.length) }; } } });
  server.on('request', app);
  try {
    const email = `email-ui-${crypto.randomUUID()}@example.test`; const password = crypto.randomUUID();
    const registered = await request.post(`${origin}/api/auth/register`, { data: { name: 'Dono dos avisos', email, password } });
    expect(registered.status()).toBe(201); const owner = await registered.json();
    const created = await request.post(`${origin}/api/tags`, { headers: { Authorization: `Bearer ${owner.token}` }, data: { name: 'Mochila com aviso' } });
    expect(created.status()).toBe(201); const { tag } = await created.json();
    await page.goto(origin);
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await page.getByLabel('E-mail', { exact: true }).fill(email);
    await page.getByLabel('Senha', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Entrar na conta', exact: true }).click();
    await page.getByRole('button', { name: 'Minha conta', exact: true }).click();
    await page.getByRole('button', { name: 'Avisos por e-mail', exact: true }).click();
    await page.route(`${origin}/api/account/notifications/verification`, async route => {
      const response = await route.fetch(); expect(response.status()).toBe(200); await route.abort('failed');
    });
    await page.getByRole('button', { name: 'Enviar código por e-mail', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Tentar enviar o código novamente', exact: true })).toBeEnabled();
    expect(mail.length).toBe(1); expect(mail[0].to === email).toBe(true);
    const code = /\b\d{6}\b/.exec(mail[0].text)?.[0]; expect(Boolean(code)).toBe(true);
    await page.getByLabel('Código de confirmação', { exact: true }).fill(code!);
    await page.getByRole('button', { name: 'Confirmar e ativar avisos', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Desativar avisos', exact: true })).toBeVisible();
    const found = await request.post(`${origin}/api/public/tags/${tag.code}/reports`, { data: { message: 'Encontrei a mochila na recepção.' } });
    expect(found.status()).toBe(201); const finder = await found.json();
    await app.locals.notifications.processQueue();
    expect(mail.length).toBe(2);
    expect(mail[1].text.includes(`/owner-chat/${finder.report.id}`)).toBe(true);
    expect(mail[1].text.includes('Encontrei a mochila')).toBe(false);
    await page.getByRole('button', { name: 'Sair da conta', exact: true }).click();
    // Open the email's route on the corresponding test listener, then log in.
    await page.goto(`${origin}/owner-chat/${finder.report.id}`);
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await page.getByLabel('E-mail', { exact: true }).fill(email);
    await page.getByLabel('Senha', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Entrar na conta', exact: true }).click();
    await expect(page.getByText('Encontrei a mochila na recepção.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Minha conta', exact: true }).click();
    await page.getByRole('button', { name: 'Avisos por e-mail', exact: true }).click();
    await page.getByRole('button', { name: 'Desativar avisos', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Ativar avisos', exact: true })).toBeVisible();
    const message = await request.post(`${origin}/api/finder/reports/${finder.report.id}/messages`, { headers: { Authorization: `Bearer ${finder.token}` }, data: { body: 'Continuo na recepção.' } });
    expect(message.status()).toBe(201); await app.locals.notifications.processQueue();
    expect(mail.length).toBe(2);
  } finally {
    await page.goto('about:blank');
    server.closeAllConnections(); await new Promise<void>(done => server.close(() => done()));
    app.locals.close(); rmSync(directory, { recursive: true, force: true });
  }
});
