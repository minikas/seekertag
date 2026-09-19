import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { QueryClient } from '@tanstack/react-query';

const compiled = ts.transpileModule(readFileSync(new URL('../../src/TagForm.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;
const noop = () => {};
const identity = value => value;
const key = (token, path) => ['test-session', path];
const a = { id: 'a', name: 'Keys', icon: 'key', color: '#123456' };
const b = { id: 'b', name: 'Bags', icon: 'briefcase', color: '#654321' };
const tag = { id: 'item', name: 'My keys', categoryId: 'a', description: '', publicMessage: 'Thanks', rewardAmount: 0 };

function harness() {
  const cache = new QueryClient();
  cache.setQueryData(key('', '/categories'), { categories: [a, b] });
  cache.setQueryData(key('', '/tags/item'), { tag });
  const wallet = { loading: false, busy: false };
  const slots = []; let cursor = 0, effects = [], fields, resets = 0;
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
    },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useCallback: value => value, useMemo: compute => compute(),
    useEffect(effect, deps = []) {
      const index = cursor++, previous = slots[index];
      if (!previous || deps.some((value, i) => value !== previous[i])) effects.push(effect);
      slots[index] = deps;
    },
  };
  react.useLayoutEffect = react.useEffect;
  const ui = Object.fromEntries(['Button', 'Field', 'Icon', 'Notice'].map(name => [name, name]));
  ui.useUI = () => ({ C: {}, s: {}, t: identity, locale: 'en-US' });
  const dependencies = {
    react,
    '@tanstack/react-query': {
      useQuery: options => ({ data: cache.getQueryData(options.queryKey), isPending: false, refetch: async () => {} }),
      useMutation: options => ({ mutateAsync: options.mutationFn, isPending: false }),
    },
    './query': { queryClient: cache, apiQueryKey: key, apiQueryOptions: (path, token) => ({ queryKey: key(token, path) }) },
    './PreferencesProvider': { useThemedStyles: () => ({}) },
    './Navigation': { NavigationScope: 'NavigationScope', useNavigationLayer: () => ({ path: 'form', active: true }) },
    './api': {}, './ui': ui,
    'react-hook-form': { Controller: 'Controller', useForm: ({ defaultValues }) => {
      fields ??= { ...defaultValues };
      return { control: {}, watch: name => fields[name], handleSubmit: fn => () => fn(fields), reset: values => { fields = { ...values }; resets++; },
        formState: { errors: {}, isDirty: Object.keys(defaultValues).some(name => defaultValues[name] !== fields[name]) } };
    } },
    '@hookform/resolvers/zod': { zodResolver: noop }, './form.model': {},
    './category.model': { categoryLabel: category => category.name },
    'react-native': { View: 'View', Text: 'Text', ActivityIndicator: 'ActivityIndicator', Keyboard: { dismiss: noop }, ToastAndroid: { show: noop }, StyleSheet: { create: identity } },
    '@gorhom/bottom-sheet': { BottomSheetFooter: 'BottomSheetFooter', BottomSheetHandle: 'BottomSheetHandle', BottomSheetModal: 'BottomSheetModal' },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    './reward.model': { canonicalRewardAmount: identity, reservationDeadline: () => new Date(), reservationSeconds: () => 2592000,
      rewardInput: identity, rewardLocked: () => false, rewardAwaitingConfirmation: () => false },
    '@seekertag/shared/reward': { amountToUnits: () => 0n, MAX_REWARD_SECONDS: 31536000, REWARD_DECIMALS: { SKR: 6 } },
    './useReward': { useReward: () => wallet },
    './platform/auth': {},
  };
  for (const name of ['HapticPressable', 'SheetBackdrop', 'Categories', 'KeyboardAwareSheetScrollView', 'RewardFields', 'RewardReview', 'RewardEditorSheet', 'RewardSummary', 'AccountActionSheet']) {
    dependencies[`./${name}`] = { __esModule: true, default: name, RewardPendingNotice: 'RewardPendingNotice', RewardNetworkBadge: 'RewardNetworkBadge', RewardPeriod: 'RewardPeriod', reviewTitle: () => 'Review deposit' };
  }
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(name => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name];
  }, module, module.exports);
  const props = { token: 'session', tag, user: { walletAddress: 'wallet' }, onUserUpdated: noop, onClose: noop, onSaved: noop };
  return { cache, wallet, get fields() { return fields; }, get resets() { return resets; }, render() {
    cursor = 0; effects = []; const root = module.exports.default(props); for (const effect of effects) effect(); return root;
  } };
}
function nodes(root) {
  if (!root || typeof root !== 'object') return [];
  if (Array.isArray(root)) return root.flatMap(nodes);
  return [root, ...nodes(root.props?.children)];
}
const category = (root, label) => nodes(root).find(node => node.type === 'HapticPressable' && node.props.accessibilityLabel === label);

test('category edits refresh names/icons while an item form keeps unsaved text and a valid selected category', () => {
  const h = harness(); h.render();
  h.fields.name = 'Unsaved new name';
  category(h.render(), 'Bags').props.onPress();
  h.cache.setQueryData(key('', '/categories'), { categories: [{ ...a, name: 'Travel keys', icon: 'airplane' }, b] });
  h.render(); const root = h.render();
  assert.ok(category(root, 'Travel keys'));
  assert.equal(category(root, 'Bags').props.accessibilityState.selected, true);
  assert.equal(h.fields.name, 'Unsaved new name');
  assert.equal(h.resets, 0);
});

test('deleting an untouched category follows its replacement without marking the item draft dirty', () => {
  const h = harness(); h.render();
  h.cache.setQueryData(key('', '/categories'), { categories: [b] }); h.render();
  h.cache.setQueryData(key('', '/tags/item'), { tag: { ...tag, categoryId: 'b' } }); h.render();
  const root = h.render();
  assert.equal(category(root, 'Bags').props.accessibilityState.selected, true);
  assert.equal(nodes(root).find(node => node.type === 'BottomSheetModal').props.enablePanDownToClose, true);
  assert.equal(h.resets, 0);
});

test('reward review permits back only before signing and uses close after submission or confirmation', () => {
  const h = harness();
  h.wallet.operation = { operation: { id: 'op', spec: { kind: 'fund' } }, status: 'prepared' };
  h.render();
  const sheet = () => nodes(h.render()).find(node => node.type === 'RewardEditorSheet');
  assert.equal(typeof sheet().props.onBack, 'function');
  h.wallet.busy = true;
  assert.equal(sheet().props.onBack, undefined);
  h.wallet.busy = false;
  for (const status of ['submitted', 'confirmed', 'failed']) {
    h.wallet.operation.status = status;
    assert.equal(sheet().props.onBack, undefined, status);
  }
  h.wallet.operation.status = 'expired';
  assert.equal(typeof sheet().props.onBack, 'function');
});
