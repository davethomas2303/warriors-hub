// Pulls every current/upcoming junior fixture for the Warriors club from PlayHQ, across all
// competitions the club plays in (VJBL, JCC, tournaments run by other associations).
// Writes data/fixtures.json (one flat list of games) and data/raw/ (API responses).
//
//   npm run sync

import { mkdir, writeFile } from 'node:fs/promises';
import { clientFromEnv } from '../src/playhq.js';

const DATA_DIR = new URL('../data/', import.meta.url);
const ACTIVE_STATUSES = new Set(['ACTIVE', 'UPCOMING']);
// Juniors only: age-group teams like "U14 Girls 1". Excludes senior teams (e.g. CBL Men/Women).
const isJunior = (team) => /\bU\d{1,2}\b/i.test(`${team.name} ${team.grade?.name ?? ''}`);

async function save(name, value) {
  const url = new URL(name, DATA_DIR);
  await mkdir(new URL('.', url), { recursive: true });
  await writeFile(url, JSON.stringify(value, null, 2));
}

function toGame(game, team, season) {
  const us = game.competitors?.find((c) => c.id === team.id);
  const them = game.competitors?.find((c) => c.id !== team.id);
  return {
    id: game.id,
    teamId: team.id,
    teamName: team.name,
    grade: team.grade?.name ?? null,
    competition: season.competition?.name ?? null,
    organiser: season.association?.name ?? null,
    seasonId: season.id,
    round: game.round?.name ?? null,
    date: game.schedule?.date ?? null,
    time: game.schedule?.time ?? null,
    timezone: game.schedule?.timezone ?? 'Australia/Melbourne',
    home: us?.isHomeTeam ?? null,
    opponent: them?.name ?? 'TBC',
    venue: game.venue?.name ?? null,
    court: game.venue?.surfaceName ?? null,
    address: game.venue?.address ?? null,
    status: game.status ?? null,
    score: us?.scoreTotal != null ? { us: us.scoreTotal, them: them?.scoreTotal ?? null, outcome: us.outcome } : null,
    url: game.url ?? null,
    updatedAt: game.updatedAt ?? null,
  };
}

async function main() {
  const { client, orgId, clubId } = clientFromEnv();
  if (!clubId) throw new Error('PLAYHQ_CLUB_ID is missing from .env');
  const tenant = await client.resolveTenant(orgId);

  const seasons = (await client.seasons(clubId)).filter((s) => ACTIVE_STATUSES.has(s.status));
  await save('raw/club-seasons.json', seasons);
  console.log(`✔ Connected (tenant ${tenant}). ${seasons.length} current/upcoming competitions.\n`);

  const games = [];
  const ungraded = [];
  for (const season of seasons) {
    const label = `${season.competition?.name} (${season.association?.name})`;
    let teams;
    try {
      teams = (await client.teams(season.id)).filter((t) => t.club?.id === clubId && isJunior(t));
    } catch (err) {
      console.log(`✘ ${label}: ${err.message}`);
      continue;
    }
    if (teams.length === 0) continue;

    // Many of our teams share a grade, so fetch each grade's fixture once.
    const gradeFixtures = new Map();
    let seasonGames = 0;
    for (const team of teams) {
      if (!team.grade?.id) {
        ungraded.push(`${team.name} — ${season.competition?.name}`);
        continue;
      }
      if (!gradeFixtures.has(team.grade.id)) {
        gradeFixtures.set(team.grade.id, await client.gradeFixture(team.grade.id));
      }
      for (const game of gradeFixtures.get(team.grade.id)) {
        if (game.competitors?.some((c) => c.id === team.id)) {
          games.push(toGame(game, team, season));
          seasonGames++;
        }
      }
    }
    console.log(`▸ ${label}: ${teams.length} teams, ${seasonGames} games`);
  }

  games.sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  await save('fixtures.json', { syncedAt: new Date().toISOString(), games });

  console.log(`\nSaved ${games.length} games to data/fixtures.json`);
  if (ungraded.length) {
    console.log(`\n${ungraded.length} teams entered but not yet graded (no fixture published yet):`);
    for (const t of ungraded) console.log(`  · ${t}`);
  }
}

main().catch((err) => {
  console.error(`✘ ${err.message}`);
  process.exit(1);
});
