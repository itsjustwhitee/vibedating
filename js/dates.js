const pad = (n, w = 2) => String(n).padStart(w, '0');

export function todayISO(now = new Date(), tz) {
  if (tz) {
    const p = {};
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric' });
    for (const { type, value } of fmt.formatToParts(now)) p[type] = +value;
    return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
  }
  return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function addDaysISO(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

const fmtCache = new Map();
function offsetMs(utcMs, tz) {
  let fmt = fmtCache.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric',
    });
    fmtCache.set(tz, fmt);
  }
  const p = {};
  for (const { type, value } of fmt.formatToParts(new Date(utcMs))) p[type] = +value;
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(utcMs / 1000) * 1000;
}

// Overlap (clocks go back): the earlier instant is returned.
// Gap (clocks go forward): the time is shifted forward by the gap (02:30 -> 03:30).
export function zonedToUtc(dateISO, hhmm, tz) {
  const [y, m, d] = dateISO.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  const day = 86400000;
  const before = offsetMs(wall - day, tz);
  const after = offsetMs(wall + day, tz);
  const candidates = [wall - before, wall - after].filter((t) => offsetMs(t, tz) === wall - t);
  return new Date(candidates.length ? Math.min(...candidates) : wall - before);
}

export function formatDateLong(iso, lang) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat(lang === 'en' ? 'en-US' : 'it-IT', {
    timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long',
  }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}
