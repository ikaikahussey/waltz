import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, makeClient } from './helpers.js';

freshDb();
const { initDb, getDb } = await import('../lib/db.js');
const { createApp } = await import('../lib/app.js');
initDb();
const app = createApp({ static: false });

const HOUSES = 'house_id,door_sort,address\nH1,001,1 Main St\nH2,002,2 Main St\n';
const VOTERS = 'voter_id,house_id,first_name,last_name,zip\n' +
  'V1,H1,Robert,Smith,90210\nV2,H2,Jane,Doe,90210\n';

test('end-to-end: signup, campaign, invite, join, upload, walk, match', async () => {
  const admin = makeClient(app);

  // Admin signs up (auto session) and creates a campaign.
  let r = await admin.req('/signup', { form: { name: 'Admin', email: 'admin@x.com', password: 'longenough1' } });
  assert.equal(r.status, 302);
  r = await admin.req('/campaigns', { method: 'POST', form: { name: 'Test Campaign' } });
  assert.equal(r.status, 302);
  const campaignId = r.headers.get('location').split('/')[2];
  assert.ok(campaignId.startsWith('c_'));

  // Admin generates a volunteer invite.
  r = await admin.req(`/c/${campaignId}/admin/invites`, { method: 'POST', form: { role: 'volunteer', count: '1' } });
  assert.equal(r.status, 302);
  const invite = getDb().prepare('SELECT hash FROM invites WHERE campaign_id = ?').get(campaignId);
  assert.ok(invite && invite.hash);

  // A non-member cannot reach the campaign tools.
  const vol = makeClient(app);
  await vol.req('/signup', { form: { name: 'Val', email: 'val@x.com', password: 'longenough1' } });
  r = await vol.req(`/c/${campaignId}/walk`);
  assert.equal(r.status, 403);

  // Volunteer accepts the invite.
  r = await vol.req(`/join/${invite.hash}`, { method: 'POST' });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), `/c/${campaignId}/walk`);

  // The invite is now single-use.
  r = await vol.req(`/join/${invite.hash}`, { method: 'POST' });
  assert.equal(r.status, 409);

  // Before a voter file exists, app-data is 404.
  r = await vol.req(`/c/${campaignId}/api/app-data`);
  assert.equal(r.status, 404);

  // Admin uploads the voter file (multipart).
  const fd = new FormData();
  fd.append('houses', new Blob([HOUSES], { type: 'text/csv' }), 'houses.csv');
  fd.append('voters', new Blob([VOTERS], { type: 'text/csv' }), 'voters.csv');
  r = await admin.req(`/c/${campaignId}/admin/voters`, { method: 'POST', body: fd });
  assert.equal(r.status, 302);

  // Volunteer can now load voter data.
  r = await vol.req(`/c/${campaignId}/api/app-data`);
  assert.equal(r.status, 200);
  const appData = await r.json();
  assert.equal(appData.houses.length, 2);
  assert.equal(appData.voters.length, 2);

  // Volunteer records a contact (idempotent on client_uuid).
  r = await vol.req(`/c/${campaignId}/api/contact`, {
    method: 'POST',
    json: { client_uuid: 'cu-1', voter_id: 'V1', score: 5, notes: 'supportive' },
  });
  assert.equal(r.status, 200);
  r = await vol.req(`/c/${campaignId}/api/contact`, {
    method: 'POST',
    json: { client_uuid: 'cu-1', voter_id: 'V1', score: 5 },
  });
  assert.equal((await r.json()).existing, true);

  // Admin CSV export includes it.
  r = await admin.req(`/c/${campaignId}/admin/contacts.csv`);
  const csv = await r.text();
  assert.match(csv, /cu-1,V1/);

  // Match: session reports the per-campaign salt + voter count.
  r = await vol.req(`/c/${campaignId}/api/match/session`);
  const sess = await r.json();
  assert.equal(sess.voterCount, 2);
  assert.ok(sess.salt);

  // The salt must match what the index was built with: hashing
  // "name:robert:smith" should match voter V1 at medium confidence.
  const { saltedHash } = await import('../lib/match-normalize.js');
  const h = saltedHash(sess.salt, 'name:robert:smith');
  r = await vol.req(`/c/${campaignId}/api/match`, { method: 'POST', json: { hashes: [h] } });
  const { matches } = await r.json();
  assert.equal(matches.length, 1);
  assert.equal(matches[0].voter.voter_id, 'V1');

  // Confirm the relationship; it is scoped per campaign + user.
  r = await vol.req(`/c/${campaignId}/api/match/confirm`, {
    method: 'POST', json: { voter_id: 'V1', relationshipTag: 'friend', matchType: matches[0].matchType },
  });
  assert.equal(r.status, 200);
  r = await vol.req(`/c/${campaignId}/api/match/mine`);
  const mine = await r.json();
  assert.equal(mine.relationships[0].voter_id, 'V1');
  assert.equal(mine.relationships[0].relationship_tag, 'friend');
});
