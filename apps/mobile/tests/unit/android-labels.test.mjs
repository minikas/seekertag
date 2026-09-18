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
    async bytes() { return files.get(this.uri); }
    async base64() { return Buffer.from(files.get(this.uri)).toString('base64'); }
    delete() { files.delete(this.uri); }
    write(bytes) {
      if (options.writeError) throw new Error('disk full');
      files.set(this.uri, bytes);
    }
    static async downloadFileAsync(url, destination, config) {
      downloads.push({ url, config });
      files.set(destination.uri, options.bytes || pdf);
      if (options.downloadError) throw new Error('connection interrupted');
      return destination;
    }
  }
  const directory = {
    uri: 'content://chosen-folder',
    createFile(name, mimeType) {
      assert.equal(mimeType, 'application/pdf');
      const file = new File(`content://chosen-folder/${name}`);
      files.set(file.uri, new Uint8Array());
      return file;
    },
  };
  const modules = {
    'expo-file-system': { File, Paths: { cache: { uri: 'file://cache' } } },
    'expo-file-system/legacy': {
      EncodingType: { Base64: 'base64' },
      async writeAsStringAsync(uri, value, writeOptions) { assert.equal(uri, 'content://downloads/SeekerTag-item.pdf'); assert.equal(writeOptions.encoding, 'base64'); if (options.writeError) throw new Error('disk full'); files.set(uri, new Uint8Array(Buffer.from(value, 'base64'))); },
    },
    'expo-intent-launcher': {
      ResultCode: { Success: -1 },
      async startActivityAsync(action, config) { saveRequests.push({ action, config }); if (options.pickerError) throw options.pickerError; return options.cancelled ? { resultCode: 0 } : { resultCode: -1, data: 'content://downloads/SeekerTag-item.pdf' }; },
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
  assert.deepEqual(h.saveRequests, [{ action: 'android.intent.action.CREATE_DOCUMENT', config: { category: 'android.intent.category.OPENABLE', type: 'application/pdf', extra: { 'android.intent.extra.TITLE': 'SeekerTag-item.pdf' } } }]);
  assert.deepEqual(h.downloads, [{ url: request.url, config: { headers: { Authorization: `Bearer ${request.token}` } } }]);
  assert.deepEqual([...h.files.keys()], ['content://downloads/SeekerTag-item.pdf']);
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

test('invalid PDF responses never reach the chosen folder and temporary data is removed', async () => {
  const h = harness({ bytes: new TextEncoder().encode('{"error":"expired"}') });
  await assert.rejects(h.downloadLabel(request), /Confira a conexão/);
  assert.equal(h.files.size, 0);
});

test('interrupted downloads remove partial files', async () => {
  const h = harness({ downloadError: true });
  await assert.rejects(h.downloadLabel(request), /Confira a conexão/);
  assert.equal(h.files.size, 0);
});

test('failed writes remove the temporary download', async () => {
  const h = harness({ writeError: true });
  await assert.rejects(h.downloadLabel(request), /Não foi possível salvar/);
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
