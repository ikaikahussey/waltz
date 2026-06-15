# Waltz

A multi-campaign volunteer platform. Many campaigns share one deployment;
each gets its own voter file, its own volunteers, and its own admins. Every
campaign's volunteers can use the two tools extrapolated from
[walk](https://github.com/ikaikahussey/walk):

- **walk** — browse the campaign's doors and voters, record contacts
  (score / phone / notes), with an offline IndexedDB queue.
- **match** — privacy-preserving relational organizing: a volunteer's
  contacts are hashed in the browser with a per-campaign salt and only
  hex hashes are sent; the server returns voter matches to confirm.

## How it works

1. **Accounts.** Anyone creates one account (`/signup`). The same account
   can be a volunteer in some campaigns and an admin in others. Auth is a
   server-side session in an httpOnly cookie.
2. **Campaigns.** A logged-in user creates a campaign and becomes its first
   admin (`/campaigns/new`).
3. **Invites.** A campaign admin generates invite links from the campaign
   admin dashboard. Each invite is a unique unguessable hash
   (`/join/<hash>`), bound to a campaign and role, and is single-use.
4. **Joining.** A volunteer opens an invite link. If signed out, they're
   prompted to sign up / sign in (the invite link is preserved); then they
   accept and are added to the campaign.
5. **Voter file.** A campaign admin uploads two CSVs — same structure as
   walk: `houses.csv` (`house_id, door_sort, address`) and `voters.csv`
   (`voter_id, house_id, first_name, last_name`, plus any pass-through
   columns). They are validated and stitched into the campaign's voter
   payload. Re-uploading replaces it.
6. **Tools.** Each campaign member opens `/c/<id>/walk` or `/c/<id>/match`.
   Voter data is served per-campaign through an authenticated API (it is
   not embedded at build time, since Waltz is multi-tenant).
7. **Export.** Admins download recorded contacts at
   `/c/<id>/admin/contacts.csv`.

## Architecture

```
account (session cookie)
   │
   ├── creates ── campaign ── admin ── invites (hash URLs) ── volunteers
   │                  │
   │                  └── voter file (houses.csv + voters.csv)
   │
   └── per campaign ── /c/:id/walk   (contacts → SQLite)
                       /c/:id/match  (browser-hashed contacts → matches)
```

Stack: Node ≥ 20, Hono, better-sqlite3, bcryptjs. No build step; the two
tools are static HTML served per campaign that derive their API base from
the URL path.

## Setup

```
cp .env.example .env
npm install
npm run migrate     # initialize SQLite
npm run dev         # http://localhost:3000
```

`npm test` runs the suite (schema, auth, and a full end-to-end flow:
signup → campaign → invite → join → upload → walk → match). `npm run lint`
runs eslint.

## Deploy

Waltz needs two things from its host:

1. **A persistent disk** for the SQLite database (WAL mode — the `*.db`,
   `*.db-wal`, and `*.db-shm` files must all survive restarts).
2. **`PUBLIC_ORIGIN` set to your real `https://…` URL.** This makes the
   session cookie `Secure` and is the base for the invite links shown in
   the admin UI. A wrong value means broken invites and/or refused cookies.

Generic steps on any Node ≥ 20 host:

```
npm ci
PUBLIC_ORIGIN=https://your-domain DATABASE_PATH=/data/waltz.db npm start
```

Health check: `GET /healthz`.

### Render (one-click, mirrors walk)

`render.yaml` provisions a web service plus a 1 GB persistent disk at
`/data`. Push to GitHub, then in Render: **New + → Blueprint → point at
this repo**. In the dashboard, set `PUBLIC_ORIGIN` to your service URL.

## Per-campaign privacy

Each campaign has its own random `match_salt`. A contact bundle hashed for
one campaign cannot be replayed against another, and raw contacts never
leave the volunteer's browser — only `salt|value` SHA-256 hex digests are
sent. The match normalization/hashing in `public/match.html` is kept
bit-for-bit identical to `lib/match-normalize.js`; change both together.

## Data schema

See `lib/db.js`. Voter file CSV format is identical to walk's
`docs/DATA_SCHEMA.md`: pre-grouped, one row per house and one per voter,
linked by `house_id`. IDs should be opaque and stable across re-uploads.
