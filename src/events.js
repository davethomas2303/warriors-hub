// Shared helpers for turning fixtures and training sessions into calendar events.

import { melbourneToUtc } from './ics.js';

const GAME_MINUTES = 60;
const GAME_ALARM = 60; // reminder before tip-off
const TRAINING_ALARM = 30;

export const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const groupOf = (text) => {
  const m = text.match(/\b(U\d{1,2})\s+(Boys|Girls)\b/i);
  return m ? `${m[1].toUpperCase()} ${m[2][0].toUpperCase()}${m[2].slice(1).toLowerCase()}` : null;
};

// "Warragul Warriors U14 Girls 2" -> { short: "U14 Girls 2", group: "U14 Girls", key: "U14 Girls 2" }
// A team without a number ("U10 Girls") is the group's only team, so its key gets " 1".
export function parseTeam(name) {
  const short = name.replace(/^Warragul Warriors\s+/i, '').trim();
  const group = groupOf(short);
  const num = short.match(/\b(\d+)\s*$/);
  return { short, group, key: group ? `${group} ${num ? num[1] : 1}` : short };
}

function venueText(code, courts, venues) {
  const v = venues[code];
  return v ? `${v.name} – ${courts}, ${v.address}` : `${code} – ${courts}`;
}

// label: what to show before "v Opponent" ("U14 Girls 2", or "Ava · U14 Girls 2" in a family calendar).
export function gameEvent(g, label, uidSuffix = '') {
  const start = melbourneToUtc(g.date, g.time);
  const where = [g.venue, g.court].filter(Boolean).join(' – ');
  const addr = g.address ? `${g.address.line1}, ${g.address.suburb} ${g.address.state} ${g.address.postcode}` : '';
  return {
    uid: `game-${g.id}-${g.teamId}${uidSuffix}@warriors-hub`,
    start,
    end: new Date(start.getTime() + GAME_MINUTES * 60_000),
    summary: `🏀 ${label} v ${g.opponent}`,
    location: [where, addr].filter(Boolean).join(', '),
    description: [`${g.competition} – ${g.round ?? ''}`.trim(), g.grade && `Grade: ${g.grade}`, g.url && `Game centre: ${g.url}`]
      .filter(Boolean).join('\n'),
    url: g.url,
    updated: g.updatedAt ? new Date(g.updatedAt) : undefined,
    alarmMinutes: GAME_ALARM,
  };
}

export function trainingEvent(s, label, { venues, coachNames = {} }, uidSuffix = '') {
  const pending = s.status === 'pending';
  const coach = coachNames[s.coach] ?? s.coach;
  return {
    uid: `training-${slug(s.group)}-${s.date}${uidSuffix}@warriors-hub`,
    start: melbourneToUtc(s.date, s.start),
    end: melbourneToUtc(s.date, s.end),
    summary: `🏋️ ${label} training${pending ? ' (TBC)' : ''}`,
    location: venueText(s.venue, s.courts, venues),
    description: [`Junior Warriors CRP – ${s.group}`, coach && `Coach: ${coach}`, pending && 'Booking not yet confirmed.']
      .filter(Boolean).join('\n'),
    tentative: pending,
    alarmMinutes: TRAINING_ALARM,
  };
}

export function clubBlockEvent(b, venues) {
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

// Training sessions for a team's age group (after aliases such as U19 Boys -> U18 Boys).
export function sessionsFor(group, sessions, training) {
  const g = training.aliases?.[group] ?? group;
  return sessions.filter((s) => s.group === g);
}
