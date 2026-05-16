// lib/voters.js — Stitch parsed houses + voters CSVs into the APP_DATA
// object that the client consumes.

import { createHash } from 'node:crypto';

const REQUIRED_HOUSE_COLS = ['house_id', 'door_sort', 'address'];
const REQUIRED_VOTER_COLS = ['voter_id', 'house_id', 'first_name', 'last_name'];
const NUMERIC_COLS = new Set(['age', 'latitude', 'longitude']);

function coerce(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (NUMERIC_COLS.has(k)) {
      if (v === '' || v == null) out[k] = null;
      else {
        const n = Number(v);
        out[k] = Number.isFinite(n) ? n : null;
      }
    } else {
      out[k] = v;
    }
  }
  return out;
}

function checkRequired(rows, required, kind) {
  const missing = [];
  rows.forEach((row, idx) => {
    const absent = required.filter((c) => row[c] == null || row[c] === '');
    if (absent.length > 0) {
      missing.push(`row ${idx + 1}: missing ${absent.join(', ')}`);
    }
  });
  if (missing.length > 0) {
    const sample = missing.slice(0, 10).join('; ');
    throw new Error(`${kind} CSV missing required fields (${missing.length} rows): ${sample}`);
  }
}

function checkUnique(rows, key, kind) {
  const seen = new Map();
  const dupes = [];
  rows.forEach((row, idx) => {
    const v = row[key];
    if (seen.has(v)) {
      dupes.push(`${v} at rows ${seen.get(v) + 1} and ${idx + 1}`);
    } else {
      seen.set(v, idx);
    }
  });
  if (dupes.length > 0) {
    const sample = dupes.slice(0, 10).join('; ');
    throw new Error(`${kind} duplicate ${key} (${dupes.length}): ${sample}`);
  }
}

export function buildAppData(housesRows, votersRows) {
  checkRequired(housesRows, REQUIRED_HOUSE_COLS, 'houses');
  checkRequired(votersRows, REQUIRED_VOTER_COLS, 'voters');
  checkUnique(votersRows, 'voter_id', 'voters');

  const seenHouseIds = new Set();
  let dupeHouseCount = 0;
  const dedupedHouses = [];
  for (const row of housesRows) {
    if (seenHouseIds.has(row.house_id)) { dupeHouseCount++; continue; }
    seenHouseIds.add(row.house_id);
    dedupedHouses.push(row);
  }
  if (dupeHouseCount > 0) {
    console.warn(`houses: ${dupeHouseCount} duplicate house_id row(s) skipped (kept first occurrence)`);
  }

  const houses = dedupedHouses.map(coerce);
  const allVoters = votersRows.map(coerce);

  const houseIds = new Set(houses.map((h) => h.house_id));
  const voters = [];
  const dangling = [];
  for (const v of allVoters) {
    if (!houseIds.has(v.house_id)) {
      dangling.push(`${v.voter_id} → ${v.house_id}`);
      continue;
    }
    voters.push(v);
  }
  if (dangling.length > 0) {
    const sample = dangling.slice(0, 10).join('; ');
    console.warn(`voters: ${dangling.length} reference unknown house_id (skipped). Sample: ${sample}`);
  }

  houses.sort((a, b) =>
    String(a.door_sort).localeCompare(String(b.door_sort), undefined, { numeric: true }),
  );

  const byHouse = new Map();
  for (const h of houses) {
    h.voters = [];
    byHouse.set(h.house_id, h);
  }
  const votersForHouse = new Map();
  for (const v of voters) {
    if (!votersForHouse.has(v.house_id)) votersForHouse.set(v.house_id, []);
    votersForHouse.get(v.house_id).push(v);
  }
  for (const [hid, list] of votersForHouse) {
    list.sort((a, b) => {
      const ln = String(a.last_name).localeCompare(String(b.last_name));
      return ln !== 0 ? ln : String(a.first_name).localeCompare(String(b.first_name));
    });
    byHouse.get(hid).voters = list.map((v) => v.voter_id);
  }

  voters.sort((a, b) => {
    const ln = String(a.last_name).localeCompare(String(b.last_name));
    return ln !== 0 ? ln : String(a.first_name).localeCompare(String(b.first_name));
  });

  const ids = [...houses.map((h) => h.house_id), ...voters.map((v) => v.voter_id)].join('|');
  const version = createHash('sha1').update(ids).digest('hex').slice(0, 8);

  return {
    generated_at: new Date().toISOString(),
    version,
    houses,
    voters,
  };
}

export const _internals = { REQUIRED_HOUSE_COLS, REQUIRED_VOTER_COLS, NUMERIC_COLS };
