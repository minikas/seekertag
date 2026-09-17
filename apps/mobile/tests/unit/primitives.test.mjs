import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeBase58, assertWalletAddress } from '../../src/platform/wallet.types.ts';
import { validateTagUrl } from '../../src/platform/nfc.url.ts';
import { labelFileName } from '../../src/platform/label.types.ts';

test('base58 conversion preserves leading zero bytes and known byte vectors', () => {
  const vectors = [[[], ''], [[0], '1'], [[0, 0], '11'], [[0, 0, 1], '112'], [[57], 'z'], [[58], '21'], [[255], '5Q'], [[0, 255], '15Q']];
  for (const [bytes, expected] of vectors) assert.equal(encodeBase58(Uint8Array.from(bytes)), expected);
  assert.equal(encodeBase58(new Uint8Array(32)), '1'.repeat(32));
  assert.equal(encodeBase58(new TextEncoder().encode('Hello World')), 'JxF12TrwUP45BMd');
});

test('wallet addresses must decode to exactly 32 bytes, beyond their apparent text length', () => {
  for (const address of ['1'.repeat(32), 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA']) assert.equal(assertWalletAddress(address), address);
  for (const address of ['', '1'.repeat(31), '1'.repeat(33), 'z'.repeat(44), '0'.repeat(32), 'O'.repeat(32), 'I'.repeat(32), 'l'.repeat(32), ` ${'1'.repeat(32)}`, `${'1'.repeat(32)}\n`]) assert.throws(() => assertWalletAddress(address), /endereço Solana inválido/);
});

test('NFC payloads accept HTTP(S) links and reject active schemes or embedded credentials', () => {
  assert.equal(validateTagUrl('https://seekertag.example/found/abc_123'), 'https://seekertag.example/found/abc_123');
  assert.equal(validateTagUrl('http://192.168.1.44:4318/found/abc-123'), 'http://192.168.1.44:4318/found/abc-123');
  for (const value of ['', 'relative/found/123', 'javascript:alert(1)', 'data:text/html,tag', 'file:///found/a', 'ftp://seekertag.example/found/a', 'https://name:secret@seekertag.example/found/a']) assert.throws(() => validateTagUrl(value), /link/);
});

test('label filenames stay local, bounded and end in a PDF extension', () => {
  assert.equal(labelFileName(), 'SeekerTag-etiqueta.pdf');
  assert.equal(labelFileName('SeekerTag-abc.PDF'), 'SeekerTag-abc.PDF');
  assert.equal(labelFileName('Minha etiqueta'), 'Minha-etiqueta.pdf');
  for (const input of ['../../outside', 'a/b\\c.pdf', '\0bad\nname', 'A'.repeat(400)]) {
    const name = labelFileName(input);
    assert.match(name, /^[a-zA-Z0-9._-]+\.pdf$/);
    assert.ok(name.length <= 104);
    assert.ok(!name.includes('/') && !name.includes('\\'));
  }
});
