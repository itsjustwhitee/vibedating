var MAX_BODY = 20000;
var MAX_CONFIG = 8000;
var DAY_MS = 86400000;
var CONFIG_KEYS = ['v', 'lang', 'to', 'from', 'q', 'places', 'slots', 'duration', 'days', 'tz', 'done', 'api', 'owner'];
var DROPPED_KEYS = ['sig', 'exp', 'k'];
// Compact `#y=` wire form, kept in step with js/config.js: positional, 0 = absent or default.
var WIRE = [['to'], ['from'], ['places'], ['slots'], ['q'], ['done'], ['lang', 'it'], ['duration', 120],
  ['days', 60], ['tz', 'Europe/Rome'], ['api'], ['k'], ['sig'], ['owner'], ['exp']];
var PLACE_WIRE = ['name', 'emoji', 'note', 'address', 'maps'];

var TEXT = {
  it: {
    titleWith: 'Cena con {from}',
    titleAlone: 'Cena insieme 💕',
    linkSubject: 'Il tuo link di invito è pronto',
    linkBody: 'Ecco il link da condividere. Scade il {exp}.',
    ignore: "Se non l'hai richiesto tu, ignora questa email.",
    yesSubject: 'Ha detto sì! {place}, {date} alle {time}',
    guest: 'Ospite',
    place: 'Luogo',
    when: 'Quando',
    calendar: 'Aggiungi a Google Calendar'
  },
  en: {
    titleWith: 'Dinner with {from}',
    titleAlone: 'Dinner together 💕',
    linkSubject: 'Your invite link is ready',
    linkBody: 'Here is the link to share. It expires on {exp}.',
    ignore: 'If you did not request it, ignore this email.',
    yesSubject: 'They said yes! {place}, {date} at {time}',
    guest: 'Guest',
    place: 'Place',
    when: 'When',
    calendar: 'Add to Google Calendar'
  }
};

function doGet() {
  return json_({ ok: true, service: 'vibedating' });
}

function doPost(e) {
  try {
    return json_(route_(parseBody_(e)));
  } catch (err) {
    if (err && err.clientCode) return json_({ ok: false, error: err.clientCode });
    console.error((err && err.stack) || err);
    return json_({ ok: false, error: 'server' });
  }
}

function route_(req) {
  if (typeof req.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(req.id)) fail_('bad_request');
  if (req.action === 'create') return withDedupe_(req.id, prepareCreate_(req));
  if (req.action === 'accept') {
    return withDedupe_(req.id, req.config ? prepareMultiAccept_(req) : preparePersonalAccept_(req));
  }
  fail_('bad_request');
}

function preparePersonalAccept_(req) {
  var p = props_();
  if (!p.SHARED_KEY || !p.ALLOWED_GUESTS) fail_('not_configured');
  if (typeof req.k !== 'string' || !safeEqual_(req.k, p.SHARED_KEY)) fail_('bad_key');
  var guest = email_(req.guest);
  var allowed = p.ALLOWED_GUESTS.split(',').map(function (s) { return s.trim().toLowerCase(); });
  if (allowed.indexOf(guest.toLowerCase()) < 0) fail_('guest_not_allowed');
  var place = isObject_(req.place) ? req.place : fail_('bad_place');
  var name = text_(place.name, 80, 'bad_place', 1);
  var address = text_(place.address, 200, 'bad_place');
  var note = text_(req.note, 500, 'bad_request');
  var from = text_(req.from, 40, 'bad_request');
  if (req.lang != null && req.lang !== 'it' && req.lang !== 'en') fail_('bad_request');
  var tz = tz_(req.tz);
  checkDate_(req.date, tz, 180);
  checkTime_(req.time);
  var start = parseStart_(req.date, req.time, tz);
  var end = new Date(start.getTime() + int_(req.duration, 120, 30, 360) * 60000);
  var title = title_(textFor_(req.lang), from);
  return {
    limits: [{ scope: 'accept:personal', max: limit_(p.DAILY_LIMIT, 20) }],
    run: function () {
      CalendarApp.getDefaultCalendar().createEvent(title, start, end, {
        guests: p.OWNER_EMAIL ? guest + ',' + p.OWNER_EMAIL.trim() : guest,
        sendInvites: true,
        location: address || name,
        description: note
      });
    }
  };
}

