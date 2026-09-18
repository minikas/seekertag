import assert from 'node:assert/strict';
import test from 'node:test';
import { categoryFormSchema, finderFormSchema, tagFormSchema } from '../../src/form.model.ts';

test('object names preserve supported identity characters and reject punctuation or repeated spaces', () => {
  const valid = tagFormSchema.safeParse({ name: "D'Ávila-2", description: '  nota  ', publicMessage: '  Obrigado  ' });
  assert.equal(valid.success, true);
  assert.deepEqual(valid.data, { name: "D'Ávila-2", description: 'nota', publicMessage: 'Obrigado' });
  for (const name of ['Mala, azul', 'Mala  azul', 'Mala #1']) {
    assert.equal(tagFormSchema.safeParse({ name, description: '', publicMessage: '' }).success, false, name);
  }
});

test('category and finder forms validate names and require a meaningful first message', () => {
  assert.equal(categoryFormSchema.safeParse({ name: 'Bicicleta urbana' }).success, true);
  assert.equal(categoryFormSchema.safeParse({ name: 'Bicicleta  urbana' }).success, false);
  assert.equal(finderFormSchema.safeParse({ finderName: 'Ana-Lu', message: '  Encontrei perto do parque.  ' }).success, true);
  assert.equal(finderFormSchema.safeParse({ finderName: 'Ana, Lu', message: 'Encontrei.' }).success, false);
  assert.equal(finderFormSchema.safeParse({ finderName: '', message: '   ' }).success, false);
});
