import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { Buffer } from 'buffer';
import { Keypair, PublicKey } from '@solana/web3.js';
import { receivingWalletAddress } from '@seekertag/shared/wallet-address';
import { QueryClient, MutationObserver } from '@tanstack/react-query';
import { receivingWalletFormSchema } from '../../src/form.model.ts';

const source = file => ts.transpileModule(readFileSync(new URL(`../../src/${file}`, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;
const compiledForm = source('ReceivingWalletSheet.tsx');
const compiledWallet = source('platform/reward-wallet.ts');
const identity = value => value;
const tick = () => new Promise(resolve => setImmediate(resolve));
const instantiate = (code, dependencies) => {
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, module, module.exports);
  return module.exports;
};
const recipient = Keypair.generate().publicKey.toBase58();
const currentRecipient = Keypair.generate().publicKey.toBase58();
const approval = { recipient, proof: { challengeId: 'challenge', address: 'base64-address', signedMessage: 'proof-message', signature: 'proof-signature' } };
const nodes = root => !root || typeof root !== 'object' ? [] : Array.isArray(root) ? root.flatMap(nodes) : [root, ...nodes(root.props?.children)];
function button(tree, label) {
  const found = nodes(tree).find(node => node.type === 'Button' && node.props.children.flat(Infinity).includes(label));
  assert.ok(found, `Expected button ${label}`);
  return found.props;
}
function harness({ existing, saveError, prepareGate } = {}) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false, networkMode: 'always', gcTime: Infinity } } });
  const slots = [], listeners = [], requests = [], saved = [], states = [], verifications = [];
  let cursor = 0, effects = [], dirty = true, tree, connectCount = 0;
  let props = { id: 'report', token: 'session', recipient: existing, onSaved: address => saved.push(address), onStateChange: state => states.push(state) };
  const react = {
    createElement: (type, elementProps, ...children) => typeof type === 'function' ? type({ ...elementProps, children }) : ({ type, props: { ...elementProps, children } }),
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], value => { const next = typeof value === 'function' ? value(slots[index]) : value; if (!Object.is(next, slots[index])) { slots[index] = next; dirty = true; } }];
    },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useCallback(callback, dependencies) {
      const index = cursor++;
      if (!slots[index] || dependencies.some((value, i) => !Object.is(value, slots[index].dependencies[i]))) slots[index] = { dependencies, callback };
      return slots[index].callback;
    },
    useEffect(effect, dependencies) {
      const index = cursor++;
      if (!slots[index] || dependencies.some((value, i) => !Object.is(value, slots[index].dependencies[i]))) {
        const old = slots[index]; slots[index] = { dependencies };
        effects.push(() => { old?.cleanup?.(); slots[index].cleanup = effect(); });
      }
    },
  };
  const useMutation = options => {
    const index = cursor++;
    if (!slots[index]) { slots[index] = new MutationObserver(client, options); listeners.push(slots[index].subscribe(() => { dirty = true; })); }
    else slots[index].setOptions(options);
    const observer = slots[index];
    return { ...observer.getCurrentResult(), mutateAsync: () => observer.mutate() };
  };
  const useForm = options => {
    const index = cursor++;
    if (!slots[index]) {
      const control = { values: { ...options.defaultValues }, errors: {}, change(name, value) { this.values[name] = value; dirty = true; } };
      const form = {
        control, watch: name => control.values[name], setValue: (name, value) => control.change(name, value),
        reset: values => { control.values = values; control.errors = {}; dirty = true; },
        setError: (name, error) => { control.errors = { ...control.errors, [name]: error }; dirty = true; },
        clearErrors: name => { if (name in control.errors) { delete control.errors[name]; dirty = true; } },
        handleSubmit: handler => async () => {
          const parsed = receivingWalletFormSchema.safeParse(control.values);
          if (parsed.success) return handler(parsed.data);
          control.errors = { address: { message: parsed.error.issues[0].message } }; dirty = true;
        },
        get formState() { return { errors: control.errors }; },
      };
      slots[index] = form;
    }
    return slots[index];
  };
  const { ReceivingWalletForm } = instantiate(compiledForm, {
    react, 'react-hook-form': { useForm, Controller: ({ control, name, render }) => render({ field: { value: control.values[name], onChange: value => control.change(name, value), onBlur() {} } }) },
    '@hookform/resolvers/zod': { zodResolver: identity }, 'react-native': { Text: 'Text', View: 'View', Alert: { alert() {} }, Keyboard: { dismiss() {} } },
    './api': { api: async (path, token, body) => { requests.push({ path, token, body }); if (saveError) throw new Error(saveError); return { recipient: body.address }; } },
    '@tanstack/react-query': { useMutation }, './AccountActionSheet': { __esModule: true, default: 'AccountActionSheet' },
    './ui': { Button: 'Button', Field: 'Field', Notice: 'Notice', useUI: () => ({ s: {}, t: identity, locale: 'en-US' }) },
    './platform/reward-wallet': {
      prepareFinderWallet: async () => { connectCount++; if (prepareGate) await prepareGate; return approval; },
      confirmFinderWallet: async (id, token, pending) => { verifications.push({ id, token, pending }); if (saveError) throw new Error(saveError); return pending.recipient; },
    }, './form.model': { receivingWalletFormSchema },
  });
  const render = () => { cursor = 0; effects = []; dirty = false; tree = ReceivingWalletForm(props); const pending = effects; effects = []; pending.forEach(effect => effect()); return tree; };
  return {
    client, saved, requests, states, verifications, get connects() { return connectCount; }, get tree() { return tree; },
    setAddress(value) { const field = nodes(tree).find(node => node.type === 'Field'); assert.ok(field); field.props.onChangeText(value); },
    setProps(next) { props = { ...props, ...next }; dirty = true; },
    async settle() {
      for (let i = 0; i < 30; i++) { if (dirty) render(); await tick(); if (!dirty && !client.isMutating()) return tree; }
      assert.fail('Wallet review did not settle');
    },
    dispose() { slots.forEach(slot => slot?.cleanup?.()); listeners.forEach(unsubscribe => unsubscribe()); client.clear(); },
  };
}

