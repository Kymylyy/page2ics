// Builds the .ics file (RFC 5545). No chrome.* dependencies, so it can be tested in node.

// Date -> "20260917T170000Z"
function utcStamp(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

// "2026-09-17T19:00" (local wall-clock time, no zone) -> "20260917T170000Z".
// The zone comes from the environment (browser / TZ in node), so DST is handled by the JS engine.
export function localToUtc(local) {
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${local}`);
  return utcStamp(d);
}

function esc(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

// Lines longer than 75 octets must be folded; a continuation starts with a space.
function fold(line) {
  const out = [];
  while (line.length > 73) {
    out.push(line.slice(0, 73));
    line = ' ' + line.slice(73);
  }
  out.push(line);
  return out.join('\r\n');
}

// One VCALENDAR with a VEVENT per event; UIDs are "<uid>-<index>".
export function buildIcs(events, { now = new Date(), uid = crypto.randomUUID() } = {}) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//page2ics//EN',
    'METHOD:PUBLISH',
    ...events.flatMap((ev, i) => vevent(ev, now, `${uid}-${i}`)),
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}

function vevent(ev, now, uid) {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${utcStamp(now)}`,
    `DTSTART:${localToUtc(ev.start)}`,
    `DTEND:${localToUtc(ev.end)}`,
    `SUMMARY:${esc(ev.title)}`,
  ];
  // Apple format: venue name on the first line, address on the second.
  const location = [ev.venue, ev.address].filter(Boolean).join('\n');
  if (location) lines.push(`LOCATION:${esc(location)}`);
  if (ev.geo) {
    lines.push(`GEO:${ev.geo.lat};${ev.geo.lon}`);
    // With coordinates Calendar.app shows a pin and directions without guessing the address from text.
    const title = location.replace(/"/g, '').replace(/\n/g, '\\n');
    lines.push(`X-APPLE-STRUCTURED-LOCATION;VALUE=URI;X-APPLE-RADIUS=100;X-TITLE="${title}":geo:${ev.geo.lat},${ev.geo.lon}`);
  }
  if (ev.description) lines.push(`DESCRIPTION:${esc(ev.description)}`);
  lines.push('END:VEVENT');
  return lines;
}
