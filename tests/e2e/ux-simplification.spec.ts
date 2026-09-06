import { test, expect, type Locator } from '@playwright/test';
import { apiUrl, register, web } from './helpers';

async function insideViewport(locator: Locator, height = 664) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(height);
}

test('essential actions and basic creation fit a 390 by 664 viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 664 });
  await page.goto(web);
  for (const name of ['Criar etiqueta', 'Entrar', 'Encontrei um objeto']) {
    await insideViewport(page.getByRole('button', { name, exact: true }));
  }
  await register(page);
  await expect(page.getByRole('button', { name: 'Criar etiqueta', exact: true })).toHaveCount(1);
  await expect(page.getByLabel('Buscar objetos', { exact: true })).toHaveCount(0);
  await insideViewport(page.getByRole('button', { name: 'Criar etiqueta', exact: true }));
  await page.getByRole('button', { name: 'Criar etiqueta', exact: true }).click();
  await page.getByLabel('Nome do objeto', { exact: true }).fill('Caderno de testes');
  await insideViewport(page.getByRole('dialog', { name: 'Criar etiqueta', exact: true }).getByRole('button', { name: 'Criar etiqueta', exact: true }));
  await expect(page.getByLabel('Valor da recompensa (opcional)', { exact: true })).toHaveCount(0);
  const creation = page.waitForResponse(r => new URL(r.url()).pathname === '/api/tags' && r.request().method() === 'POST');
  await page.getByLabel('Nome do objeto', { exact: true }).press('Enter');
  const result = await creation;
  expect(result.status()).toBe(201);
  expect((await result.json()).tag.category).toBe('Outro');
  await expect(page.getByRole('heading', { name: 'Etiqueta criada', exact: true })).toBeVisible();
});

test('collapsed tag options preserve data and preparation is an explicit owner confirmation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 664 });
  await register(page);
  await page.getByRole('button', { name: 'Criar etiqueta', exact: true }).click();
  await page.getByLabel('Nome do objeto', { exact: true }).fill('Estojo de testes');
  await page.getByRole('button', { name: 'Mais opções', exact: true }).click();
  await page.getByLabel('Anotação particular (opcional)', { exact: true }).fill('Anotação que só o dono vê');
  await page.getByLabel('Mensagem na etiqueta', { exact: true }).fill('Podemos combinar por aqui.');
  await page.getByLabel('Valor da recompensa (opcional)', { exact: true }).fill('7,50');
  await page.getByRole('button', { name: 'Menos opções', exact: true }).click();
  await page.getByRole('button', { name: 'Mais opções', exact: true }).click();
  await expect(page.getByLabel('Anotação particular (opcional)', { exact: true })).toHaveValue('Anotação que só o dono vê');
  await expect(page.getByLabel('Mensagem na etiqueta', { exact: true })).toHaveValue('Podemos combinar por aqui.');
  await expect(page.getByLabel('Valor da recompensa (opcional)', { exact: true })).toHaveValue('7,50');
  const creation = page.waitForResponse(r => new URL(r.url()).pathname === '/api/tags' && r.request().method() === 'POST');
  await page.getByRole('dialog', { name: 'Criar etiqueta', exact: true }).getByRole('button', { name: 'Criar etiqueta', exact: true }).click();
  const tag = (await (await creation).json()).tag;
  expect(tag.preparedAt).toBeNull();
  const preparation = page.waitForResponse(r => new URL(r.url()).pathname === `/api/tags/${tag.id}` && r.request().method() === 'PATCH');
  await page.getByRole('button', { name: 'Já prendi e testei a etiqueta', exact: true }).click();
  expect((await (await preparation).json()).tag.preparedAt).toBeTruthy();
  await expect(page.getByRole('button', { name: 'Desfazer confirmação de preparo', exact: true })).toBeVisible();
});

test('a finder returns through the saved conversation index without signing up', async ({ page, request }) => {
  const registration = await request.post(`${apiUrl}/auth/register`, { data: { name: 'Dono de teste', email: `qa-resume-${crypto.randomUUID()}@example.test`, password: crypto.randomUUID() } });
  expect(registration.status()).toBe(201);
  const account = await registration.json();
  const created = await request.post(`${apiUrl}/tags`, { headers: { Authorization: `Bearer ${account.token}` }, data: { name: 'Chaves para devolver', category: 'Chaves', color: '#282039' } });
  expect(created.status()).toBe(201);
  const { tag } = await created.json();
  await page.goto(`${web}/found/${tag.code}`);
  await page.getByLabel('Mensagem para o dono', { exact: true }).fill('As chaves estão na recepção.');
  await page.getByRole('button', { name: 'Avisar o dono', exact: true }).click();
  await expect(page).toHaveURL(/\/chat\/[^/?#]+$/);
  const conversationUrl = page.url();
  await expect(page.getByText('As chaves estão na recepção.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Página inicial', exact: true }).click();
  await page.getByRole('button', { name: 'Minhas conversas', exact: true }).click();
  await page.getByRole('button', { name: 'Abrir conversa sobre Chaves para devolver', exact: true }).click();
  await expect(page).toHaveURL(conversationUrl);
  await expect(page.getByText('As chaves estão na recepção.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => Boolean(sessionStorage.getItem('seekertag.owner')))).toBeFalsy();
});
