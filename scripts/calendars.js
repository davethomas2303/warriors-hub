// Builds one subscribable .ics calendar per junior team: PlayHQ games + CRP training sessions.
// Training is dropped on days the team has games. Reads data/fixtures.json (npm run sync) and
// config/training-sessions.json (npm run import-bookings).
//
//   npm run calendars   ->  public/calendars/<team>.ics  +  public/calendars/index.json

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { buildCalendar, melbourneToUtc } from '../src/ics.js';
import { renderIndex } from '../src/page.js';

const ROOT = new URL('../', import.meta.url);
const OUT_DIR = new URL('public/calendars/', ROOT);
const GAME_MINUTES = 60;
const GAME_ALARM = 60; // reminder before tip-off
const TRAINING_ALARM = 30;

const readJson = async (path) => JSON.parse(await readFile(new URL(path, ROOT), 'utf8'));

// "Warragul Warriors U14 Girls 2" -> { group: "U14 Girls", short: "U14 Girls 2" }
function parseTeam(name) {
  const short = name.replace(/^Warragul Warriors\s+/i, '').trim();
  const m = short.match(/\b(U\d{1,2})\s+(Boys|Girls)\b/i);
  return { short, group: m ? `${m[1].toUpperCase()} ${m[2][0].toUpperCase()}${m[2].slice(1).toLowerCase()}` : null };
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function venueText(code, courts, venues) {
  const v = venues[code];
  return v ? `${v.name} – ${courts}, ${v.address}` : `${code} – ${courts}`;
}

function gameEvent(g, short) {
  const start = melbourneToUtc(g.date, g.time);
  const where = [g.venue, g.court].filter(Boolean).join(' – ');
  const addr = g.address ? `${g.address.line1}, ${g.address.suburb} ${g.address.state} ${g.address.postcode}` : '';
  return {
    uid: `game-${g.id}-${g.teamId}@warriors-hub`,
    start,
    end: new Date(start.getTime() + GAME_MINUTES * 60_000),
    summary: `🏀 ${short} v ${g.opponent}`,
    location: [where, addr].filter(Boolean).join(', '),
    description: [`${g.competition} – ${g.round ?? ''}`.trim(), g.grade && `Grade: ${g.grade}`, g.url && `Game centre: ${g.url}`]
      .filter(Boolean).join('\n'),
    url: g.url,
    updated: g.updatedAt ? new Date(g.updatedAt) : undefined,
    alarmMinutes: GAME_ALARM,
  };
}

function trainingEvent(s, short, venues) {
  const pending = s.status === 'pending';
  return {
    uid: `training-${slug(s.group)}-${s.date}@warriors-hub`,
    start: melbourneToUtc(s.date, s.start),
    end: melbourneToUtc(s.date, s.end),
    summary: `🏋️ ${short} training${pending ? ' (TBC)' : ''}`,
    location: venueText(s.venue, s.courts, venues),
    description: [`Junior Warriors CRP – ${s.group}`, s.coach && `Coach: ${s.coach}`, pending && 'Booking not yet confirmed.']
      .filter(Boolean).join('\n'),
    tentative: pending,
    alarmMinutes: TRAINING_ALARM,
  };
}

function clubBlockEvent(b, venues) {
  return {
    uid: `club-training-${b.date}-${slug(b.venue)}@warriors-hub`,
    start: melbourneToUtc(b.date, b.start),
    end: melbourneToUtc(b.date, b.end),
    summary: '🏋️ CRP club training – your session time TBC',
    location: venueText(b.venue, b.courts, venues),
    description: 'Courts booked for CRP training. Your team’s time will be confirmed by your coach.',
    tentative: true,
  };
}

async function main() {
  const { games, syncedAt } = await readJson('data/fixtures.json');
  const training = await readJson('config/training.json');
  const { sessions, clubBlocks } = await readJson('config/training-sessions.json');

  // Group games by team.
  const teams = new Map();
  for (const g of games) {
    if (!teams.has(g.teamName)) teams.set(g.teamName, { ...parseTeam(g.teamName), games: [] });
    teams.get(g.teamName).games.push(g);
  }

  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  const index = [];
  const noTraining = [];
  for (const [, team] of [...teams].sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }))) {
    const events = team.games.map((g) => gameEvent(g, team.short));
    const gameDays = new Set(team.games.map((g) => g.date));

    const group = training.aliases?.[team.group] ?? team.group;
    const ours = sessions.filter((s) => s.group === group);
    const cancelled = [];
    for (const s of ours) {
      if (gameDays.has(s.date)) { cancelled.push(s.date); continue; }
      events.push(trainingEvent(s, team.short, training.venues));
    }
    if (training.includeClubBlocks) {
      for (const b of clubBlocks) if (!gameDays.has(b.date)) events.push(clubBlockEvent(b, training.venues));
    }
    if (ours.length === 0) noTraining.push(team.short);

    const file = `warriors-${slug(team.short)}.ics`;
    await writeFile(
      new URL(file, OUT_DIR),
      buildCalendar({
        name: `Warriors ${team.short}`,
        description: `Warragul Warriors ${team.short}: games from PlayHQ + CRP training. Updates automatically.`,
        events: events.sort((a, b) => a.start - b.start),
      })
    );
    index.push({ team: team.short, group: team.group, file, games: team.games.length, training: ours.length - cancelled.length, trainingCancelled: cancelled });
  }

  await writeFile(new URL('index.json', OUT_DIR), JSON.stringify({ builtAt: new Date().toISOString(), fixturesSyncedAt: syncedAt, calendars: index }, null, 2));
  await writeFile(new URL('public/index.html', ROOT), renderIndex({ calendars: index, builtAt: syncedAt }));

  console.log(`Built ${index.length} team calendars in public/calendars/\n`);
  for (const c of index) {
    const note = c.trainingCancelled.length ? `  (training off: ${c.trainingCancelled.join(', ')})` : '';
    console.log(`  ${c.team.padEnd(14)} ${String(c.games).padStart(2)} games, ${c.training} training${note}`);
  }
  if (noTraining.length) console.log(`\n⚠ No upcoming training in config/training-sessions.json for: ${noTraining.join(', ')}`);
}

main().catch((err) => {
  console.error(`✘ ${err.message}`);
  process.exit(1);
});
