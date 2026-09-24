import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { QueryClient } from '@tanstack/react-query';
import { homePreviewTags, matchesTagFilter } from '../../src/tag-search.model.ts';

const compiled = ts.transpileModule(readFileSync(new URL('../../src/Dashboard.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;
const noop = () => {};
const identity = value => value;
const translate = (value, values = {}) => value.replace(/\{(\w+)\}/g, (_, key) => values[key]);
const key = (token, path) => ['test-session', path];
const item = { id: 'item', name: 'Keys', categoryId: 'category', category: 'Keys', categoryIcon: 'key', color: '#123456', status: 'active', recoveryCount: 0 };

// Render actual Dashboard event handlers against a QueryClient. Native screens
// remain opaque, so assertions concern navigation and cache ownership only.
function harness() {
  const cache = new QueryClient();
  cache.setQueryData(key('', '/tags'), { tags: [item] });
  cache.setQueryData(key('', '/reports'), { reports: [{ id: 'first', tagId: item.id, tagName: item.name, status: 'open' }] });
  const navigation = { top: 0, tasks: 0 };
  const slots = []; let cursor = 0, effects = [];
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
    },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useCallback: value => value,
    useEffect(effect, deps) {
      const index = cursor++, previous = slots[index];
      if (!previous || deps.some((value, i) => value !== previous[i])) effects.push(effect);
      slots[index] = deps;
    },
  };
  const ui = Object.fromEntries(['Button', 'Icon', 'Notice', 'Sheet'].map(name => [name, name]));
  ui.useUI = () => ({ C: {}, s: {}, t: translate, locale: 'en-US' }); ui.formatDate = identity;
  const dependencies = {
    react,
    '@tanstack/react-query': { useQuery: options => ({ data: cache.getQueryData(options.queryKey), isPending: false, refetch: async () => {} }) },
    './query': { queryClient: cache, apiQueryKey: key, apiQueryOptions: (path, token) => ({ queryKey: key(token, path) }), invalidateApiResources: async () => {} },
    './PreferencesProvider': { useThemedStyles: () => ({}) },
    './NotificationsProvider': { useNotifications: () => ({ unreadCount: 0 }) },
    './Navigation': { PageLayer: 'PageLayer', useNavigationState: () => navigation },
    './useScrollHeader': { useScrollHeader: () => ({}) },
    './tag-search.model': { homePreviewTags, matchesTagFilter },
    './i18n': { conversationCount: () => '1 conversation' },
    './api': { ApiError: class ApiError extends Error {} }, './ui': ui,
    'react-native': { Keyboard: { dismiss: noop }, View: 'View', Text: 'Text', RefreshControl: 'RefreshControl', StyleSheet: { create: identity } },
    'react-native-keyboard-controller': { KeyboardAwareScrollView: 'KeyboardAwareScrollView' },
    'react-native-pager-view': { __esModule: true, default: 'PagerView' },
    'react-native-reanimated': { __esModule: true, useReducedMotion: () => false, default: { View: 'AnimatedView' } },
    'react-native-svg': { __esModule: true, default: 'Svg', Defs: 'Defs', LinearGradient: 'LinearGradient', Rect: 'Rect', Stop: 'Stop' },
  };
  for (const name of ['TagRow', 'ObjectsScreen', 'NotificationsScreen', 'TagForm', 'TagDetails', 'Conversation', 'Account', 'HapticPressable']) {
    dependencies[`./${name}`] = { __esModule: true, default: name };
  }
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(name => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name];
  }, module, module.exports);
  const props = { token: 'session', user: {}, onUserUpdated: noop, onLogout: noop, onScan: noop, onHelp: noop, onExpired: noop,
    onNotificationOpened: () => { props.notification = undefined; } };
  return { cache, props, navigation, render() { cursor = 0; effects = []; const root = module.exports.default(props); for (const effect of effects) effect(); return root; } };
}
function nodes(root) {
  if (!root || typeof root !== 'object') return [];
  if (Array.isArray(root)) return root.flatMap(nodes);
  return [root, ...nodes(root.props?.children), ...nodes(root.props?.headerRight)];
}
const screen = (root, type) => nodes(root).find(node => node.type === type);
const button = (root, text) => nodes(root).find(node => node.type === 'Button' && node.props.children.flat(Infinity).includes(text));

