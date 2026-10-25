import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readConfigFromHash } from '../../js/config.js';
import { startServer, mockApi, mockPhoton, photonFeature, screenOf, openBuilder, API } from './helpers.js';

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
const linkCfg = async (page) => {
  await page.waitForSelector('#result:not([hidden])');
  return (await readConfigFromHash(new URL(await page.inputValue('#link')).hash)).cfg;
};

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
  assert.equal(await page.locator('#preview, #preview-open, .preview-pane').count(), 0);
  await page.click('#build');
  assert.match(await page.textContent('.place-row'), /Nome obbligatorio/);
  assert.match(await page.textContent('#form-err'), /da correggere/);
  assert.equal(await page.isHidden('#result'), true);
  await fillBasics(page);
  await page.click('#build');
  const cfg = await linkCfg(page);
  assert.match(await page.inputValue('#link'), /index\.html#y=/);
  assert.equal(cfg.api, undefined);
  assert.equal(cfg.k, undefined);
  assert.equal(cfg.places[0].emoji, '☕');

  const invite = await context.newPage();
  await invite.goto(await page.inputValue('#link'));
  await invite.waitForSelector('[data-screen="question"]');
  assert.equal(await invite.textContent('h1'), 'Chiàra, ti va una cena? 🍝');
  await invite.click('#yes');
  assert.equal(await screenOf(invite), 'places');
  assert.match(await invite.textContent('.places'), /Caffè Né.*Più è, più già 🍷/);
  await context.close();
});

test('advanced section exists only with ?advanced', async () => {
  const plain = await open({ siteApi: API });
  assert.equal(await plain.page.locator('#advanced, #k, #api').count(), 0);
  await plain.context.close();
  const adv = await open({ siteApi: API, advanced: true });
  assert.equal(await adv.page.locator('#advanced').count(), 1);
  await adv.page.click('#advanced summary');
  assert.equal(await adv.page.isVisible('#k'), true);
  await adv.context.close();
});

test('without a site API: only link mode plus advanced api and key, key never remembered', async () => {
  const { context, page } = await open({ advanced: true });
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
  const { context, page } = await open({ siteApi: API, advanced: true });
  assert.equal(await page.isVisible('#choices'), true);
  assert.equal(await page.locator('#choices input[name="delivery"]').count(), 2);
  assert.equal(await page.isHidden('#api-field'), true);
  assert.equal(await page.isHidden('#link-only'), true);
  assert.equal(await page.isVisible('#owner'), true);
  await page.check('input[name="delivery"][value="link"]');
  assert.equal(await page.isHidden('#owner-field'), true);
  await context.close();
});

