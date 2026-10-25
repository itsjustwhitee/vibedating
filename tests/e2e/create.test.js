import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readConfigFromHash } from '../../js/config.js';
import { startServer, mockApi, screenOf, openBuilder, API } from './helpers.js';

let server;
let browser;

before(async () => {
  server = await startServer();
  browser = await chromium.launch();
});
after(async () => {
  await browser.close();
  await server.close();
});

const open = (opts) => openBuilder(browser, server.base, opts);
const linkCfg = async (page) => readConfigFromHash(new URL(await page.inputValue('#link')).hash).cfg;

async function fillBasics(page) {
  await page.fill('#to', 'Chiàra');
  await page.fill('#from', 'Niccolò');
  await page.click('#texts summary');
  await page.fill('#q', 'ti va una cena? 🍝');
  await page.fill('.place-row [data-key="name"]', 'Caffè Né');
  await page.fill('.place-row [data-key="note"]', 'Più è, più già 🍷');
}

test('client mode builds a link that opens a working invite with accents and emoji', async () => {
  const { context, page } = await open();
  await page.click('#build');
  assert.match(await page.textContent('.place-row'), /Dagli un nome/);
  assert.match(await page.textContent('#form-err'), /Manca qualcosa/);
  assert.equal(await page.isHidden('#result'), true);
  await fillBasics(page);
  assert.match(await page.textContent('#preview'), /Chiàra, ti va una cena\? 🍝/);
  await page.click('#build');
  assert.match(await page.inputValue('#link'), /index\.html#c=/);
  const cfg = await linkCfg(page);
  assert.equal(cfg.api, undefined);
  assert.equal(cfg.k, undefined);

  const invite = await context.newPage();
  await invite.goto(await page.inputValue('#link'));
  await invite.waitForSelector('[data-screen="question"]');
  assert.equal(await invite.textContent('h1'), 'Chiàra, ti va una cena? 🍝');
  await invite.click('#yes');
  assert.equal(await screenOf(invite), 'places');
  assert.match(await invite.textContent('.places'), /Caffè Né.*Più è, più già 🍷/);
  await context.close();
});

test('without a site API: only link mode plus advanced api and key, key never remembered', async () => {
  const { context, page } = await open();
  assert.equal(await page.isHidden('#choices'), true);
  assert.equal(await page.isVisible('#link-only'), true);
  await fillBasics(page);
  await page.click('#advanced summary');
  assert.equal(await page.isVisible('#api'), true);
  await page.fill('#api', API);
  await page.fill('#k', 'short');
  await page.click('#build');
  assert.match(await page.textContent('#k-err'), /8 caratteri/);
  await page.fill('#k', 'a-long-shared-key');
  await page.click('#build');
  const cfg = await linkCfg(page);
  assert.equal(cfg.api, API);
  assert.equal(cfg.k, 'a-long-shared-key');
  const stored = await page.evaluate(() => localStorage.getItem('vibedating:create'));
  assert.doesNotMatch(stored, /a-long-shared-key/);
  await page.reload();
  assert.equal(await page.inputValue('#to'), 'Chiàra');
  assert.equal(await page.inputValue('#api'), API);
  assert.equal(await page.inputValue('#k'), '');
  await context.close();
});

test('with a site API: two choices, no API field, email asks only for the owner', async () => {
  const { context, page } = await open({ siteApi: API });
  assert.equal(await page.isVisible('#choices'), true);
  assert.equal(await page.locator('#choices input[name="delivery"]').count(), 2);
  assert.equal(await page.isHidden('#api-field'), true);
  assert.equal(await page.isHidden('#link-only'), true);
  assert.equal(await page.isVisible('#owner'), true);
  await page.check('input[name="delivery"][value="link"]');
  assert.equal(await page.isHidden('#owner-field'), true);
  await context.close();
});

test('with a site API: an advanced key switches to a personal link with api and k', async () => {
  const { context, page } = await open({ siteApi: API });
  await fillBasics(page);
  await page.click('#advanced summary');
  await page.fill('#k', 'a-long-shared-key');
  assert.equal(await page.isDisabled('input[name="delivery"][value="email"]'), true);
  assert.equal(await page.isVisible('#personal-note'), true);
  assert.equal(await page.isHidden('#owner-field'), true);
  await page.click('#build');
  const cfg = await linkCfg(page);
  assert.equal(cfg.api, API);
  assert.equal(cfg.k, 'a-long-shared-key');
  await context.close();
});

test('email mode posts create and shows the inbox message, never a link', async () => {
  const { context, page } = await open({ siteApi: API });
  const bodies = await mockApi(page);
  await fillBasics(page);
  await page.click('[data-slot="22:00"]');
  await page.check('input[name="delivery"][value="email"]');
  await page.fill('#owner', 'owner@example.com');
  await page.evaluate(() => {
    const b = document.querySelector('#build');
    b.click();
    b.click();
  });
  await page.waitForSelector('#sent:not([hidden])');
  assert.match(await page.textContent('#sent'), /Controlla la posta/);
  assert.equal(bodies.length, 1);
  const b = bodies[0];
  assert.equal(b.action, 'create');
  assert.ok(/^[A-Za-z0-9_-]{1,64}$/.test(b.id));
  assert.equal(b.config.owner, 'owner@example.com');
  assert.equal(b.config.api, API);
  assert.equal(b.config.sig, undefined);
  assert.equal(b.config.exp, undefined);
  assert.ok(b.config.slots.includes('22:00'));
  assert.equal(await page.isHidden('#result'), true);
  assert.equal(await page.inputValue('#link'), '');
  assert.doesNotMatch(await page.content(), /#c=/);

  await page.click('#build');
  await page.waitForTimeout(400);
  assert.equal(bodies.length, 2);
  assert.notEqual(bodies[1].id, b.id);
  await context.close();
});

async function openMulti(reply) {
  const { context, page } = await open({ siteApi: API });
  const bodies = await mockApi(page, reply);
  await fillBasics(page);
  await page.check('input[name="delivery"][value="email"]');
  await page.fill('#owner', 'owner@example.com');
  return { context, page, bodies };
}

test('email mode: a new click after a success sends a new request id', async () => {
  const { context, page, bodies } = await openMulti();
  await page.click('#build');
  await page.waitForSelector('#sent:not([hidden]):not(.is-error)');
  await page.click('#build');
  await page.waitForFunction(() => !document.querySelector('#build').disabled);
  await page.waitForTimeout(100);
  assert.equal(bodies.length, 2);
  assert.notEqual(bodies[0].id, bodies[1].id);
  await context.close();
});

test('email mode: a retry after a network failure reuses the request id', async () => {
  const { context, page, bodies } = await openMulti(['abort', { ok: true }]);
  await page.click('#build');
  await page.waitForSelector('#sent.is-error');
  await page.click('#build');
  await page.waitForSelector('#sent:not(.is-error)');
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].id, bodies[1].id);
  await context.close();
});

test('language toggle switches the builder UI and is remembered', async () => {
  const { context, page } = await open();
  await page.fill('.place-row [data-key="name"]', 'Hideo Ramen');
  await page.click('.lang-opt[data-lang="en"]');
  assert.equal(await page.textContent('h1'), 'Make your invite');
  assert.match(await page.textContent('.place-row-title'), /Place 1/);
  assert.equal(await page.inputValue('.place-row [data-key="name"]'), 'Hideo Ramen');
  assert.equal(await page.inputValue('#lang'), 'it');
  await page.reload();
  assert.equal(await page.textContent('h1'), 'Make your invite');
  assert.equal(await page.getAttribute('html', 'lang'), 'en');
  await context.close();
});
