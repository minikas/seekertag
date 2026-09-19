import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const compile = file => ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;
const platformCode = compile('../../src/platform/notifications.ts');
const providerCode = compile('../../src/NotificationsProvider.tsx');
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness() {
  const pushListeners = new Set(), appListeners = new Set(), effects = [], cleanups = [], requests = [];
  let nativeGets = 0, fail = false, now = 0, permitted = true;
  let deviceToken = { type: 'android', data: 'test-device-token' };
  const subscribe = (listeners, listener) => { listeners.add(listener); return { remove: () => listeners.delete(listener) }; };
  const notifications = {
    AndroidImportance: { HIGH: 4 }, AndroidNotificationVisibility: { PRIVATE: 0 },
    setNotificationChannelAsync: async () => {},
    getPermissionsAsync: async () => ({ granted: permitted, canAskAgain: false }),
    getDevicePushTokenAsync: async () => {
      nativeGets++;
      assert.ok(nativeGets <= 8, 'Native token getter recursively re-entered its listener');
      // Match Expo Android: obtaining the token also publishes a token event.
      for (const listener of pushListeners) listener(deviceToken);
      return deviceToken;
    },
    addPushTokenListener: listener => subscribe(pushListeners, listener),
    setNotificationHandler() {},
    addNotificationReceivedListener: () => ({ remove() {} }),
    addNotificationResponseReceivedListener: () => ({ remove() {} }),
    getLastNotificationResponse: () => undefined,
  };
  const api = async (path, session, input) => {
    if (path === '/notifications/devices') {
      requests.push({ session, input });
      await tick();
      if (fail) throw new Error('Temporary network failure');
      return { enabled: true };
    }
    return { notifications: [], unreadCount: 0, latestId: 0, nextCursor: null };
  };
  const react = {
    createContext: () => ({ Provider: 'Provider' }),
    createElement: (type, props) => ({ type, props }),
    useState: initial => [initial, () => {}], useRef: current => ({ current }),
    useCallback: callback => callback, useEffect: effect => effects.push(effect),
  };
  function evaluate(code, dependencies) {
    const module = { exports: {} };
    new Function('require', 'module', 'exports', 'setInterval', 'clearInterval', 'Date', code)(name => {
      assert.ok(name in dependencies, `Unexpected dependency: ${name}`); return dependencies[name];
    }, module, module.exports, () => 1, () => {}, { now: () => now });
    return module.exports;
  }
  const platform = evaluate(platformCode, { 'expo-notifications': notifications,
    'expo-constants': { expoConfig: { extra: { firebaseProjectId: 'test-project' } } }, '../api': { api } });
  const provider = evaluate(providerCode, {
    react, 'react-native': { AppState: { currentState: 'active', addEventListener: (_event, listener) => subscribe(appListeners, listener) } },
    './api': { api, API_URL: 'https://example.test/api', ApiError: Error },
    './PreferencesProvider': { usePreferences: () => ({ language: 'en' }) },
    './ui': { useUI: () => ({ t: value => value }) },
    './platform/notifications': platform,
    './platform/storage': { secureStorage: { get: async () => '1', set: async () => {} } },
    './notifications.model': { newNotifications: () => [] },
  });
  return {
    requests, platform, get nativeGets() { return nativeGets; },
    fail(value) { fail = value; }, permit(value) { permitted = value; }, advance(ms) { now += ms; },
    mount(token = 'test-session') {
      provider.NotificationsProvider({ token, userId: 'test-user', onOpen() {} });
      effects.splice(0).forEach(effect => { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); });
    },
    unmount() { cleanups.splice(0).forEach(cleanup => cleanup()); },
    foreground() { appListeners.forEach(listener => listener('active')); },
    rotate(data) { deviceToken = { ...deviceToken, data }; pushListeners.forEach(listener => listener(deviceToken)); },
    async settle() { await tick(); await tick(); await tick(); },
  };
}

test('actual provider registers once when Android token getter emits its listener', async () => {
  const h = harness(); h.mount(); await h.settle();
  assert.equal(h.nativeGets, 1);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].input.token, 'test-device-token');
  for (let i = 0; i < 5; i++) h.foreground();
  await h.settle();
  assert.equal(h.nativeGets, 6, 'One native lookup per foreground, without recursive lookups');
  assert.equal(h.requests.length, 1, 'Foreground callbacks reuse a recent registration');
  h.unmount();
});

test('token rotation uses the event token, deduplicates events and stops on unmount', async () => {
  const h = harness(); h.mount(); await h.settle();
  h.rotate('rotated-token'); h.rotate('rotated-token'); await h.settle();
  assert.equal(h.nativeGets, 1);
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].input.token, 'rotated-token');
  h.unmount(); h.rotate('after-unmount'); await h.settle();
  assert.equal(h.requests.length, 2);
});

test('failed push registration stops and can retry on the next foreground', async () => {
  const h = harness(); h.fail(true); h.mount(); await h.settle();
  assert.equal(h.nativeGets, 1);
  assert.equal(h.requests.length, 1);
  h.fail(false); h.foreground(); await h.settle();
  assert.equal(h.requests.length, 2);
  assert.equal(h.nativeGets, 2);
  h.unmount();
});

test('registration cache respects session, language and expiry', async () => {
  const h = harness(), push = { type: 'android', data: 'test-device-token' };
  const register = (session = 'session-a', language = 'en') => h.platform.registerPush(session, language, push);
  assert.deepEqual(await Promise.all([register(), register()]), [true, true]);
  assert.equal(h.requests.length, 1);
  await register('session-b'); await register('session-b', 'pt');
  assert.equal(h.requests.length, 3);
  await register('session-b', 'pt'); assert.equal(h.requests.length, 3);
  h.advance(5 * 60 * 1000); await register('session-b', 'pt');
  assert.equal(h.requests.length, 4);
  assert.equal(h.nativeGets, 0);
});

test('denied permission and signed-out sessions never register a token', async () => {
  for (const signedIn of [true, false]) {
    const h = harness(); h.permit(!signedIn); h.mount(signedIn ? 'test-session' : null);
    h.rotate('token-event'); h.foreground(); await h.settle();
    assert.equal(h.nativeGets, 0); assert.equal(h.requests.length, 0);
    h.unmount();
  }
});
