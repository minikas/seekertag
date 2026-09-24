import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const script = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const renderSource = script.slice(script.indexOf('function renderReward('), script.indexOf('async function loadConversation('));

for (const status of [null, 'pending', 'unverified', 'reserved', 'expired', 'released', 'refunded']) {
  test(`wallet registration in an existing open conversation: reward ${status}`, () => {
    const elements = new Map();
    const $ = selector => {
      if (!elements.has(selector)) elements.set(selector, { classList: { toggle(_class, hidden) { this.hidden = Boolean(hidden); } } });
      return elements.get(selector);
    };
    const context = { $, currentConversation: { report: { status: 'open' } }, walletEditing: false,
      t: key => key, rewardLabel: () => '', networkLabel: () => '' };
    runInNewContext(`${renderSource}; this.renderReward = renderReward;`, context);
    const reward = status ? { status, amount: '1', currency: 'SOL', network: 'devnet' } : null;
    context.renderReward({ reward, recipient: null });
    assert.equal($('#set-wallet').classList.hidden, status === 'released');
    assert.equal($('#chat-reward').classList.hidden, false);
    assert.equal($('#chat-reward-summary').classList.hidden, !reward);
    context.renderReward({ reward, recipient: 'confirmed-address' });
    assert.equal($('#set-wallet').classList.hidden, status === 'released');
    assert.equal($('#set-wallet span').textContent, 'edit');
    context.walletEditing = true;
    context.renderReward({ reward, recipient: null });
    assert.equal($('#wallet-form').classList.hidden, status === 'released');
    context.currentConversation.report.status = 'closed';
    context.renderReward({ reward, recipient: null });
    assert.equal($('#set-wallet').classList.hidden, true);
    assert.equal($('#wallet-form').classList.hidden, true);
    context.renderReward({ reward, recipient: 'confirmed-address' });
    assert.equal($('#wallet-saved').classList.hidden, false);
    assert.equal($('#chat-reward').classList.hidden, false);
    assert.equal($('#wallet-address').textContent, 'confirmed-address');
  });
}
