import { test, expect } from '@playwright/test';
import { apiUrl, web } from './helpers';

test('a saved finder capability still opens when updating only the local conversation index fails', async ({ page, request }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const registration = await request.post(`${apiUrl}/auth/register`, { data: { name: 'Dono do acesso', email: `access-${crypto.randomUUID()}@example.test`, password: crypto.randomUUID() } });
  expect(registration.status()).toBe(201); const owner = await registration.json();
  const created = await request.post(`${apiUrl}/tags`, { headers: { Authorization: `Bearer ${owner.token}` }, data: { name: 'Chaves com acesso salvo' } });
  expect(created.status()).toBe(201); const { tag } = await created.json();
  const found = await request.post(`${apiUrl}/public/tags/${tag.code}/reports`, { data: { message: 'Encontrei as chaves na portaria.' } });
  expect(found.status()).toBe(201); const finder = await found.json();
  await page.addInitScript(({ id, code, token }) => {
    const save = Storage.prototype.setItem;
    const envelope = (value: string) => JSON.stringify({ value, expiresAt: Date.now() + 30 * 86400000 });
    save.call(localStorage, `seekertag.finder-${id}`, envelope(token));
    save.call(localStorage, `seekertag.tag-chat-${code}`, envelope(id));
    Storage.prototype.setItem = function(key, value) {
      if (key === 'seekertag.saved-conversations-v1') throw new DOMException('Test quota reached', 'QuotaExceededError');
      return save.call(this, key, value);
    };
  }, { id: finder.report.id, code: tag.code, token: finder.token });
  await page.goto(`${web}/found/${tag.code}`);
  await expect(page).toHaveURL(new RegExp(`/chat/${finder.report.id}$`));
  await expect(page.getByText('Encontrei as chaves na portaria.', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Mensagem', { exact: true })).toBeEditable();
  await expect(page.getByText('Encontrei as chaves na portaria.', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
