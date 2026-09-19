import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const code = ts.transpileModule(readFileSync(new URL('../../src/Found.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;

function render({ dirty = false, submitting = false, authenticating = false, chatId } = {}) {
  let mutation = 0, layer, home = 0;
  const alerts = [];
  const deps = {
    react: { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }), useState: initial => [initial, () => {}], useRef: current => ({ current }), useEffect() {} },
    'react-native': { View: 'View', Text: 'Text', StyleSheet: { create: styles => styles, hairlineWidth: 1 }, Alert: { alert: (...args) => alerts.push(args) } },
    'react-native-keyboard-controller': { KeyboardAwareScrollView: 'KeyboardAwareScrollView' },
    '@tanstack/react-query': { useQueryClient: () => ({}), useQuery: () => ({}), useMutation: () => ({ isPending: mutation++ === 0 ? submitting : authenticating, variables: authenticating ? 'solana' : undefined }) },
    './query': { apiQueryOptions: () => ({}) },
    'react-hook-form': { Controller: 'Controller', useForm: () => ({ watch: () => '', formState: { errors: {}, isDirty: dirty } }) },
    '@hookform/resolvers/zod': { zodResolver() {} },
    './PreferencesProvider': { useThemedStyles: () => ({}) },
    './category.model': {}, './api': {}, './theme': {}, './platform/storage': {}, './platform/auth': {}, './form.model': {}, './i18n': {},
    './ui': { Button: 'Button', Notice: 'Notice', useUI: () => ({ C: {}, s: {}, t: value => value, locale: 'en-US' }) },
    './Navigation': { NavigationScope: 'NavigationScope', useNavigationLayer: (back, task) => { layer = { back, task }; return { path: [], active: true }; } },
  };
  for (const name of ['./Conversation', './RewardSummary', './ProviderButton', './AccountActionSheet', './HapticPressable']) deps[name] = { __esModule: true, default: name };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => { assert.ok(name in deps, name); return deps[name]; }, module, module.exports);
  module.exports.default({ code: 'item-code', chatId, token: null, goHome: () => home++, goChat() {}, onAuth: async () => {} });
  return { layer, alerts, get home() { return home; } };
}

test('finder form registers a navigation task while editing, submitting or authenticating', () => {
  for (const state of [{ dirty: true }, { submitting: true }, { authenticating: true }, { chatId: 'report-1', authenticating: true }]) {
    const page = render(state);
    assert.equal(page.layer.task, true, JSON.stringify(state));
    page.layer.back();
    assert.equal(page.home, 0);
    if (state.dirty) {
      assert.equal(page.alerts.length, 1);
      page.alerts[0][2].find(action => action.style === 'destructive').onPress();
      assert.equal(page.home, 1, 'Discard remains an explicit user choice');
    } else assert.equal(page.alerts.length, 0, 'In-flight work cannot be discarded by navigation');
  }
});

test('clean finder screens and established conversations do not block deliberate notification navigation', () => {
  for (const state of [{}, { chatId: 'report-1', dirty: true }]) {
    const page = render(state);
    assert.equal(page.layer.task, false);
    page.layer.back();
    assert.equal(page.home, 1);
  }
});
