import { test, expect } from '@playwright/test';
import { web, register, createTag, login, logout, projectContext } from './helpers';

test('login, logout and recovery UI retain objects and revoke the previous session', async ({ page, browser }, testInfo) => {
  const runtimeErrors: string[] = [];
  page.on('pageerror', error => runtimeErrors.push(error.message));
  const account = await register(page);
  await createTag(page, 'Carteira azul', 'Outro');
  await logout(page);
  expect(await page.evaluate(() => Boolean(sessionStorage.getItem('seekertag.owner')))).toBeFalsy();

  await login(page, account.email, crypto.randomUUID());
  await expect(page.getByText('E-mail ou senha incorretos.', { exact: true })).toBeVisible();
  await page.getByLabel('Senha', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Entrar na conta', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Abrir Carteira azul', exact: true })).toBeVisible();

  const recoveryContext = await browser.newContext(projectContext(testInfo));
  try {
    const recoveryPage = await recoveryContext.newPage();
    recoveryPage.on('pageerror', error => runtimeErrors.push(error.message));
    await recoveryPage.goto(web);
    await recoveryPage.getByRole('button', { name: 'Entrar', exact: true }).click();
    await recoveryPage.getByRole('button', { name: 'Esqueci minha senha', exact: true }).click();
    await recoveryPage.getByLabel('E-mail', { exact: true }).fill(account.email);
    await recoveryPage.getByLabel('Código de recuperação', { exact: true }).fill(account.recoveryCode);
    const nextPassword = crypto.randomUUID();
    await recoveryPage.getByLabel('Nova senha', { exact: true }).fill(nextPassword);
    await recoveryPage.getByRole('button', { name: 'Recuperar conta', exact: true }).click();
    await recoveryPage.getByRole('button', { name: 'Já guardei meu código', exact: true }).click();
    await expect(recoveryPage.getByRole('button', { name: 'Abrir Carteira azul', exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Seu nome', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Abrir Carteira azul', exact: true })).toHaveCount(0);
    await logout(recoveryPage);
    await login(recoveryPage, account.email, nextPassword);
    await expect(recoveryPage.getByRole('button', { name: 'Abrir Carteira azul', exact: true })).toBeVisible();
    await recoveryPage.screenshot({ path: testInfo.outputPath('account-recovered.png'), fullPage: true, animations: 'disabled' });
  } finally {
    await recoveryContext.close();
  }
  expect(runtimeErrors).toEqual([]);
});

test('invalid account and tag fields explain errors and preserve a usable form', async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on('pageerror', error => runtimeErrors.push(error.message));
  await page.goto(web);
  await page.getByRole('button', { name: 'Criar conta', exact: true }).click();
  await expect(page.getByText('Preencha os campos para continuar.', { exact: true })).toBeVisible();
  await page.getByLabel('Seu nome', { exact: true }).fill('Pessoa de teste');
  await page.getByLabel('E-mail', { exact: true }).fill('not-an-email');
  await page.getByLabel('Senha', { exact: true }).fill(crypto.randomUUID());
  await page.getByRole('button', { name: 'Criar conta', exact: true }).click();
  await expect(page.getByText('Informe um e-mail válido.', { exact: true })).toBeVisible();
  await page.getByLabel('E-mail', { exact: true }).fill(`qa-fields-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Senha', { exact: true }).fill('short');
  await page.getByRole('button', { name: 'Criar conta', exact: true }).click();
  await expect(page.getByText('Escolha uma senha com pelo menos 10 caracteres.', { exact: true })).toBeVisible();
  await page.getByLabel('Senha', { exact: true }).fill(crypto.randomUUID());
  await page.getByRole('button', { name: 'Criar conta', exact: true }).click();
  await page.getByRole('button', { name: 'Já guardei meu código', exact: true }).click();
  await page.getByRole('button', { name: 'Criar etiqueta', exact: true }).click();
  await page.getByRole('dialog', { name: 'Criar etiqueta', exact: true }).getByRole('button', { name: 'Criar etiqueta', exact: true }).click();
  await expect(page.getByText('Dê um nome ao objeto.', { exact: true })).toBeVisible();
  await page.getByLabel('Nome do objeto', { exact: true }).fill('Guarda-chuva');
  await page.getByRole('button', { name: 'Mais opções', exact: true }).click();
  await page.getByLabel('Valor da recompensa (opcional)', { exact: true }).fill('-1');
  await page.getByRole('dialog', { name: 'Criar etiqueta', exact: true }).getByRole('button', { name: 'Criar etiqueta', exact: true }).click();
  await expect(page.getByText('Informe uma recompensa entre 0 e 100.000.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Nome do objeto', { exact: true })).toHaveValue('Guarda-chuva');
  await page.getByLabel('Valor da recompensa (opcional)', { exact: true }).fill('12,50');
  await page.getByRole('dialog', { name: 'Criar etiqueta', exact: true }).getByRole('button', { name: 'Criar etiqueta', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Baixar etiquetas em PDF', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Mais opções', exact: true }).click();
  await expect(page.getByText(/12,5 BRL de recompensa oferecida/)).toBeVisible();
  expect(runtimeErrors).toEqual([]);
});
