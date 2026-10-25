async function fetchJson(url, init, { timeoutMs = 12000, fetchImpl = globalThis.fetch } = {}) {
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeoutMs);
  try {
    const res = await fetchImpl(url, { ...init, signal: ctrl.signal });
    let json;
    try {
      json = JSON.parse(await res.text());
    } catch {
      return { ok: false, error: timedOut ? 'timeout' : 'server' };
    }
    if (json && json.ok === true) return json;
    return { ok: false, error: (json && json.error) || 'server' };
  } catch {
    return { ok: false, error: timedOut ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}

export const postJson = (url, body, opts) => fetchJson(url, {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain;charset=utf-8' },
  body: JSON.stringify(body),
  redirect: 'follow',
}, opts);

const LINK_ID = /^[A-Za-z0-9]{1,32}$/;
const linkStoreUrl = (base, id = '') => `${String(base).replace(/\/+$/, '')}${id && `/${id}`}`;

// The link store is optional: any failure leaves the caller with its long link.
export async function storeLink(base, payload, { timeoutMs = 6000, ...opts } = {}) {
  if (!base) return '';
  const res = await postJson(linkStoreUrl(base), { p: payload }, { timeoutMs, ...opts });
  return res.ok && LINK_ID.test(res.id) ? res.id : '';
}

export async function loadLink(base, id, { timeoutMs = 8000, ...opts } = {}) {
  if (!base || !LINK_ID.test(id)) return { ok: false, error: 'not_found' };
  const res = await fetchJson(linkStoreUrl(base, id), { method: 'GET' }, { timeoutMs, ...opts });
  if (res.ok && typeof res.p !== 'string') return { ok: false, error: 'not_found' };
  return res;
}

export function newRequestId() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

const RETRYABLE = new Set(['network', 'timeout']);

export function createAttempt() {
  let cur = null;
  return {
    begin(key) {
      if (cur?.busy) return null;
      if (!cur || cur.key !== key) cur = { key, id: newRequestId() };
      cur.busy = true;
      return cur.id;
    },
    end(result) {
      cur.busy = false;
      if (result.ok || !RETRYABLE.has(result.error)) cur = null;
    },
  };
}

export function buildAcceptPayload({ raw, cfg, mode, id, guest, placeIndex, date, time }) {
  if (mode === 'multi') {
    return { action: 'accept', id, config: raw, guest, placeIndex, date, time };
  }
  const { name, address } = cfg.places[placeIndex];
  return {
    action: 'accept', id, k: cfg.k, guest, place: { name, address }, date, time,
    duration: cfg.duration, tz: cfg.tz, lang: cfg.lang, to: cfg.to, from: cfg.from, note: cfg.done,
  };
}
