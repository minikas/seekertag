import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { rewardLocked, rewardAwaitingConfirmation } from '../../src/reward.model.ts';

const compiled = ts.transpileModule(readFileSync(new URL('../../src/TagDetails.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;
const tick = () => new Promise(resolve => setImmediate(resolve));
const noop = () => {};
const identity = value => value;
const reserve = { status: 'reserved', operation: null, currency: 'SOL', amount: '1' };

// Exercise the component's actual event handlers and API effects. Native hosts
// are opaque elements; polling effects are excluded from these intent tests.
// Hook slots are allocated by the render itself, never by test-specific indices.
function harness({ reward = null, reports = 0, resolveError } = {}) {
  const slots = [], requests = [], updates = []; let cursor = 0, resolved = 0;
  const tag = { id: 'tag', name: 'Keys', status: 'lost', openReportCount: reports,
    rewardAmount: reward ? 1 : 0, rewardCurrency: 'SOL', reward, recoveryCount: 0,
    publicUrl: 'https://example.test/found/tag', code: 'tag' };
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
    },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useEffect: noop,
  };
  const api = async (path, token, body, method) => {
    requests.push({ path, token, body, method });
    if (path === '/reports') return { reports: [{ id: 'report', tagId: tag.id, status: 'open' }] };
    if (path === '/reports/report/resolve') {
      if (resolveError) throw new Error(resolveError);
      return { report: { id: 'report', status: 'resolved' } };
    }
    assert.equal(path, '/tags/tag');
    return { tag: { ...tag, status: 'active', openReportCount: 0, recoveryCount: reports ? 1 : 0 } };
  };
  const ui = Object.fromEntries(['Button', 'Field', 'Icon', 'Notice', 'Pill', 'Sheet'].map(name => [name, name]));
  Object.assign(ui, { useUI: () => ({ C: {}, s: {}, t: identity, locale: 'pt-BR' }), formatDate: identity });
  const dependencies = {
    react, 'react-native': { View: 'View', Text: 'Text', ActivityIndicator: 'ActivityIndicator',
      useWindowDimensions: () => ({ width: 400 }), ToastAndroid: { show: noop }, StyleSheet: { create: identity } },
    './ui': ui, './PreferencesProvider': { useThemedStyles: () => ({}) },
    './api': { api, API_URL: 'https://example.test/api' },
    './reward.model': { rewardLocked, rewardAwaitingConfirmation },
    './category.model': { tagCategoryLabel: () => 'Keys' }, './platform/auth': { providerNames: {} },
    './links': {}, './platform/labels': {}, './platform/nfc': {}, './platform/storage': {},
  };
  for (const name of ['react-native-qrcode-svg', './HapticPressable', './ScreenBottomSheet', './AccountActionSheet', './RewardSummary', './ConversationReward']) {
    dependencies[name] = { __esModule: true, default: name, RewardPendingNotice: 'RewardPendingNotice' };
  }
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(name => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, module, module.exports);
  const props = { tag, token: 'test-session', user: { walletAddress: 'test-wallet' }, onResolved: () => resolved++,
    onUpdated: updated => updates.push(updated), onClose: noop, onEdit: noop, onUserUpdated: noop, onTransferred: noop };
  return { requests, updates, render() { cursor = 0; return module.exports.default(props); }, get resolved() { return resolved; } };
}
function nodes(root) {
  if (!root || typeof root !== 'object') return [];
  if (Array.isArray(root)) return root.flatMap(nodes);
  return [root, ...nodes(root.props?.children), ...nodes(root.props?.headerRight), ...nodes(root.props?.overlay)];
}
function button(root, label) {
  const found = nodes(root).find(node => node.type === 'Button' && (node.props.label === label || node.props.children.flat(Infinity).includes(label)));
  assert.ok(found, `Expected button: ${label}`);
  return found.props;
}
function restoreMenu(h) {
  button(h.render(), 'Opções do objeto').onPress();
  const found = nodes(h.render()).find(node => node.props?.title === 'Já está comigo');
  assert.ok(found, 'Expected restore menu action');
  return found.props;
}

test('finding your own item permits simple restoration with or without a reserve when no reports are open', async () => {
  for (const reward of [null, reserve]) {
    const h = harness({ reward });
    const action = button(h.render(), 'Já está comigo');
    assert.equal(action.disabled, false);
    assert.equal(restoreMenu(h).disabled, false);
    action.onPress(); await tick();
    assert.deepEqual(h.requests, [{ path: '/tags/tag', token: 'test-session', body: { status: 'active' }, method: 'PATCH' }]);
    assert.equal(h.resolved, 0);
    assert.equal(h.updates[0].status, 'active');
  }
});

test('a reserve with open reports keeps plain restoration blocked in the button, menu and handler', async () => {
  const h = harness({ reward: reserve, reports: 1 });
  const action = button(h.render(), 'Já está comigo');
  assert.equal(action.disabled, true);
  assert.equal(restoreMenu(h).disabled, true);
  action.onPress(); await tick();
  assert.equal(h.requests.length, 0);
  assert.equal(h.resolved, 0);
});

test('a submitted reward operation still blocks restoration without reports', async () => {
  const h = harness({ reward: { ...reserve, operation: { status: 'submitted' } } });
  const action = button(h.render(), 'Já está comigo');
  assert.equal(action.disabled, true);
  assert.equal(restoreMenu(h).disabled, true);
  action.onPress(); await tick();
  assert.equal(h.requests.length, 0);
});

test('a return without escrow requires confirmation, resolves once and refreshes the returned tag', async () => {
  for (const reward of [null, { ...reserve, status: 'refunded' }, { ...reserve, status: 'released' }]) {
    const h = harness({ reward, reports: 2 });
    button(h.render(), 'Finalizar devolução').onPress();
    assert.equal(h.requests.length, 0, 'Opening the confirmation does not resolve reports');
    const confirm = button(h.render(), 'Confirmar');
    confirm.onPress(); confirm.onPress(); await tick();
    assert.deepEqual(h.requests.map(({ path }) => path), ['/reports', '/reports/report/resolve', '/tags/tag']);
    assert.equal(h.requests[1].method, 'POST');
    assert.equal(h.requests.some(({ method }) => method === 'PATCH'), false);
    assert.equal(h.resolved, 1);
    assert.equal(h.updates[0].openReportCount, 0);
  }
});

test('a rejected resolution shows the error without reporting a successful return', async () => {
  const h = harness({ reports: 1, resolveError: 'Reserva ainda bloqueada' });
  button(h.render(), 'Finalizar devolução').onPress();
  button(h.render(), 'Confirmar').onPress(); await tick();
  assert.equal(h.resolved, 0);
  assert.equal(h.updates.length, 0);
  assert.deepEqual(h.requests.map(({ path }) => path), ['/reports', '/reports/report/resolve']);
  assert.ok(nodes(h.render()).some(node => node.type === 'Notice' && node.props.error && node.props.text === 'Reserva ainda bloqueada'));
});
