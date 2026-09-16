import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readRoute, nativeTagUrl } from '../../src/links.ts';

const api = 'https://tags.example.com/api';
const origin = encodeURIComponent('https://tags.example.com');

test('printed QR links and mobile handoffs open the same tag on this installation', () => {
  const publicUrl = 'https://tags.example.com/found/abc_123';
  assert.deepEqual(readRoute(publicUrl, api), { code: 'abc_123' });
  assert.deepEqual(readRoute(nativeTagUrl(publicUrl), api), { code: 'abc_123' });
  assert.deepEqual(readRoute(`seekertag://found/abc_123?origin=${origin}`, api), { code: 'abc_123' });
  assert.deepEqual(readRoute(`seekertag:///chat/report-id?origin=${origin}`, api), { chatId: 'report-id' });
  assert.deepEqual(readRoute('http://192.168.1.44:4318/found/code/', 'http://192.168.1.44:4318/api'), { code: 'code' });
});

test('links cannot change the API origin or smuggle unsupported routes into the app', () => {
  const invalid = [
    '', '/found/code', 'https://other.example/found/code',
    'http://tags.example.com/found/code', 'https://tags.example.com:1234/found/code',
    'https://user:password@tags.example.com/found/code',
    'https://tags.example.com/prefix/found/code', 'https://tags.example.com/found/code/extra',
    'https://tags.example.com/found/code#fragment', 'https://tags.example.com/found/%2Fcode',
    'javascript:alert(1)', 'file:///found/code', 'seekertag:///found/code',
    'seekertag:///found/code?origin=https://other.example',
    `seekertag:///found/code?origin=${origin}&origin=${origin}`,
    `seekertag://user:password@found/code?origin=${origin}`,
    `seekertag://found:1234/code?origin=${origin}`,
    `seekertag:///admin/code?origin=${origin}`,
  ];
  for (const value of invalid) assert.equal(readRoute(value, api), null, value);
  assert.equal(readRoute('https://tags.example.com/found/code', 'invalid API'), null);
  assert.throws(() => nativeTagUrl('https://tags.example.com/chat/report'));
});
