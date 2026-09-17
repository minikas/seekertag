import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../app.js';
import { DatabaseSync } from 'node:sqlite';
import { createCategories } from '../categories.js';

async function setup(t) {
  const app = createApp({ dbPath: ':memory:', rateLimits: false });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => server.close(resolve)); app.locals.close(); });
  const request = async (path, token, body, method = body === undefined ? 'GET' : 'POST') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    return { status: response.status, data: response.status === 204 ? null : await response.json() };
  };
  const owner = (await request('/auth/register', null, { name: 'Owner', email: 'owner@example.com', password: 'category password' })).data;
  const stranger = (await request('/auth/register', null, { name: 'Other', email: 'other@example.com', password: 'category password' })).data;
  return { app, request, owner, stranger };
}

test('categories seed once, belong to each account, validate names and can be removed permanently', async t => {
  const { request, owner, stranger } = await setup(t);
  assert.equal((await request('/categories')).status, 401);
  const initial = (await request('/categories', owner.token)).data.categories;
  assert.equal(initial.length, 6);
  assert.deepEqual((await request('/categories', owner.token)).data.categories, initial);
  const other = (await request('/categories', stranger.token)).data.categories;
  assert.ok(other.every(c => !initial.some(mine => c.id === mine.id)));
  const created = await request('/categories', owner.token, { name: '  Bicicleta  ', icon: 'truck', color: '#304441' });
  assert.equal(created.status, 201); assert.equal(created.data.category.name, 'Bicicleta');
  assert.equal((await request('/categories', owner.token, { name: 'BICICLETA' })).status, 409);
  for (const body of [{ name: '' }, { name: 'x'.repeat(33) }, { name: 'Bike', icon: 'invalid' }, { name: 'Bike', color: 'red' }]) {
    assert.equal((await request('/categories', owner.token, body)).status, 400);
  }
  assert.equal((await request(`/categories/${initial[0].id}`, stranger.token, { name: 'Stolen' }, 'PATCH')).status, 404);
  assert.equal((await request(`/categories/${initial[0].id}`, stranger.token, {}, 'DELETE')).status, 404);
  assert.equal((await request(`/categories/${initial[0].id}`, owner.token, {}, 'DELETE')).status, 204);
  assert.ok(!(await request('/categories', owner.token)).data.categories.some(c => c.id === initial[0].id));
  assert.ok(!(await request('/categories', owner.token)).data.categories.some(c => c.defaultKey === initial[0].defaultKey));
});

test('renaming updates linked objects; deleting in-use categories requires an owned replacement atomically', async t => {
  const { request, owner, stranger } = await setup(t);
  const categories = (await request('/categories', owner.token)).data.categories;
  const other = (await request('/categories', stranger.token)).data.categories[0];
  const original = categories[0]; const replacement = categories[1];
  const tag = (await request('/tags', owner.token, { name: 'Bag', categoryId: original.id })).data.tag;
  assert.equal(tag.categoryId, original.id); assert.equal(tag.categoryDefaultKey, 'backpack');
  assert.equal((await request('/tags', owner.token, { name: 'Bad', categoryId: other.id })).status, 404);
  const renamed = await request(`/categories/${original.id}`, owner.token, { name: 'Trabalho', icon: 'briefcase' }, 'PATCH');
  assert.equal(renamed.data.category.defaultKey, null);
  let current = (await request(`/tags/${tag.id}`, owner.token)).data.tag;
  assert.equal(current.category, 'Trabalho'); assert.equal(current.categoryIcon, 'briefcase');
  assert.equal((await request(`/categories/${original.id}`, owner.token, {}, 'DELETE')).status, 409);
  assert.equal((await request(`/categories/${original.id}`, owner.token, { replacementId: other.id }, 'DELETE')).status, 404);
  assert.equal((await request(`/categories/${original.id}`, owner.token, { replacementId: original.id }, 'DELETE')).status, 400);
  current = (await request(`/tags/${tag.id}`, owner.token)).data.tag;
  assert.equal(current.categoryId, original.id);
  assert.equal((await request(`/categories/${original.id}`, owner.token, { replacementId: replacement.id }, 'DELETE')).status, 204);
  current = (await request(`/tags/${tag.id}`, owner.token)).data.tag;
  assert.equal(current.categoryId, replacement.id); assert.equal(current.code, tag.code);
  assert.equal((await request('/categories', owner.token)).data.categories.find(c => c.id === replacement.id).tagCount, 1);
});

