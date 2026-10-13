// Builds a private calendar per player and per family from private/roster.json, so a player's
// calendar follows them when they're moved between teams. Each calendar lives at an unguessable
// address (an HMAC of the player/family id with FEED_SECRET) and is never listed anywhere public.
//
// Team changes for a particular competition go in private/team-changes.json:
//   { "changes": [ { "player": "Full Name", "competition": "Geelong", "team": "U14 Girls 1" } ] }
// ("team": null means not playing in that competition.)
//
//   npm run players   ->  public/my/<token>.ics  +  private/links.csv (admin only, never published)

import { createHmac } from 'node:crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { buildCalendar } from '../src/ics.js';
import { gameEvent, parseTeam, sessionsFor, trainingEvent } from '../src/events.js';

const ROOT = new URL('../', import.meta.url);
const OUT_DIR = new URL('public/my/', ROOT);
const SITE_URL = process.env.SITE_URL ?? 'https://davethomas2303.github.io/warriors-hub/';

const readJson = async (path, fallback) => {
  try {
    return JSON.parse(await readFile(new URL(path, ROOT), 'utf8'));
  } catch (err) {
    if (fallback !== undefined && err.code === 'ENOENT') return fallback;
    throw err;
  }
};

function loadSecret() {
  try { process.loadEnvFile(new URL('.env', ROOT)); } catch { /* CI: already in env */ }
  if (!process.env.FEED_SECRET) throw new Error('FEED_SECRET is missing (.env locally, repository secret on GitHub)');
  return process.env.FEED_SECRET;
}

const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

const norm = (s) => s.toLowerCase().normalize('NFKD').replace(/[^a-z]/g, '');

function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

// Finds the roster player a typed name refers to: tolerates preferred names ("Indi" for
// "Indiana"), case and small surname typos ("Stokram" for "Stokrom"). Ambiguous -> null.
function matchPlayer(typed, players) {
  const [first, ...rest] = typed.trim().split(/\s+/);
  const f = norm(first), sur = norm(rest.join(''));
  const scored = players.map((p) => {
    const [pf, ...pr] = p.fullName.split(/\s+/);
    const pSur = norm(pr.join(''));
    const firstOk = [norm(pf), norm(p.name)].some((n) => n === f || (f.length >= 3 && n.startsWith(f)));
    if (!firstOk) return null;
    const dist = editDistance(sur, pSur);
    return dist <= (pSur.length > 5 ? 2 : 1) ? { p, dist } : null;
  }).filter(Boolean).sort((a, b) => a.dist - b.dist);
  if (!scored.length || (scored[1] && scored[1].dist === scored[0].dist)) return null;
  return scored[0].p;
}

// Lineup files (private/lineups/*.txt) list who plays in which team for one competition:
//   competition: Geelong
//   # U14 Girls 1
//   Player Name
// Anyone in those age groups who isn't listed is treated as not playing that competition;
// a "# Unavailable" section records that explicitly.
const UNAVAILABLE = Symbol('unavailable');

async function lineupChanges(players) {
  const dir = new URL('private/lineups/', ROOT);
  let files = [];
  try { files = (await readdir(dir)).filter((f) => f.endsWith('.txt')); } catch { return { changes: [], problems: [] }; }
  const changes = [], problems = [];
  for (const file of files) {
    const text = await readFile(new URL(file, dir), 'utf8');
    const competition = text.match(/^\s*competition:\s*(.+)$/im)?.[1].trim();
    if (!competition) { problems.push(`${file}: missing "competition:" line`); continue; }
    let team = null;
    const listed = new Set(), groups = new Set();
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || /^competition:/i.test(line)) continue;
      if (line.startsWith('#')) {
        team = line.replace(/^#+/, '').trim();
        // "# Unavailable" lists players sitting this competition out.
        if (/^unavailable$/i.test(team)) team = UNAVAILABLE;
        else groups.add(team.replace(/\s+\d+$/, ''));
        continue;
      }
      if (!team) { problems.push(`${file}: "${line}" is above any "# Team" heading`); continue; }
      const p = matchPlayer(line, players);
      if (!p) { problems.push(`${file}: no single squad match for "${line}"`); continue; }
      listed.add(p.id);
      changes.push({ player: p.fullName, competition, team: team === UNAVAILABLE ? null : team, source: file });
    }
    for (const p of players) {
      if (p.team && groups.has(p.group) && !listed.has(p.id)) {
        changes.push({ player: p.fullName, competition, team: null, source: file });
      }
    }
  }
  return { changes, problems };
}

