import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { QueryClient, QueryObserver, MutationObserver } from '@tanstack/react-query';
import { ConversationDrafts } from '../../src/navigation.model.ts';

const compiled = ts.transpileModule(readFileSync(new URL('../../src/Conversation.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;
const tick = () => new Promise(resolve => setImmediate(resolve));

// Exercise actual composer/load/send handlers, with opaque native hosts and
// a controllable API. No credentials, device state or remote messages are used.
function harness(drafts, options = {}) {
  const slots = [], pending = [], requests = [], clipboard = []; let cursor = 0, body = '', initialized = false;
  const reset = values => { body = values.body; };
  const setActiveReport = () => {};
  const markRead = async () => true;
  const props = { id: 'report-1', token: 'test-session', ...options };
  let failSend = false;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } } });
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
    'react-native': { StyleSheet: { hairlineWidth: 1 }, View: 'View', Text: 'Text', TextInput: 'TextInput', ScrollView: 'ScrollView', RefreshControl: 'RefreshControl', AppState: { currentState: 'active' }, Keyboard: { dismiss() {} }, ToastAndroid: { show() {}, SHORT: 0 } },
    'expo-clipboard': { setStringAsync: async value => { clipboard.push(value); } },
    'react-hook-form': { Controller: 'Controller', useForm: config => {
      if (!initialized) { body = config.defaultValues.body; initialized = true; }
      return { control: {}, handleSubmit: action => () => action({ body }), reset, watch: () => body, formState: { errors: {} } };
    } },
    '@hookform/resolvers/zod': { zodResolver() {} },
    '@gorhom/bottom-sheet': { BottomSheetTextInput: 'SheetInput' },
    'react-native-keyboard-controller': { useReanimatedKeyboardAnimation: () => ({ height: { value: options.keyboardHeight ?? 0 } }) },
    'react-native-reanimated': { __esModule: true, default: { View: 'AnimatedView' }, useAnimatedStyle: fn => fn() },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 24 }) },
    '@tanstack/react-query': {
      useQueryClient: () => queryClient,
      useQuery(config) {
        const index = cursor++;
        if (!slots[index]) { slots[index] = new QueryObserver(queryClient, { ...config, refetchInterval: false }); slots[index].subscribe(() => {}); }
        slots[index].setOptions({ ...config, refetchInterval: false });
        return slots[index].getCurrentResult();
      },
      useMutation(config) {
        const index = cursor++;
        if (!slots[index]) slots[index] = new MutationObserver(queryClient, config);
        slots[index].setOptions(config);
        return { ...slots[index].getCurrentResult(), mutateAsync: variables => slots[index].mutate(variables) };
      },
    },
    './query': {
      apiQueryKey: (token, path) => ['api', token, path],
      apiQueryOptions: (path, token) => ({ queryKey: ['api', token, path], queryFn: () => dependencies['./api'].api(path, token), staleTime: 10000 }),
    },
    './form.model': {},
    './ui': { Button: 'Button', Icon: 'Icon', Notice: 'Notice', Pill: 'Pill', useUI: () => ({ C: {}, s: {}, t: value => value, locale: 'en-US' }) },
    './Navigation': { useConversationDrafts: () => drafts },
    './NotificationsProvider': { useNotifications: () => ({ markRead, setActiveReport }) },
    './ReceivingWalletSheet': { __esModule: true, default: 'ReceivingWalletSheet' },
    './RewardReleaseSheet': { __esModule: true, default: 'RewardReleaseSheet' },
    './HapticPressable': { __esModule: true, default: 'Pressable' },
    './category.model': { categoryInk: () => '#ffffff', tagCategoryLabel: tag => tag.category },
    './api': { api: async (path, _token, input) => {
      requests.push({ path, input });
      if (input) { if (failSend) throw new Error('Temporary network failure'); return { message: { id: 1, body: input.body, role: props.finder ? 'finder' : 'owner', createdAt: new Date().toISOString() } }; }
      if (path.endsWith('/reward')) return { reward: options.reward ?? null, recipient: options.recipient ?? null, tagId: 'item-1' };
      return { report: { id: props.id, tagName: 'Backpack', status: options.status ?? 'open', finderName: 'Alex' }, messages: options.messages ?? [],
        tag: { name: 'Backpack', category: 'Travel bags', color: '#112233', categoryIcon: 'briefcase', status: 'lost', publicMessage: 'Please leave it at the reception.', description: 'PRIVATE NOTE: door code 1234', rewardAmount: 3, rewardCurrency: 'SKR' } };
    } },
    './AccountActionSheet': { __esModule: true, default: 'AccountActionSheet' },
    './ConversationReward': { __esModule: true, default: 'ConversationReward' },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'setInterval', 'clearInterval', compiled)(name => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`); return dependencies[name];
  }, module, module.exports, () => 1, () => {});
  return {
    requests, clipboard, props, queryClient, failSend(value) { failSend = value; },
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


test('conversation keyboard inset keeps the composer above a docked keyboard without double-counting the safe area', async () => {
  const chat = harness(new ConversationDrafts(), { keyboardHeight: -320 });
  let layout = nodes(chat.render()).find(node => node.props?.testID === 'conversation-keyboard-layout');
  assert.equal(layout.props.style[1].paddingBottom, 296);
  chat.props.covered = true;
  layout = nodes(chat.render()).find(node => node.props?.testID === 'conversation-keyboard-layout');
  assert.equal(layout.props.style[1].paddingBottom, 0);
});

test('conversation renders cached messages during refetch and isolates another report', async () => {
  const chat = harness(new ConversationDrafts());
  chat.render(); await tick();
  const key = ['api', 'test-session', '/reports/report-1'];
  chat.queryClient.setQueryData(key, previous => ({ ...previous, messages: [{ id: 8, role: 'finder', body: 'Meet at reception', createdAt: new Date().toISOString() }] }));
  const request = chat.queryClient.invalidateQueries({ queryKey: key });
  const cached = nodes(chat.render());
  assert.ok(cached.some(node => node.props?.children?.includes('Meet at reception')));
  assert.ok(!cached.some(node => node.props?.accessibilityLabel === 'Carregando conversa'));
  await request;
  chat.props.id = 'report-2';
  assert.ok(!nodes(chat.render()).some(node => node.props?.children?.includes('Meet at reception')));
});


test('finder wallet action appears after messages and before account prompt only after a successful first message', async () => {
  const chat = harness(new ConversationDrafts(), { finder: true, reward: { status: 'reserved' } });
  chat.props.historyFooter = { type: 'AccountPrompt', props: {} };
  const walletAction = tree => nodes(tree).find(node => node.props?.testID === 'conversation-receiving-wallet');
  chat.render(); await tick();
  assert.equal(walletAction(chat.render()), undefined);
  input(chat.render()).onChangeText('I found this.');
  chat.failSend(true); button(chat.render(), 'Enviar').onPress(); await tick();
  assert.equal(walletAction(chat.render()), undefined, 'A failed send cannot unlock the wallet action');
  chat.failSend(false); button(chat.render(), 'Enviar').onPress();
  assert.equal(walletAction(chat.render()), undefined, 'Pending drafts do not qualify as sent messages');
  await tick(); chat.render(); await tick();
  const tree = chat.render(), flat = nodes(tree);
  assert.ok(walletAction(tree));
  assert.ok(flat.indexOf(walletAction(tree)) > flat.findIndex(node => node.type === 'Text' && node.props?.children?.includes('I found this.')));
  assert.ok(flat.indexOf(walletAction(tree)) < flat.findIndex(node => node.type === 'AccountPrompt'));
  walletAction(tree).props.onPress();
  assert.ok(nodes(chat.render()).some(node => node.type === 'ReceivingWalletSheet'));
  assert.ok(!nodes(chat.render()).some(node => node.type === 'AccountActionSheet'), 'Wallet opens directly, without item details underneath');
  chat.queryClient.setQueryData(['api', 'test-session', '/finder/reports/report-1/reward'], { reward: { status: 'reserved' }, recipient: 'already-confirmed', tagId: 'item-1' });
  const saved = chat.render();
  assert.ok(walletAction(saved));
  assert.ok(nodes(saved).some(node => node.props?.accessibilityHint === 'already-confirmed'));
  walletAction(saved).props.onPress();
  assert.equal(nodes(chat.render()).find(node => node.type === 'ReceivingWalletSheet').props.recipient, 'already-confirmed');
});

test('finder can confirm a wallet before funding, but cannot open registration after resolution', async () => {
  for (const options of [{ reward: null }, { reward: { status: 'released' } }, { reward: { status: 'pending' } }, { reward: { status: 'reserved', operation: { status: 'submitted' } } }, { reward: { status: 'reserved' }, status: 'resolved' }]) {
    const chat = harness(new ConversationDrafts(), { finder: true, messages: [{ id: 1, role: 'finder', body: 'Found it', createdAt: new Date().toISOString() }], ...options });
    chat.render(); await tick(); chat.render(); await tick();
    assert.equal(nodes(chat.render()).some(node => node.props?.testID === 'conversation-receiving-wallet'), options.status !== 'resolved');
  }
});

test('confirmed receiving address stays visible and copies in full after resolution without opening the editor', async () => {
  const recipient = 'ConfirmedPublicWalletAddress';
  const chat = harness(new ConversationDrafts(), { finder: true, status: 'resolved', recipient,
    reward: { status: 'released' }, messages: [{ id: 1, role: 'finder', body: 'Found it', createdAt: new Date().toISOString() }] });
  chat.render(); await tick(); chat.render(); await tick();
  const tree = chat.render();
  assert.ok(nodes(tree).some(node => node.type === 'Text' && node.props.children.join('') === `${recipient.slice(0, 8)}…${recipient.slice(-8)}`));
  assert.ok(!nodes(tree).some(node => node.type === 'Text' && node.props?.children?.includes(recipient)));
  assert.equal(nodes(tree).find(node => node.props?.testID === 'conversation-receiving-wallet').props.disabled, true);
  nodes(tree).find(node => node.props?.testID === 'conversation-copy-receiving-wallet').props.onPress();
  await tick();
  assert.deepEqual(chat.clipboard, [recipient]);
  assert.ok(!nodes(chat.render()).some(node => node.type === 'ReceivingWalletSheet'));
});

test('owner finish return appears when the finder wallet arrives and opens confirmation without changing the report', async () => {
  const chat = harness(new ConversationDrafts(), { reward: { status: 'reserved' } });
  const action = tree => nodes(tree).find(node => node.props?.testID === 'conversation-finish-return');
  chat.render(); await tick(); chat.render(); await tick();
  assert.equal(action(chat.render()), undefined);
  const key = ['api', 'test-session', '/reports/report-1/reward'];
  chat.queryClient.setQueryData(key, { tagId: 'item-1', reward: { status: 'reserved' }, recipient: 'FinderWallet' });
  action(chat.render()).props.onPress();
  const sheet = nodes(chat.render()).find(node => node.type === 'RewardReleaseSheet');
  assert.equal(sheet.props.recipient, 'FinderWallet');
  assert.equal(sheet.props.reportId, 'report-1');
  assert.equal(sheet.props.tagId, 'item-1');
  assert.equal(chat.requests.filter(request => request.input).length, 0, 'Opening confirmation must not write or pay');
  assert.equal(chat.queryClient.getQueryData(['api', 'test-session', '/reports/report-1']).report.status, 'open');
  sheet.props.onClose();
  assert.ok(!nodes(chat.render()).some(node => node.type === 'RewardReleaseSheet'));
  assert.equal(chat.queryClient.getQueryData(['api', 'test-session', '/reports/report-1']).report.status, 'open');
  sheet.props.onReleased();
  assert.equal(chat.queryClient.getQueryData(['api', 'test-session', '/reports/report-1']).report.status, 'resolved');
  assert.equal(action(chat.render()), undefined);
});

test('finish return is limited to owners with an available reward and a receiving wallet', async () => {
  for (const options of [
    { finder: true }, { recipient: null }, { status: 'resolved' }, { reward: null },
    { reward: { status: 'released' } }, { reward: { status: 'refunded' } }, { reward: { status: 'pending' } },
    { reward: { status: 'reserved', operation: { kind: 'refund', status: 'submitted' } } },
  ]) {
    const chat = harness(new ConversationDrafts(), { recipient: 'FinderWallet', reward: { status: 'reserved' },
      messages: [{ id: 1, role: 'finder', body: 'Found it', createdAt: new Date().toISOString() }], ...options });
    chat.render(); await tick(); chat.render(); await tick();
    assert.ok(!nodes(chat.render()).some(node => node.props?.testID === 'conversation-finish-return'), JSON.stringify(options));
  }
  for (const reward of [{ status: 'expired' }, { status: 'reserved', operation: { kind: 'release', status: 'submitted' } }]) {
    const chat = harness(new ConversationDrafts(), { recipient: 'FinderWallet', reward });
    chat.render(); await tick(); chat.render(); await tick();
    assert.ok(nodes(chat.render()).some(node => node.props?.testID === 'conversation-finish-return'));
  }
});

test('finder item details expose public item context and reward while keeping private notes out', async () => {
  const chat = harness(new ConversationDrafts(), { finder: true });
  chat.render(); await tick(); button(chat.render(), 'Ver objeto').onPress();
  const tree = chat.render(), flat = nodes(tree), texts = flat.filter(node => node.type === 'Text').flatMap(node => node.props.children).join(' ');
  assert.match(texts, /Backpack/); assert.match(texts, /Travel bags/); assert.match(texts, /Please leave it at the reception/);
  assert.doesNotMatch(texts, /PRIVATE NOTE|1234/);
  assert.ok(flat.some(node => node.type === 'Pill' && node.props.status === 'lost'));
  assert.ok(flat.some(node => node.type === 'ConversationReward' && node.props.showReceivingWalletAction === false));
  const send = button(tree, 'Enviar');
  assert.equal(send.style.width, 58); assert.equal(send.style.height, 58);
});

test('owner and finder share the item icon, and owner navigation uses the loaded conversation', async () => {
  const opened = [];
  const owner = harness(new ConversationDrafts(), { onViewItem: report => opened.push(report) });
  const finder = harness(new ConversationDrafts(), { finder: true });
  owner.render(); finder.render(); await tick();
  assert.equal(button(owner.render(), 'Ver objeto').icon, button(finder.render(), 'Ver objeto').icon);
  button(owner.render(), 'Ver objeto').onPress();
  assert.equal(opened[0].id, 'report-1');
  assert.equal(opened[0].tagName, 'Backpack');
});


test('finder can still set a receiving wallet after the refund date while the escrow remains payable', async () => {
  const chat = harness(new ConversationDrafts(), { finder: true, reward: { status: 'expired' }, messages: [{ id: 1, role: 'finder', body: 'Found it', createdAt: new Date().toISOString() }] });
  chat.render(); await tick(); chat.render(); await tick();
  assert.ok(nodes(chat.render()).some(node => node.props?.testID === 'conversation-receiving-wallet'));
});


test('pull to refresh fetches both messages and the receiving wallet without erasing the draft', async () => {
  const options = { reward: { status: 'reserved' } };
  const chat = harness(new ConversationDrafts(), options);
  chat.render(); await tick(); chat.render(); await tick();
  input(chat.render()).onChangeText('Unsaved message');
  options.recipient = 'NewReceivingWallet';
  const list = nodes(chat.render()).find(node => node.props?.testID === 'conversation-messages');
  const before = chat.requests.length;
  list.props.refreshControl.props.onRefresh();
  assert.equal(nodes(chat.render()).find(node => node.props?.testID === 'conversation-messages').props.refreshControl.props.refreshing, true);
  await tick();
  const tree = chat.render();
  assert.deepEqual(chat.requests.slice(before).map(request => request.path).sort(), ['/reports/report-1', '/reports/report-1/reward']);
  assert.equal(nodes(tree).find(node => node.props?.testID === 'conversation-messages').props.refreshControl.props.refreshing, false);
  assert.equal(input(tree).value, 'Unsaved message');
  assert.ok(nodes(tree).some(node => node.props?.testID === 'conversation-finish-return'));
});


test('owner sees a previously confirmed wallet even without a reserved reward or a new wallet event', async () => {
  const chat = harness(new ConversationDrafts(), { recipient: 'PreviouslyConfirmedWallet', reward: null });
  chat.render(); await tick(); chat.render(); await tick();
  const row = nodes(chat.render()).find(node => node.props?.testID === 'conversation-finder-wallet');
  assert.equal(row.props.accessibilityHint, 'PreviouslyConfirmedWallet');
  row.props.onPress(); await tick();
  assert.deepEqual(chat.clipboard, ['PreviouslyConfirmedWallet']);
});
