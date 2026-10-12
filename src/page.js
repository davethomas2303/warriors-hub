// Renders public/index.html: one card per team with subscribe links.
// Subscribe URLs are built in the browser from the page's own address, so the page works on any host.

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const fmtDate = (iso) =>
  new Date(iso).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne', dateStyle: 'medium', timeStyle: 'short' });

export function renderIndex({ calendars, builtAt }) {
  const groups = new Map();
  for (const c of calendars) {
    const key = c.group ?? 'Other';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }

  const sections = [...groups]
    .map(
      ([group, teams]) => `
    <section>
      <h2>${esc(group)}</h2>
      ${teams
        .map(
          (t) => `
      <div class="team" id="${esc(t.file.replace('.ics', ''))}">
        <div class="name">${esc(t.team)}</div>
        <div class="links">
          <a class="btn primary" data-cal="${esc(t.file)}" data-kind="webcal" href="calendars/${esc(t.file)}">Subscribe</a>
          <a class="btn" data-cal="${esc(t.file)}" data-kind="google" href="calendars/${esc(t.file)}">Google</a>
          <button class="btn" data-cal="${esc(t.file)}" data-kind="copy" type="button">Copy link</button>
        </div>
      </div>`
        )
        .join('')}
    </section>`
    )
    .join('');

  return `<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Warriors Calendars</title>
<style>
  :root { --bg:#f6f5f2; --card:#fff; --ink:#151515; --muted:#666; --line:#e4e1da; --accent:#c8102e; --accent-ink:#fff; }
  @media (prefers-color-scheme: dark) { :root { --bg:#121212; --card:#1d1d1d; --ink:#f1f1f1; --muted:#a0a0a0; --line:#2e2e2e; --accent:#e0303f; } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:16px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width:720px; margin:0 auto; padding:24px 16px 48px; }
  h1 { font-size:1.6rem; margin:0 0 4px; }
  .lead { color:var(--muted); margin:0 0 20px; }
  .how { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:12px 16px; margin-bottom:24px; font-size:.95rem; }
  .how ul { margin:6px 0 0; padding-left:20px; }
  h2 { font-size:.85rem; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); margin:24px 0 8px; }
  .team { display:flex; flex-wrap:wrap; gap:10px; align-items:center; justify-content:space-between; background:var(--card); border:1px solid var(--line); border-radius:10px; padding:12px 14px; margin-bottom:8px; }
  .team:target { outline:2px solid var(--accent); }
  .name { font-weight:600; }
  .links { display:flex; gap:6px; flex-wrap:wrap; }
  .btn { font:inherit; font-size:.9rem; padding:6px 12px; border-radius:999px; border:1px solid var(--line); background:transparent; color:var(--ink); text-decoration:none; cursor:pointer; }
  .btn.primary { background:var(--accent); border-color:var(--accent); color:var(--accent-ink); }
  footer { color:var(--muted); font-size:.85rem; margin-top:32px; }
</style>
</head>
<body>
<main>
  <h1>Warragul Warriors calendars</h1>
  <p class="lead">Games from PlayHQ plus Sunday training, for each junior rep team. Subscribe once and it keeps itself up to date.</p>
  <div class="how">
    <strong>How to add</strong>
    <ul>
      <li><b>iPhone / Mac / Outlook:</b> tap <em>Subscribe</em>.</li>
      <li><b>Android / Google Calendar:</b> tap <em>Google</em>.</li>
      <li>Training is removed automatically on days your team has tournament games.</li>
    </ul>
  </div>
  ${sections}
  <footer>Fixtures last synced ${esc(fmtDate(builtAt))}. Fixture questions: check PlayHQ or ask your team manager.</footer>
</main>
<script>
  const base = new URL('calendars/', location.href);
  for (const el of document.querySelectorAll('[data-cal]')) {
    const https = new URL(el.dataset.cal, base).href;
    const webcal = https.replace(/^https?:/, 'webcal:');
    if (el.dataset.kind === 'webcal') el.href = webcal;
    if (el.dataset.kind === 'google') { el.href = 'https://calendar.google.com/calendar/r?cid=' + encodeURIComponent(webcal); el.target = '_blank'; el.rel = 'noopener'; }
    if (el.dataset.kind === 'copy') el.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(https); el.textContent = 'Copied'; } catch { prompt('Copy this link:', https); }
      setTimeout(() => (el.textContent = 'Copy link'), 1500);
    });
  }
</script>
</body>
</html>
`;
}
