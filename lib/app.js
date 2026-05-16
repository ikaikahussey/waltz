// lib/app.js — Build the Hono app (no network bind). server.js wraps this
// with serve(); tests drive it via app.fetch().

import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { logger } from 'hono/logger';
import { loadUser } from './auth.js';
import pagesRoutes from '../routes/pages.js';
import authRoutes from '../routes/auth.js';
import joinRoutes from '../routes/join.js';
import campaignRoutes from '../routes/campaigns.js';
import campaignAdminRoutes from '../routes/campaign-admin.js';
import toolsRoutes from '../routes/tools.js';

export function createApp({ static: withStatic = true, log = false } = {}) {
  const app = new Hono();
  if (log) app.use('*', logger());
  app.get('/healthz', (c) => c.json({ ok: true, ts: Date.now() }));
  app.use('*', loadUser);
  app.route('/', pagesRoutes);
  app.route('/', authRoutes);
  app.route('/', joinRoutes);
  app.route('/campaigns', campaignRoutes);
  app.route('/c/:campaignId', campaignAdminRoutes);
  app.route('/c/:campaignId', toolsRoutes);
  if (withStatic) app.use('/*', serveStatic({ root: './public' }));
  return app;
}
