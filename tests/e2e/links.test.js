import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { encodeConfig, packConfig, packCompact, normalizeConfig } from '../../js/config.js';
import { startDevServer } from '../../dev/dev-server.js';
import { newPage, sampleConfig } from './helpers.js';

let dev;
let browser;

before(async () => {
  dev = await startDevServer();
  browser = await chromium.launch();
});
after(async () => {
  await browser.close();
  await dev.close();
});

async function buildLink(page) {
  await page.goto(`${dev.origin}/create.html`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.check('input[name="delivery"][value="link"]');
  await page.fill('#to', 'Chiàra');
  await page.fill('.place-row [data-key="name"]', 'Caffè Né 🍝');
  await page.click('#build');
  await page.waitForSelector('#result:not([hidden])');
  return page.inputValue('#link');
}

test('the builder stores the link and the short link opens', async () => {
  const { context, page } = await newPage(browser);
  const link = await buildLink(page);
  assert.match(link, /\/#i=[A-Za-z0-9]{10}$/);
  assert.equal(dev.links.LINKS.puts.length, 1);
  console.log(`builder #i= link: ${link.length} characters`);

  const invite = await context.newPage();
  await invite.goto(link);
  await invite.waitForSelector('[data-screen="question"]');
  assert.equal(await invite.textContent('h1'), 'Chiàra, ti va di uscire a cena con me?');
  await invite.click('#yes');
  assert.match(await invite.textContent('.places'), /Caffè Né 🍝/);

  // Edits drop the short link instead of spending a store write per keystroke.
  await page.fill('#to', 'Giulia');
  assert.equal(await page.isHidden('#result'), true);
  assert.equal(dev.links.LINKS.puts.length, 1);
  await context.close();
});

test('with the store down the builder quietly shows the compact link', async () => {
  const { context, page } = await newPage(browser);
  await context.route(/\/links$/, (route) => route.abort());
  const link = await buildLink(page);
  assert.match(link, /#y=[A-Za-z0-9_-]+$/);
  assert.equal(await page.isHidden('#sent'), true);
  assert.equal(await page.textContent('#form-err'), '');
  await page.goto(link);
  await page.waitForSelector('[data-screen="question"]');
  await context.close();
});

test('a short link shows a loader while the store answers', async () => {
  const { context, page } = await newPage(browser);
  const id = (await (await fetch(`${dev.origin}/links`, { method: 'POST', body: JSON.stringify({ p: await packCompact(normalizeConfig(sampleConfig())) }) })).json()).id;
  let release;
  const gate = new Promise((r) => { release = r; });
  await context.route(/\/links\/\w+$/, async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto(`${dev.origin}/index.html#i=${id}`, { waitUntil: 'commit' });
  await page.waitForSelector('[data-screen="loading"]');
  assert.equal(await page.textContent('h1'), 'Apertura dell’invito…');
  release();
  await page.waitForSelector('[data-screen="question"]');
  assert.equal(await page.isVisible('.lang-toggle'), true);
  await context.close();
});

test('an unknown short link says expired, a network error says unreachable', async () => {
  const { context, page } = await newPage(browser);
  await page.goto(`${dev.origin}/index.html#i=Unknown000`);
  await page.waitForSelector('[data-screen="error"]');
  assert.match(await page.textContent('h1'), /non c’è più/);
  assert.match(await page.textContent('.screen-error'), /scaduto o non valido/);

  await context.route(/\/links\/\w+$/, (route) => route.abort());
  const offline = await context.newPage();
  await offline.goto(`${dev.origin}/index.html#i=AbCdEf1234`);
  await offline.waitForSelector('[data-screen="error"]');
  assert.match(await offline.textContent('h1'), /non raggiungibile/);
  assert.equal(await offline.locator('.screen-error button').count(), 1);
  await context.close();
});

test('older z= and c= links still open', async () => {
  const { context } = await newPage(browser);
  for (const hash of [`#z=${await packConfig(sampleConfig())}`, `#c=${encodeConfig(sampleConfig())}`]) {
    const page = await context.newPage();
    await page.goto(`${dev.origin}/index.html${hash}`);
    await page.waitForSelector('[data-screen="question"]');
    assert.match(await page.textContent('h1'), /^Saro, /);
  }
  await context.close();
});

test('demo invite link lengths', async () => {
  const { context, page } = await newPage(browser);
  await page.goto(`${dev.origin}/index.html`);
  const demo = await page.getAttribute('a[href*="#y="]', 'href');
  const y = demo.slice(demo.indexOf('#'));
  const site = 'https://vibedating.example.com/';
  const p = y.slice(3);
  const { id } = await (await fetch(`${dev.origin}/links`, { method: 'POST', body: JSON.stringify({ p }) })).json();
  console.log(`demo invite: ${site}${y} is ${(site + y).length} characters, ${site}#i=${id} is ${(`${site}#i=${id}`).length}`);
  await context.close();
});
