// routes/tools.js — Per-campaign walk + match tools and their APIs.
// Mounted at /c/:campaignId. Membership required for everything.

import { Hono } from 'hono';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getDb } from '../lib/db.js';
import { requireMember } from '../lib/auth.js';
import { getIndex, matchHashes, getCampaignSalt } from '../lib/voter-index.js';

const router = new Hono();
const member = requireMember();

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const WALK_HTML = readFileSync(join(PUBLIC, 'walk.html'), 'utf8');
const MATCH_HTML = readFileSync(join(PUBLIC, 'match.html'), 'utf8');

router.get('/walk', member, (c) => c.html(WALK_HTML));
router.get('/match', member, (c) => c.html(MATCH_HTML));

// Voter payload. Auth-gated and campaign-scoped — unlike single-tenant
// walk (which inlines it at build time), Waltz must serve it per campaign.
router.get('/api/app-data', member, (c) => {
  const campaign = c.get('campaign');
  const row = getDb()
    .prepare('SELECT app_data FROM campaign_voterfile WHERE campaign_id = ?')
    .get(campaign.id);
  if (!row) return c.json({ error: 'no voter file uploaded yet' }, 404);
  return c.body(row.app_data, 200, { 'Content-Type': 'application/json; charset=utf-8' });
});

router.post('/api/contact', member, async (c) => {
  const user = c.get('user');
  const campaign = c.get('campaign');
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid json' }, 400); }

  const clientUuid = typeof body.client_uuid === 'string' ? body.client_uuid : '';
  const voterId = typeof body.voter_id === 'string' && body.voter_id ? body.voter_id : null;
  const houseId = typeof body.house_id === 'string' && body.house_id ? body.house_id : null;
  const houseStatus = typeof body.house_status === 'string' ? body.house_status : null;
  const phone = typeof body.phone === 'string' ? body.phone : null;
  const notes = typeof body.notes === 'string' ? body.notes : null;

  if (!clientUuid) return c.json({ error: 'missing client_uuid' }, 400);
  if (!voterId && !houseId) return c.json({ error: 'voter_id or house_id required' }, 400);

  let score = null;
  if (body.score != null && body.score !== '') {
    const n = Number(body.score);
    if (!Number.isInteger(n) || n < 1 || n > 5) {
      return c.json({ error: 'score must be integer 1-5' }, 400);
    }
    score = n;
  }
  if (phone && phone.length > 32) return c.json({ error: 'phone too long' }, 400);
  if (notes && notes.length > 4000) return c.json({ error: 'notes too long' }, 400);
  if (houseStatus && !['not_home', 'inaccessible'].includes(houseStatus)) {
    return c.json({ error: 'invalid house_status' }, 400);
  }

  const db = getDb();
  const existing = db
    .prepare('SELECT client_uuid FROM contacts WHERE client_uuid = ?')
    .get(clientUuid);
  if (existing) return c.json({ ok: true, client_uuid: clientUuid, existing: true });

  const now = Date.now();
  const createdAt = Number(body.created_at) || now;
  db.prepare(
    `INSERT INTO contacts
       (client_uuid, campaign_id, user_id, voter_id, house_id, house_status,
        score, phone, notes, created_at, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(clientUuid, campaign.id, user.id, voterId, houseId, houseStatus,
    score, phone, notes, createdAt, now);
  return c.json({ ok: true, client_uuid: clientUuid });
});

router.get('/api/contacts/mine', member, (c) => {
  const user = c.get('user');
  const campaign = c.get('campaign');
  const rows = getDb().prepare(
    `SELECT client_uuid, voter_id, house_id, house_status, score, phone,
            notes, created_at
       FROM contacts WHERE campaign_id = ? AND user_id = ?
      ORDER BY created_at DESC`,
  ).all(campaign.id, user.id);
  return c.json({ contacts: rows });
});

// ---- Match -----------------------------------------------------------------

const RELATIONSHIP_TAGS = ['family', 'friend', 'neighbor', 'coworker', 'acquaintance'];
const MAX_HASHES = 5000;

router.get('/api/match/session', member, (c) => {
  const user = c.get('user');
  const campaign = c.get('campaign');
  const idx = getIndex(campaign.id);
  return c.json({
    name: user.name,
    salt: getCampaignSalt(campaign.id),
    voterCount: idx ? idx.voterCount : 0,
    ready: !!idx,
  });
});

function hashList(v) {
  if (!Array.isArray(v)) return [];
  return v.filter((h) => typeof h === 'string' && /^[0-9a-f]{64}$/.test(h));
}

router.post('/api/match', member, async (c) => {
  const user = c.get('user');
  const campaign = c.get('campaign');
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid json' }, 400); }
  const hashes = [...new Set(hashList(body && body.hashes))];
  if (hashes.length === 0) return c.json({ error: 'no valid hashes' }, 400);
  if (hashes.length > MAX_HASHES) {
    return c.json({ error: `too many hashes (max ${MAX_HASHES})` }, 413);
  }
  if (!getIndex(campaign.id)) {
    return c.json({ error: 'no voter file uploaded yet' }, 404);
  }

  const db = getDb();
  const prior = db.prepare(
    'SELECT voter_id, status, relationship_tag FROM match_relationships WHERE campaign_id = ? AND user_id = ?',
  ).all(campaign.id, user.id);
  const priorById = new Map(prior.map((r) => [r.voter_id, r]));

  const matches = matchHashes(campaign.id, hashes).map((m) => {
    const p = priorById.get(m.voter.voter_id);
    return { ...m, status: p ? p.status : null, relationshipTag: p ? p.relationship_tag : null };
  });
  return c.json({ matches });
});

function upsertRelationship({ campaignId, userId, voterId, status, tag, notes, matchType }) {
  const now = Date.now();
  getDb().prepare(
    `INSERT INTO match_relationships
       (campaign_id, user_id, voter_id, status, relationship_tag, notes,
        match_type, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(campaign_id, user_id, voter_id) DO UPDATE SET
       status=excluded.status, relationship_tag=excluded.relationship_tag,
       notes=excluded.notes, match_type=excluded.match_type,
       updated_at=excluded.updated_at`,
  ).run(campaignId, userId, voterId, status, tag, notes, matchType, now, now);
}

router.post('/api/match/confirm', member, async (c) => {
  const user = c.get('user');
  const campaign = c.get('campaign');
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid json' }, 400); }
  const voterId = typeof body.voter_id === 'string' ? body.voter_id : '';
  if (!voterId) return c.json({ error: 'voter_id required' }, 400);
  const tag = RELATIONSHIP_TAGS.includes(body.relationshipTag) ? body.relationshipTag : null;
  const notes = typeof body.notes === 'string' ? body.notes.slice(0, 2000) : null;
  const matchType = typeof body.matchType === 'string' ? body.matchType.slice(0, 32) : null;
  upsertRelationship({
    campaignId: campaign.id, userId: user.id, voterId,
    status: 'confirmed', tag, notes, matchType,
  });
  return c.json({ ok: true });
});

router.post('/api/match/reject', member, async (c) => {
  const user = c.get('user');
  const campaign = c.get('campaign');
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid json' }, 400); }
  const voterId = typeof body.voter_id === 'string' ? body.voter_id : '';
  if (!voterId) return c.json({ error: 'voter_id required' }, 400);
  upsertRelationship({
    campaignId: campaign.id, userId: user.id, voterId,
    status: 'rejected', tag: null, notes: null, matchType: null,
  });
  return c.json({ ok: true });
});

router.get('/api/match/mine', member, (c) => {
  const user = c.get('user');
  const campaign = c.get('campaign');
  const rows = getDb().prepare(
    `SELECT voter_id, status, relationship_tag, notes, updated_at
       FROM match_relationships WHERE campaign_id = ? AND user_id = ?
      ORDER BY updated_at DESC`,
  ).all(campaign.id, user.id);
  return c.json({ name: user.name, relationships: rows });
});

export default router;
