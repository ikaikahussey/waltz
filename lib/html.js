// lib/html.js — Server-rendered page shell. All dynamic values must pass
// through esc(); never interpolate user data into HTML unescaped.

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function layout({ title, user, body, active }) {
  const nav = user
    ? `<a href="/dashboard"${active === 'dashboard' ? ' class="on"' : ''}>Campaigns</a>
       <a href="/campaigns/new"${active === 'new' ? ' class="on"' : ''}>New campaign</a>
       <span class="who">${esc(user.name)}</span>
       <form method="post" action="/logout" class="inline"><button class="link">Sign out</button></form>`
    : `<a href="/login">Sign in</a> <a href="/signup">Create account</a>`;

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Waltz</title>
<link rel="stylesheet" href="/styles.css">
</head><body>
<header class="topbar">
  <a class="brand" href="/">Waltz</a>
  <nav>${nav}</nav>
</header>
<main>${body}</main>
<footer>Waltz — multi-campaign volunteer platform. Tools: walk + match.</footer>
</body></html>`;
}

export function flash(kind, msg) {
  if (!msg) return '';
  return `<p class="flash ${kind === 'error' ? 'flash-error' : 'flash-ok'}">${esc(msg)}</p>`;
}
