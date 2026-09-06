import { test, expect, type APIRequestContext, type Page, type Route } from '@playwright/test';
import { apiUrl, web, projectContext } from './helpers';

async function seed(request: APIRequestContext, withReport = false) {
  const registration = await request.post(`${apiUrl}/auth/register`, { data: { name: 'Dono auditoria', email: `audit-${crypto.randomUUID()}@example.test`, password: crypto.randomUUID() } });
  expect(registration.status()).toBe(201); const account = await registration.json();
  const response = await request.post(`${apiUrl}/tags`, { headers: { Authorization: `Bearer ${account.token}` }, data: { name: 'Mochila auditoria', category: 'Mochila', color: '#242130' } });
  expect(response.status()).toBe(201); const { tag } = await response.json();
  let report: any; let finderToken: string | undefined;
  if (withReport) {
    const found = await request.post(`${apiUrl}/public/tags/${tag.code}/reports`, { data: { finderName: 'Pessoa de teste', message: 'Encontrei sua mochila na recepção.' } });
    expect(found.status()).toBe(201); const result = await found.json(); report = result.report; finderToken = result.token;
  }
  return { account, tag, report, finderToken };
}
async function ownerSession(page: Page, token: string) { await page.addInitScript(value => sessionStorage.setItem('seekertag.owner', value), token); }
async function finderSession(page: Page, id: string, token: string) { await page.addInitScript(({ id, token }) => { const key = `seekertag.finder-${id}`; if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ value: token, expiresAt: Date.now() + 30 * 86400000 })); }, { id, token }); }

// The real server commits the POST. Only delivery of its response is held/lost.
async function holdPost(page: Page, path: string) {
  let release!: (mode: 'deliver' | 'lose') => void;
  let committed!: (value: { data: any; operationKey: string; body: any }) => void;
  const decision = new Promise<'deliver' | 'lose'>(resolve => { release = resolve; });
  const saved = new Promise<{ data: any; operationKey: string; body: any }>(resolve => { committed = resolve; });
  let finished!: () => void; const done = new Promise<void>(resolve => { finished = resolve; });
  const handler = async (route: Route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const body = route.request().postDataJSON();
    const response = await route.fetch(); const data = await response.json();
    expect(response.status()).toBe(201); expect(body.operationKey).toMatch(/^[a-f0-9]{64}$/);
    committed({ data, operationKey: body.operationKey, body });
    try { if (await decision === 'lose') await route.abort('failed'); else await route.fulfill({ response }); } finally { finished(); }
  };
  await page.route(`${apiUrl}${path}`, handler);
  return { saved, release: async (mode: 'deliver' | 'lose') => { release(mode); await done; await page.unroute(`${apiUrl}${path}`, handler); } };
}
async function reportData(request: APIRequestContext, id: string, token: string) {
  const result = await request.get(`${apiUrl}/reports/${id}`, { headers: { Authorization: `Bearer ${token}` } });
  expect(result.ok()).toBeTruthy(); return result.json();
}

