import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { secureStorage, tokenStorage } from '../../src/platform/storage.ts';

// In-memory browser storage is a platform boundary; the real storage adapter runs unchanged.
class BrowserStorage {
  #entries = new Map();
  getItem(key) { return this.#entries.get(key) ?? null; }
  setItem(key, value) { this.#entries.set(key, String(value)); }
  removeItem(key) { this.#entries.delete(key); }
}
const original = Object.fromEntries(['localStorage', 'sessionStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
const assign = (key, value) => Object.defineProperty(globalThis, key, { configurable: true, value });
const record = (key, value, expiresAt) => localStorage.setItem(`seekertag.${key}`, JSON.stringify({ value, expiresAt }));
beforeEach(() => { assign('localStorage', new BrowserStorage()); assign('sessionStorage', new BrowserStorage()); });
afterEach(() => {
  for (const key of Object.keys(original)) {
    if (original[key]) Object.defineProperty(globalThis, key, original[key]);
    else delete globalThis[key];
  }
});

test('owner sessions survive a reload but remain scoped to a single tab', async () => {
  await tokenStorage.set('test-owner-session');
  assert.equal(await tokenStorage.get(), 'test-owner-session');
  assert.equal(localStorage.getItem('seekertag.owner'), null);
  assign('sessionStorage', new BrowserStorage());
  assert.equal(await tokenStorage.get(), null);
});

test('finder and tag-chat capabilities survive closing a tab with a bounded lifetime', async () => {
  const start = Date.now();
  for (const key of ['finder-report1', 'tag-chat-tag1']) {
    await secureStorage.set(key, 'test-finder-value');
    const stored = JSON.parse(localStorage.getItem(`seekertag.${key}`));
    assert.equal(stored.value, 'test-finder-value');
    assert.ok(stored.expiresAt >= start + 30 * 24 * 60 * 60 * 1000);
    assert.ok(stored.expiresAt <= Date.now() + 30 * 24 * 60 * 60 * 1000);
    assert.equal(sessionStorage.getItem(`seekertag.${key}`), null);
  }
  assign('sessionStorage', new BrowserStorage());
  assert.equal(await secureStorage.get('finder-report1'), 'test-finder-value');
  assert.equal(await secureStorage.get('tag-chat-tag1'), 'test-finder-value');
});

test('expired or malformed capabilities are removed and cannot fall back to stale tab tokens', async () => {
  const invalid = ['not-json', 'null', '[]', JSON.stringify({ value: 4, expiresAt: Date.now() + 10000 }), JSON.stringify({ value: 'expired', expiresAt: Date.now() - 1 }), JSON.stringify({ value: 'bad-date', expiresAt: '2099' })];
  for (const serialized of invalid) {
    localStorage.setItem('seekertag.finder-report1', serialized);
    sessionStorage.setItem('seekertag.finder-report1', 'stale-token');
    assert.equal(await secureStorage.get('finder-report1'), null);
    assert.equal(localStorage.getItem('seekertag.finder-report1'), null);
    assert.equal(sessionStorage.getItem('seekertag.finder-report1'), null);
  }
});

test('a valid persistent capability takes precedence over an old tab token', async () => {
  record('finder-report1', 'current-token', Date.now() + 10000);
  sessionStorage.setItem('seekertag.finder-report1', 'old-token');
  assert.equal(await secureStorage.get('finder-report1'), 'current-token');
});

test('legacy finder sessions migrate to persistent storage without losing access', async () => {
  sessionStorage.setItem('seekertag.finder-report1', 'legacy-token');
  assert.equal(await secureStorage.get('finder-report1'), 'legacy-token');
  assert.equal(sessionStorage.getItem('seekertag.finder-report1'), null);
  assert.equal(JSON.parse(localStorage.getItem('seekertag.finder-report1')).value, 'legacy-token');
});

test('blocked persistent storage preserves existing tab access but rejects a new save', async () => {
  sessionStorage.setItem('seekertag.finder-report1', 'legacy-token');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('Storage blocked'); } });
  assert.equal(await secureStorage.get('finder-report1'), 'legacy-token');
  await assert.rejects(secureStorage.set('finder-report2', 'new-token'), /navegador bloqueou o armazenamento/);
});

test('blocked session storage never claims that an owner session was saved', async () => {
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, get() { throw new Error('Storage blocked'); } });
  assert.equal(await tokenStorage.get(), null);
  await assert.rejects(tokenStorage.set('token'), /navegador bloqueou o armazenamento/);
});

test('logout and finder removal clear the relevant stores without affecting other accounts', async () => {
  await tokenStorage.set('owner-token');
  await secureStorage.set('finder-report1', 'finder-token');
  sessionStorage.setItem('seekertag.finder-report1', 'old-token');
  await tokenStorage.clear();
  assert.equal(await tokenStorage.get(), null);
  assert.equal(await secureStorage.get('finder-report1'), 'finder-token');
  await secureStorage.remove('finder-report1');
  assert.equal(localStorage.getItem('seekertag.finder-report1'), null);
  assert.equal(sessionStorage.getItem('seekertag.finder-report1'), null);
});

test('stale session cleanup never removes a newer signed-in session', async () => {
  await tokenStorage.set('old');
  const saving = tokenStorage.set('new');
  const staleCleanup = tokenStorage.clearIfMatches('old');
  await saving;
  assert.equal(await staleCleanup, false);
  assert.equal(await tokenStorage.get(), 'new');
  assert.equal(await tokenStorage.clearIfMatches('new'), true);
  assert.equal(await tokenStorage.get(), null);
});

test('durable pending requests and drafts survive tab closure without capability TTL', async () => {
  const pending = JSON.stringify({ operationKey: 'a'.repeat(64), payload: { body: 'draft' } });
  await secureStorage.set('mutation-owner-message:user:report', pending);
  await secureStorage.set('draft-owner-message:user:report', 'new draft');
  assign('sessionStorage', new BrowserStorage());
  assert.equal(await secureStorage.get('mutation-owner-message:user:report'), pending);
  assert.equal(await secureStorage.get('draft-owner-message:user:report'), 'new draft');
  assert.equal(await secureStorage.expiresAt('mutation-owner-message:user:report'), null);
});

test('blocked durable reads fail visibly instead of generating another request', async () => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('Storage blocked'); } });
  await assert.rejects(secureStorage.get('mutation-owner-message:user:report'), /armazenamento/);
});

test('failed owner session removal never claims that logout completed', async () => {
  await tokenStorage.set('owner-token');
  sessionStorage.removeItem = () => { throw new Error('blocked'); };
  await assert.rejects(tokenStorage.clearIfMatches('owner-token'), /remover a sessão/);
  assert.equal(await tokenStorage.get(), 'owner-token');
});
