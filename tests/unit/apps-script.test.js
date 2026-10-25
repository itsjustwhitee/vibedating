import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGas } from '../../dev/gas-emulator.js';
import { unpackCompact, normalizeConfig, readConfigFromHash } from '../../js/config.js';

const KEY = 'test-shared-key-0123456789';
const PERSONAL = { SHARED_KEY: KEY, ALLOWED_GUESTS: 'guest@example.com, Friend@Example.com' };
const MULTI = { SIGNING_SECRET: 'test-signing-secret', SITE_URL: 'https://example.com/vibedating/' };

let seq = 0;
const nextId = () => 'req-' + ++seq;

function accept(extra = {}) {
  return {
    action: 'accept', id: nextId(), k: KEY, guest: 'guest@example.com',
    place: { name: 'Trattoria Example', address: 'Via Esempio 1' },
    date: '2026-12-10', time: '20:00', duration: 120, tz: 'Europe/Rome',
    to: 'A', from: 'B', note: 'See you', ...extra
  };
}

const baseConfig = () => ({
  v: 1, lang: 'en', to: 'A', from: 'B', q: 'Dinner?', owner: 'owner@example.com',
  places: [
    { name: 'Café Ünique', emoji: '🍝', note: 'Pasta', address: 'Main St 1', maps: 'https://maps.example.com/1' },
    { name: 'Second', emoji: '🍣', address: 'Side St 2' }
  ],
  slots: ['19:30', '20:00'], duration: 90, days: 30, tz: 'Europe/Rome', api: 'https://script.example.com/exec'
});

const linkIn = (mail) => /#([yi])=([A-Za-z0-9_-]+)/.exec(mail.body);

// Decodes the emailed link with the browser code, as the invite page would.
async function createAndDecode(gas, config = baseConfig()) {
  const res = gas.post({ action: 'create', id: nextId(), config });
  assert.deepEqual(res, { ok: true });
  const m = linkIn(gas.mails.at(-1));
  assert.ok(m && m[1] === 'y', 'compact link in mail');
  return unpackCompact(m[2]);
}

const multiAccept = (config, extra = {}) => ({
  action: 'accept', id: nextId(), config, guest: 'guest@example.com', placeIndex: 0,
  date: '2026-11-05', time: '20:00', ...extra
});