function prepareCreate_(req) {
  var p = props_();
  if (!p.SIGNING_SECRET || !/^https:\/\/[^\s#]+$/.test(p.SITE_URL || '')) fail_('not_configured');
  var c = validateConfig_(req.config);
  delete c.api;
  c.exp = Math.floor(new Date().getTime() / 1000) + limit_(p.LINK_DAYS, 60) * 86400;
  c.sig = sign_(c, p.SIGNING_SECRET);
  var payload = pack_(c);
  var t = textFor_(c.lang);
  var exp = Utilities.formatDate(new Date(c.exp * 1000), c.tz, 'yyyy-MM-dd');
  var intro = t.linkBody.replace('{exp}', exp);
  return {
    limits: [
      { scope: 'create', max: limit_(p.CREATE_DAILY_LIMIT, 30) },
      { scope: 'create:' + c.owner, max: limit_(p.OWNER_DAILY_LIMIT, 3) }
    ],
    run: function () {
      var id = storeLink_(p, payload);
      var link = p.SITE_URL + (id ? '#i=' + id : '#y=' + payload);
      MailApp.sendEmail(c.owner, t.linkSubject, intro + '\n\n' + link + '\n\n' + t.ignore, {
        name: senderName_(p),
        htmlBody: '<p>' + html_(intro) + '</p><p><a href="' + html_(link) + '">' + html_(link) + '</a></p><p>' + html_(t.ignore) + '</p>'
      });
    }
  };
}

function prepareMultiAccept_(req) {
  var p = props_();
  if (!p.SIGNING_SECRET) fail_('not_configured');
  var c = isObject_(req.config) ? req.config : fail_('bad_request');
  if (typeof c.sig !== 'string' || !safeEqual_(c.sig, sign_(c, p.SIGNING_SECRET))) fail_('bad_signature');
  if (typeof c.exp !== 'number' || c.exp * 1000 <= new Date().getTime()) fail_('expired');
  var owner = email_(c.owner).toLowerCase();
  var places = Array.isArray(c.places) ? c.places : [];
  var i = req.placeIndex;
  if (!Number.isInteger(i) || i < 0 || i >= places.length || !isObject_(places[i])) fail_('bad_place');
  checkTime_(req.time);
  if (!Array.isArray(c.slots) || c.slots.indexOf(req.time) < 0) fail_('bad_time');
  var tz = tz_(c.tz);
  checkDate_(req.date, tz, int_(c.days, 60, 1, 180));
  var guest = email_(req.guest);
  var place = places[i];
  var name = String(place.name);
  var location = String(place.address || place.name);
  var t = textFor_(c.lang);
  var title = title_(t, c.from);
  var start = parseStart_(req.date, req.time, tz);
  var end = new Date(start.getTime() + int_(c.duration, 120, 30, 360) * 60000);
  var details = guest + (place.note ? '\n' + place.note : '');
  var gcal = 'https://calendar.google.com/calendar/render?action=TEMPLATE' +
    '&text=' + encodeURIComponent(title) +
    '&dates=' + utcStamp_(start) + '/' + utcStamp_(end) +
    '&details=' + encodeURIComponent(details) +
    '&location=' + encodeURIComponent(location);
  var subject = t.yesSubject.replace('{place}', name).replace('{date}', req.date)
    .replace('{time}', req.time).replace(/[\r\n]+/g, ' ');
  var rows = [[t.guest, guest], [t.place, name + (place.address ? ', ' + place.address : '')],
    [t.when, req.date + ' ' + req.time + ' (' + tz + ')']];
  var body = rows.map(function (r) { return r[0] + ': ' + r[1]; }).join('\n') + '\n\n' + t.calendar + ': ' + gcal;
  var htmlBody = rows.map(function (r) { return '<p><b>' + html_(r[0]) + ':</b> ' + html_(r[1]) + '</p>'; }).join('') +
    '<p><a href="' + html_(gcal) + '">' + html_(t.calendar) + '</a></p>';
  var ics = ics_(req.id, title, start, end, location, details);
  return {
    limits: [
      { scope: 'accept:multi', max: limit_(p.MULTI_DAILY_LIMIT, 30) },
      { scope: 'accept:' + owner, max: limit_(p.OWNER_ACCEPT_LIMIT, 10) }
    ],
    run: function () {
      MailApp.sendEmail(owner, subject, body, {
        name: senderName_(p),
        htmlBody: htmlBody,
        replyTo: guest,
        attachments: [Utilities.newBlob(ics, 'text/calendar', 'invite.ics')]
      });
    }
  };
}

function validateConfig_(raw) {
  if (!isObject_(raw) || JSON.stringify(raw).length > MAX_CONFIG) fail_('bad_request');
  Object.keys(raw).forEach(function (k) {
    if (CONFIG_KEYS.indexOf(k) < 0 && DROPPED_KEYS.indexOf(k) < 0) fail_('bad_request');
  });
  if (raw.v !== 1) fail_('bad_request');
  if (raw.lang !== undefined && raw.lang !== 'it' && raw.lang !== 'en') fail_('bad_request');
  if (raw.api !== undefined && !isHttps_(raw.api)) fail_('bad_request');
  // Defaults are spelled out so the signed object matches what the compact link expands to.
  var c = { v: 1, owner: email_(raw.owner).toLowerCase(), lang: raw.lang || 'it' };
  [['to', 40], ['from', 40], ['q', 140], ['done', 200]].forEach(function (f) {
    var s = text_(raw[f[0]], f[1], 'bad_request');
    if (s) c[f[0]] = s;
  });
  if (!Array.isArray(raw.places) || raw.places.length < 1 || raw.places.length > 12) fail_('bad_place');
  c.places = raw.places.map(function (pl) {
    if (!isObject_(pl)) fail_('bad_place');
    var out = { name: text_(pl.name, 80, 'bad_place', 1) };
    [['emoji', 8], ['note', 140], ['address', 200], ['maps', 500]].forEach(function (f) {
      var s = text_(pl[f[0]], f[1], 'bad_place');
      if (s) out[f[0]] = s;
    });
    if (out.maps && !isHttps_(out.maps)) fail_('bad_place');
    return out;
  });
  if (!Array.isArray(raw.slots) || raw.slots.length < 1 || raw.slots.length > 12) fail_('bad_time');
  c.slots = raw.slots.map(function (s) {
    s = typeof s === 'string' ? s.trim() : s;
    checkTime_(s);
    return s;
  }).filter(function (s, i, a) { return a.indexOf(s) === i; }).sort();
  c.duration = int_(raw.duration, 120, 30, 360);
  c.days = int_(raw.days, 60, 1, 180);
  c.tz = raw.tz === undefined ? 'Europe/Rome' : canonTz_(raw.tz) || fail_('bad_request');
  if (raw.api !== undefined) c.api = raw.api.trim();
  return c;
}

function withDedupe_(id, job) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var cache = CacheService.getScriptCache();
    if (cache.get('req:' + id)) return { ok: true, duplicate: true };
    var store = PropertiesService.getScriptProperties();
    var day = dayKey_(0);
    var keys = job.limits.map(function (l) { return 'count:' + l.scope + ':' + day; });
    var counts = keys.map(function (k) { return parseInt(store.getProperty(k), 10) || 0; });
    job.limits.forEach(function (l, i) { if (counts[i] >= l.max) fail_('limit'); });
    job.run();
    cache.put('req:' + id, '1', 21600);
    keys.forEach(function (k, i) { store.setProperty(k, String(counts[i] + 1)); });
    pruneCounters_(store);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

function pruneCounters_(store) {
  var cutoff = dayKey_(-3);
  store.getKeys().forEach(function (k) {
    if (k.indexOf('count:') === 0 && k.slice(-10) < cutoff) store.deleteProperty(k);
  });
}

function dayKey_(offsetDays) {
  return Utilities.formatDate(new Date(new Date().getTime() + offsetDays * DAY_MS), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function checkDate_(date, tz, maxDays) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof date === 'string' ? date : '');
  if (!m) fail_('bad_date');
  var t = Date.UTC(+m[1], m[2] - 1, +m[3]);
  var d = new Date(t);
  if (d.getUTCMonth() !== m[2] - 1 || d.getUTCDate() !== +m[3]) fail_('bad_date');
  var today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd').split('-');
  var diff = (t - Date.UTC(+today[0], today[1] - 1, +today[2])) / DAY_MS;
  if (diff < 0 || diff > maxDays) fail_('bad_date');
}

function checkTime_(time) {
  if (typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) fail_('bad_time');
}

function email_(v) {
  var s = typeof v === 'string' ? v.trim() : '';
  if (s.length > 254 || !/^[^\s@<>()",;:\\]+@[^\s@<>()",;:\\]+\.[A-Za-z]{2,}$/.test(s)) fail_('bad_email');
  return s;
}

function text_(v, max, code, min) {
  if (v == null) v = '';
  if (typeof v !== 'string') fail_(code);
  v = v.trim();
  if (v.length < (min || 0) || v.length > max) fail_(code);
  return v;
}

function int_(v, def, min, max) {
  if (v == null) return def;
  if (!Number.isInteger(v) || v < min || v > max) fail_('bad_request');
  return v;
}

function limit_(v, def) {
  var n = parseInt(v, 10);
  return n >= 0 ? n : def;
}

function canonTz_(tz) {
  if (typeof tz === 'string' && tz.length <= 64) {
    try {
      return new Intl.DateTimeFormat('en-US', { timeZone: tz }).resolvedOptions().timeZone;
    } catch (e) {}
  }
  return '';
}

function tz_(tz) {
  return canonTz_(tz) || Session.getScriptTimeZone();
}

function parseStart_(date, time, tz) {
  var start = Utilities.parseDate(date + ' ' + time, tz, 'yyyy-MM-dd HH:mm');
  if (start.getTime() <= new Date().getTime()) fail_('bad_time');
  return start;
}

function title_(t, from) {
  return from ? t.titleWith.replace('{from}', function () { return from; }) : t.titleAlone;
}

function isHttps_(s) {
  return typeof s === 'string' && /^https:\/\/[^\s\/?#]\S*$/.test(s.trim());
}

function textFor_(lang) {
  return TEXT[lang] || TEXT.it;
}

function sign_(c, secret) {
  var copy = {};
  Object.keys(c).forEach(function (k) { if (k !== 'sig') copy[k] = c[k]; });
  var bytes = Utilities.computeHmacSha256Signature(canonical_(copy), secret, Utilities.Charset.UTF_8);
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '');
}

function canonical_(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical_).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map(function (k) {
      return JSON.stringify(k) + ':' + canonical_(v[k]);
    }).join(',') + '}';
  }
  return JSON.stringify(v);
}

