import test from 'node:test';
import assert from 'node:assert/strict';
import { isHttps, isEmail, isValidTime, canonicalZone } from '../../js/validators.js';

test('isHttps', () => {
  assert.equal(isHttps('https://maps.example.com/a'), true);
  for (const bad of ['http://x.example.com', 'javascript:alert(1)', 'nope', '', null, 5]) assert.equal(isHttps(bad), false);
});

test('isEmail mirrors the server rule', () => {
  for (const ok of ['a@example.com', ' a.b+c@sub.example.org ']) assert.equal(isEmail(ok), true);
  for (const bad of ['a@b', 'a@b.c', 'a b@example.com', 'a@@example.com', '"a"@example.com', 'a@example.com,b@example.com', '<a>@example.com', '', null]) {
    assert.equal(isEmail(bad), false, String(bad));
  }
  assert.equal(isEmail(`${'a'.repeat(250)}@example.com`), false);
});

test('isValidTime', () => {
  for (const ok of ['00:00', '23:59', '19:30']) assert.equal(isValidTime(ok), true);
  for (const bad of ['24:00', '12:60', '9:00', '12:5', 'ab:cd', '']) assert.equal(isValidTime(bad), false);
});

test('canonicalZone', () => {
  assert.equal(canonicalZone('europe/rome'), 'Europe/Rome');
  assert.equal(canonicalZone('Mars/Base'), null);
});
