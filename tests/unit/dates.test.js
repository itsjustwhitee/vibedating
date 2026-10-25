import test from 'node:test';
import assert from 'node:assert/strict';
import { todayISO, addDaysISO, zonedToUtc, formatDateLong } from '../../js/dates.js';

test('todayISO uses local parts, also just after midnight', () => {
  assert.equal(todayISO(new Date(2026, 0, 5, 0, 30)), '2026-01-05');
  assert.equal(todayISO(new Date(2026, 11, 31, 23, 59)), '2026-12-31');
});

test('todayISO in an explicit zone ignores the process zone', () => {
  const now = new Date('2026-10-25T20:30:00Z');
  assert.equal(todayISO(now, 'Asia/Tokyo'), '2026-10-26');
  assert.equal(todayISO(now, 'Europe/Rome'), '2026-10-25');
  assert.equal(todayISO(now, 'America/Los_Angeles'), '2026-10-25');
});

test('addDaysISO', () => {
  assert.equal(addDaysISO('2026-02-27', 2), '2026-03-01');
  assert.equal(addDaysISO('2026-01-01', -1), '2025-12-31');
  assert.equal(addDaysISO('2026-10-25', 0), '2026-10-25');
});

test('zonedToUtc Europe/Rome winter is UTC+1', () => {
  assert.equal(zonedToUtc('2026-01-15', '20:00', 'Europe/Rome').toISOString(), '2026-01-15T19:00:00.000Z');
});

test('zonedToUtc Europe/Rome summer is UTC+2', () => {
  assert.equal(zonedToUtc('2026-07-15', '20:00', 'Europe/Rome').toISOString(), '2026-07-15T18:00:00.000Z');
});

test('zonedToUtc across the DST switch days', () => {
  assert.equal(zonedToUtc('2026-03-29', '01:30', 'Europe/Rome').toISOString(), '2026-03-29T00:30:00.000Z');
  assert.equal(zonedToUtc('2026-03-29', '03:30', 'Europe/Rome').toISOString(), '2026-03-29T01:30:00.000Z');
  assert.equal(zonedToUtc('2026-10-25', '03:30', 'Europe/Rome').toISOString(), '2026-10-25T02:30:00.000Z');
});

test('zonedToUtc spring-forward gap shifts forward (02:30 -> 03:30 local)', () => {
  assert.equal(zonedToUtc('2026-03-29', '02:30', 'Europe/Rome').toISOString(), '2026-03-29T01:30:00.000Z');
});

test('zonedToUtc autumn overlap picks the earlier instant (CEST)', () => {
  assert.equal(zonedToUtc('2026-10-25', '02:30', 'Europe/Rome').toISOString(), '2026-10-25T00:30:00.000Z');
});

test('zonedToUtc other zones', () => {
  assert.equal(zonedToUtc('2026-01-15', '12:00', 'UTC').toISOString(), '2026-01-15T12:00:00.000Z');
  assert.equal(zonedToUtc('2026-01-15', '12:00', 'America/New_York').toISOString(), '2026-01-15T17:00:00.000Z');
});

test('formatDateLong', () => {
  assert.equal(formatDateLong('2026-11-01', 'it'), 'domenica 1 novembre');
  assert.equal(formatDateLong('2026-11-01', 'en'), 'Sunday, November 1');
  assert.equal(formatDateLong('2026-10-31', 'it'), 'sabato 31 ottobre');
});
