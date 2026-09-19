import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const compiled = ts.transpileModule(readFileSync(new URL('../../src/platform/wallet-return.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function harness(initial) {
  const listeners = new Set();
  const AppState = { currentState: initial, addEventListener(_event, listener) {
    listeners.add(listener); return { remove() { listeners.delete(listener); } };
  } };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(name => {
    assert.equal(name, 'react-native'); return { AppState };
  }, module, module.exports);
  return { ...module.exports, listeners, change(state) {
    AppState.currentState = state;
    for (const listener of listeners) listener(state);
  } };
}
test('a foreground wallet return can submit the proof immediately', async () => {
  const h = harness('active');
  await h.waitForWalletReturn();
  assert.equal(h.listeners.size, 0);
});
test('a background wallet return waits until the app is active and removes its listener', async () => {
  const h = harness('background');
  let submitted = false;
  const pending = h.waitForWalletReturn().then(() => { submitted = true; });
  h.change('inactive');
  await Promise.resolve();
  assert.equal(submitted, false);
  h.change('active');
  await pending;
  assert.equal(submitted, true);
  assert.equal(h.listeners.size, 0);
});
test('an app that never resumes rejects and removes its listener', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness('background');
  const pending = assert.rejects(h.waitForWalletReturn(), /Volte ao SeekerTag/);
  t.mock.timers.tick(15_000);
  await pending;
  assert.equal(h.listeners.size, 0);
});
