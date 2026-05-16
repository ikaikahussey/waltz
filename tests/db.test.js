import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb } from './helpers.js';

freshDb();
const { initDb, getDb, closeDb } = await import('../lib/db.js');

test('initDb creates the multi-tenant schema', () => {
  initDb();
  const db = getDb();
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all().map((r) => r.name);
  for (const t of ['users', 'sessions', 'campaigns', 'campaign_members',
    'invites', 'campaign_voterfile', 'contacts', 'match_relationships']) {
    assert.ok(tables.includes(t), `missing table ${t}`);
  }
  closeDb();
});
