import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchTags } from '../../src/tag-search.model.ts';
import { createTranslator } from '../../src/i18n/index.ts';

const tags = [
  { id: 'a', name: 'Câmera de João', category: 'Eletrônico', categoryDefaultKey: 'electronics', status: 'active' },
  { id: 'b', name: 'Notebook', category: 'Eletrônico', categoryDefaultKey: 'electronics', status: 'lost' },
  { id: 'c', name: 'Jaqueta', category: 'Peças únicas', categoryDefaultKey: null, status: 'paused' },
];
const ids = results => results.map(tag => tag.id);
const pt = createTranslator('pt');

test('search accepts accents, casing and extra spaces across name and category', () => {
  assert.deepEqual(ids(searchTags(tags, '  JOAO   eletronico ', 'all', pt, 'pt-BR')), ['a']);
  assert.deepEqual(ids(searchTags(tags, 'camera', 'all', pt, 'pt-BR')), ['a']);
  assert.deepEqual(ids(searchTags(tags, 'missing', 'all', pt, 'pt-BR')), []);
});

test('search uses the displayed language for default categories and preserves custom names', () => {
  assert.deepEqual(ids(searchTags(tags, 'electronics', 'all', createTranslator('en'), 'en-US')), ['a', 'b']);
  assert.deepEqual(ids(searchTags(tags, 'electronica', 'all', createTranslator('es'), 'es-ES')), ['a', 'b']);
  assert.deepEqual(ids(searchTags(tags, 'pecas unicas', 'all', createTranslator('en'), 'en-US')), ['c']);
});

test('status and search combine, including an empty result and clearing both controls', () => {
  assert.deepEqual(ids(searchTags(tags, 'eletronico', 'lost', pt, 'pt-BR')), ['b']);
  assert.deepEqual(ids(searchTags(tags, 'camera', 'paused', pt, 'pt-BR')), []);
  for (const [status, id] of [['active', 'a'], ['lost', 'b'], ['paused', 'c']]) {
    assert.deepEqual(ids(searchTags(tags, '', status, pt, 'pt-BR')), [id]);
  }
  assert.deepEqual(searchTags(tags, '  ', 'all', pt, 'pt-BR'), tags);
});

test('filtering retains the original order and objects without mutating the collection', () => {
  const frozen = Object.freeze(tags.map(tag => Object.freeze({ ...tag })));
  const result = searchTags(frozen, 'eletronico', 'all', pt, 'pt-BR');
  assert.deepEqual(ids(result), ['a', 'b']);
  assert.equal(result[0], frozen[0]);
  assert.equal(frozen.length, 3);
});

test('recovered items are identified by return history, not simply by active status', () => {
  const items = tags.map((tag, index) => ({ ...tag, recoveryCount: index === 1 ? 2 : 0 }));
  assert.deepEqual(ids(searchTags(items, '', 'recovered', pt, 'pt-BR')), ['b']);
  assert.deepEqual(ids(searchTags(items, 'camera', 'recovered', pt, 'pt-BR')), []);
});
