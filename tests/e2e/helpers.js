import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeConfig } from '../../js/config.js';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const API = 'https://script.google.com/macros/s/TEST/exec';
export const SCREENS_DIR = join(ROOT, 'test-results', 'screens');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json',
};

export async function startServer() {
  const server = http.createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
    try {
      const body = await readFile(join(ROOT, path || 'index.html'));
      res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  return { base, close: () => new Promise((r) => server.close(r)) };
}

export const sampleConfig = (extra = {}) => ({
  v: 1,
  lang: 'it',
  to: 'Saro',
  from: 'Ciuchi',
  places: [
    { emoji: '🍣', name: 'Sushi Sapporo', note: 'Nigiri al bancone, uno dopo l’altro', address: 'Via Roma 1', maps: 'https://maps.example.com/a' },
    { emoji: '🍜', name: 'Hideo Ramen', note: 'Brodo che scalda, risucchio ammesso' },
    { emoji: '🍕', name: 'Pizzeria Montebello', note: 'Forno a legna e cornicione che scrocchia' },
  ],
  slots: ['19:30', '20:00', '20:30', '21:00'],
  duration: 120,
  days: 60,
  tz: 'Europe/Rome',
  ...extra,
});

export const inviteUrl = (base, cfg) => `${base}index.html#c=${encodeConfig(cfg)}`;

export async function newPage(browser, { fonts = false, ...opts } = {}) {
  const context = await browser.newContext({ timezoneId: 'Europe/Rome', locale: 'it-IT', ...opts });
  const blocked = fonts ? /cdn\.jsdelivr\.net|photon\.komoot\.io/ : /cdn\.jsdelivr\.net|photon\.komoot\.io|fonts\.(googleapis|gstatic)\.com/;
  await context.route(blocked, (route) => route.abort());
  const page = await context.newPage();
  return { context, page };
}

export async function mockApi(page, reply = { ok: true }) {
  const bodies = [];
  await page.route(API, async (route) => {
    bodies.push(JSON.parse(route.request().postData()));
    const current = Array.isArray(reply) ? reply[Math.min(bodies.length, reply.length) - 1] : reply;
    if (current === 'abort') return route.abort();
    await new Promise((r) => setTimeout(r, 150));
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(current) });
  });
  return bodies;
}

export const screenOf = (page) => page.locator('[data-screen]').getAttribute('data-screen');

export async function goToDatetime(page) {
  await page.click('#yes');
  await page.click('.place-pick >> nth=0');
  await page.click('.btn-next');
}

export async function shot(page, name) {
  await mkdir(SCREENS_DIR, { recursive: true });
  await page.screenshot({ path: join(SCREENS_DIR, `${name}.png`), fullPage: true });
}

export const PHOTON = /photon\.komoot\.io\/api/;

export const photonFeature = (name, street, housenumber, city) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [12.5, 41.9] },
  properties: { name, street, housenumber, city, country: 'Italia', osm_key: 'amenity', osm_value: 'restaurant' },
});

export async function mockPhoton(page, features) {
  const queries = [];
  await page.route(PHOTON, (route) => {
    queries.push(new URL(route.request().url()));
    return route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ type: 'FeatureCollection', features }) });
  });
  return queries;
}

export async function openBuilder(browser, base, { siteApi = '', advanced = false, ...opts } = {}) {
  const { context, page } = await newPage(browser, { viewport: { width: 1280, height: 900 }, ...opts });
  if (siteApi) {
    await page.route(/create\.html(\?.*)?$/, async (route) => {
      const res = await route.fetch();
      const body = (await res.text()).replace('<meta name="vibedating-api" content="">', `<meta name="vibedating-api" content="${siteApi}">`);
      await route.fulfill({ response: res, body });
    });
  }
  await page.goto(`${base}create.html${advanced ? '?advanced' : ''}`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  return { context, page };
}
