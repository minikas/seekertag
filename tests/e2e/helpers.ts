import { expect, type Page, type BrowserContext, type BrowserContextOptions, type TestInfo } from '@playwright/test';

export const web = process.env.WEB_URL || 'http://127.0.0.1:4329';
export const apiUrl = process.env.API_URL || `${web}/api`;

export function monitor(context: BrowserContext) {
  const errors: string[] = [];
  const failedRequests: string[] = [];
  context.on('page', page => {
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('requestfailed', request => {
      // Reloads legitimately cancel in-flight requests. Do not include headers or bodies.
      if (!/ERR_ABORTED|cancelled|canceled|aborted/i.test(request.failure()?.errorText || '')) {
        failedRequests.push(`${request.method()} ${new URL(request.url()).pathname}: ${request.failure()?.errorText}`);
      }
    });
    page.on('response', response => {
      if (response.url().includes('/api/') && response.status() >= 400) {
        failedRequests.push(`${response.status()} ${new URL(response.url()).pathname}`);
      }
    });
  });
  return { errors, failedRequests };
}

export async function register(page: Page) {
  const email = `qa-ui-${crypto.randomUUID()}@example.test`;
  const password = crypto.randomUUID();
  await page.goto(web);
  await expect(page.getByLabel('Seu nome', { exact: true })).toBeVisible();
  await page.getByLabel('Seu nome', { exact: true }).fill('Marina QA');
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel(/Senha/).first().fill(password);
  const registration = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/register' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Criar conta', exact: true }).last().click();
  const account = await (await registration).json();
  await page.getByRole('button', { name: 'Já guardei meu código', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Criar etiqueta', exact: true }).first()).toBeVisible();
  return { email, password, recoveryCode: account.recoveryCode as string };
}

export async function createTag(page: Page, name: string, category = 'Mochila') {
  await page.getByRole('button', { name: 'Criar etiqueta', exact: true }).first().click();
  await page.getByLabel('Nome do objeto', { exact: true }).fill(name);
  await page.getByRole('button', { name: category, exact: true }).click();
  const response = page.waitForResponse(response => new URL(response.url()).pathname === '/api/tags' && response.request().method() === 'POST');
  await page.getByRole('dialog', { name: 'Criar etiqueta', exact: true }).getByRole('button', { name: 'Criar etiqueta', exact: true }).click();
  const saved = await response;
  expect(saved.ok()).toBeTruthy();
  const tag = (await saved.json()).tag;
  await expect(page.getByRole('button', { name: 'Baixar etiquetas em PDF', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Fechar', exact: true }).click();
  return tag;
}

export function projectContext(testInfo: TestInfo): BrowserContextOptions {
  const options = testInfo.project.use;
  return {
    viewport: options.viewport,
    isMobile: options.isMobile,
    hasTouch: options.hasTouch,
    deviceScaleFactor: options.deviceScaleFactor,
    userAgent: options.userAgent,
    colorScheme: 'dark',
  };
}

export async function login(page: Page, email: string, password: string) {
  await page.goto(web);
  await expect(page.getByLabel('E-mail', { exact: true })).toBeVisible();
  if (await page.getByLabel('Seu nome', { exact: true }).isVisible()) {
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  }
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar na conta', exact: true }).click();
}

export async function logout(page: Page) {
  await page.getByRole('button', { name: 'Minha conta', exact: true }).click();
  await page.getByRole('button', { name: 'Sair da conta', exact: true }).click();
  await expect(page.getByLabel('Seu nome', { exact: true })).toBeVisible();
}
