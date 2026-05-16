// routes/join.js — Accept a campaign invite via its custom hashed URL.
//
// GET  /join/:hash  — show the invite (prompts login/signup if needed).
// POST /join/:hash  — bind the logged-in user into the campaign.

import { Hono } from 'hono';
import { getDb } from '../lib/db.js';
import { layout, flash, esc } from '../lib/html.js';

const router = new Hono();

function loadInvite(hash) {
  return getDb().prepare(
    `SELECT i.*, c.name AS campaign_name
       FROM invites i JOIN campaigns c ON c.id = i.campaign_id
      WHERE i.hash = ?`,
  ).get(hash);
}

function inviteProblem(invite) {
  if (!invite) return 'This invite link is not valid.';
  if (invite.accepted_at) return 'This invite has already been used.';
  if (invite.expires_at && invite.expires_at < Date.now()) return 'This invite has expired.';
  return null;
}

router.get('/join/:hash', (c) => {
  const user = c.get('user');
  const hash = c.req.param('hash');
  const invite = loadInvite(hash);
  const problem = inviteProblem(invite);

  if (problem) {
    return c.html(layout({
      title: 'Invite', user,
      body: `<section class="card narrow">${flash('error', problem)}
        <p><a href="/">Go home</a></p></section>`,
    }), 404);
  }

  if (!user) {
    const next = encodeURIComponent(`/join/${hash}`);
    const body = `
    <section class="card narrow">
      <h1>You're invited</h1>
      <p>You've been invited to join <strong>${esc(invite.campaign_name)}</strong>
         as <strong>${esc(invite.role)}</strong>.</p>
      <p class="muted">Sign in or create an account to accept. This link
         stays valid until you do.</p>
      <div class="cta">
        <a class="btn" href="/signup?next=${next}">Create account</a>
        <a class="btn secondary" href="/login?next=${next}">Sign in</a>
      </div>
    </section>`;
    return c.html(layout({ title: 'Invite', user, body }));
  }

  const db = getDb();
  const already = db
    .prepare('SELECT role FROM campaign_members WHERE campaign_id = ? AND user_id = ?')
    .get(invite.campaign_id, user.id);
  if (already) {
    return c.html(layout({
      title: 'Invite', user,
      body: `<section class="card narrow">
        ${flash('ok', `You're already in ${esc(invite.campaign_name)}.`)}
        <p><a href="/c/${esc(invite.campaign_id)}/walk">Open walk</a> ·
           <a href="/dashboard">Dashboard</a></p></section>`,
    }));
  }

  const body = `
  <section class="card narrow">
    <h1>Join ${esc(invite.campaign_name)}</h1>
    <p>You'll join as <strong>${esc(invite.role)}</strong>, signed in as
       ${esc(user.name)} (${esc(user.email)}).</p>
    <form method="post" action="/join/${esc(hash)}">
      <button type="submit">Accept invite</button>
    </form>
    <p class="muted"><a href="/dashboard">Not now</a></p>
  </section>`;
  return c.html(layout({ title: 'Join campaign', user, body }));
});

router.post('/join/:hash', (c) => {
  const user = c.get('user');
  const hash = c.req.param('hash');
  if (!user) return c.redirect('/login?next=' + encodeURIComponent(`/join/${hash}`), 302);

  const db = getDb();
  const invite = loadInvite(hash);
  const problem = inviteProblem(invite);
  if (problem) {
    return c.html(layout({
      title: 'Invite', user,
      body: `<section class="card narrow">${flash('error', problem)}
        <p><a href="/dashboard">Dashboard</a></p></section>`,
    }), 409);
  }

  const now = Date.now();
  const campaignId = invite.campaign_id;
  const role = invite.role === 'admin' ? 'admin' : 'volunteer';
  const tx = db.transaction(() => {
    const existing = db
      .prepare('SELECT 1 FROM campaign_members WHERE campaign_id = ? AND user_id = ?')
      .get(campaignId, user.id);
    if (!existing) {
      db.prepare(
        `INSERT INTO campaign_members (campaign_id, user_id, role, created_at)
         VALUES (?, ?, ?, ?)`,
      ).run(campaignId, user.id, role, now);
    }
    // Mark used only if still open (guards against a double POST race).
    const r = db.prepare(
      'UPDATE invites SET accepted_by = ?, accepted_at = ? WHERE hash = ? AND accepted_at IS NULL',
    ).run(user.id, now, hash);
    if (r.changes === 0 && !existing) {
      throw new Error('This invite was just used by someone else.');
    }
  });
  try {
    tx();
  } catch (e) {
    return c.html(layout({
      title: 'Invite', user,
      body: `<section class="card narrow">${flash('error', e.message)}
        <p><a href="/dashboard">Dashboard</a></p></section>`,
    }), 409);
  }

  if (role === 'admin') return c.redirect(`/c/${campaignId}/admin`, 302);
  return c.redirect(`/c/${campaignId}/walk`, 302);
});

export default router;