test('Code.gs has no module syntax', () => {
  const src = readFileSync(new URL('../../apps-script/Code.gs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /\b(import|require|export)\b/);
});

test('doGet health check', () => {
  assert.deepEqual(createGas().get(), { ok: true, service: 'vibedating' });
});

test('personal happy path, winter instant', () => {
  const gas = createGas({ props: PERSONAL });
  const out = gas.raw(JSON.stringify(accept()));
  assert.equal(out.mimeType, 'application/json');
  assert.deepEqual(out.body, { ok: true });
  assert.equal(gas.events.length, 1);
  const ev = gas.events[0];
  assert.equal(ev.title, 'Cena con B');
  assert.equal(ev.start.toISOString(), '2026-12-10T19:00:00.000Z');
  assert.equal(ev.end.toISOString(), '2026-12-10T21:00:00.000Z');
  assert.deepEqual({ ...ev.opts }, {
    guests: 'guest@example.com', sendInvites: true, location: 'Via Esempio 1', description: 'See you'
  });
});

test('personal accept also invites OWNER_EMAIL when set', () => {
  const gas = createGas({ props: { ...PERSONAL, OWNER_EMAIL: ' me@example.com ' } });
  assert.deepEqual(gas.post(accept()), { ok: true });
  assert.equal(gas.events[0].opts.guests, 'guest@example.com,me@example.com');
});

test('mails carry the sender name', () => {
  const gas = createGas({ props: { ...MULTI, SENDER_NAME: 'Invito' } });
  assert.equal(gas.post({ action: 'create', id: 'n1', config: baseConfig() }).ok, true);
  assert.equal(gas.mails[0].options.name, 'Invito');
});

test('personal summer instant (DST)', () => {
  const gas = createGas({ props: PERSONAL });
  assert.deepEqual(gas.post(accept({ date: '2027-04-10', time: '20:30' })), { ok: true });
  assert.equal(gas.events[0].start.toISOString(), '2027-04-10T18:30:00.000Z');
});

test('personal location falls back to name', () => {
  const gas = createGas({ props: PERSONAL });
  gas.post(accept({ place: { name: 'Only Name' } }));
  assert.equal(gas.events[0].opts.location, 'Only Name');
});

test('personal refusals', () => {
  const cases = [
    [{ k: 'wrong' }, 'bad_key'],
    [{ k: undefined }, 'bad_key'],
    [{ guest: 'other@example.com' }, 'guest_not_allowed'],
    [{ guest: 'not-an-email' }, 'bad_email'],
    [{ date: '2026-10-24' }, 'bad_date'],
    [{ date: '2027-05-01' }, 'bad_date'],
    [{ date: '2026-02-30' }, 'bad_date'],
    [{ time: '25:00' }, 'bad_time'],
    [{ time: '8:00' }, 'bad_time'],
    [{ place: { name: 'x'.repeat(81) } }, 'bad_place'],
    [{ place: { name: '' } }, 'bad_place'],
    [{ note: 'x'.repeat(501) }, 'bad_request'],
    [{ duration: 10 }, 'bad_request']
  ];
  for (const [extra, code] of cases) {
    const gas = createGas({ props: PERSONAL });
    assert.deepEqual(gas.post(accept(extra)), { ok: false, error: code }, JSON.stringify(extra));
    assert.equal(gas.events.length, 0);
  }
});

test('today follows the timezone, not UTC', () => {
  const gas = createGas({ props: PERSONAL, now: '2026-10-25T23:30:00Z' });
  assert.deepEqual(gas.post(accept({ date: '2026-10-25' })), { ok: false, error: 'bad_date' });
  assert.deepEqual(gas.post(accept({ date: '2026-10-26' })), { ok: true });
});

test('missing personal properties -> not_configured', () => {
  const gas = createGas({ props: { ALLOWED_GUESTS: 'guest@example.com' } });
  assert.deepEqual(gas.post(accept()), { ok: false, error: 'not_configured' });
});

test('allowlist is case-insensitive', () => {
  const gas = createGas({ props: PERSONAL });
  assert.deepEqual(gas.post(accept({ guest: 'friend@EXAMPLE.com' })), { ok: true });
  assert.deepEqual(gas.post(accept({ guest: 'GUEST@example.com' })), { ok: true });
  assert.equal(gas.events.length, 2);
});

test('duplicate id creates one event', () => {
  const gas = createGas({ props: PERSONAL });
  const req = accept();
  assert.deepEqual(gas.post(req), { ok: true });
  assert.deepEqual(gas.post(req), { ok: true, duplicate: true });
  assert.equal(gas.events.length, 1);
});

test('daily cap', () => {
  const gas = createGas({ props: { ...PERSONAL, DAILY_LIMIT: '2' } });
  assert.equal(gas.post(accept()).ok, true);
  assert.equal(gas.post(accept()).ok, true);
  assert.deepEqual(gas.post(accept()), { ok: false, error: 'limit' });
  assert.equal(gas.events.length, 2);
  gas.setNow('2026-10-26T10:00:00Z');
  assert.equal(gas.post(accept()).ok, true);
});

test('old counters are pruned', () => {
  const gas = createGas({ props: { ...PERSONAL, 'count:accept:personal:2026-10-01': '5' } });
  gas.post(accept());
  assert.equal(gas.store.has('count:accept:personal:2026-10-01'), false);
  assert.equal(gas.store.get('count:accept:personal:2026-10-25'), '1');
});

test('bad requests', () => {
  const gas = createGas({ props: PERSONAL });
  assert.deepEqual(gas.raw('{not json').body, { ok: false, error: 'bad_request' });
  assert.deepEqual(gas.raw('[]').body, { ok: false, error: 'bad_request' });
  assert.deepEqual(gas.post(accept({ id: undefined })), { ok: false, error: 'bad_request' });
  assert.deepEqual(gas.post(accept({ id: 'x'.repeat(65) })), { ok: false, error: 'bad_request' });
  assert.deepEqual(gas.post({ action: 'nope', id: 'a' }), { ok: false, error: 'bad_request' });
});

test('thrown error -> server, not echoed', () => {
  const gas = createGas({ props: PERSONAL });
  gas.calendarImpl = () => { throw new Error('secret internal detail'); };
  const res = gas.post(accept());
  assert.deepEqual(res, { ok: false, error: 'server' });
  assert.equal(gas.errors.length, 1);
});

test('create emails the signed link to the owner only', async () => {
  const gas = createGas({ props: MULTI });
  const decoded = await createAndDecode(gas);
  assert.equal(gas.mails.length, 1);
  assert.equal(gas.mails[0].to, 'owner@example.com');
  assert.match(gas.mails[0].body, /https:\/\/example\.com\/vibedating\/#y=/);
  assert.match(gas.mails[0].options.htmlBody, /href="https:\/\/example\.com\/vibedating\/#y=/);
  assert.equal(typeof decoded.sig, 'string');
  assert.equal(decoded.exp, Math.floor(Date.parse('2026-10-25T10:00:00Z') / 1000) + 60 * 86400);
  const { sig, exp, ...rest } = decoded;
  const { api, ...expected } = baseConfig();
  assert.deepEqual(rest, expected);
  assert.equal(gas.events.length, 0);
});

test('create ignores client-supplied sig/exp', async () => {
  const gas = createGas({ props: MULTI });
  const decoded = await createAndDecode(gas, { ...baseConfig(), sig: 'forged', exp: 9999999999 });
  assert.notEqual(decoded.sig, 'forged');
  assert.notEqual(decoded.exp, 9999999999);
});

test('create validation', () => {
  const gas = createGas({ props: MULTI });
  const post = (config) => gas.post({ action: 'create', id: nextId(), config });
  assert.deepEqual(post({ ...baseConfig(), owner: undefined }), { ok: false, error: 'bad_email' });
  assert.deepEqual(post({ ...baseConfig(), places: [] }), { ok: false, error: 'bad_place' });
  assert.deepEqual(post({ ...baseConfig(), slots: ['7pm'] }), { ok: false, error: 'bad_time' });
  assert.equal(gas.mails.length, 0);
});

test('create per-owner cap', async () => {
  const gas = createGas({ props: MULTI });
  for (let i = 0; i < 3; i++) await createAndDecode(gas);
  assert.deepEqual(gas.post({ action: 'create', id: nextId(), config: baseConfig() }), { ok: false, error: 'limit' });
  assert.equal(gas.mails.length, 3);
  assert.equal(gas.post({ action: 'create', id: nextId(), config: { ...baseConfig(), owner: 'b@example.com' } }).ok, true);
});

test('create without SITE_URL -> not_configured', () => {
  const gas = createGas({ props: { SIGNING_SECRET: 'x' } });
  assert.deepEqual(gas.post({ action: 'create', id: nextId(), config: baseConfig() }), { ok: false, error: 'not_configured' });
  assert.equal(gas.mails.length, 0);
});

test('multi accept mails owner with .ics, no calendar write', async () => {
  const gas = createGas({ props: MULTI });
  const config = await createAndDecode(gas);
  const res = gas.post(multiAccept(config));
  assert.deepEqual(res, { ok: true });
  assert.equal(gas.events.length, 0);
  const mail = gas.mails.at(-1);
  assert.equal(mail.to, 'owner@example.com');
  assert.equal(mail.options.replyTo, 'guest@example.com');
  assert.match(mail.subject, /Café Ünique/);
  assert.match(mail.body, /guest@example\.com/);
  assert.match(mail.body, /calendar\.google\.com\/calendar\/render\?action=TEMPLATE.*dates=20261105T190000Z\/20261105T203000Z/);
  const [blob] = mail.options.attachments;
  assert.equal(blob.getName(), 'invite.ics');
  assert.equal(blob.getContentType(), 'text/calendar');
  assert.match(blob.getDataAsString(), /DTSTART:20261105T190000Z\r\nDTEND:20261105T203000Z/);
  assert.deepEqual(gas.post({ ...multiAccept(config), id: 'dup-1' }), { ok: true });
  assert.deepEqual(gas.post({ ...multiAccept(config), id: 'dup-1' }), { ok: true, duplicate: true });
});

test('multi accept: reordered keys still verify', async () => {
  const gas = createGas({ props: MULTI });
  const config = await createAndDecode(gas);
  const reverse = (o) => Object.fromEntries(Object.entries(o).reverse()
    .map(([k, v]) => [k, Array.isArray(v) ? v.map((x) => (x && typeof x === 'object' ? reverse(x) : x)) : v]));
  assert.deepEqual(gas.post(multiAccept(reverse(config))), { ok: true });
});

test('multi accept refusals', async () => {
  const gas = createGas({ props: MULTI });
  const config = await createAndDecode(gas);
  const tampered = structuredClone(config);
  tampered.places[0].name = 'Renamed';
  assert.deepEqual(gas.post(multiAccept(tampered)), { ok: false, error: 'bad_signature' });
  assert.deepEqual(gas.post(multiAccept({ ...config, owner: 'evil@example.com' })), { ok: false, error: 'bad_signature' });
  const { sig, ...unsigned } = config;
  assert.deepEqual(gas.post(multiAccept(unsigned)), { ok: false, error: 'bad_signature' });
  assert.deepEqual(gas.post(multiAccept(config, { placeIndex: 2 })), { ok: false, error: 'bad_place' });
  assert.deepEqual(gas.post(multiAccept(config, { placeIndex: '0' })), { ok: false, error: 'bad_place' });
  assert.deepEqual(gas.post(multiAccept(config, { time: '21:00' })), { ok: false, error: 'bad_time' });
  assert.deepEqual(gas.post(multiAccept(config, { date: '2026-12-01' })), { ok: false, error: 'bad_date' });
  assert.deepEqual(gas.post(multiAccept(config, { guest: 'nope' })), { ok: false, error: 'bad_email' });
  gas.setNow('2026-12-25T10:00:00Z');
  assert.deepEqual(gas.post(multiAccept(config, { date: '2026-12-26' })), { ok: false, error: 'expired' });
  assert.equal(gas.mails.length, 1);
});

test('multi accept per-owner cap', async () => {
  const gas = createGas({ props: { ...MULTI, OWNER_ACCEPT_LIMIT: '1' } });
  const config = await createAndDecode(gas);
  assert.equal(gas.post(multiAccept(config)).ok, true);
  assert.deepEqual(gas.post(multiAccept(config)), { ok: false, error: 'limit' });
});

const create = (gas, config) => gas.post({ action: 'create', id: nextId(), config });
const icsOf = (gas) => gas.mails.at(-1).options.attachments[0].getDataAsString();

test('create per-owner cap ignores spaces, NBSP and case', () => {
  const gas = createGas({ props: MULTI });
  for (const owner of ['owner@example.com', '  Owner@Example.com ', '\u00a0OWNER@example.COM', ' owner@example.com']) {
    const res = create(gas, { ...baseConfig(), owner });
    assert.equal(res.ok, owner !== ' owner@example.com', owner);
  }
  assert.equal(gas.mails.length, 3);
  assert.ok(gas.mails.every((m) => m.to === 'owner@example.com'));
});

test('multi accepts do not consume the personal cap', async () => {
  const gas = createGas({ props: { ...PERSONAL, ...MULTI, DAILY_LIMIT: '1', MULTI_DAILY_LIMIT: '2' } });
  const config = await createAndDecode(gas);
  assert.equal(gas.post(multiAccept(config)).ok, true);
  assert.equal(gas.post(multiAccept(config)).ok, true);
  assert.deepEqual(gas.post(multiAccept(config)), { ok: false, error: 'limit' });
  assert.equal(gas.post(accept()).ok, true);
  assert.deepEqual(gas.post(accept()), { ok: false, error: 'limit' });
});

test('create refuses configs the front end would not accept', () => {
  const gas = createGas({ props: MULTI });
  const b = baseConfig();
  const place = (o) => ({ ...b, places: [{ name: 'X', ...o }] });
  const cases = [
    [{ ...b, v: 2 }, 'bad_request'],
    [{ ...b, v: undefined }, 'bad_request'],
    [{ ...b, lang: 'fr' }, 'bad_request'],
    [{ ...b, extra: 1 }, 'bad_request'],
    [{ ...b, api: 'http://script.example.com/exec' }, 'bad_request'],
    [{ ...b, to: 'x'.repeat(41) }, 'bad_request'],
    [{ ...b, q: 'x'.repeat(141) }, 'bad_request'],
    [{ ...b, done: 'x'.repeat(201) }, 'bad_request'],
    [{ ...b, tz: 'Mars/Base' }, 'bad_request'],
    [{ ...b, duration: 29 }, 'bad_request'],
    [{ ...b, days: 181 }, 'bad_request'],
    [place({ emoji: '123456789' }), 'bad_place'],
    [place({ note: 'x'.repeat(141) }), 'bad_place'],
    [place({ address: 'x'.repeat(201) }), 'bad_place'],
    [place({ maps: 'http://maps.example.com/1' }), 'bad_place'],
    [{ ...b, places: Array(13).fill({ name: 'X' }) }, 'bad_place'],
    [{ ...b, slots: Array.from({ length: 13 }, (_, i) => `1${i % 10}:0${i % 10}`) }, 'bad_time']
  ];
  for (const [config, code] of cases) assert.deepEqual(create(gas, config), { ok: false, error: code }, JSON.stringify(config).slice(0, 80));
  assert.equal(gas.mails.length, 0);
  assert.equal(create(gas, place({ emoji: '12345678', note: 'x'.repeat(140) })).ok, true);
});

test('create never signs an api and ignores the client api',  async () => {
  const gas = createGas({ props: MULTI });
  const decoded = await createAndDecode(gas, { ...baseConfig(), api: 'https://evil.example.org/exec', k: 'leak' });
  assert.equal(decoded.api, undefined);
  assert.equal(decoded.k, undefined);
  const noApi = { ...baseConfig() };
  delete noApi.api;
  assert.equal((await createAndDecode(createGas({ props: MULTI }), noApi)).api, undefined);
  const missing = createGas({ props: { SITE_URL: MULTI.SITE_URL } });
  assert.deepEqual(create(missing, baseConfig()), { ok: false, error: 'not_configured' });
});

test('server-signed link decodes in the browser and passes normalizeConfig', async () => {
  const gas = createGas({ props: MULTI });
  const decoded = await createAndDecode(gas, { ...baseConfig(), tz: 'europe/rome', slots: ['20:00', ' 19:30 ', '20:00'] });
  const cfg = normalizeConfig(decoded);
  assert.deepEqual(cfg, decoded);
  assert.equal(cfg.tz, 'Europe/Rome');
  assert.deepEqual(cfg.slots, ['19:30', '20:00']);
  assert.equal(cfg.api, undefined);
  assert.equal(cfg.owner, 'owner@example.com');
  assert.equal(cfg.sig, decoded.sig);
});

test('ics escapes CR and folds at 75 octets', async () => {
  const gas = createGas({ props: MULTI });
  const config = await createAndDecode(gas, {
    ...baseConfig(),
    places: [{ name: 'Line\rOne', note: 'é'.repeat(60) + '🍝'.repeat(20), address: 'Via\rRoma\r\nX, y\nZ' }]
  });
  assert.equal(gas.post(multiAccept(config)).ok, true);
  const ics = icsOf(gas);
  assert.doesNotMatch(ics, /\r(?!\n)/);
    const lines = ics.split('\r\n');
  for (const l of lines) assert.ok(Buffer.byteLength(l) <= 75, l);
  const unfolded = ics.replace(/\r\n /g, '');
  assert.ok(unfolded.includes('LOCATION:Via\\nRoma\\nX\\, y\\nZ'));
  assert.ok(unfolded.includes('é'.repeat(60) + '🍝'.repeat(20)));
  assert.ok(!gas.mails.at(-1).subject.match(/[\r\n]/));
});

test('tz is canonicalised on create and the instant is right', async () => {
  const gas = createGas({ props: MULTI });
  const config = await createAndDecode(gas, { ...baseConfig(), tz: 'europe/rome' });
  assert.equal(config.tz, 'Europe/Rome');
  assert.equal(gas.post(multiAccept(config)).ok, true);
  assert.match(gas.mails.at(-1).body, /dates=20261105T190000Z/);
  const p = createGas({ props: PERSONAL });
  assert.deepEqual(p.post(accept({ tz: 'europe/rome' })), { ok: true });
  assert.equal(p.events[0].start.toISOString(), '2026-12-10T19:00:00.000Z');
  assert.deepEqual(p.post(accept({ tz: 'Mars/Base' })), { ok: true });
});

test('past start today -> bad_time in both modes', async () => {
  const gas = createGas({ props: { ...PERSONAL, ...MULTI }, now: '2026-10-25T19:30:00Z' });
  const config = await createAndDecode(gas);
  assert.deepEqual(gas.post(multiAccept(config, { date: '2026-10-25', time: '20:00' })), { ok: false, error: 'bad_time' });
  assert.deepEqual(gas.post(accept({ date: '2026-10-25', time: '20:00' })), { ok: false, error: 'bad_time' });
  assert.deepEqual(gas.post(accept({ date: '2026-10-25', time: '21:00' })), { ok: true });
});

test('personal title follows lang and from', () => {
  const gas = createGas({ props: PERSONAL });
  const titles = [];
  for (const extra of [{}, { lang: 'en' }, { lang: 'en', from: '' }, { from: '' }, { lang: 'it', from: 'B' }]) {
    gas.post(accept(extra));
    titles.push(gas.events.at(-1).title);
  }
  assert.deepEqual(titles, ['Cena con B', 'Dinner with B', 'Dinner together 💕', 'Cena insieme 💕', 'Cena con B']);
  assert.deepEqual(gas.post(accept({ lang: 'fr' })), { ok: false, error: 'bad_request' });
});

test('multi accept title uses config lang and from', async () => {
  const gas = createGas({ props: MULTI });
  gas.post(multiAccept(await createAndDecode(gas)));
  assert.match(icsOf(gas), /SUMMARY:Dinner with B/);
  const { from, ...rest } = baseConfig();
  gas.post(multiAccept(await createAndDecode(gas, { ...rest, lang: 'it', owner: 'o2@example.com' })));
  assert.match(icsOf(gas), /SUMMARY:Cena insieme/);
});

test('emulated gzip carries FNAME like the real service', () => {
  const gas = createGas();
  const bytes = gas.utilities.gzip(gas.utilities.newBlob('{"a":1}', 'application/json', 'config.json')).getBytes();
  assert.equal(bytes[3] & 8, 8);
  assert.equal(Buffer.from(bytes.slice(10, 21).map((b) => b & 255)).toString('latin1'), 'config.json');
});

test('a Code.gs link opens in the browser code and its signature verifies on accept', async () => {
  const gas = createGas({ props: MULTI });
  const derived = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('Caffè Né, Via Già 1')}`;
  const { lang, ...noLang } = baseConfig();
  const config = { ...noLang, to: 'Chiàra 💕', places: [{ name: 'Caffè Né', emoji: '☕', address: 'Via Già 1', maps: derived }, { name: 'Plain' }] };
  assert.deepEqual(gas.post({ action: 'create', id: nextId(), config }), { ok: true });
  const [, kind, payload] = linkIn(gas.mails.at(-1));
  assert.equal(kind, 'y');
  const { raw, cfg } = await readConfigFromHash(`#y=${payload}`);
  assert.equal(cfg.lang, 'it');
  assert.equal(cfg.places[0].maps, derived);
  assert.deepEqual(normalizeConfig(raw), cfg);
  assert.deepEqual(gas.post(multiAccept(raw)), { ok: true });
  assert.deepEqual(gas.post(multiAccept({ ...raw, to: 'Other' })), { ok: false, error: 'bad_signature' });
});

const STORE = { ...MULTI, LINKS_URL: 'https://links.example.com/links', LINKS_SECRET: 'links-secret' };

test('create shortens the link through the store when configured', async () => {
  const gas = createGas({ props: STORE });
  gas.fetchImpl = () => ({ body: JSON.stringify({ ok: true, id: 'Xk3f9Qa2bT' }) });
  assert.deepEqual(gas.post({ action: 'create', id: nextId(), config: baseConfig() }), { ok: true });
  assert.match(gas.mails[0].body, /https:\/\/example\.com\/vibedating\/#i=Xk3f9Qa2bT\n/);
  assert.equal(gas.fetches.length, 1);
  const { url, params } = gas.fetches[0];
  assert.equal(url, STORE.LINKS_URL);
  assert.equal(params.method, 'post');
  assert.equal(params.headers.Authorization, 'Bearer links-secret');
  const { raw } = await readConfigFromHash(`#y=${JSON.parse(params.payload).p}`);
  assert.deepEqual(gas.post(multiAccept(raw)), { ok: true });
});

test('a failing store falls back to the compact link', () => {
  const replies = [
    () => ({ code: 500, body: '{"ok":false,"error":"server"}' }),
    () => ({ code: 429, body: '<html>' }),
    () => ({ body: JSON.stringify({ ok: true, id: '../evil' }) }),
    () => { throw new Error('DNS error'); },
  ];
  for (const reply of replies) {
    const gas = createGas({ props: STORE });
    gas.fetchImpl = reply;
    assert.deepEqual(gas.post({ action: 'create', id: nextId(), config: baseConfig() }), { ok: true });
    assert.equal(linkIn(gas.mails[0])[1], 'y');
    assert.equal(gas.errors.length, 1);
  }
});

test('the store is skipped without both properties or past the daily cap', () => {
  for (const props of [MULTI, { ...STORE, LINKS_SECRET: '' }, { ...STORE, LINKS_URL: 'http://links.example.com/links' }]) {
    const gas = createGas({ props });
    assert.deepEqual(gas.post({ action: 'create', id: nextId(), config: baseConfig() }), { ok: true });
    assert.equal(linkIn(gas.mails[0])[1], 'y');
    assert.equal(gas.fetches.length, 0);
  }
  const gas = createGas({ props: { ...STORE, CREATE_DAILY_LIMIT: '0' } });
  assert.deepEqual(gas.post({ action: 'create', id: nextId(), config: baseConfig() }), { ok: false, error: 'limit' });
  assert.equal(gas.fetches.length, 0);
});
