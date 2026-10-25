import vm from 'node:vm';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';

const CODE = readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');

function wallParts(t, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(new Date(t));
  const o = {};
  for (const p of parts) o[p.type] = p.value;
  return o;
}

function offsetMs(t, tz) {
  const p = wallParts(t, tz);
  return Date.UTC(+p.year, p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(t / 1000) * 1000;
}

function javaZone(tz) {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz }).resolvedOptions().timeZone === tz ? tz : 'GMT';
  } catch {
    return 'GMT';
  }
}

function parseDate(str, tz, pattern) {
  tz = javaZone(tz);
  if (pattern !== 'yyyy-MM-dd HH:mm') throw new Error('unsupported pattern ' + pattern);
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(str);
  if (!m) throw new Error('unparseable ' + str);
  const wall = Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5]);
  let t = wall - offsetMs(wall, tz);
  t = wall - offsetMs(t, tz);
  return new Date(t);
}

function formatDate(date, tz, pattern) {
  tz = javaZone(tz);
  const p = wallParts(date.getTime(), tz);
  const map = { yyyy: p.year, MM: p.month, dd: p.day, HH: p.hour, mm: p.minute, ss: p.second };
  return pattern.replace(/yyyy|MM|dd|HH|mm|ss/g, (k) => map[k]);
}

const toSigned = (buf) => Array.from(buf, (b) => (b > 127 ? b - 256 : b));
const toBuffer = (data) => (typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data.map((b) => b & 255)));

export function createGas({ props = {}, now = '2026-10-25T10:00:00Z', tz = 'Europe/Rome' } = {}) {
  let nowMs = new Date(now).getTime();
  const store = new Map(Object.entries(props));
  const cache = new Map();
  const events = [];
  const mails = [];
  const errors = [];
  const calendar = { createEvent: (title, start, end, opts) => events.push({ title, start, end, opts }) };

  class FakeDate extends Date {
    constructor(...args) {
      if (args.length === 0) super(nowMs);
      else super(...args);
    }
    static now() { return nowMs; }
  }

  const gas = {
    calendarImpl: () => calendar,
    events, mails, errors, store, cache,
    setNow(v) { nowMs = new Date(v).getTime(); }
  };

  const context = {
    Date: FakeDate,
    console: { log() {}, error: (...a) => errors.push(a) },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (store.has(k) ? store.get(k) : null),
        setProperty: (k, v) => { store.set(k, String(v)); },
        deleteProperty: (k) => { store.delete(k); },
        getKeys: () => [...store.keys()],
        getProperties: () => Object.fromEntries(store)
      })
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => {
          const e = cache.get(k);
          return e && e.until > nowMs ? e.value : null;
        },
        put: (k, value, ttl = 600) => { cache.set(k, { value, until: nowMs + ttl * 1000 }); }
      })
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, tryLock: () => true, releaseLock() {} }) },
    CalendarApp: { getDefaultCalendar: () => gas.calendarImpl() },
    MailApp: { sendEmail: (to, subject, body, options = {}) => mails.push({ to, subject, body, options }) },
    Session: {
      getScriptTimeZone: () => tz,
      getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' })
    },
    Utilities: {
      Charset: { UTF_8: 'UTF-8' },
      parseDate,
      formatDate,
      computeHmacSha256Signature: (value, key) =>
        toSigned(crypto.createHmac('sha256', toBuffer(key)).update(toBuffer(value)).digest()),
      computeDigest: (alg, value) => toSigned(crypto.createHash('sha256').update(toBuffer(value)).digest()),
      base64EncodeWebSafe: (data) => toBuffer(data).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
      newBlob: (data, contentType, name) => ({
        getDataAsString: () => data,
        getContentType: () => contentType,
        getName: () => name
      }),
      getUuid: () => crypto.randomUUID()
    },
    ContentService: {
      MimeType: { JSON: 'application/json', TEXT: 'text/plain' },
      createTextOutput: (content) => {
        const out = { content, mimeType: 'text/plain', getContent: () => content };
        out.setMimeType = (m) => { out.mimeType = m; return out; };
        return out;
      }
    },
    MimeType: { JSON: 'application/json' }
  };
  vm.createContext(context);
  vm.runInContext(CODE, context, { filename: 'Code.gs' });

  gas.raw = (contents) => {
    const out = context.doPost({ postData: { contents, type: 'text/plain' } });
    return { mimeType: out.mimeType, body: JSON.parse(out.content) };
  };
  gas.post = (body) => gas.raw(JSON.stringify(body)).body;
  gas.get = () => JSON.parse(context.doGet().content);
  return gas;
}
