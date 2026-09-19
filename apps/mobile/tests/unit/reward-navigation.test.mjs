import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const noop = () => {};
const react = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
  forwardRef: component => component, useRef: current => ({ current }), useState: initial => [initial, noop],
  useEffect: noop, useCallback: value => value, useMemo: compute => compute() };
function component(file, dependencies) {
  const compiled = ts.transpileModule(readFileSync(new URL(`../../src/${file}.tsx`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(name => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name];
  }, module, module.exports);
  return module.exports.default;
}
function nodes(root) {
  if (!root || typeof root !== 'object') return [];
  if (Array.isArray(root)) return root.flatMap(nodes);
  return [root, ...nodes(root.props?.children)];
}
const base = { react, 'react-native': { Text: 'Text', View: 'View', Keyboard: { dismiss: noop } },
  './ui': { Button: 'Button', Notice: 'Notice', useUI: () => ({ C: {}, s: {}, t: value => value }) } };

test('a reward overlay has one right close control at its root and back only for an actual previous step', () => {
  let hardwareBack, closed = 0, previous = 0;
  const Sheet = component('RewardEditorSheet', { ...base,
    '@gorhom/bottom-sheet': { BottomSheetModal: 'BottomSheetModal', BottomSheetHandle: 'BottomSheetHandle', BottomSheetFooter: 'BottomSheetFooter' },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    './Navigation': { NavigationScope: 'NavigationScope', useNavigationLayer: handler => { hardwareBack = handler; return { active: true, path: [] }; } },
    './SheetBackdrop': { __esModule: true, default: 'SheetBackdrop' },
    './KeyboardAwareSheetScrollView': { __esModule: true, default: 'KeyboardAwareSheetScrollView' },
  });
  const props = { title: 'Reward', busy: false, onClose: noop, onRequestClose: () => closed++, contentKey: 'review' };
  const controls = () => {
    const tree = Sheet(props);
    const modal = nodes(tree).find(node => node.type === 'BottomSheetModal');
    return nodes(modal.props.handleComponent({})).filter(node => node.type === 'Button');
  };
  let buttons = controls();
  assert.deepEqual(buttons.map(button => button.props.icon), ['x']);
  buttons[0].props.onPress(); hardwareBack(); assert.equal(closed, 2);
  props.onBack = () => previous++;
  buttons = controls(); assert.deepEqual(buttons.map(button => button.props.icon), ['arrow-left']);
  buttons[0].props.onPress(); hardwareBack(); assert.equal(previous, 2);
  props.onBack = undefined; props.busy = true;
  buttons = controls(); assert.deepEqual(buttons.map(button => button.props.icon), ['x']);
  assert.equal(buttons[0].props.disabled, true);
  hardwareBack(); assert.equal(closed, 2);
});

test('release confirmation returns to summary only before signing; submitted and completed operations close', () => {
  const wallet = { busy: false, loading: false, discardReview: noop };
  const Sheet = component('RewardReleaseSheet', { ...base,
    './AccountActionSheet': { __esModule: true, default: 'AccountActionSheet' },
    './useReward': { useReward: () => wallet },
    './RewardReview': { __esModule: true, default: 'RewardReview', Address: 'Address', RewardReviewAction: 'RewardReviewAction' },
    './RewardSummary': { __esModule: true, default: 'RewardSummary' },
  });
  const props = { tagId: 'item', token: 'session', reportId: 'report', recipient: 'wallet', onClose: noop, onChanged: noop, onReleased: noop };
  assert.equal(Sheet(props).props.onBack, undefined);
  for (const status of ['prepared', 'expired']) {
    wallet.operation = { status };
    assert.equal(Sheet(props).props.onBack, wallet.discardReview);
  }
  for (const status of ['submitted', 'confirmed', 'failed']) {
    wallet.operation = { status };
    assert.equal(Sheet(props).props.onBack, undefined);
  }
  wallet.operation = { status: 'prepared' }; wallet.busy = true;
  assert.equal(Sheet(props).props.onBack, undefined);
});