test('manual receiving address is reviewed in full and only saved after explicit confirmation', async t => {
  const h = harness({ existing: currentRecipient }); t.after(() => h.dispose());
  await h.settle();
  assert.equal(nodes(h.tree).find(node => node.type === 'Field').props.value, currentRecipient);
  assert.equal(h.states.at(-1).dirty, false);
  h.setAddress(recipient); await h.settle();
  button(h.tree, 'Conferir endereço').onPress(); await h.settle();
  assert.equal(h.requests.length, 0);
  assert.equal(h.saved.length, 0);
  assert.ok(nodes(h.tree).some(node => node.type === 'Text' && node.props.selectable && node.props.children.includes(recipient)));
  assert.ok(h.states.at(-1).onBack);
  const confirm = button(h.tree, 'Confirmar carteira de recebimento');
  confirm.onPress(); confirm.onPress(); await h.settle();
  assert.equal(h.requests.length, 1);
  assert.deepEqual(h.requests[0].body, { address: recipient });
  assert.deepEqual(h.saved, [recipient]);
});

test('review Back preserves the draft without changing the saved receiving address', async t => {
  const h = harness({ existing: currentRecipient }); t.after(() => h.dispose());
  await h.settle(); h.setAddress(recipient); await h.settle();
  button(h.tree, 'Conferir endereço').onPress(); await h.settle();
  h.states.at(-1).onBack(); await h.settle();
  assert.equal(nodes(h.tree).find(node => node.type === 'Field').props.value, recipient);
  assert.equal(h.states.at(-1).reviewing, false);
  assert.equal(h.requests.length, 0);
  h.setAddress(currentRecipient); await h.settle();
  assert.equal(h.states.at(-1).dirty, false);
});

