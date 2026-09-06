import { test, expect, type Page } from '@playwright/test';
import { apiUrl, web, register, createTag, projectContext } from './helpers';

for (const role of ['owner', 'finder'] as const) {
  test(`${role} keeps an unsent draft offline, retries once online, and retains access after reopening`, async ({ browser, request }, testInfo) => {
    const ownerContext = await browser.newContext(projectContext(testInfo));
    const finderContext = await browser.newContext(projectContext(testInfo));
    const uncaughtErrors: string[] = [];
    for (const context of [ownerContext, finderContext]) {
      context.on('page', page => page.on('pageerror', error => uncaughtErrors.push(error.message)));
    }
    const owner = await ownerContext.newPage();
    let finder = await finderContext.newPage();
    try {
      // Capture only synthetic credentials in memory. No auth storage, HAR, or trace artifacts.
      const registration = owner.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/register' && response.request().method() === 'POST');
      await register(owner);
      const ownerToken: string = (await (await registration).json()).token;
      const item = `Mochila para testar rede (${role})`;
      const tag = await createTag(owner, item);

      await finder.goto(`${web}/found/${tag.code}`);
      await finder.getByRole('button', { name: 'Adicionar meu nome (opcional)', exact: true }).click();
      await finder.getByLabel(/Como podemos te chamar/).fill('Alex');
      const initialMessage = 'Encontrei a mochila na recepção. Podemos combinar a entrega.';
      await finder.getByLabel('Mensagem para o dono', { exact: true }).fill(initialMessage);
      const reportResponse = finder.waitForResponse(response => new URL(response.url()).pathname === `/api/public/tags/${tag.code}/reports` && response.request().method() === 'POST');
      await finder.getByRole('button', { name: 'Avisar o dono', exact: true }).click();
      const report = (await (await reportResponse).json()).report;
      await expect(finder).toHaveURL(new RegExp(`/chat/${report.id}$`));
      const conversationUrl = finder.url();
      await expect(finder.getByText(initialMessage, { exact: true })).toBeVisible();

      await owner.getByRole('button', { name: 'Conversas', exact: true }).click();
      await owner.getByRole('button', { name: `Conversa sobre ${item}`, exact: true }).click();
      await expect(owner.getByText(initialMessage, { exact: true })).toBeVisible();

      const sendingPage = role === 'owner' ? owner : finder;
      const receivingPage = role === 'owner' ? finder : owner;
      const sendingContext = role === 'owner' ? ownerContext : finderContext;
      const messagePath = `/api/${role === 'finder' ? 'finder/' : ''}reports/${report.id}/messages`;
      const draft = role === 'owner'
        ? 'Posso buscar às 18h. Esta mensagem foi preservada durante a queda de rede.'
        : 'Estarei na recepção às 18h. Meu rascunho continuou aqui sem conexão.';
      const messageField = sendingPage.getByLabel('Mensagem', { exact: true });
      await messageField.fill(draft);

      // Disable the browser network itself. The application's API is never mocked.
      await sendingContext.setOffline(true);
      const offlinePost = sendingPage.waitForEvent('requestfailed', {
        predicate: event => new URL(event.url()).pathname === messagePath && event.method() === 'POST',
      });
      await sendingPage.getByRole('button', { name: 'Enviar', exact: true }).click();
      await offlinePost;
      await expect(sendingPage.getByText('Não foi possível conectar. Verifique sua conexão e tente novamente.', { exact: true }).first()).toBeVisible();
      await expect(messageField).toHaveValue(draft);
      await expect(sendingPage.getByRole('button', { name: 'Recuperar envio', exact: true })).toBeEnabled();

      // This independent HTTP client remains online and inspects the real isolated database.
      async function storedCopies() {
        const response = await request.get(`${apiUrl}/reports/${report.id}`, { headers: { Authorization: `Bearer ${ownerToken}` } });
        expect(response.ok()).toBeTruthy();
        const result: { messages: { body: string; role: string }[] } = await response.json();
        return result.messages.filter(message => message.body === draft);
      }
      expect(await storedCopies()).toHaveLength(0);
      await sendingPage.screenshot({ path: testInfo.outputPath(`${role}-draft-offline.png`), fullPage: true, animations: 'disabled' });

      await sendingContext.setOffline(false);
      await expect(messageField).toHaveValue(draft);
      const successfulPost = sendingPage.waitForResponse(response => new URL(response.url()).pathname === messagePath && response.request().method() === 'POST');
      await sendingPage.getByRole('button', { name: 'Recuperar envio', exact: true }).click();
      expect((await successfulPost).status()).toBe(201);
      await expect(messageField).toHaveValue('');
      await expect(receivingPage.getByText(draft, { exact: true })).toBeVisible({ timeout: 20_000 });
      await expect(sendingPage.getByText(draft, { exact: true })).toHaveCount(1);
      const copies = await storedCopies();
      expect(copies).toHaveLength(1);
      expect(copies[0].role).toBe(role);

      if (role === 'owner') {
        // Owner sessions intentionally live in sessionStorage: reload the same tab.
        await owner.reload();
        await expect(owner.getByRole('button', { name: `Abrir ${item}`, exact: true })).toBeVisible();
        await expect(owner.getByLabel('E-mail', { exact: true })).toHaveCount(0);
        await owner.getByRole('button', { name: 'Conversas', exact: true }).click();
        await owner.getByRole('button', { name: `Conversa sobre ${item}`, exact: true }).click();
        await expect(owner.getByText(draft, { exact: true })).toHaveCount(1);
      } else {
        // Finder capabilities persist across tabs in this browser without an account.
        await finder.close();
        finder = await finderContext.newPage();
        await finder.goto(conversationUrl);
        await expect(finder.getByText(initialMessage, { exact: true })).toBeVisible();
        await expect(finder.getByText(draft, { exact: true })).toHaveCount(1);
        await expect(finder.getByLabel('Mensagem', { exact: true })).toBeVisible();
      }
      expect(await storedCopies()).toHaveLength(1);
      const reopenedPage: Page = role === 'owner' ? owner : finder;
      await reopenedPage.screenshot({ path: testInfo.outputPath(`${role}-reconnected-persistent.png`), fullPage: true, animations: 'disabled' });
      expect(uncaughtErrors).toEqual([]);
    } finally {
      await ownerContext.setOffline(false).catch(() => {});
      await finderContext.setOffline(false).catch(() => {});
      await ownerContext.close();
      await finderContext.close();
    }
  });
}
