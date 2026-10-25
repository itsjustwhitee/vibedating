import zlib from 'node:zlib';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ConfigError, encodeConfig, decodeConfig, packConfig, unpackConfig, packCompact, unpackCompact, normalizeConfig,
  readConfigFromHash, buildInviteUrl, configMode, isStoredLink, mapsSearchUrl,
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

test('readConfigFromHash keeps raw untouched', async () => {
  const raw = { ...base(), junk: 'x', to: '  Giulia  ', sig: 's' };
  for (const frag of [`c=${encodeConfig(raw)}`, `z=${await packConfig(raw)}`]) {
    const res = await readConfigFromHash(`#a=1&${frag}&x=y`);
    assert.deepEqual(res.raw, raw);
    assert.equal(res.cfg.to, 'Giulia');
    assert.equal('junk' in res.cfg, false);
  }
});

test('readConfigFromHash errors', async () => {
  assert.deepEqual(await readConfigFromHash(''), { error: 'missing' });
  assert.deepEqual(await readConfigFromHash('#x=1'), { error: 'missing' });
  assert.deepEqual(await readConfigFromHash('#c=@@@'), { error: 'decode' });
  assert.deepEqual(await readConfigFromHash('#z=@@@'), { error: 'decode' });
  assert.deepEqual(await readConfigFromHash(`#c=${encodeConfig({ v: 9 })}`), { error: 'version' });
  assert.deepEqual(await readConfigFromHash(`#z=${await packConfig({ v: 9 })}`), { error: 'version' });
});

test('packConfig round trip keeps emoji and accents', async () => {
  const obj = { v: 1, to: 'Chiarà', places: [{ name: 'Café Ünique 🍣', emoji: '🍜' }] };
  assert.deepEqual(await unpackConfig(await packConfig(obj)), obj);
});

test('unpackConfig rejects corrupted or non-gzip input', async () => {
  const good = await packConfig(base());
  for (const bad of ['', '***', 'abc', encodeConfig(base()), good.slice(0, -6), `${good.slice(0, 12)}AAAA${good.slice(16)}`, await packConfig([1])]) {
    await assert.rejects(unpackConfig(bad), (e) => e instanceof ConfigError && e.code === 'decode');
  }
});

test('siteApi always overrides the link api', async () => {
  const site = 'https://script.example.com/site';
  const raw = { ...base(), k: 'key', api: 'https://evil.example.org/exec' };
  const z = `#z=${await packConfig(raw)}`;
  assert.equal((await readConfigFromHash(z, { siteApi: site })).cfg.api, site);
  assert.equal((await readConfigFromHash(`#c=${encodeConfig(raw)}`, { siteApi: site })).cfg.api, site);
  const { k, api, ...noApi } = raw;
  const res = await readConfigFromHash(`#z=${await packConfig({ ...noApi, k })}`, { siteApi: site });
  assert.equal(configMode(res.cfg), 'personal');
  assert.equal(res.raw.api, undefined);
});

test('link api is kept without a usable siteApi', async () => {
  const raw = { ...base(), api: 'https://script.example.com/exec' };
  const z = `#z=${await packConfig(raw)}`;
  for (const siteApi of [undefined, '', 'http://insecure.example.com', 'nope']) {
    assert.equal((await readConfigFromHash(z, { siteApi })).cfg.api, raw.api);
  }
});

