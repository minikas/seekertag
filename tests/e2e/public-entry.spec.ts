import { test, expect } from '@playwright/test';
import { web, apiUrl } from './helpers';

test('invalid public label has a clear recovery path and does not demand registration', async ({ page }) => {
  await page.goto('/found/invalid-qa-label');
  await expect(page.getByText(/etiqueta não foi encontrada/i)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Página inicial', exact: true })).toBeVisible();
  await expect(page.getByLabel('Mensagem para o dono', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('E-mail', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Página inicial', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Encontrei um objeto', exact: true })).toBeVisible();
});

test('unavailable camera still permits manual tag entry and browser back-forward navigation', async ({ page, context, request }, testInfo) => {
  // Simulate an absent browser capability, as on an insecure HTTP LAN origin.
  // All SeekerTag API calls and persistence remain real.
  await context.addInitScript(() => Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined }));
  const runtimeErrors: string[] = [];
  page.on('pageerror', error => runtimeErrors.push(error.message));
  const registered = await request.post(`${apiUrl}/auth/register`, { data: { name: 'Teste do leitor', email: `qa-scanner-${crypto.randomUUID()}@example.test`, password: crypto.randomUUID() } });
  expect(registered.ok()).toBeTruthy();
  const account = await registered.json();
  const created = await request.post(`${apiUrl}/tags`, { headers: { Authorization: `Bearer ${account.token}` }, data: { name: 'Câmera de viagem', category: 'Eletrônico' } });
  expect(created.ok()).toBeTruthy();
  const { tag } = await created.json();
  await page.goto(web);
  await page.getByRole('button', { name: 'Encontrei um objeto', exact: true }).click();
  const permissionButton = page.getByRole('button', { name: /Permitir câmera|Abrir configurações/ });
  await permissionButton.click();
  await expect(page.getByText(/Este navegador não disponibiliza a câmera/)).toBeVisible();
  await page.evaluate(() => Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false }));
  await permissionButton.click();
  await expect(page.getByText(/A câmera no navegador precisa de HTTPS/)).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
      getUserMedia: async () => { throw new DOMException('Permission denied', 'NotAllowedError'); },
    } });
  });
  await permissionButton.click();
  await expect(page.getByText(/Câmera não autorizada/)).toBeVisible();
  await page.getByLabel('Link da etiqueta', { exact: true }).fill(`https://unrelated.example/found/${tag.code}`);
  await page.getByRole('button', { name: 'Abrir etiqueta', exact: true }).click();
  await expect(page.getByText(/Este QR não é uma etiqueta desta instalação/)).toBeVisible();
  await page.getByRole('button', { name: 'Encontrei um objeto', exact: true }).click();
  await page.getByLabel('Link da etiqueta', { exact: true }).fill(`${web}/found/${tag.code}`);
  await page.getByRole('button', { name: 'Abrir etiqueta', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Câmera de viagem', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('button', { name: 'Encontrei um objeto', exact: true })).toBeVisible();
  await page.goForward();
  await expect(page.getByLabel('Mensagem para o dono', { exact: true })).toBeVisible();
  await page.getByLabel('Mensagem para o dono', { exact: true }).fill('Está guardada na recepção.');
  await page.getByRole('button', { name: 'Avisar o dono', exact: true }).click();
  await expect(page.getByText('Está guardada na recepção.', { exact: true })).toBeVisible();
  // A completed report must not trap Back between /found and /chat.
  await page.goBack();
  await expect(page.getByRole('button', { name: 'Encontrei um objeto', exact: true })).toBeVisible();
  await page.goForward();
  await expect(page.getByText('Está guardada na recepção.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Página inicial', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Encontrei um objeto', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByText('Está guardada na recepção.', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Está guardada na recepção.', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('finder-navigation-restored.png'), fullPage: true, animations: 'disabled' });
  expect(runtimeErrors).toEqual([]);
});

test('chat URL without its browser capability explains how to contact the owner again', async ({ page }) => {
  await page.goto('/chat/00000000-0000-0000-0000-000000000000');
  await expect(page.getByText(/conversa está disponível no navegador/i)).toBeVisible();
  await expect(page.getByText(/escaneie a etiqueta/i)).toBeVisible();
  await expect(page.getByLabel('Mensagem', { exact: true })).toHaveCount(0);
});

test('finder can open a label through manual entry when camera is unavailable', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Encontrei um objeto', exact: true }).click();
  await expect(page.getByLabel('Link da etiqueta', { exact: true })).toBeVisible();
  await page.getByLabel('Link da etiqueta', { exact: true }).fill('this is not a QR link');
  await page.getByRole('button', { name: 'Abrir etiqueta', exact: true }).click();
  await expect(page.getByText(/não contém um link/i)).toBeVisible();
  await page.getByLabel('Link da etiqueta', { exact: true }).fill('javascript:alert(1)');
  await page.getByRole('button', { name: 'Abrir etiqueta', exact: true }).click();
  await expect(page.getByText(/com um link HTTP ou HTTPS/i)).toBeVisible();
  await page.getByRole('button', { name: 'Fechar leitor', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Encontrei um objeto', exact: true })).toBeVisible();
});
