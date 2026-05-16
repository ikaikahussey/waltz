// lib/auth.js — Account, session, and authorization helpers.
//
// Platform auth is a server-side session keyed by an httpOnly cookie.
// This intentionally diverges from walk's "typed name only" model:
// Waltz is multi-tenant, so a volunteer is a real account that can
// belong to several campaigns with different roles.

import bcrypt from 'bcryptjs';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { getDb } from './db.js';
import { newUserId, newSessionToken } from './ids.js';

const COOKIE = 'waltz_session';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const BCRYPT_ROUNDS = 10;

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function validEmail(s) {
  return typeof s === 'string' && EMAIL_RE.test(s.trim()) && s.length <= 200;
}

export async function createUser({ email, name, password }) {
  const db = getDb();
  email = String(email || '').trim().toLowerCase();
  name = String(name || '').trim();
  if (!validEmail(email)) throw new Error('a valid email is required');
  if (name.length < 2 || name.length > 80) throw new Error('name must be 2-80 characters');
  if (typeof password !== 'string' || password.length < 8) {
    throw new Error('password must be at least 8 characters');
  }
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
    throw new Error('an account with that email already exists');
  }
  const id = newUserId();
  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  db.prepare(
    'INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(id, email, name, hash, Date.now());
  return { id, email, name };
}

export async function verifyLogin(email, password) {
  const db = getDb();
  email = String(email || '').trim().toLowerCase();
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!row) return null;
  const ok = await bcrypt.compare(String(password || ''), row.password_hash);
  if (!ok) return null;
  return { id: row.id, email: row.email, name: row.name };
}

export function startSession(c, userId) {
  const db = getDb();
  const token = newSessionToken();
  const now = Date.now();
  db.prepare(
    'INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
  ).run(token, userId, now, now + SESSION_MS);
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: Math.floor(SESSION_MS / 1000),
    secure: (process.env.PUBLIC_ORIGIN || '').startsWith('https://'),
  });
  return token;
}

export function endSession(c) {
  const token = getCookie(c, COOKIE);
  if (token) {
    try { getDb().prepare('DELETE FROM sessions WHERE token = ?').run(token); } catch { /* ignore */ }
  }
  deleteCookie(c, COOKIE, { path: '/' });
}

// Populates c.get('user') when a valid session cookie is present.
export async function loadUser(c, next) {
  const token = getCookie(c, COOKIE);
  if (token) {
    const db = getDb();
    const sess = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
    if (sess && sess.expires_at > Date.now()) {
      const user = db.prepare('SELECT id, email, name FROM users WHERE id = ?').get(sess.user_id);
      if (user) c.set('user', user);
    } else if (sess) {
      db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    }
  }
  return next();
}

function nextParam(c) {
  const u = new URL(c.req.url);
  return encodeURIComponent(u.pathname + u.search);
}

export function requireUser(c, next) {
  if (!c.get('user')) {
    return c.redirect('/login?next=' + nextParam(c), 302);
  }
  return next();
}

// role: undefined → any member; 'admin' → admin only.
export function requireMember(role) {
  return (c, next) => {
    const user = c.get('user');
    if (!user) return c.redirect('/login?next=' + nextParam(c), 302);
    const campaignId = c.req.param('campaignId');
    const db = getDb();
    const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId);
    if (!campaign) return c.text('campaign not found', 404);
    const member = db
      .prepare('SELECT role FROM campaign_members WHERE campaign_id = ? AND user_id = ?')
      .get(campaignId, user.id);
    if (!member) return c.text('not a member of this campaign', 403);
    if (role === 'admin' && member.role !== 'admin') {
      return c.text('campaign admin access required', 403);
    }
    c.set('campaign', campaign);
    c.set('memberRole', member.role);
    return next();
  };
}
