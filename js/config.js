import { isHttps, isValidTime, canonicalZone } from './validators.js';

export class ConfigError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ConfigError';
    this.code = code;
  }
}

export function encodeConfig(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeConfig(str) {
  try {
    if (typeof str !== 'string' || !/^[A-Za-z0-9_-]+$/.test(str)) throw new Error('chars');
    let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
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

export function readConfigFromHash(hash) {
  const payload = new URLSearchParams(String(hash || '').replace(/^#/, '')).get('c');
  if (!payload) return { error: 'missing' };
  try {
    const raw = decodeConfig(payload);
    return { raw, cfg: normalizeConfig(raw) };
  } catch (e) {
    return { error: e instanceof ConfigError ? e.code : 'decode' };
  }
}

export function buildInviteUrl(baseUrl, raw) {
  return `${String(baseUrl).split('#')[0]}#c=${encodeConfig(raw)}`;
}

export function configMode(cfg) {
  if (!cfg.api) return 'client';
  if (cfg.sig) return 'multi';
  if (cfg.k) return 'personal';
  return 'client';
}
