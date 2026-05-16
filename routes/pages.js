// routes/pages.js — Landing page and the volunteer dashboard.

import { Hono } from 'hono';
import { getDb } from '../lib/db.js';
import { layout, esc } from '../lib/html.js';
import { requireUser } from '../lib/auth.js';

const router = new Hono();

router.get('/', (c) => {
  const user = c.get('user');
  const body = `
  <section class="hero">
    <h1>Waltz</h1>
    <p class="lead">One platform, many campaigns. Volunteers join a campaign
      with an invite link, then canvass with <strong>walk</strong> and find
      people they know with <strong>match</strong>.</p>
    <div class="cta">
      ${user
        ? `<a class="btn" href="/dashboard">Go to your campaigns</a>`
        : `<a class="btn" href="/signup">Create an account</a>
           <a class="btn secondary" href="/login">Sign in</a>`}
    </div>
  </section>
  <section class="grid3">
    <div class="card"><h3>Volunteers</h3><p>Make an account, accept a campaign
      invite, and start knocking doors or matching your contacts.</p></div>
    <div class="card"><h3>Campaign admins</h3><p>Spin up a campaign, upload
      your voter file, and invite volunteers with one unique link each.</p></div>
    <div class="card"><h3>Private by design</h3><p>Match hashes contacts in
      the browser with a per-campaign salt — raw contacts never reach the
      server.</p></div>
  </section>`;
  return c.html(layout({ title: 'Welcome', user, body }));
});

router.get('/dashboard', requireUser, (c) => {
  const user = c.get('user');
  const db = getDb();
  const rows = db.prepare(
    `SELECT m.role, m.campaign_id, c.name, c.slug,
            (SELECT COUNT(*) FROM campaign_voterfile vf WHERE vf.campaign_id = c.id) AS has_voters
       FROM campaign_members m
       JOIN campaigns c ON c.id = m.campaign_id
      WHERE m.user_id = ?
      ORDER BY c.created_at DESC`,
  ).all(user.id);

  const cards = rows.length
    ? rows.map((r) => {
      const adminLinks = r.role === 'admin'
        ? `<a href="/c/${esc(r.campaign_id)}/admin">Manage</a>`
        : '';
      const toolLinks = r.has_voters
        ? `<a href="/c/${esc(r.campaign_id)}/walk">Walk</a>
           <a href="/c/${esc(r.campaign_id)}/match">Match</a>`
        : `<span class="muted">Waiting for a voter file</span>`;
      return `<div class="card">
        <h3>${esc(r.name)}</h3>
        <p class="muted">Role: ${esc(r.role)}</p>
        <div class="links">${toolLinks} ${adminLinks}</div>
      </div>`;
    }).join('')
    : `<div class="card"><p>You're not in any campaigns yet. Ask an organizer
       for an invite link, or <a href="/campaigns/new">start your own
       campaign</a>.</p></div>`;

  const body = `
  <section>
    <h1>Your campaigns</h1>
    <div class="grid3">${cards}</div>
  </section>`;
  return c.html(layout({ title: 'Your campaigns', user, body, active: 'dashboard' }));
});

export default router;
