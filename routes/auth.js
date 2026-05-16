// routes/auth.js — Account creation, login, logout.

import { Hono } from 'hono';
import { layout, flash, esc } from '../lib/html.js';
import { createUser, verifyLogin, startSession, endSession } from '../lib/auth.js';

const router = new Hono();

// Only allow same-site relative paths as post-login redirect targets.
function safeNext(next) {
  if (typeof next !== 'string') return '/dashboard';
  if (!next.startsWith('/') || next.startsWith('//')) return '/dashboard';
  return next;
}

function authPage({ mode, user, next, error, values = {} }) {
  const isSignup = mode === 'signup';
  const title = isSignup ? 'Create account' : 'Sign in';
  const other = isSignup
    ? `<p class="muted">Already have an account? <a href="/login?next=${encodeURIComponent(next)}">Sign in</a>.</p>`
    : `<p class="muted">New here? <a href="/signup?next=${encodeURIComponent(next)}">Create an account</a>.</p>`;
  const body = `
  <section class="card narrow">
    <h1>${title}</h1>
    <p class="muted">${isSignup
      ? 'Volunteers and campaign organizers use one account.'
      : 'Sign in to reach your campaigns.'}</p>
    ${flash('error', error)}
    <form method="post" action="/${mode}">
      <input type="hidden" name="next" value="${esc(next)}">
      ${isSignup ? `<label>Your name
        <input name="name" required minlength="2" maxlength="80" autocomplete="name"
               value="${esc(values.name || '')}"></label>` : ''}
      <label>Email
        <input name="email" type="email" required autocomplete="email"
               value="${esc(values.email || '')}"></label>
      <label>Password
        <input name="password" type="password" required minlength="8"
               autocomplete="${isSignup ? 'new-password' : 'current-password'}"></label>
      <button type="submit">${title}</button>
    </form>
    ${other}
  </section>`;
  return layout({ title, user, body });
}

router.get('/signup', (c) => {
  if (c.get('user')) return c.redirect('/dashboard', 302);
  const next = safeNext(c.req.query('next'));
  return c.html(authPage({ mode: 'signup', user: null, next }));
});

router.post('/signup', async (c) => {
  const form = await c.req.parseBody();
  const next = safeNext(form.next);
  try {
    const u = await createUser({ email: form.email, name: form.name, password: form.password });
    startSession(c, u.id);
    return c.redirect(next, 302);
  } catch (e) {
    return c.html(
      authPage({ mode: 'signup', user: null, next, error: e.message, values: form }),
      400,
    );
  }
});

router.get('/login', (c) => {
  if (c.get('user')) return c.redirect('/dashboard', 302);
  const next = safeNext(c.req.query('next'));
  return c.html(authPage({ mode: 'login', user: null, next }));
});

router.post('/login', async (c) => {
  const form = await c.req.parseBody();
  const next = safeNext(form.next);
  const u = await verifyLogin(form.email, form.password);
  if (!u) {
    return c.html(
      authPage({
        mode: 'login', user: null, next,
        error: 'Incorrect email or password.', values: form,
      }),
      401,
    );
  }
  startSession(c, u.id);
  return c.redirect(next, 302);
});

router.post('/logout', (c) => {
  endSession(c);
  return c.redirect('/', 302);
});

export default router;
