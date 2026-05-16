// server.js — Waltz: multi-campaign volunteer platform entry point.

import 'dotenv/config';
import { serve } from '@hono/node-server';
import { initDb } from './lib/db.js';
import { createApp } from './lib/app.js';

initDb();
const app = createApp({ log: true });

const port = Number(process.env.PORT || 3000);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`waltz listening on :${info.port}`);
});
