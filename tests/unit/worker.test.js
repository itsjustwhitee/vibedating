import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { newId } from '../../worker/src/index.js';
import { createMemoryKv } from '../../dev/memory-kv.js';

const BASE = 'https://links.example.com';
const PAYLOAD = 'LY49qgJBDMevElJPMfoqWwV5zZOHWy5bxNngBmYny4zbWHkBSwtB';

function env(extra = {}) {
  const calls = [];
  const limiter = { allow: true, limit: async ({ key }) => { calls.push(key); return { success: limiter.allow }; } };
  return { LINKS: createMemoryKv(), LIMITER: limiter, WRITE_SECRET: 'write-secret', limiterCalls: calls, ...extra };
}

const post = (e, body, headers = {}) => worker.fetch(new Request(`${BASE}/links`, {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain;charset=utf-8', 'CF-Connecting-IP': '203.0.113.7', ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
}), e);
const get = (e, path, headers = {}) => worker.fetch(new Request(`${BASE}${path}`, { headers }), e);
const read = async (res) => ({ status: res.status, body: await res.json() });

test('create then get returns the payload', async () => {
  const e = env();
  const created = await read(await post(e, { p: PAYLOAD }));
  assert.equal(created.status, 200);
  assert.equal(created.body.ok, true);
  assert.match(created.body.id, /^[A-Za-z0-9]{10}$/);
  const res = await get(e, `/links/${created.body.id}`);
  assert.deepEqual(await read(res), { status: 200, body: { ok: true, p: PAYLOAD } });
  assert.match(res.headers.get('Cache-Control'), /max-age/);
});

test('unknown, malformed or expired ids answer 404 not_found', async () => {
  let now = Date.parse('2026-10-25T10:00:00Z');
  const e = env({ LINKS: createMemoryKv({ now: () => now }), LINK_TTL_DAYS: '1' });
  const { id } = await (await post(e, { p: PAYLOAD })).json();
  for (const path of ['/links/AAAAAAAAAA', '/links/short', '/links/..%2Fx', '/nope', '/links/']) {
    assert.deepEqual(await read(await get(e, path)), { status: 404, body: { ok: false, error: 'not_found' } }, path);
  }
  now += 86400 * 1000;
  assert.equal((await get(e, `/links/${id}`)).status, 404);
});

test('invalid payloads are refused', async () => {
  const e = env();
  for (const body of ['not json', '[]', {}, { p: '' }, { p: 'has space' }, { p: 'a+b/c=' }, { p: 5 }, { p: 'a'.repeat(8001) }, `{"p":"${'a'.repeat(9000)}"}`]) {
    assert.deepEqual(await read(await post(e, body)), { status: 400, body: { ok: false, error: 'bad_request' } }, String(body).slice(0, 40));
  }
  assert.equal(e.LINKS.puts.length, 0);
  assert.equal((await post(e, { p: 'a'.repeat(8000) })).status, 200);
});

test('TTL is passed to KV, default one year', async () => {
  const e = env();
  await post(e, { p: PAYLOAD });
  assert.equal(e.LINKS.puts[0].options.expirationTtl, 365 * 86400);
  const short = env({ LINK_TTL_DAYS: '30' });
  await post(short, { p: PAYLOAD });
  assert.equal(short.LINKS.puts[0].options.expirationTtl, 30 * 86400);
});

test('anonymous writes are rate limited per IP, the bearer secret bypasses it', async () => {
  const e = env();
  e.LIMITER.allow = false;
  assert.deepEqual(await read(await post(e, { p: PAYLOAD })), { status: 429, body: { ok: false, error: 'limit' } });
  assert.deepEqual(e.limiterCalls, ['203.0.113.7']);
  assert.equal((await post(e, { p: PAYLOAD }, { Authorization: 'Bearer wrong' })).status, 429);
  const ok = await post(e, { p: PAYLOAD }, { Authorization: 'Bearer write-secret' });
  assert.equal(ok.status, 200);
  assert.equal(e.limiterCalls.length, 2);
  assert.equal(e.LINKS.puts.length, 1);
  const noSecret = env({ WRITE_SECRET: '' });
  noSecret.LIMITER.allow = false;
  assert.equal((await post(noSecret, { p: PAYLOAD }, { Authorization: 'Bearer ' })).status, 429);
  assert.equal((await post(env({ LIMITER: undefined }), { p: PAYLOAD })).status, 200);
});

test('CORS: * by default, the listed origin otherwise, OPTIONS answered', async () => {
  const open = await post(env(), { p: PAYLOAD }, { Origin: 'https://site.example.com' });
  assert.equal(open.headers.get('Access-Control-Allow-Origin'), '*');
  const e = env({ ALLOWED_ORIGINS: 'https://site.example.com, https://other.example.com' });
  const listed = await get(e, '/links/AAAAAAAAAA', { Origin: 'https://other.example.com' });
  assert.equal(listed.headers.get('Access-Control-Allow-Origin'), 'https://other.example.com');
  assert.equal(listed.headers.get('Vary'), 'Origin');
  const foreign = await get(e, '/links/AAAAAAAAAA', { Origin: 'https://evil.example.org' });
  assert.notEqual(foreign.headers.get('Access-Control-Allow-Origin'), 'https://evil.example.org');
  const pre = await worker.fetch(new Request(`${BASE}/links`, { method: 'OPTIONS', headers: { Origin: 'https://site.example.com' } }), e);
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('Access-Control-Allow-Origin'), 'https://site.example.com');
  assert.match(pre.headers.get('Access-Control-Allow-Methods'), /POST/);
});

test('ids are uniform base62 and collisions are retried', async () => {
  const ids = new Set(Array.from({ length: 2000 }, newId));
  assert.equal(ids.size, 2000);
  for (const id of ids) assert.match(id, /^[A-Za-z0-9]{10}$/);
  const e = env();
  const realGet = e.LINKS.get;
  let gets = 0;
  e.LINKS.get = async (key) => (++gets < 3 ? 'taken' : realGet(key));
  assert.equal((await post(e, { p: PAYLOAD })).status, 200);
  assert.equal(gets, 3);
  e.LINKS.get = async () => 'taken';
  assert.deepEqual(await read(await post(e, { p: PAYLOAD })), { status: 500, body: { ok: false, error: 'server' } });
});

test('a KV failure answers server, not a crash', async () => {
  const e = env();
  e.LINKS.put = async () => { throw new Error('KV down'); };
  const errors = [];
  const saved = console.error;
  console.error = (...a) => errors.push(a);
  try {
    assert.deepEqual(await read(await post(e, { p: PAYLOAD })), { status: 500, body: { ok: false, error: 'server' } });
  } finally {
    console.error = saved;
  }
  assert.equal(errors.length, 1);
});