test('a connected wallet waits for final review and its proof never becomes mutation data or variables', async t => {
  const h = harness(); t.after(() => h.dispose());
  await h.settle(); button(h.tree, 'Conectar carteira (opcional)').onPress(); await h.settle();
  assert.equal(h.connects, 1);
  assert.equal(h.verifications.length, 0);
  assert.equal(h.saved.length, 0);
  assert.ok(h.states.at(-1).reviewing);
  button(h.tree, 'Confirmar carteira de recebimento').onPress(); await h.settle();
  assert.deepEqual(h.saved, [recipient]);
  assert.deepEqual(h.verifications, [{ id: 'report', token: 'session', pending: approval }]);
  for (const mutation of h.client.getMutationCache().getAll()) {
    assert.equal(mutation.state.variables, undefined);
    assert.ok(mutation.state.data === undefined || mutation.state.data === recipient);
  }
});

test('a failed confirmation keeps the full address review available without replacing the current wallet', async t => {
  const h = harness({ existing: currentRecipient, saveError: 'Cannot save now' }); t.after(() => h.dispose());
  await h.settle(); h.setAddress(recipient); await h.settle();
  button(h.tree, 'Conferir endereço').onPress(); await h.settle();
  button(h.tree, 'Confirmar carteira de recebimento').onPress(); await h.settle();
  assert.equal(h.saved.length, 0);
  assert.equal(h.states.at(-1).reviewing, true);
  assert.ok(nodes(h.tree).some(node => node.type === 'Notice' && node.props.text === 'Cannot save now'));
  h.states.at(-1).onBack(); await h.settle();
  assert.equal(nodes(h.tree).find(node => node.type === 'Field').props.value, recipient);
});

test('invalid Solana addresses cannot advance to review or save', async t => {
  const h = harness(); t.after(() => h.dispose());
  await h.settle(); h.setAddress('not-a-wallet'); await h.settle();
  button(h.tree, 'Conferir endereço').onPress(); await h.settle();
  assert.equal(h.states.at(-1).reviewing, false);
  assert.equal(h.requests.length, 0);
  assert.ok(nodes(h.tree).find(node => node.type === 'Field').props.error);
});

test('wallet ownership proof is prepared without saving and verify remains a separate explicit operation', async () => {
  const publicKey = new PublicKey(recipient), calls = [];
  const proof = { address: Buffer.from(publicKey.toBytes()).toString('base64'), signed_message: 'message', signature: 'signature' };
  const wallet = instantiate(compiledWallet, {
    buffer: { Buffer }, '@solana/web3.js': { PublicKey }, '@seekertag/shared/wallet-address': { receivingWalletAddress },
    '@seekertag/shared/escrow-wire': {}, './wallet-return': { waitForWalletReturn: async () => {} },
    '../api': { api: async (path, token, body) => { calls.push({ path, token, body }); return path.endsWith('/challenge') ? { challengeId: 'challenge', payload: { uri: 'https://example.test' } } : { recipient }; } },
    '@solana-mobile/mobile-wallet-adapter-protocol': { transact: async callback => callback({ authorize: async () => ({ sign_in_result: proof }) }) },
  });
  const pending = await wallet.prepareFinderWallet('report', 'session', 'en');
  assert.equal(pending.recipient, recipient);
  assert.deepEqual(calls.map(call => call.path), ['/finder/reports/report/reward/wallet/challenge']);
  assert.equal(await wallet.confirmFinderWallet('report', 'session', pending), recipient);
  assert.deepEqual(calls.map(call => call.path), ['/finder/reports/report/reward/wallet/challenge', '/finder/reports/report/reward/wallet/verify']);
  assert.deepEqual(calls[1].body, { challengeId: 'challenge', address: proof.address, signedMessage: 'message', signature: 'signature' });
});

test('a wallet connection completing after the conversation changes cannot create a review for the new conversation', async t => {
  let finish;
  const prepareGate = new Promise(resolve => { finish = resolve; });
  const h = harness({ prepareGate }); t.after(() => h.dispose());
  await h.settle();
  button(h.tree, 'Conectar carteira (opcional)').onPress();
  await tick();
  h.setProps({ id: 'different-report', token: 'different-session' });
  finish(); await h.settle();
  assert.equal(h.states.at(-1).reviewing, false);
  assert.equal(h.verifications.length, 0);
  assert.equal(h.saved.length, 0);
});
