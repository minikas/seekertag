import test from 'node:test';
import assert from 'node:assert/strict';
import { createPriceFeed } from '../rewards/prices.js';

const now = 1_800_000_000_000;
const entries = (age = 0) => Object.fromEntries(['solana', 'usd-coin', 'seeker'].map(id => [id, { usd: 2, brl: 10, last_updated_at: (now - age) / 1000 }]));
test('coalesces requests and maps explicit coin IDs to both fiat currencies', async () => {
  let calls = 0;
  const feed = createPriceFeed({ now: () => now, fetchPrice: async url => { calls++; assert.match(url, /ids=solana,usd-coin,seeker/); return { ok: true, json: async () => entries() }; } });
  const [first, second] = await Promise.all([feed(), feed()]);
  assert.equal(calls, 1); assert.deepEqual(first, second);
  assert.equal(first.quotes.SKR.brl, 10); assert.equal(first.quotes.USDC.usd, 2);
  await feed(); assert.equal(calls, 1);
});
test('rejects stale, malformed and future quotes rather than inventing prices', async () => {
  for (const body of [entries(301_000), entries(-61_000), Object.fromEntries(Object.entries(entries()).map(([id, q]) => [id, { ...q, usd: '2' }]))]) {
    const feed = createPriceFeed({ now: () => now, fetchPrice: async () => ({ ok: true, json: async () => body }) });
    await assert.rejects(feed(), /PRICE_UNAVAILABLE/);
  }
});
test('an unavailable token does not fabricate a rate or discard other valid coins', async () => {
  const body = entries(); delete body.seeker;
  const feed = createPriceFeed({ now: () => now, fetchPrice: async () => ({ ok: true, json: async () => body }) });
  const result = await feed(); assert.equal(result.quotes.SKR, undefined); assert.equal(result.quotes.SOL.usd, 2);
});
test('backs off on rate limits and never serves an expired cache', async () => {
  let time = now; let calls = 0;
  const feed = createPriceFeed({ now: () => time, fetchPrice: async () => { calls++; return calls === 1 ? { ok: true, json: async () => entries() } : { ok: false }; } });
  await feed(); time += 301_000;
  await assert.rejects(feed(), /PRICE_UNAVAILABLE/);
  await assert.rejects(feed(), /PRICE_UNAVAILABLE/); assert.equal(calls, 2);
  time += 60_001; await assert.rejects(feed(), /PRICE_UNAVAILABLE/); assert.equal(calls, 3);
});
