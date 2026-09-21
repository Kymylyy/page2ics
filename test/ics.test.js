import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localToUtc, buildIcs } from '../ics.js';

// Tests assume TZ=Europe/Warsaw (set in package.json).

test('summer time: 19:00 in Warsaw is 17:00 UTC', () => {
  assert.equal(localToUtc('2026-09-17T19:00'), '20260917T170000Z');
});

test('winter time: 19:00 in Warsaw is 18:00 UTC', () => {
  assert.equal(localToUtc('2026-12-17T19:00'), '20261217T180000Z');
});

test('day of the switch to summer time (2026-03-29): evening is already +2', () => {
  assert.equal(localToUtc('2026-03-29T19:00'), '20260329T170000Z');
});

test('day of the switch to winter time (2026-10-25): evening is already +1', () => {
  assert.equal(localToUtc('2026-10-25T19:00'), '20261025T180000Z');
});

test('invalid date throws', () => {
  assert.throws(() => localToUtc('tomorrow'), /Invalid date/);
});

const crossfit = {
  title: 'CrossFit Endurance – CrossFit Wisła',
  start: '2026-09-17T19:00',
  end: '2026-09-17T20:00',
  venue: 'CrossFit Wisła',
  address: 'Nadrzeczna 5, 30-003 Kraków',
  description: 'Czwartek: 2026-09-17 - 19:00\n\nhttps://x.pl',
};
const opts = { now: new Date('2026-09-16T12:00:00Z'), uid: 'test-uid' };
const unfold = (ics) => ics.replace(/\r\n /g, '');

test('buildIcs: gym booking, no coordinates', () => {
  assert.equal(buildIcs(crossfit, opts), [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//page2ics//EN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    'UID:test-uid',
    'DTSTAMP:20260916T120000Z',
    'DTSTART:20260917T170000Z',
    'DTEND:20260917T180000Z',
    'SUMMARY:CrossFit Endurance – CrossFit Wisła',
    'LOCATION:CrossFit Wisła\\nNadrzeczna 5\\, 30-003 Kraków',
    'DESCRIPTION:Czwartek: 2026-09-17 - 19:00\\n\\nhttps://x.pl',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n'));
});

test('buildIcs: coordinates add GEO and the Apple structured location', () => {
  const ics = unfold(buildIcs({ ...crossfit, geo: { lat: '50.0614', lon: '19.9366' } }, opts));
  assert.ok(ics.includes('\r\nGEO:50.0614;19.9366\r\n'));
  assert.ok(ics.includes(
    '\r\nX-APPLE-STRUCTURED-LOCATION;VALUE=URI;X-APPLE-RADIUS=100;X-TITLE="CrossFit Wisła\\nNadrzeczna 5, 30-003 Kraków":geo:50.0614,19.9366\r\n',
  ));
});

test('buildIcs: without an address LOCATION is just the venue; without both there is no LOCATION', () => {
  assert.ok(buildIcs({ ...crossfit, address: '' }, opts).includes('\r\nLOCATION:CrossFit Wisła\r\n'));
  assert.ok(!buildIcs({ ...crossfit, venue: '', address: '' }, opts).includes('LOCATION'));
});

test('buildIcs: semicolons, commas and backslashes in text are escaped', () => {
  const ics = buildIcs({ ...crossfit, title: 'Cut; beard, wash \\ dry' }, opts);
  assert.ok(ics.includes('\r\nSUMMARY:Cut\\; beard\\, wash \\\\ dry\r\n'));
});

test('buildIcs: long lines are folded and can be unfolded back', () => {
  const title = 'x'.repeat(200);
  const ics = buildIcs({ title, start: '2026-09-17T19:00', end: '2026-09-17T20:00' }, { uid: 'u' });
  for (const line of ics.split('\r\n')) assert.ok(line.length <= 74, `line too long: ${line.length}`);
  assert.ok(unfold(ics).includes(`SUMMARY:${title}`));
});