function safeEqual_(a, b) {
  var diff = a.length ^ b.length;
  for (var i = 0; i < b.length; i++) diff |= (a.charCodeAt(i % (a.length || 1)) || 0) ^ b.charCodeAt(i);
  return diff === 0;
}

function pack_(c) {
  var blob = Utilities.gzip(Utilities.newBlob(JSON.stringify(wire_(c)), 'application/json'));
  return Utilities.base64EncodeWebSafe(rawDeflate_(blob.getBytes())).replace(/=+$/, '');
}

function wire_(c) {
  return trimZeros_(WIRE.map(function (f) {
    var v = c[f[0]];
    if (f[0] === 'places') return v.map(placeWire_);
    if (f[0] === 'slots') return v.join('').replace(/:/g, '');
    if (f[0] === 'lang') return v === 'en' ? 1 : 0;
    return v === undefined || v === f[1] ? 0 : v;
  }));
}

function placeWire_(pl) {
  var derived = 'https://www.google.com/maps/search/?api=1&query=' +
    encodeURIComponent([pl.name, pl.address].filter(Boolean).join(', '));
  return trimZeros_(PLACE_WIRE.map(function (k) {
    if (k === 'maps' && pl.maps && pl.maps === derived) return 1;
    return pl[k] === undefined ? 0 : pl[k];
  }));
}