async function main() {
  const secret = loadSecret();
  const token = (kind, id) => createHmac('sha256', secret).update(`${kind}:${id}`).digest('base64url').slice(0, 24);

  const { players } = await readJson('private/roster.json');
  const { changes: manual = [] } = await readJson('private/team-changes.json', { changes: [] });
  const lineups = await lineupChanges(players);
  // Manual one-off changes take precedence over lineup files.
  const changes = [...manual, ...lineups.changes];
  const { games } = await readJson('data/fixtures.json');
  const training = await readJson('config/training.json');
  const { sessions } = await readJson('config/training-sessions.json');

  // Index games by team key, e.g. "U14 Girls 2".
  const gamesByTeam = new Map();
  for (const g of games) {
    const { key } = parseTeam(g.teamName);
    if (!gamesByTeam.has(key)) gamesByTeam.set(key, []);
    gamesByTeam.get(key).push(g);
  }
  const competitions = [...new Set(games.map((g) => g.competition))];

  const unknownPlayers = manual.filter((c) => !players.some((p) => p.fullName.toLowerCase() === c.player.toLowerCase()));

  // Which team a player is in for a given competition.
  const teamFor = (p, competition) => {
    const change = changes.find(
      (c) => c.player.toLowerCase() === p.fullName.toLowerCase() && competition.toLowerCase().includes(c.competition.toLowerCase())
    );
    return change ? change.team : p.team;
  };

  // Events for one player; label prefix distinguishes siblings in a family calendar.
  const playerEvents = (p, prefix) => {
    const events = [];
    const gameDays = new Set();
    const moves = [];
    for (const competition of competitions) {
      const team = teamFor(p, competition);
      if (team !== p.team) moves.push(`${competition}: ${team ?? 'not playing'}`);
      if (!team) continue;
      for (const g of (gamesByTeam.get(team) ?? []).filter((g) => g.competition === competition)) {
        events.push(gameEvent(g, `${prefix}${parseTeam(g.teamName).short}`, `-${p.id}`));
        gameDays.add(g.date);
      }
    }
    const group = p.group;
    for (const s of sessionsFor(group, sessions, training)) {
      if (!gameDays.has(s.date)) events.push(trainingEvent(s, `${prefix}${group}`, training, `-${p.id}`));
    }
    return { events, moves };
  };

  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  const families = new Map();
  for (const p of players) {
    if (!families.has(p.family)) families.set(p.family, []);
    families.get(p.family).push(p);
  }

  const links = [['Parent/Guardian', 'Children', 'Family calendar', 'Child', 'Child calendar', 'Team', 'Changes']];
  const summary = { players: 0, families: 0, moved: [] };
  for (const [familyId, kids] of families) {
    const familyEvents = [];
    for (const p of kids) {
      const { events, moves } = playerEvents(p, '');
      const file = `${token('player', p.id)}.ics`;
      await writeFile(
        new URL(file, OUT_DIR),
        buildCalendar({ name: `${p.name} – Warriors`, description: `${p.name}'s Warriors games and training. Updates automatically.`, events: events.sort((a, b) => a.start - b.start) })
      );
      summary.players++;
      if (moves.length) summary.moved.push(`${p.name} (${p.team}) → ${moves.join('; ')}`);
      familyEvents.push(...(kids.length > 1 ? playerEvents(p, `${p.name} · `).events : events));
      links.push([p.parent, kids.map((k) => k.name).join(', '), '', p.name, `${SITE_URL}my/${file}`, p.team ?? `${p.group} (shadow – training only)`, moves.join('; ')]);
    }
    if (kids.length > 1) {
      const file = `${token('family', familyId)}.ics`;
      const names = kids.map((k) => k.name).join(', ');
      await writeFile(
        new URL(file, OUT_DIR),
        buildCalendar({ name: `${names} – Warriors`, description: `Warriors games and training for ${names}. Updates automatically.`, events: familyEvents.sort((a, b) => a.start - b.start) })
      );
      summary.families++;
      const familyUrl = `${SITE_URL}my/${file}`;
      for (const row of links.slice(-kids.length)) row[2] = familyUrl;
    }
  }

  // Search engines shouldn't index these, and the folder has no listing.
  await writeFile(new URL('robots.txt', new URL('public/', ROOT)), 'User-agent: *\nDisallow: /my/\n');
  await writeFile(new URL('private/links.csv', ROOT), links.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n');

  console.log(`Built ${summary.players} player calendars and ${summary.families} family calendars in public/my/`);
  console.log('Private link list for admins: private/links.csv (never published)');
  if (summary.moved.length) console.log(`\nTeam changes applied:\n  ${summary.moved.join('\n  ')}`);
  if (lineups.problems.length) console.log(`\n⚠ Lineup problems:\n  ${lineups.problems.join('\n  ')}`);
  if (unknownPlayers.length) console.log(`\n⚠ team-changes.json names not in the roster: ${unknownPlayers.map((c) => c.player).join(', ')}`);
  const teamsWithoutGames = [...new Set(players.map((p) => p.team).filter(Boolean))].filter((t) => !gamesByTeam.has(t));
  if (teamsWithoutGames.length) console.log(`\nℹ Squad teams with no upcoming PlayHQ games: ${teamsWithoutGames.join(', ')}`);
}

main().catch((err) => {
  console.error(`✘ ${err.message}`);
  process.exit(1);
});
