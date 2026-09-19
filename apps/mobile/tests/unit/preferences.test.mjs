import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import ts from 'typescript';
import { parsePreferences, resolveLanguage, localeFor } from '../../src/preferences.model.ts';
import { createTranslator, translateNotice, objectCount } from '../../src/i18n/index.ts';
import { catalog } from '../../src/i18n/catalog.ts';
import { errors } from '../../src/i18n/errors.ts';
import { categoryLabel, categoryInk } from '../../src/category.model.ts';
import { darkColors, lightColors } from '../../src/theme.ts';

test('stored preferences survive serialization and invalid values fall back independently', () => {
  for (const language of ['system', 'pt', 'en', 'es']) for (const theme of ['system', 'light', 'dark']) {
    assert.deepEqual(parsePreferences(JSON.stringify({ language, theme })), { language, theme });
  }
  for (const raw of [null, 'null', '{', '[]', '12']) assert.deepEqual(parsePreferences(raw), { language: 'system', theme: 'system' });
  assert.deepEqual(parsePreferences('{"language":"fr","theme":"dark"}'), { language: 'system', theme: 'dark' });
  assert.deepEqual(parsePreferences('{"language":"es","theme":false}'), { language: 'es', theme: 'system' });
});

test('device language uses regional variants and supported fallbacks; explicit choice wins', () => {
  assert.equal(resolveLanguage('system', ['pt-PT', 'en']), 'pt');
  assert.equal(resolveLanguage('system', ['fr', 'es_MX']), 'es');
  assert.equal(resolveLanguage('system', [null, 'ja']), 'en');
  assert.equal(resolveLanguage('system', []), 'en');
  assert.equal(resolveLanguage('en', ['pt']), 'en');
  assert.equal(localeFor('es'), 'es-ES');
});

test('translations interpolate names, counts and server validation without changing custom category names', () => {
  const en = createTranslator('en'); const es = createTranslator('es');
  assert.equal(objectCount(en, 1, 'en-US'), '1 item');
  assert.equal(objectCount(es, 2, 'es-ES'), '2 objetos');
  assert.equal(en('Com {name}', { name: 'João' }), 'With João');
  assert.equal(translateNotice(en, 'Nome do objeto: use entre 1 e 80 caracteres.'), 'Item name: use between 1 and 80 characters.');
  assert.equal(categoryLabel({ name: 'Mochila', defaultKey: 'backpack' }, en), 'Backpack');
  assert.equal(categoryLabel({ name: 'Mochila', defaultKey: null }, en), 'Mochila');
  assert.equal(en('Unrecognized user content'), 'Unrecognized user content');
});

test('all translated UI messages exist and preserve their interpolation fields in both languages', () => {
  const placeholders = value => (value.match(/\{\w+\}/g) || []).sort();
  const messages = { ...catalog, ...errors };
  for (const [source, values] of Object.entries(messages)) for (const value of values) {
    assert.ok(value.trim(), source);
    assert.deepEqual(placeholders(value), placeholders(source), source);
  }
  const root = new URL('../../', import.meta.url);
  const files = ['App.tsx', ...readdirSync(new URL('src/', root), { recursive: true }).filter(file => /\.tsx?$/.test(file)).map(file => `src/${file}`)];
  for (const file of files) {
    const ast = ts.createSourceFile(file, readFileSync(new URL(file, root), 'utf8'), ts.ScriptTarget.Latest, true);
    function visit(node) {
      if (ts.isCallExpression(node) && node.expression.getText(ast) === 't' && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
        assert.ok(Object.hasOwn(messages, node.arguments[0].text), `${file}: ${node.arguments[0].text}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
});

test('both palettes retain readable body text, controls and feedback', () => {
  function luminance(hex) {
    const rgb = hex.slice(1).match(/../g).map(v => parseInt(v, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  }
  const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
  for (const palette of [darkColors, lightColors]) for (const [fg, bg] of [['ink', 'bg'], ['muted', 'bg'], ['ink', 'input'], ['onPrimary', 'primary'], ['red', 'redSoft'], ['green', 'greenSoft'], ['blue', 'blueSoft'], ['orange', 'orangeSoft']]) {
    assert.ok(contrast(palette[fg], palette[bg]) >= 4.5, `${fg}/${bg}`);
  }
  assert.equal(categoryInk('#304441'), '#FFFFFF');
  assert.equal(categoryInk('#BCD5A6'), '#10221D');
});
