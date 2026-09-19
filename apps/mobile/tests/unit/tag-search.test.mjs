import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesTagFilter, searchTags } from '../../src/tag-search.model.ts';
import { displayTagStatus } from '../../src/tag-status.model.ts';
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
  assert.deepEqual(ids(searchTags(tags, 'pecas unicas', 'paused', createTranslator('en'), 'en-US')), ['c']);
});

test('status and search combine, including an empty result and clearing both controls', () => {
  assert.deepEqual(ids(searchTags(tags, 'eletronico', 'lost', pt, 'pt-BR')), ['b']);
  assert.deepEqual(ids(searchTags(tags, 'camera', 'paused', pt, 'pt-BR')), []);
  for (const [status, id] of [['active', 'a'], ['lost', 'b'], ['paused', 'c']]) {
    assert.deepEqual(ids(searchTags(tags, '', status, pt, 'pt-BR')), [id]);
  }
  assert.deepEqual(ids(searchTags(tags, '  ', 'all', pt, 'pt-BR')), ['a', 'b']);
});

test('the main collection hides archived items while its dedicated filter keeps them accessible', () => {
  assert.deepEqual(ids(searchTags(tags, '', 'all', pt, 'pt-BR')), ['a', 'b']);
  assert.deepEqual(ids(searchTags(tags, '', 'paused', pt, 'pt-BR')), ['c']);
});

test('filtering retains the original order and objects without mutating the collection', () => {
  const frozen = Object.freeze(tags.map(tag => Object.freeze({ ...tag })));
  const result = searchTags(frozen, 'eletronico', 'all', pt, 'pt-BR');
  assert.deepEqual(ids(result), ['a', 'b']);
  assert.equal(result[0], frozen[0]);
  assert.equal(frozen.length, 3);
});

test('protected and recovered items have separate badges, filters and counts', () => {
  const items = [
    { ...tags[0], recoveryCount: 0 },
    { ...tags[1], status: 'active', recoveryCount: 2 },
    { ...tags[2], recoveryCount: 1 },
  ];
  assert.deepEqual(items.map(displayTagStatus), ['active', 'recovered', 'paused']);
  assert.deepEqual(ids(searchTags(items, '', 'active', pt, 'pt-BR')), ['a']);
  assert.deepEqual(ids(searchTags(items, '', 'recovered', pt, 'pt-BR')), ['b']);
  assert.deepEqual(ids(searchTags(items, 'camera', 'recovered', pt, 'pt-BR')), []);
  assert.equal(items.filter(tag => matchesTagFilter(tag, 'active')).length, 1);
  assert.equal(items.filter(tag => matchesTagFilter(tag, 'recovered')).length, 1);
  for (const tag of items) {
    assert.equal(['active', 'lost', 'recovered', 'paused'].filter(filter => matchesTagFilter(tag, filter)).length, 1);
  }
});

test('a recovered item becomes lost when lost again and archived when archived', () => {
  const item = { ...tags[0], status: 'active', recoveryCount: 1 };
  for (const status of ['lost', 'paused']) {
    const changed = { ...item, status };
    assert.equal(displayTagStatus(changed), status);
    assert.equal(matchesTagFilter(changed, 'recovered'), false);
    assert.equal(matchesTagFilter(changed, 'active'), false);
    assert.equal(matchesTagFilter(changed, status), true);
  }
  assert.equal(displayTagStatus({ ...item, recoveryCount: 2 }), 'recovered');
  assert.equal(displayTagStatus({ ...item, recoveryCount: 0 }), 'active');
});
