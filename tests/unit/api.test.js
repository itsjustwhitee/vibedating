import test from 'node:test';
import assert from 'node:assert/strict';
import { postJson, newRequestId, buildAcceptPayload, createAttempt } from '../../js/api.js';

const reply = (text) => async () => ({ text: async () => text });

test('postJson sends text/plain JSON and returns ok payload', async () => {
  let seen;
  const fetchImpl = async (url, opts) => { seen = { url, opts }; return { text: async () => '{"ok":true,"eventId":"e1"}' }; };
  const res = await postJson('https://api.example.com/exec', { a: 1 }, { fetchImpl });
  assert.deepEqual(res, { ok: true, eventId: 'e1' });
  assert.equal(seen.url, 'https://api.example.com/exec');
  assert.equal(seen.opts.method, 'POST');
  assert.equal(seen.opts.headers['Content-Type'], 'text/plain;charset=utf-8');
  assert.equal(seen.opts.body, '{"a":1}');
  assert.equal(seen.opts.redirect, 'follow');
});

test('postJson maps error JSON', async () => {
  assert.deepEqual(await postJson('u', {}, { fetchImpl: reply('{"ok":false,"error":"limit"}') }), { ok: false, error: 'limit' });
  assert.deepEqual(await postJson('u', {}, { fetchImpl: reply('{"ok":false}') }), { ok: false, error: 'server' });
  assert.deepEqual(await postJson('u', {}, { fetchImpl: reply('{"error":"x"}') }), { ok: false, error: 'x' });
  assert.deepEqual(await postJson('u', {}, { fetchImpl: reply('null') }), { ok: false, error: 'server' });
});

test('postJson treats an HTML body as server error', async () => {
  assert.deepEqual(await postJson('u', {}, { fetchImpl: reply('<html>Error</html>') }), { ok: false, error: 'server' });
});

test('postJson network failure never throws', async () => {
  const fetchImpl = async () => { throw new TypeError('failed'); };
  assert.deepEqual(await postJson('u', {}, { fetchImpl }), { ok: false, error: 'network' });
});

test('postJson times out via abort', async () => {
  const fetchImpl = (url, { signal }) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });
  assert.deepEqual(await postJson('u', {}, { fetchImpl, timeoutMs: 20 }), { ok: false, error: 'timeout' });
});

test('newRequestId', () => {
  const a = newRequestId();
  assert.match(a, /^[0-9a-f-]{32,36}$/);
  assert.notEqual(a, newRequestId());
});

const cfg = {
  k: 'key', duration: 120, tz: 'Europe/Rome', lang: 'it', to: 'Giulia', from: 'Luca', done: 'Ciao',
  places: [{ name: 'A' }, { name: 'B', address: 'Via 1', emoji: 'x' }],
};

test('buildAcceptPayload personal', () => {
  const p = buildAcceptPayload({ raw: {}, cfg, mode: 'personal', id: 'i', guest: 'g@example.com', placeIndex: 1, date: '2026-11-07', time: '20:00' });
  assert.deepEqual(p, {
    action: 'accept', id: 'i', k: 'key', guest: 'g@example.com', place: { name: 'B', address: 'Via 1' },
    date: '2026-11-07', time: '20:00', duration: 120, tz: 'Europe/Rome', lang: 'it', to: 'Giulia', from: 'Luca', note: 'Ciao',
  });
});

test('buildAcceptPayload multi sends the untouched raw config', () => {
  const raw = { v: 1, sig: 's', extra: true };
  const p = buildAcceptPayload({ raw, cfg, mode: 'multi', id: 'i', guest: 'g@example.com', placeIndex: 0, date: '2026-11-07', time: '20:00' });
  assert.deepEqual(p, { action: 'accept', id: 'i', config: raw, guest: 'g@example.com', placeIndex: 0, date: '2026-11-07', time: '20:00' });
  assert.equal(p.config, raw);
});

test('createAttempt keeps the id while busy or after network/timeout, renews otherwise', () => {
  const a = createAttempt();
  const id = a.begin('k');
  assert.equal(a.begin('k'), null);
  a.end({ ok: false, error: 'network' });
  assert.equal(a.begin('k'), id);
  a.end({ ok: false, error: 'timeout' });
  assert.equal(a.begin('k'), id);
  a.end({ ok: true });
  const next = a.begin('k');
  assert.notEqual(next, id);
  a.end({ ok: false, error: 'bad_time' });
  assert.notEqual(a.begin('k'), next);
  a.end({ ok: false, error: 'network' });
  assert.notEqual(a.begin('other'), null);
});
