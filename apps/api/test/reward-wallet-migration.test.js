import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createRewards } from '../rewards/index.js';

test('legacy receiving wallets retain their signature verification after an idempotent migration', t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  db.exec(`CREATE TABLE finder_reward_wallets (report_id TEXT PRIMARY KEY, address TEXT NOT NULL, verified_at TEXT NOT NULL) STRICT;
    INSERT INTO finder_reward_wallets VALUES ('report', 'existing-wallet', '2026-09-18T00:00:00.000Z');`);
  const deps = { db, all: (sql, ...params) => db.prepare(sql).all(...params), run: (sql, ...params) => db.prepare(sql).run(...params) };
  createRewards(deps);
  createRewards(deps);
  assert.deepEqual({ ...db.prepare('SELECT * FROM finder_reward_wallets').get() }, {
    report_id: 'report', address: 'existing-wallet', verified_at: '2026-09-18T00:00:00.000Z', confirmation_method: 'signature',
  });
});
