import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { labelFileName } from '../../src/platform/label.types.ts';

// Execute the real adapter, replacing only Android's filesystem and share sheet.
// Device integration is covered separately by tests/android and physical QA.
const compiled = ts.transpileModule(readFileSync(new URL('../../src/platform/labels.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const pdf = new TextEncoder().encode('%PDF-1.7\nlabel without credentials\n%%EOF');
const request = { url: 'https://api.example/api/tags/item/label.pdf', token: 'synthetic-owner-token', fileName: 'SeekerTag-item.pdf' };

function harness(options = {}) {
  const files = new Map();
  const downloads = [];
  const shares = [];
  const saveRequests = [];
  class File {
    constructor(parent, name) { this.uri = name ? `${parent.uri}/${name}` : parent; }
    get exists() { return files.has(this.uri); }
    async bytes() { return options.corruptWrite && this.uri.startsWith('content://') ? new Uint8Array() : files.get(this.uri); }
    async base64() { return Buffer.from(files.get(this.uri)).toString('base64'); }
    delete() { files.delete(this.uri); }
    write(bytes) {
      if (options.writeError) throw new Error('disk full');
      files.set(this.uri, bytes);
    }
    static async downloadFileAsync(url, destination, config) {
      assert.ok(destination.uri.startsWith('file://'), 'Expo downloadFileAsync requires a local file');
      downloads.push({ url, config });
      files.set(destination.uri, options.bytes || pdf);
      if (options.downloadError) throw new Error('connection interrupted');
      return destination;
    }
  }
  const modules = {
    'expo-file-system': { File, Paths: { cache: { uri: 'file://cache' } } },
    'expo-intent-launcher': {
      ResultCode: { Success: -1 },
      async startActivityAsync(action, config) {
        saveRequests.push({ action, config });
        if (options.pickerError) throw options.pickerError;
        if (options.cancelled) return { resultCode: 0 };
        const data = options.resultData ?? 'content://com.android.providers.downloads.documents/document/msf%3A123';
        files.set(data, new Uint8Array()); // CREATE_DOCUMENT creates an empty file before returning.
        return { resultCode: -1, data };
      },
    },
    'expo-sharing': {
      async isAvailableAsync() { return options.sharingAvailable !== false; },
      async shareAsync(uri, config) { shares.push({ uri, config }); },
    },
    './label.types': { labelFileName },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(name => {
    assert.ok(Object.hasOwn(modules, name), `Unexpected native dependency: ${name}`);
    return modules[name];
  }, module, module.exports);
  return { ...module.exports, files, downloads, shares, saveRequests };
}

test('Android PDF download saves a permanent copy and sends credentials only in the request header', async () => {
  const h = harness();
  assert.equal(await h.downloadLabel(request), true);
  assert.deepEqual(h.saveRequests, [{ action: 'android.intent.action.CREATE_DOCUMENT', config: { category: 'android.intent.category.OPENABLE', type: 'application/pdf', flags: 0x3, extra: { 'android.intent.extra.TITLE': 'SeekerTag-item.pdf' } } }]);
  assert.deepEqual(h.downloads, [{ url: request.url, config: { headers: { Authorization: `Bearer ${request.token}` } } }]);
  assert.deepEqual([...h.files.keys()], ['content://com.android.providers.downloads.documents/document/msf%3A123']);
  assert.deepEqual(h.files.values().next().value, pdf);
  assert.equal(h.shares.length, 0);
});

test('cancelling the Android folder picker does not download or save a file', async () => {
  const h = harness({ cancelled: true });
  assert.equal(await h.downloadLabel(request), false);
  assert.equal(h.downloads.length, 0);
  assert.equal(h.files.size, 0);
});

test('an unavailable folder picker is reported without sending an authenticated download', async () => {
  const h = harness({ pickerError: new Error('permission denied') });
  await assert.rejects(h.downloadLabel(request), /diálogo para salvar/);
  assert.equal(h.downloads.length, 0);
});

test('invalid PDF responses are removed from the chosen folder', async () => {
  const h = harness({ bytes: new TextEncoder().encode('{"error":"expired"}') });
  await assert.rejects(h.downloadLabel(request), /salvar o PDF/);
  assert.equal(h.files.size, 0);
});

test('interrupted downloads remove partial files from the chosen folder', async () => {
  const h = harness({ downloadError: true });
  await assert.rejects(h.downloadLabel(request), /salvar o PDF/);
  assert.equal(h.files.size, 0);
});

test('failed writes remove the empty chosen document', async () => {
  const h = harness({ writeError: true });
  await assert.rejects(h.downloadLabel(request), /salvar o PDF/);
  assert.equal(h.files.size, 0);
});

test('the redacted Android 16 Intent captured on Seeker is never used as a file URI', async () => {
  const h = harness({ resultData: 'Intent { dat=content://com.android.providers.downloads.documents/... flg=0x43 xflg=0x4 }' });
  await assert.rejects(h.downloadLabel(request), /diálogo para salvar/);
  assert.equal(h.downloads.length, 0);
});

test('a zero-byte write is rejected and cleaned up instead of reporting success', async () => {
  const h = harness({ corruptWrite: true });
  await assert.rejects(h.downloadLabel(request), /salvar o PDF/);
  assert.equal(h.files.size, 0);
});

test('sharing uses a local PDF and keeps it available to the receiving Android app', async () => {
  const h = harness();
  await h.shareLabel({ ...request, dialogTitle: 'Share or print label' });
  assert.equal(h.shares.length, 1);
  assert.equal(h.shares[0].config.dialogTitle, 'Share or print label');
  const shared = h.shares[0];
  assert.match(shared.uri, /^file:\/\/cache\//);
  assert.equal(shared.config.mimeType, 'application/pdf');
  assert.deepEqual(h.files.get(shared.uri), pdf);
  assert.ok(!JSON.stringify(shared).includes(request.token));
});

test('unavailable Android sharing is reported before downloading', async () => {
  const h = harness({ sharingAvailable: false });
  await assert.rejects(h.shareLabel(request), /compartilhamento/);
  assert.equal(h.downloads.length, 0);
});
