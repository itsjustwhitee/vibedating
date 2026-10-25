import { isHttps, isValidTime, canonicalZone } from './validators.js';
import { storeLink, loadLink } from './api.js';

export class ConfigError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ConfigError';
    this.code = code;
  }
}

const toB64Url = (bytes) => {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromB64Url = (str) => {
  if (typeof str !== 'string' || !/^[A-Za-z0-9_-]+$/.test(str)) throw new Error('chars');
  let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
};

export function encodeConfig(obj) {
  return toB64Url(new TextEncoder().encode(JSON.stringify(obj)));
}

export function decodeConfig(str) {
  try {
    const bytes = fromB64Url(str);
    const obj = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('shape');
    return obj;
  } catch {
    throw new ConfigError('decode');
  }
}

function optString(v, max, code) {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') throw new ConfigError(code);
  const s = v.trim();
  if (s.length > max) throw new ConfigError(code);
  return s || undefined;
}

function normalizePlace(p) {
  if (p === null || typeof p !== 'object') throw new ConfigError('place');
  const name = optString(p.name, 80, 'place');
  if (!name) throw new ConfigError('place');
  const out = { name };
  const emoji = optString(p.emoji, 8, 'place');
  const note = optString(p.note, 140, 'place');
  const address = optString(p.address, 200, 'place');
  if (emoji) out.emoji = emoji;
  if (note) out.note = note;
  if (address) out.address = address;
  const maps = typeof p.maps === 'string' ? p.maps.trim() : '';
  if (isHttps(maps)) out.maps = maps;
  return out;
}

function intInRange(v, def, min, max, code) {
  if (v === undefined || v === null) return def;
  if (!Number.isInteger(v) || v < min || v > max) throw new ConfigError(code);
  return v;
}

export function normalizeConfig(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new ConfigError('shape');
  if (raw.v !== 1) throw new ConfigError('version');
  const lang = raw.lang === undefined ? 'it' : raw.lang;
  if (lang !== 'it' && lang !== 'en') throw new ConfigError('lang');

  if (!Array.isArray(raw.places) || raw.places.length < 1 || raw.places.length > 12) {
    throw new ConfigError('places');
  }
  if (!Array.isArray(raw.slots) || raw.slots.length < 1 || raw.slots.length > 12) {
    throw new ConfigError('slots');
  }
  const slots = [...new Set(raw.slots.map((s) => {
    if (typeof s !== 'string' || !isValidTime(s.trim())) throw new ConfigError('slots');
    return s.trim();
  }))].sort();

  const tz = raw.tz === undefined ? 'Europe/Rome' : raw.tz;
  const zone = typeof tz === 'string' ? canonicalZone(tz) : null;
  if (!zone) throw new ConfigError('tz');

  const cfg = {
    v: 1,
    lang,
    places: raw.places.map(normalizePlace),
    slots,
    duration: intInRange(raw.duration, 120, 30, 360, 'duration'),
    days: intInRange(raw.days, 60, 1, 180, 'days'),
    tz: zone,
  };
  const optional = { to: [40, 'to'], from: [40, 'from'], q: [140, 'q'], done: [200, 'done'] };
  for (const [key, [max, code]] of Object.entries(optional)) {
    const s = optString(raw[key], max, code);
    if (s !== undefined) cfg[key] = s;
  }
  if (isHttps(typeof raw.api === 'string' ? raw.api.trim() : '')) cfg.api = raw.api.trim();
  for (const key of ['k', 'sig', 'owner']) {
    if (typeof raw[key] === 'string') cfg[key] = raw[key];
  }
  if (typeof raw.exp === 'number') cfg.exp = raw.exp;
  return cfg;
}

export const mapsSearchUrl = (name, address) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([name, address].filter(Boolean).join(', '))}`;

async function pipe(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}

const deflate = async (value, format) =>
  toB64Url(await pipe(new TextEncoder().encode(JSON.stringify(value)), new CompressionStream(format)));

const inflate = async (str, format) =>
  JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await pipe(fromB64Url(str), new DecompressionStream(format))));

export const packConfig = (obj) => deflate(obj, 'gzip');

export async function unpackConfig(str) {
  try {
    const obj = await inflate(str, 'gzip');
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('shape');
    return obj;
  } catch {
    throw new ConfigError('decode');
  }
}

// Compact `#y=` wire form: a positional array where 0 means absent or default, trailing zeros
// dropped. apps-script/Code.gs writes the same form, so keep the two in step.
const WIRE = [['to'], ['from'], ['places'], ['slots'], ['q'], ['done'], ['lang', 'it'], ['duration', 120],
  ['days', 60], ['tz', 'Europe/Rome'], ['api'], ['k'], ['sig'], ['owner'], ['exp']];