function trimZeros_(arr) {
  while (arr.length && arr[arr.length - 1] === 0) arr.pop();
  return arr;
}

// Utilities has no raw deflate: strip the gzip header (RFC 1952) and the 8 byte trailer.
// Bytes are signed, hence the masks.
function rawDeflate_(bytes) {
  var flags = bytes[3] & 255;
  var pos = 10;
  if (flags & 4) pos += 2 + ((bytes[pos] & 255) | ((bytes[pos + 1] & 255) << 8));
  [8, 16].forEach(function (bit) {
    if (flags & bit) while (pos < bytes.length && bytes[pos++] !== 0) {}
  });
  if (flags & 2) pos += 2;
  return bytes.slice(pos, bytes.length - 8);
}

// Optional short link store (worker/): returns the id, or '' to fall back to the long link.
function storeLink_(p, payload) {
  if (!isHttps_(p.LINKS_URL) || !p.LINKS_SECRET) return '';
  try {
    var res = UrlFetchApp.fetch(p.LINKS_URL.trim(), {
      method: 'post',
      contentType: 'text/plain',
      payload: JSON.stringify({ p: payload }),
      headers: { Authorization: 'Bearer ' + p.LINKS_SECRET },
      muteHttpExceptions: true
    });
    var out = JSON.parse(res.getContentText());
    if (res.getResponseCode() === 200 && out && out.ok && /^[A-Za-z0-9]{1,32}$/.test(out.id)) return out.id;
    console.error('link store: ' + res.getResponseCode() + ' ' + (out && out.error));
  } catch (err) {
    console.error('link store: ' + ((err && err.message) || err));
  }
  return '';
}

