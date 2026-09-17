import { test } from 'node:test';
import assert from 'node:assert/strict';
import { labelCopy } from '../label-copy.js';

test('print labels use supported languages and safely fall back for malformed query values', () => {
  assert.equal(labelCopy('en').found, 'Found this item?');
  assert.equal(labelCopy('es').found, '¿Encontraste este objeto?');
  for (const value of [undefined, 'fr', '__proto__', ['en'], {}, Object.create(null)]) assert.equal(labelCopy(value), labelCopy('pt'));
});