test('legacy writes attach categories and transfers copy custom categories without sharing ownership', async t => {
  const { request, app, owner, stranger } = await setup(t);
  const tag = (await request('/tags', owner.token, { name: 'Bike', category: 'Bicicleta', color: '#123456' })).data.tag;
  assert.ok(tag.categoryId);
  const moved = await request(`/tags/${tag.id}/transfer`, owner.token, { recipient: stranger.user.id, password: 'category password' });
  assert.equal(moved.status, 200);
  const received = (await request(`/tags/${tag.id}`, stranger.token)).data.tag;
  assert.notEqual(received.categoryId, tag.categoryId); assert.equal(received.category, 'Bicicleta');
  await request(`/categories/${tag.categoryId}`, owner.token, { name: 'Changed' }, 'PATCH');
  assert.equal((await request(`/tags/${tag.id}`, stranger.token)).data.tag.category, 'Bicicleta');
  assert.deepEqual(app.locals.db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('migration attaches legacy tags without changing QR, private data or colors and is idempotent', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`PRAGMA foreign_keys=ON;
      CREATE TABLE users(id TEXT PRIMARY KEY);
      CREATE TABLE tags(id TEXT PRIMARY KEY, owner_id TEXT REFERENCES users(id), category TEXT, color TEXT, code TEXT, description TEXT);
      INSERT INTO users VALUES('owner');
      INSERT INTO tags VALUES('tag', 'owner', 'Mochila', '#AABBCC', 'stable-qr', 'private note');
      INSERT INTO tags VALUES('custom', 'owner', 'Patins', '#123456', 'custom-qr', 'custom note');`);
    const config = { db, get: (sql, ...args) => db.prepare(sql).get(...args), all: (sql, ...args) => db.prepare(sql).all(...args), run: (sql, ...args) => db.prepare(sql).run(...args), transaction: fn => { db.exec('BEGIN'); try { const value = fn(); db.exec('COMMIT'); return value; } catch (e) { db.exec('ROLLBACK'); throw e; } }, fail: () => assert.fail('migration should not fail') };
    createCategories(config);
    const migrated = config.all('SELECT * FROM tags');
    assert.equal(migrated[0].code, 'stable-qr'); assert.equal(migrated[0].color, '#AABBCC'); assert.equal(migrated[0].description, 'private note');
    assert.ok(migrated.every(tag => tag.category_id));
    assert.equal(config.get('SELECT COUNT(*) AS n FROM categories').n, 7);
    db.exec("DELETE FROM categories WHERE default_key='pet'");
    createCategories(config);
    assert.deepEqual(config.all('SELECT * FROM tags'), migrated);
    assert.equal(config.get('SELECT COUNT(*) AS n FROM categories').n, 6);
    assert.deepEqual(config.all('PRAGMA foreign_key_check'), []);
  } finally { db.close(); }
});

test('category quota covers legacy writes and transfer fails atomically when the target is full', async t => {
  const { request, owner, stranger } = await setup(t);
  const initial = (await request('/categories', stranger.token)).data.categories;
  await request(`/categories/${initial.find(c => c.defaultKey === 'other').id}`, stranger.token, {}, 'DELETE');
  for (let i = 0; i < 45; i++) assert.equal((await request('/categories', stranger.token, { name: `Custom ${i}` })).status, 201);
  assert.equal((await request('/categories', stranger.token, { name: 'Over quota' })).status, 409);
  assert.equal((await request('/tags', stranger.token, { name: 'Default legacy category' })).status, 409);
  const tag = (await request('/tags', owner.token, { name: 'Bike', category: 'Bicycle' })).data.tag;
  assert.equal((await request(`/tags/${tag.id}/transfer`, owner.token, { recipient: stranger.user.id, password: 'category password' })).status, 409);
  assert.equal((await request(`/tags/${tag.id}`, owner.token)).data.tag.code, tag.code);
  assert.equal((await request(`/tags/${tag.id}`, stranger.token)).status, 404);
});