test('selected item and edit form receive fresh category metadata from the shared collection without reload', () => {
  const h = harness();
  screen(h.render(), 'ObjectsScreen').props.onSelect(item);
  screen(h.render(), 'TagDetails').props.onEdit(item);
  const renamed = { ...item, category: 'Travel keys', categoryIcon: 'briefcase', color: '#654321' };
  h.cache.setQueryData(key('', '/tags'), { tags: [renamed] });
  const root = h.render();
  assert.deepEqual(screen(root, 'TagDetails').props.tag, renamed);
  assert.deepEqual(screen(root, 'TagForm').props.tag, renamed);
  assert.equal(screen(root, 'TagDetails').props.covered, true);
});

test('a notification replaces an existing conversation and closes covered item navigation', () => {
  const h = harness();
  h.props.notification = { reportId: 'first', finder: false }; h.render();
  assert.equal(screen(h.render(), 'Conversation').props.id, 'first');
  screen(h.render(), 'ObjectsScreen').props.onSelect(item);
  h.props.notification = { reportId: 'second', finder: true }; h.render();
  const root = h.render();
  assert.equal(screen(root, 'Conversation').props.id, 'second');
  assert.equal(screen(root, 'Conversation').props.finder, true);
  assert.equal(screen(root, 'TagDetails'), undefined);
  assert.equal(h.props.notification, undefined);
});

test('notification navigation waits for an open item form to complete its own close guard', () => {
  const h = harness();
  button(h.render(), 'Adicionar objeto').props.onPress();
  h.props.notification = { reportId: 'second', finder: false };
  const pending = h.render();
  assert.ok(screen(pending, 'TagForm'));
  assert.equal(screen(pending, 'Conversation'), undefined);
  assert.ok(h.props.notification);
  screen(pending, 'TagForm').props.onClose(); h.render();
  assert.equal(screen(h.render(), 'Conversation').props.id, 'second');
});

test('a protected modal keeps a notification queued until its financial or draft task closes', () => {
  const h = harness();
  h.props.notification = { reportId: 'first', finder: false }; h.render();
  assert.equal(screen(h.render(), 'Conversation').props.id, 'first');
  h.navigation.tasks = 1;
  h.props.notification = { reportId: 'second', finder: false }; h.render();
  assert.equal(screen(h.render(), 'Conversation').props.id, 'first');
  assert.equal(h.props.notification.reportId, 'second');
  h.navigation.tasks = 0; h.render();
  assert.equal(screen(h.render(), 'Conversation').props.id, 'second');
  assert.equal(h.props.notification, undefined);
});

test('native page selection updates the active tab and protected tasks disable swiping', () => {
  const h = harness();
  screen(h.render(), 'PagerView').props.onPageSelected({ nativeEvent: { position: 2 } });
  const root = h.render();
  assert.equal(screen(root, 'ObjectsScreen').props.active, true);
  assert.equal(nodes(root).find(node => node.props?.testID === 'tab-tags').props.accessibilityState.selected, true);
  assert.equal(screen(root, 'PagerView').props.scrollEnabled, true);
  h.navigation.tasks = 1;
  assert.equal(screen(h.render(), 'PagerView').props.scrollEnabled, false);
  h.navigation.tasks = 0;
  screen(h.render(), 'ObjectsScreen').props.onSelect(item);
  assert.equal(screen(h.render(), 'PagerView').props.scrollEnabled, false);
  screen(h.render(), 'TagDetails').props.onClose();
  assert.equal(screen(h.render(), 'PagerView').props.scrollEnabled, true);
});
