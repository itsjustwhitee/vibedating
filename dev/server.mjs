// Local test server: serves the site and runs apps-script/Code.gs at /api with
// fake Calendar and Mail. Nothing is sent; what would be sent is listed at /outbox.
import https from 'node:https';
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGas } from './gas-emulator.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT || 8443);
const ORIGIN = process.env.ORIGIN || `https://localhost:${PORT}`;
const { CERT, KEY } = process.env;

const gas = createGas({
  now: new Date().toISOString(),
  props: {
    SHARED_KEY: process.env.SHARED_KEY || 'dev-key',
    ALLOWED_GUESTS: process.env.ALLOWED_GUESTS || 'guest@example.com',
    SIGNING_SECRET: process.env.SIGNING_SECRET || 'dev-secret',
    SITE_URL: `${ORIGIN}/`,
    API_URL: `${ORIGIN}/api`,
  },
});

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json',
};
const PUBLIC = /^\/(index\.html|create\.html|css\/|js\/|assets\/)/;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const linkify = (s) => esc(s).replace(/https:\/\/\S+/g, (u) => `<a href="${u}">${u}</a>`);

function outbox() {
  const events = gas.events.map((e) => `<li><b>Calendar</b> ${esc(e.title)}<br>${esc(e.start.toISOString())} → ${esc(e.end.toISOString())}<br>guests: ${esc(e.opts.guests)} · ${esc(e.opts.location)}<br>${esc(e.opts.description || '')}</li>`);
  const mails = gas.mails.map((m) => `<li><b>Mail</b> to ${esc(m.to)}: ${esc(m.subject)}<pre>${linkify(m.body)}</pre>${(m.options.attachments || []).map((a) => `<details><summary>${esc(a.getName())}</summary><pre>${esc(a.getDataAsString())}</pre></details>`).join('')}</li>`);
  const items = [...events, ...mails].reverse().join('') || '<li>Empty.</li>';
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Outbox</title><style>body{font:15px system-ui;max-width:760px;margin:24px auto;padding:0 16px}li{margin:0 0 16px}pre{white-space:pre-wrap;word-break:break-all;background:#f4f4f4;padding:8px}</style><h1>Outbox (nothing is really sent)</h1><ul>${items}</ul>`;
}

function handler(req, res) {
  const url = new URL(req.url, ORIGIN);
  if (url.pathname === '/api' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      gas.setNow(Date.now());
      const out = gas.raw(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out.body));
    });
    return;
  }
  if (url.pathname === '/api') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(gas.get()));
  }
  if (url.pathname === '/outbox') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(outbox());
  }
  const path = url.pathname === '/' ? '/index.html' : normalize(decodeURIComponent(url.pathname));
  const file = join(ROOT, path);
  if (!PUBLIC.test(path) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404);
    return res.end('Not found');
  }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  const body = readFileSync(file);
  res.end(path === '/create.html' ? body.toString().replace('<meta name="vibedating-api" content="">', `<meta name="vibedating-api" content="${esc(process.env.SITE_API || `${ORIGIN}/api`)}">`) : body);
}

const server = CERT && KEY
  ? https.createServer({ cert: readFileSync(CERT), key: readFileSync(KEY) }, handler)
  : http.createServer(handler);
server.listen(PORT, () => console.log(`vibedating dev server on ${ORIGIN} (outbox: ${ORIGIN}/outbox)`));
