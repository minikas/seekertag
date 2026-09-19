import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNavigationStore, ConversationDrafts } from '../../src/navigation.model.ts';

const entry = (id, path, back, task = false) => ({ id, path, back, task });

test('Back closes the child before the page even when child effects register first', () => {
  const stack = createNavigationStore(), closed = [];
  const child = stack.register(entry(2, [1, 2], () => closed.push('confirmation'), true));
  stack.register(entry(1, [1], () => closed.push('object')));
  stack.back();
  assert.deepEqual(closed, ['confirmation']);
  child(); stack.back();
  assert.deepEqual(closed, ['confirmation', 'object']);
});

test('a newer sibling page covers the whole previous subtree and reveals it on return', () => {
  const stack = createNavigationStore(), closed = [];
  stack.register(entry(1, [1], () => closed.push('account')));
  stack.register(entry(2, [1, 2], () => closed.push('categories')));
  const preview = stack.register(entry(3, [3], () => closed.push('preview')));
  stack.back(); preview(); stack.back();
  assert.deepEqual(closed, ['preview', 'categories']);
});

test('covered parent cannot consume Back; a busy active task can block it', () => {
  const stack = createNavigationStore(), closed = [];
  stack.register(entry(1, [1], () => closed.push('form'), true));
  const remove = stack.register(entry(2, [1, 2], () => {}, true));
  assert.equal(stack.back(), true);
  assert.deepEqual(closed, []);
  assert.equal(stack.getSnapshot().tasks, 2);
  remove();
  assert.equal(stack.getSnapshot().tasks, 1);
  stack.back();
  assert.deepEqual(closed, ['form']);
});

test('deferred external navigation can resume only when all tasks have closed', () => {
  const stack = createNavigationStore();
  const page = stack.register(entry(1, [1], () => {}));
  const form = stack.register(entry(2, [1, 2], () => {}, true));
  const selector = stack.register(entry(3, [1, 2, 3], () => {}, true));
  form();
  assert.equal(stack.getSnapshot().tasks, 1);
  selector();
  assert.deepEqual(stack.getSnapshot(), { top: 1, tasks: 0 });
  page(); assert.equal(stack.back(), false);
});

test('each origin remembers its own accessibility focus when a child closes', () => {
  const stack = createNavigationStore();
  stack.rememberFocus(100);
  const page = stack.register(entry(1, [1], () => {}));
  stack.rememberFocus(200);
  const sheet = stack.register(entry(2, [1, 2], () => {}, true));
  stack.rememberFocus(300);
  sheet();
  assert.equal(stack.focusTarget(stack.getSnapshot().top), 200);
  assert.equal(stack.focusTarget(2), undefined);
  page();
  assert.equal(stack.focusTarget(stack.getSnapshot().top), 100);
});

test('drafts survive conversation remounts, stay isolated per role and session, and clear on send', () => {
  const firstSession = new ConversationDrafts();
  firstSession.set('owner:report-1', 'Posso buscar às 18h.');
  firstSession.set('finder:report-1', 'Encontrei a mochila.');
  assert.equal(firstSession.get('owner:report-1'), 'Posso buscar às 18h.');
  assert.equal(firstSession.get('owner:report-2'), '');
  assert.equal(new ConversationDrafts().get('owner:report-1'), '');
  firstSession.set('owner:report-1', '');
  assert.equal(firstSession.get('owner:report-1'), '');
  assert.equal(firstSession.get('finder:report-1'), 'Encontrei a mochila.');
  firstSession.clear(); assert.equal(firstSession.get('finder:report-1'), '');
});
