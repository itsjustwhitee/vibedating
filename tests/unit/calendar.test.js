import test from 'node:test';
import assert from 'node:assert/strict';
import { googleCalendarUrl, buildIcs } from '../../js/calendar.js';

const start = new Date('2026-11-07T19:30:00Z');
const end = new Date('2026-11-07T21:30:00Z');
const now = new Date('2026-10-25T10:00:00Z');

test('googleCalendarUrl format', () => {
  const url = new URL(googleCalendarUrl({ title: 'Cena & più', start, end, location: 'Via Roma 1, Padova', details: 'a\nb' }));
  assert.equal(url.origin + url.pathname, 'https://calendar.google.com/calendar/render');
  assert.equal(url.searchParams.get('action'), 'TEMPLATE');
  assert.equal(url.searchParams.get('text'), 'Cena & più');
  assert.equal(url.searchParams.get('dates'), '20261107T193000Z/20261107T213000Z');
  assert.equal(url.searchParams.get('location'), 'Via Roma 1, Padova');
  assert.equal(url.searchParams.get('details'), 'a\nb');
});

const unfold = (s) => s.replace(/\r\n /g, '');

test('buildIcs structure and CRLF', () => {
  const ics = buildIcs({ uid: 'abc@example.com', title: 'Dinner', start, end, location: 'Somewhere', description: 'Hi', now });
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.equal(ics.replace(/\r\n/g, '').includes('\n'), false);
  for (const line of [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT', 'UID:abc@example.com',
    'DTSTAMP:20261025T100000Z', 'DTSTART:20261107T193000Z', 'DTEND:20261107T213000Z', 'SUMMARY:Dinner',
    'LOCATION:Somewhere', 'DESCRIPTION:Hi', 'BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', 'END:VALARM', 'END:VEVENT',
  ]) assert.ok(ics.split('\r\n').includes(line), line);
  assert.ok(ics.split('\r\n').some((l) => l.startsWith('PRODID:')));
});

test('buildIcs escapes text', () => {
  const ics = buildIcs({ uid: 'u', title: 'a;b,c\\d', start, end, location: 'x', description: 'l1\nl2\r\nl3', now });
  assert.ok(ics.includes('SUMMARY:a\\;b\\,c\\\\d\r\n'));
  assert.ok(ics.includes('DESCRIPTION:l1\\nl2\\nl3\r\n'));
});

test('buildIcs folds long UTF-8 lines at 75 octets without splitting characters', () => {
  const description = 'Cena da Mario 🍝 è così bella, ' .repeat(12) + '日本語'.repeat(20);
  const ics = buildIcs({ uid: 'u', title: 'T', start, end, location: 'x', description, now });
  const enc = new TextEncoder();
  const lines = ics.split('\r\n');
  for (const l of lines) assert.ok(enc.encode(l).length <= 75, `too long: ${l}`);
  assert.ok(lines.some((l) => l.startsWith(' ')));
  const unfolded = unfold(ics);
  const expected = 'DESCRIPTION:' + description.replace(/,/g, '\\,');
  assert.ok(unfolded.split('\r\n').includes(expected));
  assert.equal(unfolded.includes('�'), false);
});
