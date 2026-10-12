// Converts a court-booking export (JSON) into config/training-sessions.json.
// Keeps only CRP bookings from today onwards; contact details and other programs are dropped.
//
//   npm run import-bookings -- path/to/export.json

import { readFile, writeFile } from 'node:fs/promises';

const OUT = new URL('../config/training-sessions.json', import.meta.url);
const GROUP_RE = /\bU(\d{1,2})\s*(Boys|Girls)\b/i;

const hhmm = (mins) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
const courtNo = (c) => Number(String(c).replace(/\D/g, ''));

function expandDates(b) {
  if (b.kind === 'once') return b.date ? [b.date] : [];
  if (b.kind !== 'weekly') return [];
  const skip = new Set(b.skip ?? []);
  const dates = [];
  const d = new Date(`${b.from}T00:00:00Z`);
  const until = new Date(`${b.until}T00:00:00Z`);
  while (d.getUTCDay() !== b.dow) d.setUTCDate(d.getUTCDate() + 1);
  for (; d <= until; d.setUTCDate(d.getUTCDate() + 7)) {
    const iso = d.toISOString().slice(0, 10);
    if (!skip.has(iso)) dates.push(iso);
  }
  return dates;
}

function formatCourts(nums) {
  const sorted = [...new Set(nums)].sort((a, b) => a - b);
  if (sorted.length === 1) return `Court ${sorted[0]}`;
  const consecutive = sorted.every((n, i) => i === 0 || n === sorted[i - 1] + 1);
  return consecutive ? `Courts ${sorted[0]}–${sorted.at(-1)}` : `Courts ${sorted.join(' & ')}`;
}

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error('Usage: npm run import-bookings -- path/to/export.json');
  const { bookings, exported } = JSON.parse(await readFile(file, 'utf8'));
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Melbourne' });

  // One entry per group/date/time/venue; multi-court bookings are merged.
  const sessions = new Map();
  const blocks = new Map();
  for (const b of bookings.filter((b) => b.prog === 'crp')) {
    const m = (b.team ?? '').match(GROUP_RE);
    for (const date of expandDates(b).filter((d) => d >= today)) {
      if (m) {
        const group = `U${m[1]} ${m[2][0].toUpperCase()}${m[2].slice(1).toLowerCase()}`;
        const key = [date, group, b.s, b.e, b.v].join('|');
        const s = sessions.get(key) ?? {
          date, group, start: hhmm(b.s), end: hhmm(b.e), venue: b.v, courts: [], coach: b.contact || null, status: b.status,
        };
        s.courts.push(courtNo(b.c));
        if (b.status === 'pending') s.status = 'pending';
        sessions.set(key, s);
      } else if (/training/i.test(b.team ?? '')) {
        // Whole-program blocks ("Club Training") with no per-group times yet.
        const key = [date, b.v].join('|');
        const blk = blocks.get(key) ?? { date, s: b.s, e: b.e, venue: b.v, courts: [], status: b.status };
        blk.courts.push(courtNo(b.c));
        blk.s = Math.min(blk.s, b.s);
        blk.e = Math.max(blk.e, b.e);
        blocks.set(key, blk);
      }
    }
  }

  const finish = (list) =>
    [...list.values()]
      .map((x) => ({ ...x, courts: formatCourts(x.courts) }))
      .sort((a, b) => `${a.date}${a.start}${a.group ?? ''}`.localeCompare(`${b.date}${b.start}${b.group ?? ''}`));

  const clubBlocks = new Map([...blocks].map(([k, { s, e, ...rest }]) => [k, { date: rest.date, start: hhmm(s), end: hhmm(e), ...rest }]));
  const out = { importedAt: new Date().toISOString(), sourceExportedAt: exported ?? null, sessions: finish(sessions), clubBlocks: finish(clubBlocks) };
  await writeFile(OUT, JSON.stringify(out, null, 2) + '\n');

  console.log(`Imported ${out.sessions.length} CRP sessions and ${out.clubBlocks.length} club-training blocks (from ${today}).`);
  for (const s of out.sessions) console.log(`  ${s.date} ${s.start}–${s.end}  ${s.group.padEnd(10)} ${s.venue} ${s.courts}  ${s.coach ?? ''}${s.status === 'pending' ? '  (pending)' : ''}`);
  for (const b of out.clubBlocks) console.log(`  ${b.date} ${b.start}–${b.end}  Club training block  ${b.venue} ${b.courts}  (${b.status})`);
}

main().catch((err) => {
  console.error(`✘ ${err.message}`);
  process.exit(1);
});
