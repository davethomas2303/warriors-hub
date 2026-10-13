// Builds one subscribable .ics calendar per junior team: PlayHQ games + CRP training sessions.
// Training is dropped on days the team has games. Reads data/fixtures.json (npm run sync) and
// config/training-sessions.json (npm run import-bookings).
//
//   npm run calendars   ->  public/calendars/<team>.ics  +  public/calendars/index.json

import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { buildCalendar } from '../src/ics.js';
import { clubBlockEvent, gameEvent, parseTeam, sessionsFor, slug, trainingEvent } from '../src/events.js';
import { renderIndex } from '../src/page.js';

const ROOT = new URL('../', import.meta.url);
const OUT_DIR = new URL('public/calendars/', ROOT);

const readJson = async (path) => JSON.parse(await readFile(new URL(path, ROOT), 'utf8'));

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

    const ours = sessionsFor(team.group, sessions, training);
    const cancelled = [];
    for (const s of ours) {
      if (gameDays.has(s.date)) { cancelled.push(s.date); continue; }
      events.push(trainingEvent(s, team.short, training));
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
  await copyFile(new URL('assets/logo.png', ROOT), new URL('public/logo.png', ROOT));

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
