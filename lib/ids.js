// lib/ids.js — Opaque id and token generators.

import { randomBytes } from 'node:crypto';

function hex(bytes) {
  return randomBytes(bytes).toString('hex');
}

export const newUserId = () => 'u_' + hex(12);
export const newCampaignId = () => 'c_' + hex(8);
export const newSessionToken = () => hex(32);

// The custom hash embedded in an invite URL (/join/<hash>). Opaque,
// unguessable, single campaign + role binding lives server-side.
export const newInviteHash = () => hex(20);

// Per-campaign salt for match hashing. Distinct salts mean a contact
// bundle hashed for one campaign cannot be replayed against another.
export const newMatchSalt = () => 'waltz-' + hex(12);

// URL-friendly slug, kept only for display alongside the opaque id.
export function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'campaign';
}
