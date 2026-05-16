// lib/db.js — Multi-tenant SQLite schema.
//
// Waltz hosts many campaigns. Every voter, contact, invite, and match
// relationship is scoped by campaign_id. Users are global accounts;
// campaign_members maps a user into a campaign with a role.

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS campaigns (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL,
  match_salt  TEXT NOT NULL,
  created_by  TEXT REFERENCES users(id),
  created_at  INTEGER NOT NULL
);

-- role: 'admin' | 'volunteer'
CREATE TABLE IF NOT EXISTS campaign_members (
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  user_id     TEXT NOT NULL REFERENCES users(id),
  role        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (campaign_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_members_user ON campaign_members(user_id);

-- The custom hash is the primary key: it IS the invite URL token.
CREATE TABLE IF NOT EXISTS invites (
  hash        TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  role        TEXT NOT NULL DEFAULT 'volunteer',
  label       TEXT,
  created_by  TEXT REFERENCES users(id),
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER,
  accepted_by TEXT REFERENCES users(id),
  accepted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_invites_campaign ON invites(campaign_id);

-- Uploaded voter file, stitched into the APP_DATA blob the walk client
-- consumes. One current file per campaign (re-upload replaces it).
CREATE TABLE IF NOT EXISTS campaign_voterfile (
  campaign_id  TEXT PRIMARY KEY REFERENCES campaigns(id),
  version      TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  house_count  INTEGER NOT NULL,
  voter_count  INTEGER NOT NULL,
  app_data     TEXT NOT NULL,
  uploaded_by  TEXT REFERENCES users(id),
  uploaded_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS contacts (
  client_uuid  TEXT PRIMARY KEY,
  campaign_id  TEXT NOT NULL REFERENCES campaigns(id),
  user_id      TEXT NOT NULL REFERENCES users(id),
  voter_id     TEXT,
  house_id     TEXT,
  house_status TEXT,
  score        INTEGER,
  phone        TEXT,
  notes        TEXT,
  created_at   INTEGER NOT NULL,
  received_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contacts_campaign ON contacts(campaign_id);
CREATE INDEX IF NOT EXISTS idx_contacts_user ON contacts(campaign_id, user_id);

CREATE TABLE IF NOT EXISTS match_relationships (
  campaign_id      TEXT NOT NULL REFERENCES campaigns(id),
  user_id          TEXT NOT NULL REFERENCES users(id),
  voter_id         TEXT NOT NULL,
  status           TEXT NOT NULL,
  relationship_tag TEXT,
  notes            TEXT,
  match_type       TEXT,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  PRIMARY KEY (campaign_id, user_id, voter_id)
);
CREATE INDEX IF NOT EXISTS idx_match_rel_campaign ON match_relationships(campaign_id);
`;

let db = null;

export function initDb() {
  const path = process.env.DATABASE_PATH || './data/waltz.db';
  mkdirSync(dirname(path), { recursive: true });
  db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

export function getDb() {
  if (!db) throw new Error('db not initialized — call initDb() first');
  return db;
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}
