import { test, expect, type APIRequestContext } from '@playwright/test';
import { apiUrl, web } from './helpers';

async function account(request: APIRequestContext, name: string) {
  const password = crypto.randomUUID(); const email = `session-${crypto.randomUUID()}@example.test`;
  const response = await request.post(`${apiUrl}/auth/register`, { data: { name, email, password } });
  expect(response.status()).toBe(201);
  return { ...await response.json(), password, email };
}

test('a late real 401 from the previous account does not clear the new session', async ({ page, request }) => {
  const first = await account(request, 'Conta anterior'); const next = await account(request, 'Conta atual');
  await page.goto(web);
  await page.evaluate(token => sessionStorage.setItem('seekertag.owner', token), first.token);
  const initialTags = page.waitForResponse(r => r.url() === `${apiUrl}/tags` && r.status() === 200);
  const initialReports = page.waitForResponse(r => r.url() === `${apiUrl}/reports` && r.status() === 200);
  await page.reload();
  await Promise.all([initialTags, initialReports]);
  await expect(page.getByRole('button', { name: 'Minha conta', exact: true })).toBeVisible();
  let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; });
  let retained = 0;
  await page.route(/\/api\/(tags|reports)$/, async route => {
    if (route.request().headers().authorization !== `Bearer ${first.token}`) return route.continue();
    const response = await route.fetch();
    if (response.status() === 200) return route.fulfill({ response });
    expect(response.status()).toBe(401); retained++;
    await wait; await route.fulfill({ response });
  });
  expect((await request.post(`${apiUrl}/auth/logout`, { headers: { Authorization: `Bearer ${first.token}` }, data: {} })).ok()).toBe(true);
  try {
    await expect.poll(() => retained, { timeout: 12_000 }).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Minha conta', exact: true }).click();
    await page.getByRole('button', { name: 'Sair da conta', exact: true }).click();
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await page.getByLabel('E-mail', { exact: true }).fill(next.email);
    await page.getByLabel('Senha', { exact: true }).fill(next.password);
    await page.getByRole('button', { name: 'Entrar na conta', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Minha conta', exact: true })).toBeVisible();
    const session = await page.evaluate(() => sessionStorage.getItem('seekertag.owner'));
    expect(Boolean(session)).toBe(true);
    const delivered = page.waitForResponse(r => r.status() === 401 && /\/api\/(tags|reports)$/.test(r.url()));
    release(); await delivered;
    await page.getByRole('button', { name: 'Minha conta', exact: true }).click();
    await expect(page.getByText(next.email, { exact: true })).toBeVisible();
    expect(await page.evaluate(value => sessionStorage.getItem('seekertag.owner') === value, session)).toBe(true);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Minha conta', exact: true })).toBeVisible();
  } finally { release(); }
});

