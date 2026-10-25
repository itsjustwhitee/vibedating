// Local test server: serves the site, runs apps-script/Code.gs at /api with fake Calendar and
// Mail, and the link store (worker/) at /links in memory. Nothing is sent; what would be sent is
// listed at /outbox.
import https from 'node:https';
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGas } from './gas-emulator.js';
import { createMemoryKv } from './memory-kv.js';
import { handle as linkStore } from '../worker/src/index.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json',
};
const PUBLIC = /^\/(index\.html|create\.html|css\/|js\/|assets\/)/;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const linkify = (s) => esc(s).replace(/https?:\/\/\S+/g, (u) => `<a href="${u}">${u}</a>`);
const fillMeta = (html, name, value) => html.replace(`<meta name="${name}" content="">`, `<meta name="${name}" content="${esc(value)}">`);

function outbox(gas) {
  const events = gas.events.map((e) => `<li><b>Calendar</b> ${esc(e.title)}<br>${esc(e.start.toISOString())} → ${esc(e.end.toISOString())}<br>guests: ${esc(e.opts.guests)} · ${esc(e.opts.location)}<br>${esc(e.opts.description || '')}</li>`);
  const mails = gas.mails.map((m) => `<li><b>Mail</b> to ${esc(m.to)}: ${esc(m.subject)}<pre>${linkify(m.body)}</pre>${(m.options.attachments || []).map((a) => `<details><summary>${esc(a.getName())}</summary><pre>${esc(a.getDataAsString())}</pre></details>`).join('')}</li>`);
  const items = [...events, ...mails].reverse().join('') || '<li>Empty.</li>';
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Outbox</title><style>body{font:15px system-ui;max-width:760px;margin:24px auto;padding:0 16px}li{margin:0 0 16px}pre{white-space:pre-wrap;word-break:break-all;background:#f4f4f4;padding:8px}</style><h1>Outbox (nothing is really sent)</h1><ul>${items}</ul>`;
}

const readBody = (req) => new Promise((resolve) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => resolve(body));
});

async function serveLinks(req, res, url, env) {
  const body = req.method === 'POST' ? await readBody(req) : undefined;
  const out = await linkStore(new Request(url, { method: req.method, headers: req.headers, body }), env);
  res.writeHead(out.status, Object.fromEntries(out.headers));
  res.end(await out.text());
}

/** Starts the server; port 0 picks a free one. Resolves to { origin, gas, links, close }. */
export async function startDevServer({ port = 0, origin, cert, key, env = {} } = {}) {
  const server = cert && key ? https.createServer({ cert, key }) : http.createServer();
  await new Promise((r) => server.listen(port, r));
  const base = origin || `${cert && key ? 'https' : 'http'}://localhost:${server.address().port}`;
  const gas = createGas({
    now: new Date().toISOString(),
    props: {
      SHARED_KEY: env.SHARED_KEY || 'dev-key',
      ALLOWED_GUESTS: env.ALLOWED_GUESTS || 'guest@example.com',
      SIGNING_SECRET: env.SIGNING_SECRET || 'dev-secret',
      SITE_URL: `${base}/`,
    },
  });
  const links = { LINKS: createMemoryKv(), WRITE_SECRET: env.LINKS_SECRET || 'dev-links-secret' };
  const metas = { 'vibedating-api': env.SITE_API || `${base}/api`, 'vibedating-links': env.SITE_LINKS || `${base}/links` };

  server.on('request', async (req, res) => {
    const url = new URL(req.url, base);
    if (url.pathname === '/api' && req.method === 'POST') {
      const body = await readBody(req);
      gas.setNow(Date.now());
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(gas.raw(body).body));
    }
    if (url.pathname === '/api') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(gas.get()));
    }
    if (url.pathname === '/links' || url.pathname.startsWith('/links/')) return serveLinks(req, res, url, links);
    if (url.pathname === '/outbox') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(outbox(gas));
    }
    const path = url.pathname === '/' ? '/index.html' : normalize(decodeURIComponent(url.pathname));
    const file = join(ROOT, path);
    if (!PUBLIC.test(path) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404);
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    const body = readFileSync(file);
    if (path !== '/create.html' && path !== '/index.html') return res.end(body);
    return res.end(Object.entries(metas).reduce((html, [name, value]) => fillMeta(html, name, value), body.toString()));
  });

  return { origin: base, gas, links, close: () => new Promise((r) => server.close(r)) };
}
