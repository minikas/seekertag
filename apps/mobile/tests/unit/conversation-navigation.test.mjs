import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { ConversationDrafts } from '../../src/navigation.model.ts';

const compiled = ts.transpileModule(readFileSync(new URL('../../src/Conversation.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;
const tick = () => new Promise(resolve => setImmediate(resolve));

// Exercise actual composer/load/send handlers, with opaque native hosts and
// a controllable API. No credentials, device state or remote messages are used.
function harness(drafts, options = {}) {
  const slots = [], pending = [], requests = []; let cursor = 0, body = '', initialized = false;
  const reset = values => { body = values.body; };
  const setActiveReport = () => {};
  const markRead = async () => true;
  const props = { id: 'report-1', token: 'test-session', ...options };
  let failSend = false;
  const react = {
    createElement(type, props, ...children) {
      if (type === 'Controller') return props.render({ field: { value: body, onChange: value => { body = value; }, onBlur() {} } });
      return { type, props: { ...props, children } };
    },
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
    },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useEffect(effect, deps) {
      const index = cursor++, previous = slots[index];
      if (!previous || deps.some((value, i) => value !== previous[i])) pending.push(effect);
      slots[index] = deps;
    },
  };
  const dependencies = {
    react,
    'react-native': { View: 'View', Text: 'Text', TextInput: 'TextInput', ScrollView: 'ScrollView', AppState: { currentState: 'active' } },
    'react-hook-form': { Controller: 'Controller', useForm: config => {
      if (!initialized) { body = config.defaultValues.body; initialized = true; }
      return { control: {}, handleSubmit: action => () => action({ body }), reset, watch: () => body, formState: { errors: {} } };
    } },
    '@hookform/resolvers/zod': { zodResolver() {} },
    '@gorhom/bottom-sheet': { BottomSheetTextInput: 'SheetInput' },
    'react-native-keyboard-controller': { KeyboardAvoidingView: 'KeyboardAvoidingView' },
    './form.model': {},
    './ui': { Button: 'Button', Icon: 'Icon', Notice: 'Notice', useUI: () => ({ C: {}, s: {}, t: value => value, locale: 'en-US' }) },
    './Navigation': { useConversationDrafts: () => drafts },
    './NotificationsProvider': { useNotifications: () => ({ markRead, setActiveReport }) },
    './ReceivingWalletSheet': { ReceivingWalletForm: 'ReceivingWalletForm' },
    './api': { api: async (path, _token, input) => {
      requests.push({ path, input });
      if (input) { if (failSend) throw new Error('Temporary network failure'); return { message: { id: 1, body: input.body, role: props.finder ? 'finder' : 'owner', createdAt: new Date().toISOString() } }; }
      return { report: { id: props.id, tagName: 'Backpack', status: 'open', finderName: 'Alex' }, messages: [] };
    } },
    './AccountActionSheet': { __esModule: true, default: 'AccountActionSheet' },
    './ConversationReward': { __esModule: true, default: 'ConversationReward' },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'setInterval', 'clearInterval', compiled)(name => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`); return dependencies[name];
  }, module, module.exports, () => 1, () => {});
  return {
    requests, props, failSend(value) { failSend = value; },
    render() { cursor = 0; const tree = module.exports.default(props); pending.splice(0).forEach(effect => effect()); return tree; },
  };
}
function nodes(root) {
  if (!root || typeof root !== 'object') return [];
  if (Array.isArray(root)) return root.flatMap(nodes);
  return [root, ...nodes(root.props?.children)];
}
const input = tree => nodes(tree).find(node => ['TextInput', 'SheetInput'].includes(node.type)).props;
const button = (tree, label) => nodes(tree).find(node => node.type === 'Button' && node.props.label === label).props;

test('real chat composer restores its draft after covering the page and remounting', async () => {
  const drafts = new ConversationDrafts(), first = harness(drafts);
  first.render(); await tick();
  input(first.render()).onChangeText('See you at the desk.');
  first.props.covered = true;
  assert.equal(input(first.render()).value, 'See you at the desk.');
  const reopened = harness(drafts); reopened.render(); await tick();
  assert.equal(input(reopened.render()).value, 'See you at the desk.');
  const another = harness(drafts, { id: 'report-2' }); another.render(); await tick();
  assert.equal(input(another.render()).value, '');
});

test('failed sends retain the real composer draft; successful sends clear it', async () => {
  const drafts = new ConversationDrafts(), chat = harness(drafts);
  chat.render(); await tick(); input(chat.render()).onChangeText('I can collect it.');
  chat.failSend(true); button(chat.render(), 'Enviar').onPress(); await tick();
  assert.equal(input(chat.render()).value, 'I can collect it.');
  assert.equal(drafts.get('owner:report-1'), 'I can collect it.');
  chat.failSend(false); button(chat.render(), 'Enviar').onPress();
  assert.equal(input(chat.render()).editable, false);
  await tick();
  assert.equal(input(chat.render()).value, '');
  assert.equal(drafts.get('owner:report-1'), '');
});

test('finder chat exposes reward details through both presentation entry points', async () => {
  for (const presentation of ['page', 'sheet']) {
    const chat = harness(new ConversationDrafts(), { finder: true, presentation });
    chat.render(); await tick(); button(chat.render(), 'Ver objeto').onPress();
    assert.ok(nodes(chat.render()).some(node => node.type === 'ConversationReward' && node.props.finder));
  }
});