test('with a site API: an advanced key builds a personal link with k and no api', async () => {
  const { context, page } = await open({ siteApi: API, advanced: true });
  await fillBasics(page);
  await page.click('#advanced summary');
  await page.fill('#k', 'a-long-shared-key');
  assert.equal(await page.isDisabled('input[name="delivery"][value="email"]'), true);
  assert.equal(await page.isVisible('#personal-note'), true);
  assert.equal(await page.isHidden('#owner-field'), true);
  await page.click('#build');
  const cfg = await linkCfg(page);
  assert.equal(cfg.api, undefined);
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
  assert.match(await page.textContent('#sent'), /Link inviato/);
  assert.equal(bodies.length, 1);
  const b = bodies[0];
  assert.equal(b.action, 'create');
  assert.ok(/^[A-Za-z0-9_-]{1,64}$/.test(b.id));
  assert.equal(b.config.owner, 'owner@example.com');
  assert.equal(b.config.api, undefined);
  assert.equal(b.config.sig, undefined);
  assert.equal(b.config.exp, undefined);
  assert.ok(b.config.slots.includes('22:00'));
  assert.equal(await page.isHidden('#result'), true);
  assert.equal(await page.inputValue('#link'), '');
  assert.doesNotMatch(await page.content(), /#[cyzi]=/);

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

test('emoji is suggested from the name until picked by hand', async () => {
  const { context, page } = await open();
  const face = () => page.textContent('.place-row .emoji-face');
  await page.fill('.place-row [data-key="name"]', 'Pizzeria Montebello');
  assert.equal(await face(), '🍕');
  await page.fill('.place-row [data-key="name"]', 'Sushi Bar Hana');
  assert.equal(await face(), '🍣');
  await page.click('.place-row .emoji-btn');
  assert.equal(await page.getAttribute('.place-row .emoji-btn', 'aria-expanded'), 'true');
  assert.equal(await page.locator('.emoji-opt').count(), 24);
  await page.keyboard.press('Escape');
  assert.equal(await page.isHidden('.emoji-pop'), true);
  await page.click('.place-row .emoji-btn');
  await page.click('.emoji-opt[data-emoji="🍷"]');
  assert.equal(await face(), '🍷');
  await page.fill('.place-row [data-key="name"]', 'Ramen Ya');
  assert.equal(await face(), '🍷');
  await page.reload();
  assert.equal(await face(), '🍷');
  await context.close();
});

test('place search suggests places and fills name, address and maps link', async () => {
  const { context, page } = await open();
  const queries = await mockPhoton(page, [
    photonFeature('Pizzeria Montebello', 'Via Montebello', '77', 'Roma'),
    photonFeature('Montebello Pizza', 'Corso Italia', '2', 'Milano'),
  ]);
  const name = page.locator('.place-row [data-key="name"]');
  await name.fill('Mo');
  await page.waitForTimeout(450);
  assert.equal(queries.length, 0);
  await name.fill('Pizzeria Montebello');
  await page.waitForSelector('.suggest:not([hidden]) .suggest-opt');
  assert.equal(queries.length, 1);
  assert.equal(queries[0].searchParams.get('q'), 'Pizzeria Montebello');
  assert.equal(queries[0].searchParams.get('lang'), 'default');
  assert.equal(await name.getAttribute('aria-expanded'), 'true');
  assert.equal(await page.locator('.suggest-opt').count(), 2);
  assert.match(await page.textContent('.suggest-opt >> nth=1'), /Montebello Pizza.*Corso Italia 2, Milano/);
  await page.keyboard.press('ArrowDown');
  assert.equal(await name.getAttribute('aria-activedescendant'), await page.getAttribute('.suggest-opt >> nth=0', 'id'));
  await page.keyboard.press('Enter');
  assert.equal(await page.isHidden('.suggest'), true);
  assert.equal(await name.inputValue(), 'Pizzeria Montebello');
  assert.equal(await page.inputValue('.place-row [data-key="address"]'), 'Via Montebello 77, Roma');
  assert.equal(await page.inputValue('.place-row [data-key="maps"]'),
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('Pizzeria Montebello, Via Montebello 77, Roma')}`);
  assert.equal(await page.textContent('.place-row .emoji-face'), '🍕');

  await name.fill('Montebello P');
  await page.waitForSelector('.suggest:not([hidden])');
  await page.keyboard.press('Escape');
  assert.equal(await page.isHidden('.suggest'), true);
  await context.close();
});

test('place search fails silently', async () => {
  const { context, page } = await open();
  await page.route(/photon\.komoot\.io/, (route) => route.abort());
  await page.fill('.place-row [data-key="name"]', 'Hideo Ramen');
  await page.waitForTimeout(600);
  assert.equal(await page.isHidden('.suggest'), true);
  assert.equal(await page.textContent('.place-row .emoji-face'), '🍜');
  await context.close();
});

test('icon-only buttons are labelled and add or remove places and times', async () => {
  const { context, page } = await open();
  assert.equal(await page.getAttribute('#add-place', 'aria-label'), 'Aggiungi un luogo');
  assert.equal(await page.getAttribute('#add-slot', 'aria-label'), 'Aggiungi orario');
  assert.equal(await page.isHidden('.place-remove'), true);
  await page.click('#add-place');
  assert.equal(await page.locator('.place-row').count(), 2);
  assert.equal(await page.getAttribute('.place-row >> nth=1 >> .place-remove', 'aria-label'), 'Rimuovi luogo 2');
  const box = await page.locator('.place-row >> nth=1 >> .place-remove').boundingBox();
  assert.ok(box.width >= 40 && box.height >= 40);
  await page.click('.place-row >> nth=1 >> .place-remove');
  assert.equal(await page.locator('.place-row').count(), 1);
  await page.fill('#custom-slot', '23:15');
  await page.click('#add-slot');
  assert.equal(await page.getAttribute('[data-slot="23:15"]', 'aria-pressed'), 'true');
  await context.close();
});

test('language toggle switches the builder UI and is remembered', async () => {
  const { context, page } = await open();
  await page.fill('.place-row [data-key="name"]', 'Hideo Ramen');
  await page.click('.lang-opt[data-lang="en"]');
  assert.equal(await page.textContent('h1'), 'Make your invite');
  assert.match(await page.textContent('.place-row-title'), /Place 1/);
  assert.equal(await page.getAttribute('#add-place', 'aria-label'), 'Add a place');
  assert.equal(await page.inputValue('.place-row [data-key="name"]'), 'Hideo Ramen');
  assert.equal(await page.inputValue('#lang'), 'it');
  await page.reload();
  assert.equal(await page.textContent('h1'), 'Make your invite');
  assert.equal(await page.getAttribute('html', 'lang'), 'en');
  await context.close();
});
