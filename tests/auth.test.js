import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb } from './helpers.js';

freshDb();
const { initDb } = await import('../lib/db.js');
const { createUser, verifyLogin } = await import('../lib/auth.js');
initDb();

test('createUser then verifyLogin succeeds with correct password', async () => {
  const u = await createUser({ email: 'A@Example.com', name: 'Ann', password: 'longenough1' });
  assert.equal(u.email, 'a@example.com');
  const ok = await verifyLogin('a@example.com', 'longenough1');
  assert.ok(ok && ok.id === u.id);
});

test('verifyLogin fails with wrong password', async () => {
  await createUser({ email: 'b@example.com', name: 'Bee', password: 'longenough1' });
  assert.equal(await verifyLogin('b@example.com', 'nope'), null);
});

test('duplicate email is rejected', async () => {
  await createUser({ email: 'c@example.com', name: 'Cee', password: 'longenough1' });
  await assert.rejects(
    () => createUser({ email: 'c@example.com', name: 'Cee2', password: 'longenough1' }),
    /already exists/,
  );
});

test('short password and bad email are rejected', async () => {
  await assert.rejects(() => createUser({ email: 'd@example.com', name: 'Dee', password: 'short' }), /at least 8/);
  await assert.rejects(() => createUser({ email: 'notanemail', name: 'Eee', password: 'longenough1' }), /valid email/);
});
