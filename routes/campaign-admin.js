// routes/campaign-admin.js — Campaign admin: invites, voter file, export.
// Mounted at /c/:campaignId. Every route requires the admin role.

import { Hono } from 'hono';
import { getDb } from '../lib/db.js';
import { layout, flash, esc } from '../lib/html.js';
import { requireMember } from '../lib/auth.js';
import { newInviteHash } from '../lib/ids.js';
import { parseCsv, writeCsv } from '../lib/csv.js';
import { buildAppData } from '../lib/voters.js';

const router = new Hono();
const admin = requireMember('admin');

function originOf(c) {
  if (process.env.PUBLIC_ORIGIN) return process.env.PUBLIC_ORIGIN.replace(/\/$/, '');
  const u = new URL(c.req.url);
  return `${u.protocol}//${u.host}`;
}

function fmtTime(ms) {
  if (!ms) return '';
  return new Date(Number(ms)).toISOString().replace('T', ' ').slice(0, 16) + 'Z';
}

router.get('/admin', admin, (c) => {
  const user = c.get('user');
  const campaign = c.get('campaign');
  const db = getDb();
  const origin = originOf(c);

  const vf = db
    .prepare('SELECT version, house_count, voter_count, uploaded_at FROM campaign_voterfile WHERE campaign_id = ?')
    .get(campaign.id);

  const members = db.prepare(
    `SELECT u.name, u.email, m.role, m.created_at
       FROM campaign_members m JOIN users u ON u.id = m.user_id
      WHERE m.campaign_id = ? ORDER BY m.created_at ASC`,
  ).all(campaign.id);

  const invites = db.prepare(
    `SELECT i.hash, i.role, i.label, i.created_at, i.expires_at,
            i.accepted_at, u.name AS accepted_name
       FROM invites i LEFT JOIN users u ON u.id = i.accepted_by
      WHERE i.campaign_id = ? ORDER BY i.created_at DESC`,
  ).all(campaign.id);

  const contactCount = db
    .prepare('SELECT COUNT(*) AS n FROM contacts WHERE campaign_id = ?')
    .get(campaign.id).n;

  const memberRows = members.map((m) => `<tr>
    <td>${esc(m.name)}</td><td>${esc(m.email)}</td>
    <td>${esc(m.role)}</td><td>${esc(fmtTime(m.created_at))}</td></tr>`).join('');

  const inviteRows = invites.map((i) => {
    const url = `${origin}/join/${i.hash}`;
    const status = i.accepted_at
      ? `accepted by ${esc(i.accepted_name || '')} ${esc(fmtTime(i.accepted_at))}`
      : (i.expires_at && i.expires_at < Date.now() ? 'expired' : 'open');
    const revoke = i.accepted_at ? '' :
      `<form method="post" action="/c/${esc(campaign.id)}/admin/invites/${esc(i.hash)}/revoke" class="inline">
         <button class="link danger">revoke</button></form>`;
    return `<tr>
      <td>${esc(i.label || '')}</td>
      <td>${esc(i.role)}</td>
      <td><code class="copy" title="Click to copy" data-url="${esc(url)}">${esc(url)}</code></td>
      <td>${status} ${revoke}</td>
    </tr>`;
  }).join('');

  const vfStatus = vf
    ? `<p class="flash flash-ok">Voter file loaded: ${vf.house_count} houses,
        ${vf.voter_count} voters (v${esc(vf.version)}, ${esc(fmtTime(vf.uploaded_at))}).</p>`
    : `<p class="flash flash-error">No voter file yet — volunteers can't walk
        or match until one is uploaded.</p>`;

  const body = `
  <section>
    <h1>${esc(campaign.name)}</h1>
    <p class="muted">Admin dashboard ·
      <a href="/c/${esc(campaign.id)}/walk">open walk</a> ·
      <a href="/c/${esc(campaign.id)}/match">open match</a> ·
      <a href="/c/${esc(campaign.id)}/admin/contacts.csv">contacts.csv</a></p>

    <h2>Voter file</h2>
    ${vfStatus}
    <p><a class="btn" href="/c/${esc(campaign.id)}/admin/voters">Upload voter file</a></p>

    <h2>Invite volunteers</h2>
    <p class="muted">Each link has its own unguessable hash and works once.</p>
    <form method="post" action="/c/${esc(campaign.id)}/admin/invites" class="row">
      <input name="label" placeholder="label (optional, e.g. 'East side team')" maxlength="80">
      <select name="role">
        <option value="volunteer">volunteer</option>
        <option value="admin">admin</option>
      </select>
      <input name="count" type="number" min="1" max="100" value="1" style="width:6rem">
      <button type="submit">Generate invites</button>
    </form>
    <table>
      <thead><tr><th>Label</th><th>Role</th><th>Invite URL</th><th>Status</th></tr></thead>
      <tbody>${inviteRows || '<tr><td colspan="4" class="muted">No invites yet.</td></tr>'}</tbody>
    </table>

    <h2>Members (${members.length}) · ${contactCount} contacts recorded</h2>
    <table>
      <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Joined</th></tr></thead>
      <tbody>${memberRows}</tbody>
    </table>
  </section>
  <script>
  document.querySelectorAll('code.copy').forEach((el) => {
    el.addEventListener('click', () => {
      navigator.clipboard.writeText(el.dataset.url).then(() => {
        const o = el.textContent; el.textContent = 'copied!';
        setTimeout(() => { el.textContent = o; }, 1000);
      });
    });
  });
  </script>`;
  return c.html(layout({ title: campaign.name + ' admin', user, body }));
});

