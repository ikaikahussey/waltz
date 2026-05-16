// tests/helpers.js — Isolated DB + a tiny cookie-aware client.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), 'waltz-test-'));
  process.env.DATABASE_PATH = join(dir, 'test.db');
  process.env.PUBLIC_ORIGIN = 'http://localhost';
}

// Cookie jar around app.fetch. Returns { status, headers, text(), json() }.
export function makeClient(app) {
  let cookie = '';
  async function req(path, { method, body, json, form, redirect = 'manual' } = {}) {
    method = method || ((json !== undefined || form !== undefined || body !== undefined) ? 'POST' : 'GET');
    const headers = {};
    if (cookie) headers.cookie = cookie;
    let payload = body;
    if (json !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(json); }
    if (form !== undefined) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      payload = new URLSearchParams(form).toString();
    }
    const res = await app.fetch(new Request('http://localhost' + path, {
      method, headers, body: payload, redirect,
    }));
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      const m = setCookie.match(/^waltz_session=([^;]*)/);
      if (m) cookie = m[1] === '' ? '' : 'waltz_session=' + m[1];
    }
    return res;
  }
  return { req, getCookie: () => cookie };
}
