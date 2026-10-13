// Reads the CRP teams-and-players CSV and writes private/roster.json with only what calendars
// need: a display name, team and family grouping. Dates of birth, phone numbers and emails are
// never written out (the family key is a one-way hash of the parent's email/phone).
//
//   npm run import-roster -- path/to/crp-teams-and-players.csv

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const ROOT = new URL('../', import.meta.url);
const OUT = new URL('private/roster.json', ROOT);

// Minimal RFC 4180 CSV parser (handles quoted fields with commas/newlines).
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows.filter((r) => r.some((f) => f.trim()));
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

const hash = (s) => createHash('sha256').update(s).digest('base64url').slice(0, 16);

// "U14 Girls 14.2 · ..." -> "U14 Girls 2"; "U18/19 Boys 18.1" -> "U18 Boys 1". Overrides win.
function teamKey(label, overrides) {
  if (overrides[label]) return overrides[label];
  const m = label.match(/^U(\d{1,2})(?:\/\d+)?\s+(Boys|Girls)\s+\d+\.(\d+)/i);
  return m ? `U${m[1]} ${m[2][0].toUpperCase()}${m[2].slice(1).toLowerCase()} ${m[3]}` : null;
}

function displayName(row) {
  const preferred = row['Preferred name']?.split(/\s+or\s+/i)[0].trim();
  return preferred || row.Player.split(/\s+/)[0];
}

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error('Usage: npm run import-roster -- path/to/teams-and-players.csv');
  const overrides = JSON.parse(await readFile(new URL('config/roster-teams.json', ROOT), 'utf8')).teams ?? {};
  const rows = parseCsv(await readFile(file, 'utf8'));

  const players = [];
  const unplaced = [];
  for (const r of rows) {
    if (!r.Player) continue;
    // Shadow players train with their age group but don't play.
    const shadow = /shadow/i.test(r.Team);
    const team = shadow ? null : teamKey(r.Team, overrides);
    const g = r.Team.match(/^U(\d{1,2})(?:\/\d+)?\s+(Boys|Girls)/i);
    const group = team ? team.replace(/\s+\d+$/, '') : g && `U${g[1]} ${g[2][0].toUpperCase()}${g[2].slice(1).toLowerCase()}`;
    if (!group) { unplaced.push(`${displayName(r)} (${r.Team})`); continue; }
    const contact = (r.Email || r.Phone || r['Parent/Guardian']).toLowerCase().replace(/\s+/g, '');
    players.push({
      id: hash(`player:${r.Player.toLowerCase()}`),
      fullName: r.Player, // used only to match team changes; never published
      name: displayName(r),
      team, // null for shadow (training-only) players
      group,
      family: hash(`family:${contact}`),
      parent: r['Parent/Guardian'], // for the local links list only
    });
  }

  await mkdir(new URL('private/', ROOT), { recursive: true });
  await writeFile(OUT, JSON.stringify({ importedAt: new Date().toISOString(), players }, null, 2) + '\n');

  const byTeam = {};
  for (const p of players) {
    const k = p.team ?? `${p.group} (shadow, training only)`;
    byTeam[k] = (byTeam[k] ?? 0) + 1;
  }
  const families = new Set(players.map((p) => p.family));
  console.log(`Imported ${players.length} players in ${families.size} families -> private/roster.json\n`);
  for (const [t, n] of Object.entries(byTeam).sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }))) console.log(`  ${t.padEnd(14)} ${n}`);
  if (unplaced.length) console.log(`\n⚠ Not on a team (no calendar): ${unplaced.join(', ')}`);
}

main().catch((err) => {
  console.error(`✘ ${err.message}`);
  process.exit(1);
});
