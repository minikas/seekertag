const IDS = { SOL: 'solana', USDC: 'usd-coin', SKR: 'seeker' };
const MAX_AGE_MS = 5 * 60_000;
const ENDPOINT = 'https://api.coingecko.com/api/v3/simple/price?ids=solana,usd-coin,seeker&vs_currencies=usd,brl&include_last_updated_at=true';

// Shared on-demand cache: no wallet addresses or application credentials leave the API.
export function createPriceFeed({ fetchPrice = fetch, now = Date.now } = {}) {
  let cached; let pending; let retryAfter = 0;
  return async function prices() {
    const time = now();
    if (cached && time < cached.expiresAt && time - cached.fetchedAt < 60_000) return cached;
    if (pending) return pending;
    if (time < retryAfter) throw new Error('PRICE_UNAVAILABLE');
    pending = (async () => {
      const response = await fetchPrice(ENDPOINT, { signal: AbortSignal.timeout(6000) });
      if (!response.ok) throw new Error('PRICE_UNAVAILABLE');
      const data = await response.json();
      const quotes = {};
      for (const [symbol, id] of Object.entries(IDS)) {
        const entry = data[id];
        const updatedAt = entry?.last_updated_at * 1000;
        if (!Number.isFinite(updatedAt) || updatedAt > now() + 60_000 || now() - updatedAt > MAX_AGE_MS) continue;
        if (![entry.usd, entry.brl].every(value => typeof value === 'number' && Number.isFinite(value) && value > 0)) continue;
        quotes[symbol] = { usd: entry.usd, brl: entry.brl, updatedAt };
      }
      if (!Object.keys(quotes).length) throw new Error('PRICE_UNAVAILABLE');
      cached = { source: 'CoinGecko', quotes, fetchedAt: now(), expiresAt: Math.min(...Object.values(quotes).map(quote => quote.updatedAt + MAX_AGE_MS)) };
      return cached;
    })().catch(error => { retryAfter = now() + 60_000; throw error; }).finally(() => { pending = undefined; });
    return pending;
  };
}
