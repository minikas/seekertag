import { test, expect } from '@playwright/test';

test('invalid public label has a clear recovery path and does not demand registration', async ({ page }) => {
  await page.goto('/found/invalid-qa-label');
  await expect(page.getByText(/etiqueta não foi encontrada/i)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Página inicial', exact: true })).toBeVisible();
  await expect(page.getByLabel('Mensagem para o dono', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('E-mail', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Página inicial', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Encontrei um objeto', exact: true })).toBeVisible();
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
