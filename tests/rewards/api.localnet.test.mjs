import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getAccount, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { startRewardFixture, signTestMessage } from '../../scripts/reward-test-fixture.mjs';

test('real API + compiled escrow: fund, renew same QR, prove finder, commit, waive, recommit, pay once, resolve', { timeout: 240_000 }, async t => {
  const h = await startRewardFixture(); t.after(h.stop);
  const register = async email => {
    const result = await h.request('/auth/register', { method: 'POST', body: { name: 'Local reward test', email, password: 'local testing password only' } });
    assert.equal(result.status, 201); return result.data;
  };
  const owner = await register('owner@reward-test.invalid');
  const stranger = await register('stranger@reward-test.invalid');
  const made = await h.request('/tags', { method: 'POST', token: owner.token, body: { name: 'Mochila teste SKR', category: 'Mochila', color: '#C4A1FF', rewardAmount: 0, rewardCurrency: 'SKR' } });
  assert.equal(made.status, 201); const tag = made.data.tag;
  const config = await h.request('/rewards/config');
  assert.equal(config.data.enabled, true); assert.equal(config.data.cluster, 'localnet');
  assert.match(config.data.assetLabel, /test/i);
  assert.equal('rpcUrl' in config.data, false);
  const wallet = h.ownerWallet.publicKey.toBase58();
  const path = `/tags/${tag.id}/reward`;
  assert.equal((await h.request(`${path}/prepare`, { method: 'POST', token: stranger.token, body: { wallet, amount: '100', days: 7 } })).status, 404);
  const prepared = await h.request(`${path}/prepare`, { method: 'POST', token: owner.token, body: { wallet, amount: '100.000001', days: 7 } });
  assert.equal(prepared.status, 200, JSON.stringify(prepared.data));
  assert.equal(prepared.data.reward.status, 'draft');
  const retried = await h.request(`${path}/prepare`, { method: 'POST', token: owner.token, body: { wallet, amount: '100.000001', days: 7 } });
  assert.equal(retried.data.transaction, prepared.data.transaction, 'retry must return the same pending intent');
  assert.equal((await h.request(`${path}/cancel`, { method: 'POST', token: owner.token, body: { wallet } })).status, 409);
  assert.equal((await h.request(`/tags/${tag.id}`, { method: 'PATCH', token: owner.token, body: { rewardAmount: 1 } })).status, 409);
  assert.equal((await h.request(`/tags/${tag.id}/transfer`, { method: 'POST', token: owner.token, body: { email: stranger.user.email, password: 'local testing password only' } })).status, 409);

  const depositSignature = await h.submit(prepared.data);
  const synced = await h.request(`${path}/sync`, { method: 'POST', token: owner.token, body: { signature: depositSignature } });
  assert.equal(synced.status, 200, JSON.stringify(synced.data));
  assert.equal(synced.data.reward.status, 'funded');
  assert.equal(synced.data.reward.amount, '100.000001');
  const address = synced.data.reward.address;
  const publicReward = await h.request(`/public/tags/${tag.code}/reward`);
  assert.equal(publicReward.data.reward.status, 'funded');
  assert.ok(!JSON.stringify(publicReward.data).includes('owner@reward-test.invalid'));

  const renewed = await h.request(`${path}/renew`, { method: 'POST', token: owner.token, body: { wallet, days: 15 } });
  assert.equal(renewed.status, 200, JSON.stringify(renewed.data));
  const renewedSignature = await h.submit(renewed.data);
  const afterRenew = await h.request(`${path}/sync`, { method: 'POST', token: owner.token, body: { signature: renewedSignature } });
  assert.equal(afterRenew.data.reward.address, address);
  assert.equal(Date.parse(afterRenew.data.reward.expiresAt) - Date.parse(synced.data.reward.expiresAt), 15 * 86400_000);
  assert.equal((await h.request(`/tags/${tag.id}`, { token: owner.token })).data.tag.publicUrl, tag.publicUrl);
  assert.equal((await h.request(`${path}/refund`, { method: 'POST', token: owner.token, body: { wallet } })).status, 409);

  async function report(name) {
    const result = await h.request(`/public/tags/${tag.code}/reports`, { method: 'POST', body: { finderName: name, message: 'Encontrei sua mochila.' } });
    assert.equal(result.status, 201); return result.data;
  }
  const finder = await report('Finder'); const other = await report('Other');
  const finderWallet = h.finderWallet.publicKey.toBase58();
  const finderPath = `/finder/reports/${finder.report.id}/reward`;
  const ownerPath = `/reports/${finder.report.id}/reward`;
  const challenge = await h.request(`${finderPath}/wallet/challenge`, { method: 'POST', token: finder.token, body: { wallet: finderWallet } });
  assert.equal(challenge.status, 200, JSON.stringify(challenge.data));
  const proof = { wallet: finderWallet, nonce: challenge.data.nonce, signature: signTestMessage(h.finderWallet, challenge.data.message) };
  assert.equal((await h.request(`/finder/reports/${other.report.id}/reward/wallet/verify`, { method: 'POST', token: other.token, body: proof })).status, 400);
  assert.equal((await h.request(`${finderPath}/wallet/verify`, { method: 'POST', token: finder.token, body: proof })).status, 200);
  assert.equal((await h.request(`${finderPath}/wallet/verify`, { method: 'POST', token: finder.token, body: proof })).status, 400);
  assert.equal((await h.request(`/reports/${finder.report.id}/resolve`, { method: 'POST', token: owner.token, body: {} })).status, 409);
  assert.equal((await h.request(`${ownerPath}/release`, { method: 'POST', token: owner.token, body: { wallet } })).data.code, 'REWARD_COMMITMENT_REQUIRED');
  async function commit() {
    const prepared = await h.request(`${ownerPath}/commit`, { method: 'POST', token: owner.token, body: { wallet } });
    assert.equal(prepared.status, 200, JSON.stringify(prepared.data));
    const signature = await h.submit(prepared.data);
    const result = await h.request(`${ownerPath}/sync`, { method: 'POST', token: owner.token, body: { signature } });
    assert.equal(result.data.reward.status, 'committed', JSON.stringify(result.data));
    assert.equal(result.data.commitmentMatchesReport, true);
    return result.data.reward;
  }
  const committed = await commit(); assert.equal(committed.claimSeq, '1');
  assert.equal((await h.request(`/reports/${other.report.id}/reward`, { token: owner.token })).data.commitmentMatchesReport, false);
  for (const action of ['refund', 'renew']) assert.equal((await h.request(`${path}/${action}`, { method: 'POST', token: owner.token, body: { wallet, days: 7 } })).status, 409);
  assert.equal((await h.request(`${finderPath}/wallet/challenge`, { method: 'POST', token: finder.token, body: { wallet: finderWallet } })).status, 409);
  assert.equal((await h.request(`/finder/reports/${other.report.id}/reward/waive`, { method: 'POST', token: other.token, body: { wallet: finderWallet } })).status, 403);
  const pendingRelease = await h.request(`${ownerPath}/release`, { method: 'POST', token: owner.token, body: { wallet } });
  assert.equal(pendingRelease.status, 200);
  const waived = await h.request(`${finderPath}/waive`, { method: 'POST', token: finder.token, body: { wallet: finderWallet } });
  assert.equal(waived.status, 200, JSON.stringify(waived.data));
  assert.equal(waived.data.wallet, finderWallet);
  // Pay only the local test transaction fee; no token transfer is involved.
  const sol = await h.connection.requestAirdrop(h.finderWallet.publicKey, 1_000_000_000);
  await h.connection.confirmTransaction({ ...(await h.connection.getLatestBlockhash()), signature: sol }, 'finalized');
  const waiverSignature = await h.submit(waived.data, h.finderWallet);
  const reopened = await h.request(`${finderPath}/sync`, { method: 'POST', token: finder.token, body: { signature: waiverSignature } });
  assert.equal(reopened.data.reward.status, 'funded', JSON.stringify(reopened.data));
  assert.equal(reopened.data.reward.expiresAt, committed.expiresAt);
  assert.equal(reopened.data.reward.address, address);
  assert.equal(reopened.data.reward.recipientWallet, undefined);
  const recommitted = await commit(); assert.equal(recommitted.claimSeq, '2');
  const release = await h.request(`${ownerPath}/release`, { method: 'POST', token: owner.token, body: { wallet } });
  assert.equal(release.status, 200, JSON.stringify(release.data));
  const payoutSignature = await h.submit(release.data);
  const paid = await h.request(`${ownerPath}/sync`, { method: 'POST', token: owner.token, body: { signature: payoutSignature } });
  assert.equal(paid.data.reward.status, 'paid', JSON.stringify(paid.data));
  assert.equal(paid.data.reward.recipientWallet, finderWallet);
  const recipientToken = getAssociatedTokenAddressSync(h.mint, h.finderWallet.publicKey);
  assert.equal((await getAccount(h.connection, recipientToken)).amount, 100_000_001n);
  assert.equal((await h.request(`${ownerPath}/release`, { method: 'POST', token: owner.token, body: { wallet } })).status, 409);
  assert.equal((await h.request(`/reports/${other.report.id}/resolve`, { method: 'POST', token: owner.token, body: {} })).status, 409);
  const resolved = await h.request(`/reports/${finder.report.id}/resolve`, { method: 'POST', token: owner.token, body: {} });
  assert.equal(resolved.status, 200, JSON.stringify(resolved.data));
  assert.equal(resolved.data.report.status, 'resolved');
  assert.equal((await h.request(`/tags/${tag.id}`, { token: owner.token })).data.tag.publicUrl, tag.publicUrl);
  assert.equal((await h.request(finderPath, { token: finder.token })).data.reward.status, 'paid');
});
