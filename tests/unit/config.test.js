import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ConfigError, encodeConfig, decodeConfig, normalizeConfig, readConfigFromHash, buildInviteUrl, configMode,
} from '../../js/config.js';

const base = () => ({ v: 1, places: [{ name: 'Trattoria' }], slots: ['20:00'] });
const code = (fn) => { try { fn(); } catch (e) { assert.ok(e instanceof ConfigError); return e.code; } assert.fail('did not throw'); };

test('round trip with emoji and accents', () => {
  const obj = { v: 1, to: 'Giulia 💕', note: 'È già più è così ñ 日本', places: [{ name: '🍝 Caffè' }] };
  assert.deepEqual(decodeConfig(encodeConfig(obj)), obj);
});

test('base64url has no + / =', () => {
  const s = encodeConfig({ x: '???>>>~~~ÿÿÿÿ' + '?'.repeat(7) });
  assert.match(s, /^[A-Za-z0-9_-]+$/);
});

test('decodeConfig throws ConfigError on bad input', () => {
  for (const bad of ['', '***', 'abc', encodeConfig([1]), '_w']) {
    assert.equal(code(() => decodeConfig(bad)), 'decode');
  }
});

test('defaults', () => {
  const cfg = normalizeConfig(base());
  assert.deepEqual(cfg, { v: 1, lang: 'it', places: [{ name: 'Trattoria' }], slots: ['20:00'], duration: 120, days: 60, tz: 'Europe/Rome' });
});

test('normalize returns a new object and drops unknown keys', () => {
  const raw = { ...base(), junk: 1, places: [{ name: 'A', evil: 1 }] };
  const cfg = normalizeConfig(raw);
  assert.notEqual(cfg, raw);
  assert.equal('junk' in cfg, false);
  assert.equal('evil' in cfg.places[0], false);
});

test('version, lang, shape', () => {
  assert.equal(code(() => normalizeConfig({ ...base(), v: 2 })), 'version');
  assert.equal(code(() => normalizeConfig({ ...base(), lang: 'fr' })), 'lang');
  assert.equal(code(() => normalizeConfig(null)), 'shape');
  assert.equal(normalizeConfig({ ...base(), lang: 'en' }).lang, 'en');
});

test('string limits and trimming', () => {
  assert.equal(normalizeConfig({ ...base(), to: '  Giulia ' }).to, 'Giulia');
  assert.equal(normalizeConfig({ ...base(), to: '   ' }).to, undefined);
  assert.equal(normalizeConfig({ ...base(), to: 'a'.repeat(40) }).to.length, 40);
  assert.equal(code(() => normalizeConfig({ ...base(), to: 'a'.repeat(41) })), 'to');
  assert.equal(code(() => normalizeConfig({ ...base(), from: 'a'.repeat(41) })), 'from');
  assert.equal(code(() => normalizeConfig({ ...base(), q: 'a'.repeat(141) })), 'q');
  assert.equal(code(() => normalizeConfig({ ...base(), done: 'a'.repeat(201) })), 'done');
  assert.equal(code(() => normalizeConfig({ ...base(), to: 5 })), 'to');
});

test('places rules', () => {
  const p = (x) => normalizeConfig({ ...base(), places: [x] }).places[0];
  assert.equal(code(() => normalizeConfig({ ...base(), places: [] })), 'places');
  assert.equal(code(() => normalizeConfig({ ...base(), places: Array(13).fill({ name: 'A' }) })), 'places');
  assert.equal(normalizeConfig({ ...base(), places: Array(12).fill({ name: 'A' }) }).places.length, 12);
  assert.equal(code(() => p({})), 'place');
  assert.equal(code(() => p({ name: ' ' })), 'place');
  assert.equal(code(() => p({ name: 'a'.repeat(81) })), 'place');
  assert.equal(code(() => p({ name: 'A', emoji: '123456789' })), 'place');
  assert.equal(code(() => p({ name: 'A', note: 'a'.repeat(141) })), 'place');
  assert.equal(code(() => p({ name: 'A', address: 'a'.repeat(201) })), 'place');
  assert.deepEqual(p({ name: ' A ', emoji: '🍝', note: 'n', address: 'Via 1', maps: 'https://maps.example.com/x' }),
    { name: 'A', emoji: '🍝', note: 'n', address: 'Via 1', maps: 'https://maps.example.com/x' });
  assert.equal('maps' in p({ name: 'A', maps: 'http://maps.example.com' }), false);
  assert.equal('maps' in p({ name: 'A', maps: 'javascript:alert(1)' }), false);
});

