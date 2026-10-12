// Builds one subscribable .ics calendar per junior team: PlayHQ games + weekly training.
// Training is dropped on days the team has games. Reads data/fixtures.json (npm run sync).
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
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const readJson = async (path) => JSON.parse(await readFile(new URL(path, ROOT), 'utf8'));

// "Warragul Warriors U14 Girls 2" -> { group: "U14 Girls", short: "U14 Girls 2" }
function parseTeam(name) {
  const short = name.replace(/^Warragul Warriors\s+/i, '').trim();
  const m = short.match(/\b(U\d{1,2})\s+(Boys|Girls)\b/i);
  return { short, group: m ? `${m[1].toUpperCase()} ${m[2][0].toUpperCase()}${m[2].slice(1).toLowerCase()}` : null };
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function* sundaysBetween(fromStr, untilStr, dayName) {
  const dow = DAYS.indexOf(dayName);
  const d = new Date(`${fromStr}T00:00:00Z`);
  const until = new Date(`${untilStr}T00:00:00Z`);
  while (d.getUTCDay() !== dow) d.setUTCDate(d.getUTCDate() + 1);
  for (; d <= until; d.setUTCDate(d.getUTCDate() + 7)) yield d.toISOString().slice(0, 10);
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

function trainingEvent(session, date, cfg, short) {
  return {
    uid: `training-${slug(session.group)}-${date}@warriors-hub`,
    start: melbourneToUtc(date, session.start),
    end: melbourneToUtc(date, session.end),
    summary: `🏋️ ${short} training`,
    location: `${cfg.venue} – ${session.courts}, ${cfg.address}`,
    description: `Junior Warriors CRP – ${session.group}\nCoach: ${session.coach}`,
    alarmMinutes: TRAINING_ALARM,
  };
}

async function main() {
  const { games, syncedAt } = await readJson('data/fixtures.json');
  const training = await readJson('config/training.json');
  const sessionsByGroup = new Map(training.sessions.map((s) => [s.group, s]));
  const skip = new Set(training.skipDates);

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
  for (const [name, team] of [...teams].sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }))) {
    const events = team.games.map((g) => gameEvent(g, team.short));
    const gameDays = new Set(team.games.map((g) => g.date));

    const session = sessionsByGroup.get(team.group);
    const cancelled = [];
    if (session) {
      for (const date of sundaysBetween(training.from, training.until, training.day)) {
        if (skip.has(date)) continue;
        if (gameDays.has(date)) { cancelled.push(date); continue; }
        events.push(trainingEvent(session, date, training, team.short));
      }
    } else {
      noTraining.push(team.short);
    }

    const file = `warriors-${slug(team.short)}.ics`;
    await writeFile(
      new URL(file, OUT_DIR),
      buildCalendar({
        name: `Warriors ${team.short}`,
        description: `Warragul Warriors ${team.short}: games from PlayHQ + CRP training. Updates automatically.`,
        events: events.sort((a, b) => a.start - b.start),
      })
    );
    index.push({ team: team.short, group: team.group, file, games: team.games.length, trainingCancelled: cancelled });
  }

  await writeFile(new URL('index.json', OUT_DIR), JSON.stringify({ builtAt: new Date().toISOString(), fixturesSyncedAt: syncedAt, calendars: index }, null, 2));
  await writeFile(new URL('public/index.html', ROOT), renderIndex({ calendars: index, builtAt: syncedAt }));

  console.log(`Built ${index.length} team calendars in public/calendars/\n`);
  for (const c of index) {
    const note = c.trainingCancelled.length ? `  (training off: ${c.trainingCancelled.join(', ')})` : '';
    console.log(`  ${c.team.padEnd(14)} ${String(c.games).padStart(2)} games${note}`);
  }
  if (noTraining.length) console.log(`\n⚠ No training session in config/training.json for: ${noTraining.join(', ')}`);
}

main().catch((err) => {
  console.error(`✘ ${err.message}`);
  process.exit(1);
});