function utcStamp_(d) {
  return d.toISOString().replace(/[-:]|\.\d{3}/g, '');
}

function ics_(id, title, start, end, location, description) {
  var esc = function (s) {
    return String(s).replace(/\r\n?|\n/g, '\n').replace(/[\\;,]/g, '\\$&').replace(/\n/g, '\\n');
  };
  var fold = function (line) {
    var out = [];
    var cur = '';
    var bytes = 0;
    for (var ch of line) {
      var cp = ch.codePointAt(0);
      var n = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
      if (bytes + n > 75) {
        out.push(cur);
        cur = ' ';
        bytes = 1;
      }
      cur += ch;
      bytes += n;
    }
    out.push(cur);
    return out;
  };
  var lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//vibedating//EN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
    'UID:' + id + '@vibedating', 'DTSTAMP:' + utcStamp_(new Date()), 'DTSTART:' + utcStamp_(start),
    'DTEND:' + utcStamp_(end), 'SUMMARY:' + esc(title), 'LOCATION:' + esc(location),
    'DESCRIPTION:' + esc(description), 'END:VEVENT', 'END:VCALENDAR'];
  return lines.reduce(function (acc, l) { return acc.concat(fold(l)); }, []).join('\r\n') + '\r\n';
}

function html_(s) {
  return String(s).replace(/[&<>"']/g, function (ch) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
  });
}

function isObject_(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function senderName_(p) {
  return p.SENDER_NAME || 'Vibe Dating';
}

function props_() {
  return PropertiesService.getScriptProperties().getProperties();
}

function parseBody_(e) {
  var raw = e && e.postData && e.postData.contents;
  if (typeof raw !== 'string' || raw.length > MAX_BODY) fail_('bad_request');
  var req;
  try {
    req = JSON.parse(raw);
  } catch (x) {
    fail_('bad_request');
  }
  if (!isObject_(req)) fail_('bad_request');
  return req;
}

function fail_(code) {
  var err = new Error(code);
  err.clientCode = code;
  throw err;
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