test('buildInviteUrl replaces any existing hash and writes the compact form', async () => {
  const raw = base();
  const url = await buildInviteUrl('https://example.com/invite/#old', raw);
  assert.match(url, /^https:\/\/example\.com\/invite\/#y=[A-Za-z0-9_-]+$/);
  assert.deepEqual((await readConfigFromHash(url.slice(url.indexOf('#')))).raw, normalizeConfig(raw));
});

test('buildInviteUrl falls back to c= without CompressionStream', async (t) => {
  const saved = globalThis.CompressionStream;
  t.after(() => { globalThis.CompressionStream = saved; });
  delete globalThis.CompressionStream;
  const url = await buildInviteUrl('https://example.com/', { ...base(), to: ' Giulia ' });
  assert.match(url, /#c=/);
  assert.equal((await readConfigFromHash(url.slice(url.indexOf('#')))).cfg.to, 'Giulia');
});

test('z= link is shorter than c= for a realistic config', async () => {
  const raw = {
    v: 1, lang: 'it', to: 'Saro', from: 'Ciuchi',
    places: [
      { emoji: '🍣', name: 'Sushi Sapporo', note: 'Nigiri al bancone, uno dopo l’altro' },
      { emoji: '🍜', name: 'Hideo Ramen', note: 'Brodo che scalda, risucchio ammesso' },
      { emoji: '🍕', name: 'Pizzeria Montebello', note: 'Forno a legna e cornicione che scrocchia' },
    ],
    slots: ['19:30', '20:00', '20:30', '21:00'], duration: 120, days: 60, tz: 'Europe/Rome',
    k: 'k'.repeat(32), api: `https://script.google.com/macros/s/${'A'.repeat(60)}/exec`,
  };
  const { api, ...noApi } = raw;
  const c = encodeConfig(raw);
  const z = await packConfig(noApi);
  assert.ok(z.length < c.length * 0.6, `${z.length} vs ${c.length}`);
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

// Seeded generator of varied normalized configs for the round-trip invariant.
function rng(seed) {
  return () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
}

function randomConfig(r) {
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const maybe = (v) => (r() < 0.5 ? v : undefined);
  const words = ['Caffè', 'Né', 'già', '🍝', 'Ünique', '日本', 'Trattoria', '0', 'x,y', 'a&b=c', '"quoted"', 'ñ'];
  const text = (n) => Array.from({ length: 1 + Math.floor(r() * n) }, () => pick(words)).join(' ');
  const places = Array.from({ length: 1 + Math.floor(r() * 12) }, () => {
    const p = { name: text(4), emoji: maybe(pick(['🍣', '☕', '🍷', '🇮🇹'])), note: maybe(text(6)), address: maybe(text(5)) };
    const maps = r();
    if (maps < 0.33) p.maps = mapsSearchUrl(p.name, p.address);
    else if (maps < 0.66) p.maps = `https://maps.example.com/${Math.floor(r() * 1e6)}`;
    return p;
  });
  const slots = Array.from({ length: 1 + Math.floor(r() * 12) },
    () => `${String(Math.floor(r() * 24)).padStart(2, '0')}:${pick(['00', '15', '30', '45', '05'])}`);
  const raw = {
    v: 1, places, slots,
    lang: maybe(pick(['it', 'en'])), duration: maybe(pick([30, 90, 120, 360])), days: maybe(pick([1, 60, 180])),
    tz: maybe(pick(['Europe/Rome', 'America/New_York', 'Asia/Tokyo'])),
    to: maybe(text(3)), from: maybe(text(3)), q: maybe(text(10)), done: maybe(text(10)),
  };
  if (r() < 0.3) raw.api = 'https://script.example.com/exec';
  if (r() < 0.3) raw.k = 'k'.repeat(8 + Math.floor(r() * 30));
  if (r() < 0.4) Object.assign(raw, { sig: 'S1g_-'.repeat(8), owner: 'owner@example.com', exp: 1790000000 + Math.floor(r() * 1e6) });
  for (const p of places) {
    if (p.name.length > 80) p.name = p.name.slice(0, 80).trim();
    for (const key of ['note', 'address']) if (p[key]?.length > 140) p[key] = p[key].slice(0, 140).trim();
  }
  for (const [key, max] of [['to', 40], ['from', 40], ['q', 140], ['done', 200]]) if (raw[key]?.length > max) raw[key] = raw[key].slice(0, max).trim();
  return normalizeConfig(JSON.parse(JSON.stringify(raw)));
}

test('compact round trip: normalizeConfig(decode(encode(c))) equals c for many configs', async () => {
  const r = rng(42);
  for (let i = 0; i < 300; i++) {
    const c = randomConfig(r);
    const decoded = await unpackCompact(await packCompact(c));
    assert.deepEqual(decoded, c, JSON.stringify(c));
    assert.deepEqual(normalizeConfig(decoded), c);
  }
});

test('compact form drops defaults and derived maps links', async () => {
  const place = { name: 'Caffè Né', address: 'Via Roma 1' };
  const c = normalizeConfig({ ...base(), places: [{ ...place, maps: mapsSearchUrl(place.name, place.address) }] });
  const wire = JSON.parse(zlib.inflateRawSync(Buffer.from(await packCompact(c), 'base64url')).toString('utf8'));
  assert.deepEqual(wire, [0, 0, [['Caffè Né', 0, 0, 'Via Roma 1', 1]], '2000']);
  const en = normalizeConfig({ ...base(), lang: 'en', duration: 90, tz: 'Asia/Tokyo' });
  const wireEn = JSON.parse(zlib.inflateRawSync(Buffer.from(await packCompact(en), 'base64url')).toString('utf8'));
  assert.deepEqual(wireEn, [0, 0, [['Trattoria']], '2000', 0, 0, 1, 90, 0, 'Asia/Tokyo']);
});

test('unpackCompact rejects bad input', async () => {
  const raw = (v) => Buffer.from(zlib.deflateRawSync(Buffer.from(JSON.stringify(v)))).toString('base64url');
  for (const bad of ['', '***', 'abc', await packConfig(base()), raw({ a: 1 })]) {
    await assert.rejects(unpackCompact(bad), (e) => e instanceof ConfigError && e.code === 'decode');
  }
  assert.deepEqual(await readConfigFromHash(`#y=${raw([0, 0, [], '2000'])}`), { error: 'places' });
  assert.deepEqual(await readConfigFromHash(`#y=${raw([0, 0, [['A']], '200'])}`), { error: 'slots' });
  assert.deepEqual(await readConfigFromHash(`#y=${raw([0, 0, [['A']], '2000', 0, 0, 7])}`), { error: 'lang' });
  assert.deepEqual(await readConfigFromHash(`#y=${raw([0, 0, [{ name: 'A' }], '2000'])}`), { error: 'place' });
});

test('y= is the shortest form for the demo invite', async () => {
  const c = normalizeConfig({
    ...base(), to: 'Saro', from: 'Ciuchi',
    places: [
      { emoji: '🍣', name: 'Sushi Sapporo', note: 'Nigiri al bancone, uno dopo l’altro' },
      { emoji: '🍜', name: 'Hideo Ramen', note: 'Brodo che scalda, risucchio ammesso' },
      { emoji: '🍕', name: 'Pizzeria Montebello', note: 'Forno a legna e cornicione che scrocchia' },
    ],
    slots: ['19:30', '20:00', '20:30', '21:00'],
  });
  const y = await packCompact(c);
  const z = await packConfig(c);
  assert.ok(y.length < z.length * 0.75, `${y.length} vs ${z.length}`);
});

const storeFetch = (entries) => async (url) => {
  const id = url.split('/').pop();
  if (entries === 'down') throw new TypeError('failed');
  const p = entries[id];
  return { text: async () => JSON.stringify(p ? { ok: true, p } : { ok: false, error: 'not_found' }) };
};

test('i= links are read from the store', async () => {
  const c = normalizeConfig({ ...base(), to: 'Giulia' });
  const fetchImpl = storeFetch({ Xk3f9Qa2bT: await packCompact(c) });
  const linksApi = 'https://links.example.com/links';
  assert.equal(isStoredLink('#i=Xk3f9Qa2bT'), true);
  assert.equal(isStoredLink('#y=abc'), false);
  assert.deepEqual((await readConfigFromHash('#i=Xk3f9Qa2bT', { linksApi, fetchImpl })).cfg, c);
  assert.deepEqual(await readConfigFromHash('#i=Unknown000', { linksApi, fetchImpl }), { error: 'not_found' });
  assert.deepEqual(await readConfigFromHash('#i=../x', { linksApi, fetchImpl }), { error: 'not_found' });
  assert.deepEqual(await readConfigFromHash('#i=Xk3f9Qa2bT', { fetchImpl }), { error: 'not_found' });
  assert.deepEqual(await readConfigFromHash('#i=Xk3f9Qa2bT', { linksApi, fetchImpl: storeFetch('down') }), { error: 'network' });
});

test('buildInviteUrl shortens through the store and quietly keeps y= on failure', async () => {
  const linksApi = 'https://links.example.com/links/';
  let seen;
  const ok = async (url, opts) => { seen = { url, body: JSON.parse(opts.body) }; return { text: async () => '{"ok":true,"id":"Xk3f9Qa2bT"}' }; };
  assert.equal(await buildInviteUrl('https://example.com/', base(), { linksApi, fetchImpl: ok }), 'https://example.com/#i=Xk3f9Qa2bT');
  assert.equal(seen.url, 'https://links.example.com/links');
  assert.deepEqual(await unpackCompact(seen.body.p), normalizeConfig(base()));
  for (const fetchImpl of [storeFetch('down'), async () => ({ text: async () => '{"ok":false,"error":"limit"}' })]) {
    assert.match(await buildInviteUrl('https://example.com/', base(), { linksApi, fetchImpl }), /^https:\/\/example\.com\/#y=/);
  }
});
