// Tiny iCalendar (RFC 5545) writer. Times are converted to UTC so no VTIMEZONE block is needed.

const TZ = 'Australia/Melbourne';

// Converts a Melbourne wall-clock time ("2026-10-17", "08:45") to a UTC Date, DST-aware.
export function melbourneToUtc(date, time) {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-AU', {
      timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(new Date(guess)).map((p) => [p.type, p.value])
  );
  const asLocal = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  return new Date(guess - (asLocal - guess));
}

const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

const escape = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');

// Folds lines at 75 octets as the spec requires (continuation lines start with a space).
function fold(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const out = [];
  let start = 0;
  while (start < bytes.length) {
    let end = Math.min(start + (out.length ? 74 : 75), bytes.length);
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--; // don't split a UTF-8 character
    out.push((out.length ? ' ' : '') + bytes.subarray(start, end).toString('utf8'));
    start = end;
  }
  return out.join('\r\n');
}

/**
 * events: [{ uid, start: Date, end: Date, summary, location?, description?, url?, alarmMinutes?, updated?: Date }]
 */
export function buildCalendar({ name, description, events }) {
  const now = stamp(new Date());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Warragul Warriors//Warriors Hub//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escape(name)}`,
    `X-WR-CALDESC:${escape(description)}`,
    `X-WR-TIMEZONE:${TZ}`,
    'X-APPLE-CALENDAR-COLOR:#C8102E', // Warriors red on Apple devices
    'COLOR:crimson', // RFC 7986, used by some other calendar apps
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ];
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}`,
      `DTSTAMP:${now}`,
      `DTSTART:${stamp(e.start)}`,
      `DTEND:${stamp(e.end)}`,
      `SUMMARY:${escape(e.summary)}`
    );
    if (e.location) lines.push(`LOCATION:${escape(e.location)}`);
    if (e.description) lines.push(`DESCRIPTION:${escape(e.description)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    if (e.tentative) lines.push('STATUS:TENTATIVE');
    if (e.updated) lines.push(`LAST-MODIFIED:${stamp(e.updated)}`);
    if (e.alarmMinutes) {
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escape(e.summary)}`, `TRIGGER:-PT${e.alarmMinutes}M`, 'END:VALARM');
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
