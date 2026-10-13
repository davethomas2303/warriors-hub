// Renders public/index.html: one row per team with subscribe links, styled to match
// warragulbasketball.org.au (Montserrat, WBA red/dark, lowercase display type, square buttons).
// Subscribe URLs are built in the browser from the page's own address, so the page works on any host.

const CLUB_SITE = 'https://www.warragulbasketball.org.au/';

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
      <section class="group">
        <p class="eyebrow">// ${esc(group.toLowerCase())}</p>
        ${teams
          .map(
            (t) => `
        <div class="team" id="${esc(t.file.replace('.ics', ''))}">
          <div class="team__name">${esc(t.team)}</div>
          <div class="team__links">
            <a class="btn btn--primary" data-cal="${esc(t.file)}" data-kind="webcal" href="calendars/${esc(t.file)}">subscribe <span aria-hidden="true">→</span></a>
            <a class="btn btn--ghost-dark" data-cal="${esc(t.file)}" data-kind="google" href="calendars/${esc(t.file)}">google</a>
            <button class="btn btn--ghost-dark" data-cal="${esc(t.file)}" data-kind="copy" type="button">copy link</button>
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
<meta name="description" content="Warragul Warriors junior rep games and training, straight into your calendar.">
<meta name="theme-color" content="#1A1A1A">
<link rel="icon" href="logo.png">
<link rel="apple-touch-icon" href="logo.png">
<meta property="og:title" content="Warragul Warriors calendars">
<meta property="og:description" content="Games from PlayHQ and CRP training for every junior rep team. Subscribe once, stays up to date.">
<meta property="og:image" content="logo.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,300&display=swap">
<style>
  /* Brand tokens from warragulbasketball.org.au */
  :root {
    --wba-white:#FFFFFF; --wba-offwhite:#F8F8F6; --wba-dark:#1A1A1A; --wba-red:#C1272D; --wba-red-d:#9B1D22;
    --wba-orange:#F7931E; --wba-border:#E6E6E2; --wba-muted:#888888;
    --font-sans:'Montserrat', system-ui, -apple-system, sans-serif;
    --gutter:24px;
  }
  @media (min-width: 900px) { :root { --gutter:56px; } }
  * { box-sizing:border-box; }
  html, body { margin:0; padding:0; }
  body { font-family:var(--font-sans); color:var(--wba-dark); background:var(--wba-white); line-height:1.55; -webkit-font-smoothing:antialiased; }
  a { color:var(--wba-red); }
  .wrap { max-width:1180px; margin:0 auto; padding:0 var(--gutter); }

  .eyebrow { font-size:.74rem; font-weight:700; letter-spacing:.22em; text-transform:uppercase; color:var(--wba-muted); margin:0; }
  .tagline { font-size:.78rem; font-weight:600; letter-spacing:.16em; font-style:italic; text-transform:lowercase; color:var(--wba-red); margin:0; }
  .h-display { font-weight:800; letter-spacing:-.025em; line-height:1.02; text-transform:lowercase; margin:0; }
  .h-display em { font-style:italic; font-weight:300; }

  /* Utility bar + nav */
  .utility { background:var(--wba-dark); color:rgba(255,255,255,.85); font-size:.7rem; letter-spacing:.14em; text-transform:lowercase; }
  .utility .wrap { display:flex; justify-content:space-between; gap:16px; padding-top:11px; padding-bottom:11px; }
  .utility a { color:rgba(255,255,255,.85); text-decoration:none; }
  .utility a:hover { color:var(--wba-orange); }
  .nav { background:var(--wba-white); border-bottom:1px solid var(--wba-border); }
  .nav .wrap { display:flex; align-items:center; gap:14px; padding-top:18px; padding-bottom:18px; }
  .nav img { height:60px; width:auto; }
  .nav__text { display:flex; flex-direction:column; line-height:1.15; }
  .nav__text strong { font-weight:800; font-size:1rem; letter-spacing:-.01em; }

  /* Hero */
  .hero { background:var(--wba-offwhite); border-bottom:1px solid var(--wba-border); }
  .hero .wrap { padding-top:56px; padding-bottom:48px; }
  .hero .h-display { font-size:clamp(2.2rem, 7vw, 4.2rem); margin:14px 0 18px; }
  .hero p.lead { max-width:640px; margin:0; font-size:1.02rem; color:#444; }

  .steps { display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:1px; background:var(--wba-border); border:1px solid var(--wba-border); margin-top:36px; }
  .step { background:var(--wba-white); padding:22px; }
  .step .tag { display:inline-block; font-size:.7rem; font-weight:700; letter-spacing:.14em; text-transform:lowercase; color:var(--wba-white); background:var(--wba-red); padding:6px 12px; margin-bottom:12px; }
  .step .tag::before { content:"[ "; opacity:.55; font-weight:400; }
  .step .tag::after { content:" ]"; opacity:.55; font-weight:400; }
  .step p { margin:0; font-size:.92rem; }

  /* Team list */
  .teams { padding:48px 0 64px; }
  .group { margin-bottom:36px; }
  .group .eyebrow { margin-bottom:12px; }
  .team { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:12px; padding:16px 0; border-top:1px solid var(--wba-border); }
  .group .team:last-child { border-bottom:1px solid var(--wba-border); }
  .team:target { background:#FDF3F3; box-shadow:inset 4px 0 0 var(--wba-red); padding-left:14px; }
  .team__name { font-weight:800; font-size:1.15rem; letter-spacing:-.01em; }
  .team__links { display:flex; flex-wrap:wrap; gap:8px; }

  .btn { display:inline-flex; align-items:center; gap:10px; font-family:inherit; font-size:.72rem; font-weight:700; letter-spacing:.18em; text-transform:lowercase;
         padding:13px 20px; text-decoration:none; border:1px solid currentColor; background:transparent; cursor:pointer; border-radius:0;
         transition:background .25s ease, color .25s ease, border-color .25s ease; }
  .btn--primary { background:var(--wba-red); color:var(--wba-white); border-color:var(--wba-red); }
  .btn--primary:hover { background:var(--wba-dark); border-color:var(--wba-dark); color:var(--wba-white); }
  .btn--ghost-dark { color:var(--wba-dark); border-color:var(--wba-dark); }
  .btn--ghost-dark:hover { background:var(--wba-dark); color:var(--wba-white); }
  .btn:focus-visible { outline:3px solid var(--wba-orange); outline-offset:2px; }

  /* Footer */
  footer { background:var(--wba-dark); color:rgba(255,255,255,.75); font-size:.85rem; }
  footer .wrap { padding-top:40px; padding-bottom:40px; display:flex; flex-wrap:wrap; gap:24px; justify-content:space-between; align-items:flex-start; }
  footer .eyebrow { color:rgba(255,255,255,.5); margin-bottom:8px; }
  footer a { color:var(--wba-white); }
  footer a:hover { color:var(--wba-orange); }
  footer img { height:56px; width:auto; }
</style>
</head>
<body>
<div class="utility">
  <div class="wrap">
    <span>#WarriorSpirit · est. 1967</span>
    <a href="${CLUB_SITE}">warragulbasketball.org.au →</a>
  </div>
</div>
<header class="nav">
  <div class="wrap">
    <a href="${CLUB_SITE}"><img src="logo.png" alt="Warragul Warriors Basketball"></a>
    <div class="nav__text">
      <strong>Warragul Warriors</strong>
      <span class="tagline">junior rep calendars</span>
    </div>
  </div>
</header>

<section class="hero">
  <div class="wrap">
    <p class="eyebrow">// junior rep program</p>
    <h1 class="h-display">every game. every session. <em>one calendar.</em></h1>
    <p class="lead">Games straight from PlayHQ plus CRP training, for every junior rep team. Subscribe once and it keeps itself up to date — times, courts and venues included.</p>
    <div class="steps">
      <div class="step"><span class="tag">iphone · mac · outlook</span><p>Find your team below and tap <strong>subscribe</strong>.</p></div>
      <div class="step"><span class="tag">android · google</span><p>Tap <strong>google</strong> to add it to Google Calendar.</p></div>
      <div class="step"><span class="tag">tournament days</span><p>Training drops off automatically on days your team plays.</p></div>
    </div>
  </div>
</section>

<main class="teams">
  <div class="wrap">
    ${sections}
  </div>
</main>

<footer>
  <div class="wrap">
    <div>
      <p class="eyebrow">// warragul basketball association</p>
      <p style="margin:0">Fixtures last synced ${esc(fmtDate(builtAt))}.<br>Fixture questions: check PlayHQ or ask your team manager.</p>
    </div>
    <div>
      <p class="eyebrow">// more</p>
      <p style="margin:0"><a href="${CLUB_SITE}">Club website</a> · <a href="https://www.playhq.com/basketball-victoria/org/warragul-warriors-basketball-club/6c75cb90">PlayHQ</a></p>
    </div>
    <a href="${CLUB_SITE}"><img src="logo.png" alt=""></a>
  </div>
</footer>

<script>
  const base = new URL('calendars/', location.href);
  for (const el of document.querySelectorAll('[data-cal]')) {
    const https = new URL(el.dataset.cal, base).href;
    const webcal = https.replace(/^https?:/, 'webcal:');
    if (el.dataset.kind === 'webcal') el.href = webcal;
    if (el.dataset.kind === 'google') { el.href = 'https://calendar.google.com/calendar/r?cid=' + encodeURIComponent(webcal); el.target = '_blank'; el.rel = 'noopener'; }
    if (el.dataset.kind === 'copy') el.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(https); el.textContent = 'copied'; } catch { prompt('Copy this link:', https); }
      setTimeout(() => (el.textContent = 'copy link'), 1500);
    });
  }
</script>
</body>
</html>
`;
}
