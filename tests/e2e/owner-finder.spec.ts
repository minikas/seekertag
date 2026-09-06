import { test, expect, type Page, type BrowserContext } from '@playwright/test';

const web = process.env.WEB_URL || 'http://localhost:8081';

function monitor(context: BrowserContext) {
  const errors: string[] = [];
  const failedRequests: string[] = [];
  context.on('page', page => {
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('requestfailed', request => {
      // Reloads legitimately cancel in-flight requests. Do not include headers or bodies.
      if (request.failure()?.errorText !== 'net::ERR_ABORTED') {
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

async function register(page: Page) {
  const email = `qa-ui-${crypto.randomUUID()}@example.test`;
  const password = crypto.randomUUID();
  await page.goto(web);
  if (!(await page.getByLabel('Seu nome', { exact: true }).isVisible())) {
    await page.getByRole('button', { name: 'Criar conta', exact: true }).click();
  }
  await page.getByLabel('Seu nome', { exact: true }).fill('Marina QA');
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel(/Senha/).first().fill(password);
  await page.getByRole('button', { name: 'Criar conta', exact: true }).last().click();
  await page.getByRole('button', { name: 'Já guardei meu código', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Adicionar objeto', exact: true }).first()).toBeVisible();
  return { email, password };
}

async function createTag(page: Page, name: string, category = 'Mochila') {
  await page.getByRole('button', { name: 'Adicionar objeto', exact: true }).first().click();
  await page.getByLabel('Nome do objeto', { exact: true }).fill(name);
  await page.getByRole('button', { name: category, exact: true }).click();
  const response = page.waitForResponse(response => new URL(response.url()).pathname === '/api/tags' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Criar etiqueta', exact: true }).click();
  const saved = await response;
  expect(saved.ok()).toBeTruthy();
  const tag = (await saved.json()).tag;
  await page.getByRole('button', { name: 'Fechar', exact: true }).click();
  return tag;
}

test('owner creates printable tag; anonymous finder and owner coordinate and confirm return', async ({ browser }, testInfo) => {
  const ownerContext = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const finderContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const ownerHealth = monitor(ownerContext);
  const finderHealth = monitor(finderContext);
  const owner = await ownerContext.newPage();
  let finder = await finderContext.newPage();
  try {
    const account = await register(owner);
    const item = 'Mochila de viagem';
    const tag = await createTag(owner, item);
    await owner.screenshot({ path: testInfo.outputPath('owner-tag-created.png'), fullPage: true, animations: 'disabled' });
    await owner.getByRole('button', { name: `Abrir ${item}`, exact: true }).click();
    const downloadEvent = owner.waitForEvent('download');
    await owner.getByRole('button', { name: 'Baixar etiquetas em PDF', exact: true }).click();
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
    await download.saveAs(testInfo.outputPath('printed-label.pdf'));
    await owner.getByRole('button', { name: 'Marcar como perdido', exact: true }).click();
    await expect(owner.getByText('Perdido', { exact: true }).first()).toBeVisible();
    await owner.getByRole('button', { name: 'Fechar', exact: true }).click();

    // A genuinely separate browser context has no owner login or local data.
    await finder.goto(`${web}/found/${tag.code}`);
    await expect(finder.getByText(item, { exact: true }).first()).toBeVisible();
    await expect(finder.getByText(account.email, { exact: true })).toHaveCount(0);
    await finder.getByLabel(/Como podemos te chamar/).fill('Ana');
    await finder.getByLabel('Mensagem para o dono', { exact: true }).fill('Encontrei sua mochila na recepção do café.');
    await finder.getByRole('button', { name: 'Avisar o dono', exact: true }).click();
    await expect(finder.getByText('Encontrei sua mochila na recepção do café.', { exact: true })).toBeVisible();
    await expect(finder).toHaveURL(/\/chat\/[^/?#]+$/);
    const privateConversationUrl = finder.url();
    expect(new URL(privateConversationUrl).search).toBe('');
    await finder.reload();
    await expect(finder.getByText('Encontrei sua mochila na recepção do café.', { exact: true })).toBeVisible();
    await finder.close();
    finder = await finderContext.newPage();
    await finder.goto(privateConversationUrl);
    await expect(finder.getByText('Encontrei sua mochila na recepção do café.', { exact: true })).toBeVisible();
    await finder.screenshot({ path: testInfo.outputPath('finder-mobile-conversation.png'), fullPage: true, animations: 'disabled' });

    await owner.getByRole('button', { name: 'Conversas', exact: true }).click();
    await owner.getByText(item, { exact: true }).first().click();
    await expect(owner.getByText('Encontrei sua mochila na recepção do café.', { exact: true })).toBeVisible();
    await owner.getByLabel('Mensagem', { exact: true }).fill('Obrigada, Ana! Posso passar às 18h?');
    await owner.getByRole('button', { name: 'Enviar', exact: true }).click();
    await expect(finder.getByText('Obrigada, Ana! Posso passar às 18h?', { exact: true })).toBeVisible({ timeout: 20_000 });
    await finder.getByLabel('Mensagem', { exact: true }).fill('Sim, deixei com a equipe da recepção.');
    await finder.getByRole('button', { name: 'Enviar', exact: true }).click();
    await expect(owner.getByText('Sim, deixei com a equipe da recepção.', { exact: true })).toBeVisible({ timeout: 20_000 });
    await owner.screenshot({ path: testInfo.outputPath('owner-two-way-relay.png'), fullPage: true, animations: 'disabled' });

    await owner.getByRole('button', { name: 'Confirmar devolução', exact: true }).click();
    await owner.getByRole('button', { name: 'Sim, recebi meu objeto', exact: true }).click();
    await expect(owner.getByText(/Devolvido|devolução confirmada|conversa encerrada/i).first()).toBeVisible();
    await finder.reload();
    await expect(finder.getByText(/Devolvido|devolução confirmada|conversa encerrada/i).first()).toBeVisible();

    // A future recovery of the same item must allow a fresh report in this tab.
    await finder.goto(`${web}/found/${tag.code}`);
    await expect(finder.getByLabel('Mensagem para o dono', { exact: true })).toBeVisible();

    // A leaked chat ID alone must never reveal the private conversation.
    const outsider = await browser.newContext();
    const outsiderPage = await outsider.newPage();
    await outsiderPage.goto(privateConversationUrl);
    await expect(outsiderPage.getByText('Encontrei sua mochila na recepção do café.', { exact: true })).toHaveCount(0);
    await outsider.close();
    expect(ownerHealth.errors).toEqual([]);
    expect(finderHealth.errors).toEqual([]);
    expect(ownerHealth.failedRequests).toEqual([]);
    expect(finderHealth.failedRequests).toEqual([]);
  } finally {
    await ownerContext.close();
    await finderContext.close();
  }
});

test('small mobile viewport keeps core actions visible and registration persistent', async ({ browser }, testInfo) => {
  const context = await browser.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
  const health = monitor(context);
  const page = await context.newPage();
  try {
    await register(page);
    await createTag(page, 'Chaves de casa', 'Chaves');
    await page.reload();
    await expect(page.getByText('Chaves de casa', { exact: true }).first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(overflow, 'mobile page must not require horizontal scrolling').toBeFalsy();
    await page.screenshot({ path: testInfo.outputPath('owner-mobile-360.png'), fullPage: true, animations: 'disabled' });
    await page.getByRole('button', { name: 'Abrir Chaves de casa', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Baixar etiquetas em PDF', exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('owner-mobile-360-details.png'), fullPage: true, animations: 'disabled' });
    const modalOverflow = await page.evaluate(() => {
      const screens = [...document.querySelectorAll('[role="dialog"]')];
      return screens.some(element => element.scrollWidth > element.clientWidth + 1);
    });
    expect(modalOverflow, 'mobile details must not overflow the sheet').toBeFalsy();
    expect(health.errors).toEqual([]);
    expect(health.failedRequests).toEqual([]);
  } finally {
    await context.close();
  }
});

test('tag management supports search, filters, editing, pause, resume and transfer through the UI', async ({ browser, request }, testInfo) => {
  const ownerContext = await browser.newContext({ viewport: { width: 1366, height: 960 } });
  const publicContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const health = monitor(ownerContext);
  const owner = await ownerContext.newPage();
  const publicPage = await publicContext.newPage();
  try {
    const account = await register(owner);
    await createTag(owner, 'Chaves do escritório', 'Chaves');
    const tag = await createTag(owner, 'Mala azul', 'Mala');
    await owner.getByLabel('Buscar objetos', { exact: true }).fill('MALA');
    await expect(owner.getByRole('button', { name: 'Abrir Mala azul', exact: true })).toBeVisible();
    await expect(owner.getByRole('button', { name: 'Abrir Chaves do escritório', exact: true })).toHaveCount(0);
    await owner.getByLabel('Buscar objetos', { exact: true }).fill('');
    await owner.getByRole('button', { name: 'Perdidos', exact: true }).click();
    await expect(owner.getByText('Nenhum objeto por aqui.', { exact: true })).toBeVisible();
    await owner.getByRole('button', { name: 'Todos', exact: true }).click();
    await owner.getByRole('button', { name: 'Abrir Mala azul', exact: true }).click();
    await owner.getByRole('button', { name: 'Editar objeto', exact: true }).click();
    await owner.getByLabel('Nome do objeto', { exact: true }).fill('Mala azul de viagem');
    await owner.getByLabel('Anotação particular (opcional)', { exact: true }).fill('Detalhe particular: zíper lateral');
    await owner.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
    await expect(owner.getByText('Detalhe particular: zíper lateral', { exact: true })).toBeVisible();
    await owner.getByRole('button', { name: 'Pausar etiqueta', exact: true }).click();
    await expect(owner.getByRole('button', { name: 'Reativar etiqueta', exact: true })).toBeVisible();
    await publicPage.goto(`${web}/found/${tag.code}`);
    await expect(publicPage.getByText(/etiqueta está pausada pelo dono/i)).toBeVisible();
    await expect(publicPage.getByLabel('Mensagem para o dono', { exact: true })).toHaveCount(0);
    await owner.getByRole('button', { name: 'Fechar', exact: true }).click();
    await owner.getByRole('button', { name: 'Pausados', exact: true }).click();
    await expect(owner.getByRole('button', { name: 'Abrir Mala azul de viagem', exact: true })).toBeVisible();
    await expect(owner.getByRole('button', { name: 'Abrir Chaves do escritório', exact: true })).toHaveCount(0);
    await owner.getByRole('button', { name: 'Abrir Mala azul de viagem', exact: true }).click();
    await owner.getByRole('button', { name: 'Reativar etiqueta', exact: true }).click();
    await publicPage.reload();
    await expect(publicPage.getByLabel('Mensagem para o dono', { exact: true })).toBeVisible();
    await expect(publicPage.getByText('Detalhe particular: zíper lateral', { exact: true })).toHaveCount(0);

    const recipientEmail = `qa-recipient-${crypto.randomUUID()}@example.test`;
    const recipientPassword = crypto.randomUUID();
    const recipientResponse = await request.post(`${process.env.API_URL || 'http://localhost:4318/api'}/auth/register`, { data: { name: 'Rafa', email: recipientEmail, password: recipientPassword } });
    expect(recipientResponse.ok()).toBeTruthy();
    await owner.getByRole('button', { name: 'Transferir etiqueta para outra pessoa', exact: true }).click();
    await owner.getByLabel('E-mail de quem vai receber', { exact: true }).fill(recipientEmail);
    await owner.getByLabel('Sua senha atual', { exact: true }).fill(account.password);
    await owner.getByRole('button', { name: 'Confirmar transferência', exact: true }).click();
    await expect(owner.getByRole('button', { name: 'Fechar', exact: true })).toHaveCount(0);
    await owner.getByRole('button', { name: 'Todos', exact: true }).click();
    await expect(owner.getByRole('button', { name: 'Abrir Mala azul de viagem', exact: true })).toHaveCount(0);
    await owner.reload();
    await expect(owner.getByRole('button', { name: 'Abrir Chaves do escritório', exact: true })).toBeVisible();
    await expect(owner.getByRole('button', { name: 'Abrir Mala azul de viagem', exact: true })).toHaveCount(0);

    const recipient = await publicContext.newPage();
    await recipient.goto(web);
    await recipient.getByRole('button', { name: 'Entrar', exact: true }).click();
    await recipient.getByLabel('E-mail', { exact: true }).fill(recipientEmail);
    await recipient.getByLabel('Senha', { exact: true }).fill(recipientPassword);
    await recipient.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(recipient.getByRole('button', { name: 'Abrir Mala azul de viagem', exact: true })).toBeVisible();
    await recipient.screenshot({ path: testInfo.outputPath('transferred-item-recipient.png'), fullPage: true, animations: 'disabled' });
    expect(health.errors).toEqual([]);
    expect(health.failedRequests).toEqual([]);
  } finally {
    await ownerContext.close();
    await publicContext.close();
  }
});
