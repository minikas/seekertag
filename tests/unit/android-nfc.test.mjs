import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { validateTagUrl } from '../../src/platform/nfc.url.ts';

const compiled = ts.transpileModule(readFileSync(new URL('../../src/platform/nfc.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const url = 'https://seekertag.example/t/test-tag';
function harness({ status, discovery } = {}) {
  const cancellations = [], writes = [];
  let requests = 0;
  const manager = {
    isSupported: async () => true, start: async () => {}, isEnabled: async () => true,
    requestTechnology: async () => { requests++; await discovery?.promise; },
    cancelTechnologyRequest: async options => { cancellations.push(options); discovery?.reject(new Error('cancelled')); },
    ndefHandler: { getNdefStatus: async () => status ? status.promise : { status: 1, capacity: 1000 }, writeNdefMessage: async bytes => { writes.push(bytes); } },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(name => {
    if (name === './nfc.url') return { validateTagUrl };
    assert.equal(name, 'react-native-nfc-manager');
    return { __esModule: true, default: manager, NfcTech: { Ndef: 'Ndef' }, NdefStatus: { NotSupported: 0, ReadOnly: 2 }, Ndef: { uriRecord: value => value, encodeMessage: () => [1, 2, 3] } };
  }, module, module.exports);
  return { ...module.exports, cancellations, writes, get requests() { return requests; } };
}

test('NFC cancellation stops discovery without the Android default delay and releases the session', async () => {
  const discovery = deferred(), h = harness({ discovery });
  const write = assert.rejects(h.writeTagUrl(url), /cancelada/);
  await tick();
  assert.equal(h.requests, 1);
  await h.cancelNfcWrite();
  await write;
  assert.equal(h.writes.length, 0);
  assert.ok(h.cancellations.length > 0);
  assert.ok(h.cancellations.every(options => options.delayMsAndroid === 0));
  await assert.rejects(h.writeTagUrl(url), /Não foi possível gravar/); // A new session reaches the adapter, rather than staying locked.
  assert.equal(h.requests, 2);
});

test('cancelling during NDEF inspection prevents writing and keeps a new session out until cleanup completes', async () => {
  const status = deferred(), h = harness({ status });
  const write = assert.rejects(h.writeTagUrl(url), /cancelada/);
  await tick();
  const cancellation = h.cancelNfcWrite();
  await assert.rejects(h.writeTagUrl(url), /Já existe/);
  status.resolve({ status: 1, capacity: 1000 });
  await Promise.all([write, cancellation]);
  assert.equal(h.writes.length, 0);
  await h.writeTagUrl(url);
  assert.equal(h.writes.length, 1);
});

test('cancelling before the NFC module loads never starts discovery', async () => {
  const h = harness();
  const write = assert.rejects(h.writeTagUrl(url), /cancelada/);
  await h.cancelNfcWrite();
  await write;
  assert.equal(h.requests, 0);
  assert.equal(h.writes.length, 0);
  await h.writeTagUrl(url);
  assert.equal(h.writes.length, 1);
});
