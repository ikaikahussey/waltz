// lib/voter-index.js — Per-campaign salted hash index for the match tool.
//
// Ported from walk's voter-index, but multi-tenant: the index is built
// from the campaign's stored APP_DATA blob and keyed by the campaign's
// own match_salt. The server never sees raw contacts — only hex hashes.

import { getDb } from './db.js';
import { personHashes, CONF_LABEL } from './match-normalize.js';

// campaign_id -> { version, byHash, voterById, voterCount }
const cache = new Map();

function loadAppData(campaignId) {
  const row = getDb()
    .prepare('SELECT version, app_data FROM campaign_voterfile WHERE campaign_id = ?')
    .get(campaignId);
  if (!row) return null;
  return { version: row.version, data: JSON.parse(row.app_data) };
}

export function getCampaignSalt(campaignId) {
  const row = getDb().prepare('SELECT match_salt FROM campaigns WHERE id = ?').get(campaignId);
  return row ? row.match_salt : null;
}

export function getIndex(campaignId) {
  const loaded = loadAppData(campaignId);
  if (!loaded) return null;
  const cached = cache.get(campaignId);
  if (cached && cached.version === loaded.version) return cached;

  const salt = getCampaignSalt(campaignId);
  const byHash = new Map(); // hash -> Map(voter_id -> bestConf)
  const voterById = new Map();

  for (const v of loaded.data.voters || []) {
    const first = v.first_name || '';
    const last = v.last_name || '';
    if (!first && !last) continue;
    const id = String(v.voter_id);
    voterById.set(id, {
      voter_id: id,
      first_name: first,
      last_name: last,
      address: v['Full Address'] || v.Address || v.address || '',
      city: v.City || v.city || '',
      zip: String(v.Zip || v.zip || ''),
      house_id: v.house_id || '',
    });
    for (const { h, conf } of personHashes(salt, {
      first, last, zip: v.Zip || v.zip || '', addr: v.Address || v.address || '',
    })) {
      let m = byHash.get(h);
      if (!m) { m = new Map(); byHash.set(h, m); }
      const cur = m.get(id);
      if (cur === undefined || cur < conf) m.set(id, conf);
    }
  }
  const index = { version: loaded.version, byHash, voterById, voterCount: voterById.size };
  cache.set(campaignId, index);
  return index;
}

export function matchHashes(campaignId, hashes) {
  const idx = getIndex(campaignId);
  if (!idx) return [];
  const best = new Map(); // voter_id -> { conf, matchedHash }
  for (const h of hashes) {
    const hits = idx.byHash.get(h);
    if (!hits) continue;
    for (const [voter_id, conf] of hits) {
      const cur = best.get(voter_id);
      if (!cur || conf > cur.conf) best.set(voter_id, { conf, matchedHash: h });
    }
  }
  const matches = [];
  for (const [voter_id, m] of best) {
    const voter = idx.voterById.get(voter_id);
    if (!voter) continue;
    matches.push({
      voter,
      matchType: CONF_LABEL[m.conf],
      confidence: CONF_LABEL[m.conf],
      matchedHash: m.matchedHash,
    });
  }
  return matches;
}