router.post('/admin/invites', admin, async (c) => {
  const user = c.get('user');
  const campaign = c.get('campaign');
  const form = await c.req.parseBody();
  const label = String(form.label || '').trim().slice(0, 80) || null;
  const role = form.role === 'admin' ? 'admin' : 'volunteer';
  let count = parseInt(form.count, 10);
  if (!Number.isFinite(count) || count < 1) count = 1;
  if (count > 100) count = 100;

  const db = getDb();
  const now = Date.now();
  const stmt = db.prepare(
    `INSERT INTO invites (hash, campaign_id, role, label, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const tx = db.transaction(() => {
    for (let i = 0; i < count; i++) {
      stmt.run(newInviteHash(), campaign.id, role, label, user.id, now);
    }
  });
  tx();
  return c.redirect(`/c/${campaign.id}/admin`, 302);
});

router.post('/admin/invites/:hash/revoke', admin, (c) => {
  const campaign = c.get('campaign');
  const hash = c.req.param('hash');
  getDb()
    .prepare('DELETE FROM invites WHERE hash = ? AND campaign_id = ? AND accepted_at IS NULL')
    .run(hash, campaign.id);
  return c.redirect(`/c/${campaign.id}/admin`, 302);
});

router.get('/admin/voters', admin, (c) => {
  const user = c.get('user');
  const campaign = c.get('campaign');
  const body = `
  <section class="card">
    <h1>Upload voter file</h1>
    <p class="muted">Two CSVs, same structure as the walk tool. Re-uploading
      replaces the current file.</p>
    <ul class="muted">
      <li><code>houses.csv</code> — required columns:
        <code>house_id, door_sort, address</code></li>
      <li><code>voters.csv</code> — required columns:
        <code>voter_id, house_id, first_name, last_name</code></li>
    </ul>
    <form method="post" action="/c/${esc(campaign.id)}/admin/voters"
          enctype="multipart/form-data">
      <label>houses.csv <input type="file" name="houses" accept=".csv" required></label>
      <label>voters.csv <input type="file" name="voters" accept=".csv" required></label>
      <button type="submit">Upload &amp; validate</button>
    </form>
    <p><a href="/c/${esc(campaign.id)}/admin">← Back to admin</a></p>
  </section>`;
  return c.html(layout({ title: 'Upload voter file', user, body }));
});

router.post('/admin/voters', admin, async (c) => {
  const user = c.get('user');
  const campaign = c.get('campaign');
  let error = null;
  try {
    const form = await c.req.parseBody();
    const housesFile = form.houses;
    const votersFile = form.voters;
    if (!housesFile || typeof housesFile === 'string' || !votersFile || typeof votersFile === 'string') {
      throw new Error('Both houses.csv and voters.csv are required.');
    }
    const housesText = await housesFile.text();
    const votersText = await votersFile.text();
    const housesRows = parseCsv(housesText).rows;
    const votersRows = parseCsv(votersText).rows;
    if (!housesRows.length) throw new Error('houses.csv has no data rows.');
    if (!votersRows.length) throw new Error('voters.csv has no data rows.');

    const appData = buildAppData(housesRows, votersRows);
    getDb().prepare(
      `INSERT INTO campaign_voterfile
         (campaign_id, version, generated_at, house_count, voter_count,
          app_data, uploaded_by, uploaded_at)
       VALUES (@cid, @ver, @gen, @hc, @vc, @ad, @uid, @now)
       ON CONFLICT(campaign_id) DO UPDATE SET
         version=@ver, generated_at=@gen, house_count=@hc, voter_count=@vc,
         app_data=@ad, uploaded_by=@uid, uploaded_at=@now`,
    ).run({
      cid: campaign.id,
      ver: appData.version,
      gen: appData.generated_at,
      hc: appData.houses.length,
      vc: appData.voters.length,
      ad: JSON.stringify(appData),
      uid: user.id,
      now: Date.now(),
    });
    return c.redirect(`/c/${campaign.id}/admin`, 302);
  } catch (e) {
    error = e.message || String(e);
  }
  const body = `
  <section class="card">
    <h1>Upload voter file</h1>
    ${flash('error', error)}
    <p><a href="/c/${esc(campaign.id)}/admin/voters">← Try again</a></p>
  </section>`;
  return c.html(layout({ title: 'Upload failed', user, body }), 400);
});

router.get('/admin/contacts.csv', admin, (c) => {
  const campaign = c.get('campaign');
  const rows = getDb().prepare(
    `SELECT ct.client_uuid, ct.voter_id, ct.house_id, ct.house_status,
            ct.score, ct.phone, ct.notes, u.name AS volunteer_name,
            u.email AS volunteer_email, ct.created_at
       FROM contacts ct JOIN users u ON u.id = ct.user_id
      WHERE ct.campaign_id = ? ORDER BY ct.created_at ASC`,
  ).all(campaign.id);

  const cols = ['client_uuid', 'voter_id', 'house_id', 'house_status', 'score',
    'phone', 'notes', 'volunteer_name', 'volunteer_email', 'created_at'];
  const csv = writeCsv(rows.map((r) => ({
    client_uuid: r.client_uuid || '',
    voter_id: r.voter_id || '',
    house_id: r.house_id || '',
    house_status: r.house_status || '',
    score: r.score == null ? '' : String(r.score),
    phone: r.phone || '',
    notes: r.notes || '',
    volunteer_name: r.volunteer_name || '',
    volunteer_email: r.volunteer_email || '',
    created_at: r.created_at ? new Date(r.created_at).toISOString() : '',
  })), cols);

  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  c.header('Content-Type', 'text/csv; charset=utf-8');
  c.header('Content-Disposition', `attachment; filename=contacts-${campaign.slug}-${day}.csv`);
  return c.body(csv);
});

export default router;