test('slots are validated, deduped and sorted', () => {
  assert.deepEqual(normalizeConfig({ ...base(), slots: ['21:00', '19:30', '21:00', '00:00'] }).slots, ['00:00', '19:30', '21:00']);
  for (const bad of [[], ['24:00'], ['19:60'], ['9:00'], [5]]) {
    assert.equal(code(() => normalizeConfig({ ...base(), slots: bad })), 'slots');
  }
  assert.equal(code(() => normalizeConfig({ ...base(), slots: Array.from({ length: 13 }, (_, i) => `${10 + i}:00`) })), 'slots');
});

test('duration, days, tz', () => {
  assert.equal(normalizeConfig({ ...base(), duration: 30 }).duration, 30);
  assert.equal(normalizeConfig({ ...base(), duration: 360 }).duration, 360);
  assert.equal(code(() => normalizeConfig({ ...base(), duration: 29 })), 'duration');
  assert.equal(code(() => normalizeConfig({ ...base(), duration: 90.5 })), 'duration');
  assert.equal(normalizeConfig({ ...base(), days: 180 }).days, 180);
  assert.equal(code(() => normalizeConfig({ ...base(), days: 0 })), 'days');
  assert.equal(code(() => normalizeConfig({ ...base(), days: 366 })), 'days');
  assert.equal(normalizeConfig({ ...base(), tz: 'America/New_York' }).tz, 'America/New_York');
  assert.equal(normalizeConfig({ ...base(), tz: 'europe/rome' }).tz, 'Europe/Rome');
  assert.equal(code(() => normalizeConfig({ ...base(), tz: 'Mars/Base' })), 'tz');
});

test('api and pass-through fields', () => {
  assert.equal(normalizeConfig({ ...base(), api: 'https://script.example.com/exec' }).api, 'https://script.example.com/exec');
  assert.equal('api' in normalizeConfig({ ...base(), api: 'http://script.example.com/exec' }), false);
  const cfg = normalizeConfig({ ...base(), k: 'key', sig: 'sig', owner: 'o@example.com', exp: 1767225600 });
  assert.deepEqual([cfg.k, cfg.sig, cfg.owner, cfg.exp], ['key', 'sig', 'o@example.com', 1767225600]);
  const none = normalizeConfig({ ...base(), k: 5, exp: '1' });
  assert.equal('k' in none || 'exp' in none, false);
});

test('readConfigFromHash keeps raw untouched', () => {
  const raw = { ...base(), junk: 'x', to: '  Giulia  ', sig: 's' };
  const res = readConfigFromHash(`#a=1&c=${encodeConfig(raw)}&x=y`);
  assert.deepEqual(res.raw, raw);
  assert.equal(res.cfg.to, 'Giulia');
  assert.equal('junk' in res.cfg, false);
});

test('readConfigFromHash errors', () => {
  assert.deepEqual(readConfigFromHash(''), { error: 'missing' });
  assert.deepEqual(readConfigFromHash('#x=1'), { error: 'missing' });
  assert.deepEqual(readConfigFromHash('#c=@@@'), { error: 'decode' });
  assert.deepEqual(readConfigFromHash(`#c=${encodeConfig({ v: 9 })}`), { error: 'version' });
});

test('buildInviteUrl replaces any existing hash', () => {
  const raw = base();
  const url = buildInviteUrl('https://example.com/invite/#old', raw);
  assert.ok(url.startsWith('https://example.com/invite/#c='));
  assert.deepEqual(readConfigFromHash(url.slice(url.indexOf('#'))).raw, raw);
});

test('configMode', () => {
  const api = 'https://script.example.com/exec';
  assert.equal(configMode({}), 'client');
  assert.equal(configMode({ k: 'x' }), 'client');
  assert.equal(configMode({ api }), 'client');
  assert.equal(configMode({ api, k: 'x' }), 'personal');
  assert.equal(configMode({ api, sig: 's' }), 'multi');
  assert.equal(configMode({ api, sig: 's', k: 'x' }), 'multi');
});