test('session restoration retries after transport loss without a reload or deleting access', async ({ page, request }) => {
  const owner = await account(request, 'Conta reconectada');
  await page.goto(web); await page.evaluate(token => sessionStorage.setItem('seekertag.owner', token), owner.token);
  await page.route(`${apiUrl}/auth/me`, route => route.abort('failed'));
  await page.reload();
  await expect(page.getByText('Vamos reconectar.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('E-mail', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(token => sessionStorage.getItem('seekertag.owner') === token, owner.token)).toBe(true);
  await page.unroute(`${apiUrl}/auth/me`);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByRole('button', { name: 'Minha conta', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Minha conta', exact: true }).click();
  await expect(page.getByText(owner.email, { exact: true })).toBeVisible();
});

test('lost recovery response can be repaired with the new password and a repeatable replacement code', async ({ page, request }) => {
  const owner = await account(request, 'Conta recuperada'); const nextPassword = crypto.randomUUID();
  await page.goto(web);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.getByRole('button', { name: 'Esqueci minha senha', exact: true }).click();
  await page.getByLabel('E-mail', { exact: true }).fill(owner.email);
  await page.getByLabel('Código de recuperação', { exact: true }).fill(owner.recoveryCode);
  await page.getByLabel('Nova senha', { exact: true }).fill(nextPassword);
  await page.route(`${apiUrl}/auth/recover`, async route => {
    const response = await route.fetch(); expect(response.status()).toBe(200); await route.abort('failed');
  });
  await page.getByRole('button', { name: 'Recuperar conta', exact: true }).click();
  await expect(page.getByText(/tente entrar com a nova senha/i)).toBeVisible();
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.getByLabel('Senha', { exact: true }).fill(nextPassword);
  await page.getByRole('button', { name: 'Entrar na conta', exact: true }).click();
  await page.getByRole('button', { name: 'Minha conta', exact: true }).click();
  await page.getByRole('button', { name: 'Gerar novo código', exact: true }).click();
  await page.getByLabel('Sua senha atual', { exact: true }).fill(nextPassword);
  let firstKey = ''; let firstCode = '';
  await page.route(`${apiUrl}/account/recovery-code`, async route => {
    firstKey = route.request().postDataJSON().operationKey;
    const response = await route.fetch(); expect(response.status()).toBe(200);
    firstCode = (await response.json()).recoveryCode; await route.abort('failed');
  });
  await page.getByRole('dialog', { name: 'Gerar novo código', exact: true }).getByRole('button', { name: 'Gerar novo código', exact: true }).click();
  await expect(page.getByText('Não foi possível conectar. Verifique sua conexão e tente novamente.', { exact: true })).toBeVisible();
  await page.unroute(`${apiUrl}/account/recovery-code`);
  const retried = page.waitForResponse(r => r.url() === `${apiUrl}/account/recovery-code`);
  await page.getByRole('button', { name: 'Recuperar código gerado', exact: true }).click();
  const response = await retried;
  // Compare secrets in memory; failed assertions never print their values.
  expect(response.request().postDataJSON().operationKey === firstKey).toBe(true);
  expect((await response.json()).recoveryCode === firstCode).toBe(true);
  await expect(page.getByRole('button', { name: 'Copiar código', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Já guardei meu código', exact: true }).click();
  const repaired = await request.post(`${apiUrl}/auth/recover`, { data: { email: owner.email, password: crypto.randomUUID(), recoveryCode: firstCode } });
  expect(repaired.status()).toBe(200);
});

test('a superseded recovery operation releases its retry so the owner can generate a usable code', async ({ page, request }) => {
  const owner = await account(request, 'Conta com dois acessos');
  await page.goto(web);
  await page.evaluate(token => sessionStorage.setItem('seekertag.owner', token), owner.token);
  await page.reload();
  await page.getByRole('button', { name: 'Minha conta', exact: true }).click();
  await page.getByRole('button', { name: 'Gerar novo código', exact: true }).click();
  await page.getByLabel('Sua senha atual', { exact: true }).fill(owner.password);
  let firstKey = '';
  await page.route(`${apiUrl}/account/recovery-code`, async route => {
    firstKey = route.request().postDataJSON().operationKey;
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    await route.abort('failed');
  });
  const dialog = page.getByRole('dialog', { name: 'Gerar novo código', exact: true });
  await dialog.getByRole('button', { name: 'Gerar novo código', exact: true }).click();
  await expect(page.getByText('Não foi possível conectar. Verifique sua conexão e tente novamente.', { exact: true })).toBeVisible();
  await page.unroute(`${apiUrl}/account/recovery-code`);

  // A second real login replaces the code while the first browser still has a pending retry.
  const otherLogin = await request.post(`${apiUrl}/auth/login`, { data: { email: owner.email, password: owner.password } });
  expect(otherLogin.status()).toBe(200);
  const otherToken = (await otherLogin.json()).token;
  const secondKey = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
  const superseding = await request.post(`${apiUrl}/account/recovery-code`, {
    headers: { Authorization: `Bearer ${otherToken}` }, data: { password: owner.password, operationKey: secondKey },
  });
  expect(superseding.status()).toBe(200);
  const retried = page.waitForResponse(r => r.url() === `${apiUrl}/account/recovery-code`);
  await dialog.getByRole('button', { name: 'Recuperar código gerado', exact: true }).click();
  const rejected = await retried;
  expect(rejected.status()).toBe(409);
  expect(rejected.request().postDataJSON().operationKey === firstKey).toBe(true);
  expect((await rejected.json()).code).toBe('OPERATION_SUPERSEDED');
  await expect(dialog.getByText('Outro código de recuperação foi gerado para esta conta. Gere um novo código para continuar.', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Recuperar código gerado', exact: true })).toHaveCount(0);

  const generated = page.waitForResponse(r => r.url() === `${apiUrl}/account/recovery-code`);
  await dialog.getByRole('button', { name: 'Gerar novo código', exact: true }).click();
  const fresh = await generated;
  expect(fresh.status()).toBe(200);
  expect(fresh.request().postDataJSON().operationKey !== firstKey).toBe(true);
  expect(fresh.request().postDataJSON().operationKey !== secondKey).toBe(true);
  const usableCode = (await fresh.json()).recoveryCode;
  await expect(page.getByRole('button', { name: 'Copiar código', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Já guardei meu código', exact: true }).click();
  const recovered = await request.post(`${apiUrl}/auth/recover`, { data: { email: owner.email, password: crypto.randomUUID(), recoveryCode: usableCode } });
  expect(recovered.status()).toBe(200);
});