const PLACE_WIRE = ['name', 'emoji', 'note', 'address', 'maps'];
const LANGS = ['it', 'en'];

function trimZeros(arr) {
  while (arr.length && arr[arr.length - 1] === 0) arr.pop();
  return arr;
}

const placeToWire = (p) => trimZeros(PLACE_WIRE.map((key) =>
  (key === 'maps' && p.maps && p.maps === mapsSearchUrl(p.name, p.address) ? 1 : p[key] ?? 0)));

function placeFromWire(arr) {
  if (!Array.isArray(arr)) return null;
  const p = {};
  PLACE_WIRE.forEach((key, i) => { if (arr[i]) p[key] = arr[i]; });
  if (p.maps === 1) p.maps = mapsSearchUrl(p.name, p.address);
  return p;
}

const toWire = (cfg) => trimZeros(WIRE.map(([key, def]) => {
  const v = cfg[key];
  if (key === 'places') return v.map(placeToWire);
  if (key === 'slots') return v.join('').replace(/:/g, '');
  if (key === 'lang') return LANGS.indexOf(v);
  return v === undefined || v === def ? 0 : v;
}));

// Expands to the same object the signer saw: defaults spelled out, absent fields left out.
function fromWire(arr) {
  if (!Array.isArray(arr)) throw new Error('shape');
  const raw = { v: 1 };
  WIRE.forEach(([key, def], i) => {
    const v = arr[i] ?? 0;
    if (key === 'places') raw.places = Array.isArray(v) ? v.map(placeFromWire) : v;
    else if (key === 'slots') raw.slots = typeof v === 'string' ? (v.match(/.{1,4}/g) || []).map((s) => `${s.slice(0, 2)}:${s.slice(2)}`) : v;
    else if (key === 'lang') raw.lang = LANGS[v] ?? v;
    else if (v !== 0) raw[key] = v;
    else if (def !== undefined) raw[key] = def;
  });
  return raw;
}

/** Packs a normalized config into the compact `#y=` payload. */
export const packCompact = (cfg) => deflate(toWire(cfg), 'deflate-raw');

export async function unpackCompact(str) {
  try {
    return fromWire(await inflate(str, 'deflate-raw'));
  } catch {
    throw new ConfigError('decode');
  }
}

const FORMATS = [['y', unpackCompact], ['z', unpackConfig], ['c', decodeConfig]];

/** True when the hash points to the link store, so reading it needs a network round trip. */
export const isStoredLink = (hash) => new URLSearchParams(String(hash || '').replace(/^#/, '')).has('i');

export async function readConfigFromHash(hash, { siteApi, linksApi, fetchImpl } = {}) {
  const params = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  if (params.has('i')) {
    const res = await loadLink(linksApi, params.get('i'), { fetchImpl });
    return res.ok ? readConfigFromHash(`#y=${res.p}`, { siteApi }) : { error: res.error };
  }
  const format = FORMATS.find(([key]) => params.get(key));
  if (!format) return { error: 'missing' };
  try {
    const raw = await format[1](params.get(format[0]));
    const cfg = normalizeConfig(raw);
    const site = typeof siteApi === 'string' ? siteApi.trim() : '';
    if (isHttps(site)) cfg.api = site;
    return { raw, cfg };
  } catch (e) {
    return { error: e instanceof ConfigError ? e.code : 'decode' };
  }
}

/** With `linksApi` the link is stored and shortened to `#i=`; a store failure keeps `#y=`. */
export async function buildInviteUrl(baseUrl, raw, { linksApi = '', fetchImpl } = {}) {
  const base = String(baseUrl).split('#')[0];
  const cfg = normalizeConfig(raw);
  if (typeof CompressionStream === 'undefined') return `${base}#c=${encodeConfig(cfg)}`;
  const payload = await packCompact(cfg);
  const id = linksApi ? await storeLink(linksApi, payload, { fetchImpl }) : '';
  return id ? `${base}#i=${id}` : `${base}#y=${payload}`;
}

export function configMode(cfg) {
  if (!cfg.api) return 'client';
  if (cfg.sig) return 'multi';
  if (cfg.k) return 'personal';
  return 'client';
}
