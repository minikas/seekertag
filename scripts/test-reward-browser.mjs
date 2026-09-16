import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { Transaction } from '@solana/web3.js';
import { getAccount, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { startRewardFixture, signTestMessage } from './reward-test-fixture.mjs';
import { projectRoot } from './reward-localnet.mjs';

const output = join(projectRoot, 'artifacts/rewards/browser');
const webDistPath = join(output, 'web');
mkdirSync(output, { recursive: true });
const fixture = await startRewardFixture({ webDistPath, prepareWeb: ({ origin, env }) => command('npx', ['expo', 'export', '--clear', '--platform', 'web', '--output-dir', webDistPath], {
  ...process.env, EXPO_PUBLIC_API_URL: `${origin}/api`, EXPO_PUBLIC_APP_ORIGIN: origin,
  EXPO_PUBLIC_SKR_CLUSTER: 'localnet', EXPO_PUBLIC_SKR_PROGRAM_ID: env.SKR_PROGRAM_ID, EXPO_PUBLIC_SKR_MINT: env.SKR_MINT,
}) });
let browser;
const errors = []; const networkFailures = []; const timings = [];

function command(cmd, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: projectRoot, env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`)));
  });
}

async function context(wallet, mobile = false) {
  const ctx = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, isMobile: mobile, hasTouch: mobile, colorScheme: 'dark' });
  ctx.on('page', page => {
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('requestfailed', r => { if (!/aborted|canceled|cancelled/i.test(r.failure()?.errorText || '')) networkFailures.push(`${r.method()} ${new URL(r.url()).pathname}: ${r.failure()?.errorText}`); });
    page.on('response', r => { if (new URL(r.url()).pathname.startsWith('/api/') && r.status() >= 400) networkFailures.push(`${r.status()} ${new URL(r.url()).pathname}`); });
    page.on('requestfinished', r => { if (new URL(r.url()).pathname.startsWith('/api/')) timings.push({ method: r.method(), path: new URL(r.url()).pathname, ms: Math.round(r.timing().responseEnd) }); });
  });
  // Only the external wallet is synthetic. The app, HTTP API, database and SBF
  // program are real. Generated keys stay in this Node process, never in the page.
  await ctx.exposeBinding('testWalletSend', async (_, bytes) => {
    const transaction = Transaction.from(Uint8Array.from(bytes));
    assert.equal(transaction.feePayer.toBase58(), wallet.publicKey.toBase58());
    transaction.sign(wallet);
    const signature = await fixture.connection.sendRawTransaction(transaction.serialize());
    const latest = await fixture.connection.getLatestBlockhash();
    const result = await fixture.connection.confirmTransaction({ signature, blockhash: transaction.recentBlockhash, lastValidBlockHeight: latest.lastValidBlockHeight }, 'finalized');
    assert.equal(result.value.err, null);
    return { signature };
  });
  await ctx.exposeBinding('testWalletMessage', async (_, bytes) => Array.from(Buffer.from(signTestMessage(wallet, Uint8Array.from(bytes)), 'base64')));
  await ctx.addInitScript(address => {
    const publicKey = { toString: () => address };
    window.phantom = { solana: {
      publicKey,
      connect: async () => ({ publicKey }), disconnect: async () => {},
      signMessage: async bytes => ({ publicKey, signature: Uint8Array.from(await window.testWalletMessage(Array.from(bytes))) }),
      signAndSendTransaction: async transaction => window.testWalletSend(Array.from(transaction.serialize({ requireAllSignatures: false, verifySignatures: false }))),
    } };
  }, wallet.publicKey.toBase58());
  return ctx;
}

try {
  // A test build pins this ephemeral network, mint and program. No persistent
  // environment file or production distribution is changed.
  browser = await chromium.launch();
  const ownerContext = await context(fixture.ownerWallet);
  const finderContext = await context(fixture.finderWallet, true);
  const owner = await ownerContext.newPage(); const finder = await finderContext.newPage();
  owner.setDefaultTimeout(25_000); finder.setDefaultTimeout(25_000);
  await owner.goto(fixture.origin);
  await owner.getByLabel('Seu nome', { exact: true }).fill('Dono teste SKR');
  await owner.getByLabel('E-mail', { exact: true }).fill('browser-owner@reward-test.invalid');
  await owner.getByLabel(/Senha/).first().fill('ephemeral reward test password');
  await owner.getByRole('button', { name: 'Criar conta', exact: true }).last().click();
  await owner.getByRole('button', { name: 'Já guardei meu código', exact: true }).click();
  await owner.getByRole('button', { name: 'Adicionar objeto', exact: true }).first().click();
  await owner.getByLabel('Nome do objeto', { exact: true }).fill('Mochila com recompensa');
  await owner.getByRole('button', { name: 'Mochila', exact: true }).click();
  const createdResponse = owner.waitForResponse(r => new URL(r.url()).pathname === '/api/tags' && r.request().method() === 'POST');
  await owner.getByRole('button', { name: 'Criar etiqueta', exact: true }).click();
  const { tag } = await (await createdResponse).json();
  await owner.getByRole('button', { name: 'Conectar carteira para recompensa', exact: true }).click();
  await owner.getByLabel(/Valor do depósito/).fill('100.000001');
  await owner.getByRole('button', { name: '7 dias', exact: true }).click();
  await owner.getByRole('button', { name: 'Revisar depósito', exact: true }).click();
  await expect(owner.getByText('Confira antes de assinar', { exact: true })).toBeVisible();
  const unsignedPublic = await fixture.request(`/public/tags/${tag.code}/reward`);
  assert.equal(unsignedPublic.data.reward.status, 'draft');
  await owner.getByRole('button', { name: 'Assinar na carteira', exact: true }).click();
  await expect(owner.getByText('Saldo depositado confirmado', { exact: true })).toBeVisible({ timeout: 45_000 });
  const before = (await fixture.request(`/public/tags/${tag.code}/reward`)).data.reward;
  await owner.getByText('Recompensa com depósito', { exact: true }).locator('..').screenshot({ path: join(output, 'owner-funded.png') });
  await owner.getByRole('button', { name: '+15 dias', exact: true }).click();
  await owner.getByRole('button', { name: 'Revisar renovação', exact: true }).click();
  await expect(owner.getByText(/Não há novo depósito/)).toBeVisible();
  await owner.getByRole('button', { name: 'Assinar na carteira', exact: true }).click();
  await expect(owner.getByText('Saldo e validade confirmados na blockchain. O QR continua o mesmo.', { exact: true })).toBeVisible({ timeout: 45_000 });
  const renewed = (await fixture.request(`/public/tags/${tag.code}/reward`)).data.reward;
  assert.equal(renewed.address, before.address);
  assert.equal(Date.parse(renewed.expiresAt) - Date.parse(before.expiresAt), 15 * 86400_000);
  await expect(owner.getByLabel('Link da etiqueta', { exact: true })).toHaveValue(tag.publicUrl);
  await owner.getByRole('button', { name: 'Fechar', exact: true }).click();

  await finder.goto(tag.publicUrl);
  await expect(finder.getByText('Saldo depositado confirmado', { exact: true })).toBeVisible();
  await finder.getByLabel(/Como podemos te chamar/).fill('Pessoa que encontrou');
  await finder.getByLabel('Mensagem para o dono', { exact: true }).fill('Encontrei a mochila na recepção.');
  await finder.getByRole('button', { name: 'Avisar o dono', exact: true }).click();
  await finder.getByRole('button', { name: 'Conectar carteira para recompensa', exact: true }).click();
  await finder.getByRole('button', { name: 'Comprovar carteira nesta conversa', exact: true }).click();
  await expect(finder.getByText('Carteira comprovada para receber', { exact: true })).toBeVisible();
  assert.equal(await finder.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'finder mobile overflow');
  await finder.screenshot({ path: join(output, 'finder-mobile-verified.png'), fullPage: true });
  await owner.getByRole('button', { name: 'Conversas', exact: true }).click();
  await owner.getByText('Mochila com recompensa', { exact: true }).first().click();
  await owner.getByRole('button', { name: 'Conectar carteira para recompensa', exact: true }).click();
  await expect(owner.getByRole('button', { name: 'Confirmar devolução', exact: true })).toBeDisabled();
  await expect(owner.getByRole('button', { name: 'Recebi o objeto: revisar pagamento', exact: true })).toHaveCount(0);
  async function commit() {
    await owner.getByRole('button', { name: 'Comprometer recompensa', exact: true }).click();
    await expect(owner.getByText(/Você está fixando esta carteira antes da entrega/)).toBeVisible();
    await owner.getByRole('button', { name: 'Assinar na carteira', exact: true }).click();
    await expect(owner.getByRole('button', { name: 'Recebi o objeto: revisar pagamento', exact: true })).toBeVisible({ timeout: 45_000 });
  }
  await commit();
  await owner.getByText('Recompensa com depósito', { exact: true }).locator('..').screenshot({ path: join(output, 'owner-committed.png') });
  const committed = (await fixture.request(`/public/tags/${tag.code}/reward`)).data.reward;
  assert.equal(committed.status, 'committed'); assert.equal(committed.claimSeq, '1');
  await finder.getByRole('button', { name: 'Atualizar confirmação', exact: true }).click();
  await expect(finder.getByRole('button', { name: 'Revisar renúncia sem pagamento', exact: true })).toBeVisible({ timeout: 45_000 });
  assert.equal(await finder.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'committed finder mobile overflow');
  await finder.screenshot({ path: join(output, 'finder-mobile-committed.png'), fullPage: true });
  const funding = await fixture.connection.requestAirdrop(fixture.finderWallet.publicKey, 1_000_000_000);
  await fixture.connection.confirmTransaction({ ...(await fixture.connection.getLatestBlockhash()), signature: funding }, 'finalized');
  await finder.getByRole('button', { name: 'Revisar renúncia sem pagamento', exact: true }).click();
  await expect(finder.getByRole('button', { name: 'Assinar renúncia sem pagamento', exact: true })).toBeDisabled();
  await finder.getByLabel('Digite RENUNCIAR para confirmar', { exact: true }).fill('RENUNCIAR');
  await finder.screenshot({ path: join(output, 'finder-mobile-waiver-review.png'), fullPage: true });
  await finder.getByRole('button', { name: 'Assinar renúncia sem pagamento', exact: true }).click();
  await expect(finder.getByText(/Renúncia confirmada sem pagamento/)).toBeVisible({ timeout: 45_000 });
  const reopened = (await fixture.request(`/public/tags/${tag.code}/reward`)).data.reward;
  assert.equal(reopened.status, 'funded'); assert.equal(reopened.address, committed.address);
  assert.equal(reopened.expiresAt, committed.expiresAt); assert.equal(reopened.claimSeq, '1');
  assert.equal(await fixture.connection.getAccountInfo(getAssociatedTokenAddressSync(fixture.mint, fixture.finderWallet.publicKey)), null, 'waiver does not create recipient token account or pay tokens');
  await owner.getByRole('button', { name: 'Atualizar confirmação', exact: true }).click();
  await commit();
  assert.equal((await fixture.request(`/public/tags/${tag.code}/reward`)).data.reward.claimSeq, '2');
  await owner.getByRole('button', { name: 'Recebi o objeto: revisar pagamento', exact: true }).click();
  await expect(owner.getByText(`Destinatário: ${fixture.finderWallet.publicKey.toBase58()}`, { exact: true })).toBeVisible();
  await owner.getByRole('button', { name: 'Assinar na carteira', exact: true }).click();
  await expect(owner.getByText('Recompensa paga', { exact: true })).toBeVisible({ timeout: 45_000 });
  await expect(owner.getByRole('button', { name: 'Confirmar devolução', exact: true })).toBeEnabled();
  await owner.getByText('Recompensa com depósito', { exact: true }).locator('..').screenshot({ path: join(output, 'owner-paid.png') });
  await owner.getByRole('button', { name: 'Confirmar devolução', exact: true }).click();
  await owner.getByRole('button', { name: 'Sim, recebi meu objeto', exact: true }).click();
  await expect(owner.getByText(/Devolvido|devolução confirmada|conversa encerrada/i).first()).toBeVisible();
  const balance = await getAccount(fixture.connection, getAssociatedTokenAddressSync(fixture.mint, fixture.finderWallet.publicKey));
  assert.equal(balance.amount, 100_000_001n);
  assert.deepEqual(errors, []); assert.deepEqual(networkFailures, []);
  writeFileSync(join(output, 'verification.json'), JSON.stringify({ passed: true, scenario: 'Actual browser + API + SBF localnet; ephemeral external test wallet only', sameQr: true, renewalDays: 15, commitment: true, waiverWithoutPayout: true, recommittedSequence: '2', amountBaseUnits: balance.amount.toString(), consoleErrors: errors, networkFailures, requests: timings }, null, 2));
  console.log('Reward browser flow passed: deposit, same-QR renewal, finder proof, commitment, unpaid waiver, recommitment, exact payout, return, console/network, mobile layout.');
} catch (error) {
  if (browser) for (const [i, ctx] of browser.contexts().entries()) for (const [j, page] of ctx.pages().entries()) {
    await page.screenshot({ path: join(output, `failure-${i}-${j}.png`), fullPage: true }).catch(() => {});
  }
  writeFileSync(join(output, 'failure-health.json'), JSON.stringify({ errors, networkFailures, requests: timings }, null, 2));
  throw error;
} finally {
  await browser?.close();
  await fixture.stop();
}