test('lost report response survives restart and returns the same report and saved access', async ({ page, request }) => {
  const { account, tag } = await seed(request); const endpoint = `/public/tags/${tag.code}/reports`;
  await page.goto(`${web}/found/${tag.code}`);
  await page.getByLabel('Mensagem para o dono', { exact: true }).fill('Achei a mochila. Esta é a primeira intenção.');
  const held = await holdPost(page, endpoint);
  await page.getByRole('button', { name: 'Avisar o dono', exact: true }).click(); const first = await held.saved;
  expect((await reportData(request, first.data.report.id, account.token)).messages).toHaveLength(1);
  await held.release('lose');
  await expect(page.getByRole('button', { name: 'Recuperar aviso anterior', exact: true })).toBeEnabled();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Recuperar aviso anterior', exact: true })).toBeVisible();
  const retried = page.waitForResponse(r => new URL(r.url()).pathname === `/api${endpoint}` && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Recuperar aviso anterior', exact: true }).click(); const response = await retried;
  expect(response.request().postDataJSON().operationKey).toBe(first.operationKey);
  expect((await response.json()).report.id).toBe(first.data.report.id);
  await expect(page).toHaveURL(new RegExp(`/chat/${first.data.report.id}$`));
  expect((await reportData(request, first.data.report.id, account.token)).messages).toHaveLength(1);
  await page.getByRole('button', { name: 'Página inicial', exact: true }).click();
  await page.getByRole('button', { name: 'Minhas conversas', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Abrir conversa sobre Mochila auditoria', exact: true })).toBeVisible();
});

test('a delayed report response saves access without navigating away from the new screen', async ({ page, request }) => {
  const { tag } = await seed(request);
  await page.goto(`${web}/found/${tag.code}`);
  await page.getByLabel('Mensagem para o dono', { exact: true }).fill('Achei sua mochila.');
  const held = await holdPost(page, `/public/tags/${tag.code}/reports`);
  await page.getByRole('button', { name: 'Avisar o dono', exact: true }).click(); const first = await held.saved;
  await page.getByRole('button', { name: 'Página inicial', exact: true }).click();
  await expect(page).toHaveURL(`${web}/`);
  await held.release('deliver');
  await expect.poll(() => page.evaluate(id => Boolean(localStorage.getItem(`seekertag.finder-${id}`)), first.data.report.id)).toBe(true);
  await expect(page).toHaveURL(`${web}/`);
  await page.getByRole('button', { name: 'Minhas conversas', exact: true }).click();
  await page.getByRole('button', { name: 'Abrir conversa sobre Mochila auditoria', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/chat/${first.data.report.id}$`));
});

for (const role of ['owner', 'finder'] as const) {
  test(`${role} retains a new draft while an earlier message response is delayed`, async ({ page, request }) => {
    const { account, report, finderToken } = await seed(request, true);
    if (role === 'owner') await ownerSession(page, account.token); else await finderSession(page, report.id, finderToken!);
    await page.goto(`${web}/${role === 'owner' ? 'owner-chat' : 'chat'}/${report.id}`);
    const field = page.getByLabel('Mensagem', { exact: true }); await expect(field).toBeEditable();
    await field.fill('Mensagem já enviada.');
    const held = await holdPost(page, `/${role === 'finder' ? 'finder/' : ''}reports/${report.id}/messages`);
    await page.getByRole('button', { name: 'Enviar', exact: true }).click(); await held.saved;
    await field.fill('Este novo rascunho precisa continuar aqui.');
    await held.release('deliver');
    await expect(page.getByRole('button', { name: 'Enviar', exact: true })).toBeEnabled();
    await expect(field).toHaveValue('Este novo rascunho precisa continuar aqui.');
    const saved = await reportData(request, report.id, account.token);
    expect(saved.messages.filter((message: any) => message.body === 'Mensagem já enviada.')).toHaveLength(1);
    expect(saved.messages.filter((message: any) => message.body === 'Este novo rascunho precisa continuar aqui.')).toHaveLength(0);
  });
}

test('a lost message response recovers its original intent after reopening and preserves a different draft', async ({ page, request }) => {
  const { account, report, finderToken } = await seed(request, true);
  await finderSession(page, report.id, finderToken!); await page.goto(`${web}/chat/${report.id}`);
  const field = page.getByLabel('Mensagem', { exact: true }); await expect(field).toBeEditable(); await field.fill('Primeiro envio confirmado no servidor.');
  const endpoint = `/finder/reports/${report.id}/messages`; const held = await holdPost(page, endpoint);
  await page.getByRole('button', { name: 'Enviar', exact: true }).click(); const first = await held.saved;
  await field.fill('Próxima mensagem ainda é rascunho.'); await held.release('lose');
  await expect(page.getByRole('button', { name: 'Recuperar envio', exact: true })).toBeEnabled();
  await page.reload(); await expect(field).toHaveValue('Próxima mensagem ainda é rascunho.');
  const retried = page.waitForResponse(r => new URL(r.url()).pathname === `/api${endpoint}` && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Recuperar envio', exact: true }).click(); const response = await retried;
  expect(response.request().postDataJSON().operationKey).toBe(first.operationKey);
  expect(response.request().postDataJSON().body).toBe('Primeiro envio confirmado no servidor.');
  await expect(field).toHaveValue('Próxima mensagem ainda é rascunho.');
  await expect(page.getByRole('button', { name: 'Enviar', exact: true })).toBeEnabled();
  expect((await reportData(request, report.id, account.token)).messages).toHaveLength(2);
  await page.getByRole('button', { name: 'Enviar', exact: true }).click(); await expect(field).toHaveValue('');
  expect((await reportData(request, report.id, account.token)).messages).toHaveLength(3);
});

test('unseen incoming messages stay unread while reading history; closing an alert is not a return', async ({ page, request }) => {
  const { account, report, finderToken, tag } = await seed(request, true);
  for (let i = 1; i <= 24; i++) {
    const sent = await request.post(`${apiUrl}/finder/reports/${report.id}/messages`, { headers: { Authorization: `Bearer ${finderToken}` }, data: { body: `Trecho histórico ${i}. Vamos combinar a entrega em um lugar público com movimento.` } });
    expect(sent.status()).toBe(201);
  }
  await ownerSession(page, account.token); await page.goto(`${web}/owner-chat/${report.id}`);
  const history = page.getByTestId('conversation-history'); await expect(history).toBeVisible();
  await expect.poll(async () => (await reportData(request, report.id, account.token)).report.unreadCount).toBe(0);
  await history.evaluate(element => { element.scrollTop = 0; element.dispatchEvent(new Event('scroll')); });
  await expect(page.getByText('Encontrei sua mochila na recepção.', { exact: true })).toBeVisible();
  const sent = await request.post(`${apiUrl}/finder/reports/${report.id}/messages`, { headers: { Authorization: `Bearer ${finderToken}` }, data: { body: 'Nova mensagem que ainda está fora da tela.' } }); expect(sent.status()).toBe(201);
  await expect(page.getByRole('button', { name: 'Novas mensagens', exact: true })).toBeVisible({ timeout: 15000 });
  expect((await reportData(request, report.id, account.token)).report.unreadCount).toBe(1);
  expect(await history.evaluate(element => element.scrollTop)).toBeLessThan(50);
  await page.getByRole('button', { name: 'Novas mensagens', exact: true }).click();
  await expect.poll(async () => (await reportData(request, report.id, account.token)).report.unreadCount).toBe(0);
  await page.getByRole('button', { name: 'Encerrar aviso', exact: true }).click();
  await page.getByRole('button', { name: 'Aviso por engano', exact: true }).click();
  await expect(page.getByText('Conversa encerrada: aviso por engano. Isso não registra uma devolução.', { exact: true })).toBeVisible();
  const closed = await reportData(request, report.id, account.token); expect(closed.report.closedReason).toBe('mistake');
  const tags = await request.get(`${apiUrl}/tags`, { headers: { Authorization: `Bearer ${account.token}` } });
  expect((await tags.json()).tags.find((entry: any) => entry.id === tag.id).recoveryCount).toBe(0);
});

test('tag creation replays a persisted request after its committed response is lost', async ({ page, request }) => {
  const { account } = await seed(request); await ownerSession(page, account.token); await page.goto(web);
  await page.getByRole('button', { name: 'Criar etiqueta', exact: true }).first().click();
  await page.getByLabel('Nome do objeto', { exact: true }).fill('Etiqueta com resposta perdida');
  const held = await holdPost(page, '/tags');
  await page.getByRole('dialog', { name: 'Criar etiqueta', exact: true }).getByRole('button', { name: 'Criar etiqueta', exact: true }).click(); const first = await held.saved; await held.release('lose');
  await expect(page.getByRole('button', { name: 'Recuperar criação anterior', exact: true })).toBeEnabled();
  await page.reload(); await page.getByRole('button', { name: 'Criar etiqueta', exact: true }).first().click();
  await expect(page.getByLabel('Nome do objeto', { exact: true })).toHaveValue('Etiqueta com resposta perdida');
  const retried = page.waitForResponse(r => new URL(r.url()).pathname === '/api/tags' && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Recuperar criação anterior', exact: true }).click(); const response = await retried;
  expect(response.request().postDataJSON().operationKey).toBe(first.operationKey); expect((await response.json()).tag.id).toBe(first.data.tag.id);
  const list = await request.get(`${apiUrl}/tags`, { headers: { Authorization: `Bearer ${account.token}` } });
  expect((await list.json()).tags.filter((entry: any) => entry.name === 'Etiqueta com resposta perdida')).toHaveLength(1);
});

test('leaving a pending message keeps its recovery proof until the sender returns', async ({ page, request }) => {
  const { account, report, finderToken } = await seed(request, true);
  await finderSession(page, report.id, finderToken!); await page.goto(`${web}/chat/${report.id}`);
  const field = page.getByLabel('Mensagem', { exact: true }); await expect(field).toBeEditable(); await field.fill('Envio antes de sair da conversa.');
  const held = await holdPost(page, `/finder/reports/${report.id}/messages`);
  await page.getByRole('button', { name: 'Enviar', exact: true }).click(); await held.saved;
  await page.getByRole('button', { name: 'Página inicial', exact: true }).click(); await held.release('deliver');
  await page.getByRole('button', { name: 'Minhas conversas', exact: true }).click();
  await page.getByRole('button', { name: 'Abrir conversa sobre Mochila auditoria', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Recuperar envio', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Recuperar envio', exact: true }).click(); await expect(field).toHaveValue('');
  expect((await reportData(request, report.id, account.token)).messages).toHaveLength(2);
});
