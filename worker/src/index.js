// Short link store for vibedating: POST /links stores a compact `#y=` payload under a random id,
// GET /links/<id> returns it. Bindings: KV `LINKS`, optional rate limiter `LIMITER`;
// vars `ALLOWED_ORIGINS`, `LINK_TTL_DAYS`; secret `WRITE_SECRET`.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const ID_LENGTH = 10;
const ID = /^[A-Za-z0-9]{10}$/;
const PAYLOAD = /^[A-Za-z0-9_-]{1,8000}$/;
const MAX_BODY = 9000;
const DAY_S = 86400;

export function newId() {
  let id = '';
  // 248 is the largest multiple of 62 under 256: rejecting bytes above it keeps ids uniform.
  while (id.length < ID_LENGTH) {
    for (const b of crypto.getRandomValues(new Uint8Array(16))) {
      if (b < 248 && id.length < ID_LENGTH) id += ALPHABET[b % 62];
    }
  }
  return id;
}

function cors(request, env) {
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const origin = request.headers.get('Origin') || '';
  const headers = { 'Access-Control-Allow-Origin': '*' };
  if (allowed.length) {
    headers['Access-Control-Allow-Origin'] = allowed.includes(origin) ? origin : allowed[0];
    headers.Vary = 'Origin';
  }
  return headers;
}

const json = (body, status, headers) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

function safeEqual(a, b) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= (a.charCodeAt(i % (a.length || 1)) || 0) ^ b.charCodeAt(i);
  return diff === 0;
}

const isTrusted = (request, env) =>
  Boolean(env.WRITE_SECRET) && safeEqual(request.headers.get('Authorization') || '', `Bearer ${env.WRITE_SECRET}`);

async function create(request, env, headers) {
  if (!isTrusted(request, env) && env.LIMITER) {
    const { success } = await env.LIMITER.limit({ key: request.headers.get('CF-Connecting-IP') || 'unknown' });
    if (!success) return json({ ok: false, error: 'limit' }, 429, headers);
  }
  const text = await request.text();
  let payload;
  try {
    payload = text.length <= MAX_BODY ? JSON.parse(text).p : null;
  } catch {
    payload = null;
  }
  if (typeof payload !== 'string' || !PAYLOAD.test(payload)) return json({ ok: false, error: 'bad_request' }, 400, headers);
  const days = Number.parseInt(env.LINK_TTL_DAYS, 10) > 0 ? Number.parseInt(env.LINK_TTL_DAYS, 10) : 365;
  for (let i = 0; i < 5; i++) {
    const id = newId();
    if ((await env.LINKS.get(id)) !== null) continue;
    await env.LINKS.put(id, payload, { expirationTtl: days * DAY_S });
    return json({ ok: true, id }, 200, headers);
  }
  return json({ ok: false, error: 'server' }, 500, headers);
}

async function read(id, env, headers) {
  const payload = ID.test(id) ? await env.LINKS.get(id) : null;
  if (payload === null) return json({ ok: false, error: 'not_found' }, 404, headers);
  return json({ ok: true, p: payload }, 200, { ...headers, 'Cache-Control': 'public, max-age=3600' });
}

export async function handle(request, env) {
  const headers = cors(request, env);
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        ...headers,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': String(DAY_S),
      },
    });
  }
  const match = /^\/links(?:\/([^/]*))?\/?$/.exec(new URL(request.url).pathname);
  try {
    if (match && request.method === 'POST' && match[1] === undefined) return await create(request, env, headers);
    if (match && request.method === 'GET' && match[1]) return await read(match[1], env, headers);
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: 'server' }, 500, headers);
  }
  return json({ ok: false, error: 'not_found' }, 404, headers);
}

export default { fetch: handle };
