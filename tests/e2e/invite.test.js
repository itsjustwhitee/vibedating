import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, devices } from 'playwright';
import { startServer, newPage, sampleConfig, inviteUrl, mockApi, screenOf, goToDatetime, API } from './helpers.js';

const NOW = new Date('2026-10-25T20:10:00+01:00');
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

async function open(cfg, opts) {
  const { context, page } = await newPage(browser, opts);
  await page.clock.setFixedTime(NOW);
  const bodies = cfg.api ? await mockApi(page, opts?.reply) : [];
  await page.goto(inviteUrl(server.base, cfg));
  await page.waitForSelector('[data-screen="question"]');
  return { context, page, bodies };
}

async function chooseDefaults(page) {
  await goToDatetime(page);
  await page.fill('#date', '2026-11-07');
  await page.click('[data-slot="20:00"]');
  await page.click('.btn-next');
}

const rects = (page) => page.evaluate(() => {
  const r = (el) => JSON.parse(JSON.stringify(el.getBoundingClientRect()));
  return { no: r(document.querySelector('#no')), yes: r(document.querySelector('#yes')), vw: innerWidth, vh: innerHeight };
});
const overlap = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const inside = (r, vw, vh) => r.left >= 0 && r.top >= 0 && r.right <= vw && r.bottom <= vh;

test('landing without fragment links to the builder and a demo', async () => {
  const { context, page } = await newPage(browser);
  await page.goto(`${server.base}index.html`);
  await page.waitForSelector('[data-screen="landing"]');
  assert.equal(await page.locator('a[href="create.html"]').count(), 1);
  assert.equal(await page.title(), 'Una domanda per te 💌');
  await page.click('a[href*="#y="]');
  await page.waitForSelector('[data-screen="question"]');
  await context.close();
});

test('bad fragment shows a friendly error screen', async () => {
  const { context, page } = await newPage(browser);
  await page.goto(`${server.base}index.html#c=not-a-config`);
  await page.waitForSelector('[data-screen="error"]');
  const text = await page.textContent('body');
  assert.doesNotMatch(text, /Error|stack|decode|undefined/);
  await context.close();
});

test('desktop: No cannot be clicked or activated with the keyboard', async () => {
  const { context, page } = await open(sampleConfig());
  for (let i = 0; i < 5; i++) {
    await page.click('#no', { timeout: 800 }).catch(() => {});
    assert.equal(await screenOf(page), 'question');
  }
  assert.ok(await page.evaluate(() => document.querySelector('#no').classList.contains('is-running')));
  await page.focus('#yes');
  for (let i = 0; i < 4 && (await page.evaluate(() => document.activeElement.id)) !== 'no'; i++) await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'no');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Space');
  await page.waitForTimeout(100);
  assert.equal(await screenOf(page), 'question');
  await context.close();
});

test('desktop: No never overlaps Yes and Yes stays in the viewport after 15 dodges', async () => {
  const { context, page } = await open(sampleConfig(), { viewport: { width: 1280, height: 800 } });
  for (let i = 0; i < 15; i++) {
    const { no } = await rects(page);
    await page.mouse.move(no.left + no.width / 2, no.top + no.height / 2);
    await page.waitForTimeout(400);
    const r = await rects(page);
    assert.ok(!overlap(r.no, r.yes), `overlap at dodge ${i + 1}`);
    assert.ok(inside(r.no, r.vw, r.vh), `No outside at dodge ${i + 1}`);
    assert.ok(inside(r.yes, r.vw, r.vh), `Yes outside at dodge ${i + 1}`);
  }
  assert.notEqual(await page.textContent('#no'), 'No');
  await page.click('#yes');
  assert.equal(await screenOf(page), 'places');
  await context.close();
});

test('No dashes with a blur while moving and still never activates', async () => {
  const { context, page } = await open(sampleConfig(), { viewport: { width: 1280, height: 800 } });
  for (let i = 0; i < 4; i++) {
    const { no } = await rects(page);
    await page.mouse.move(no.left + no.width / 2, no.top - 20);
    const during = await page.evaluate(() => {
      const el = document.querySelector('#no');
      return { dashing: el.classList.contains('is-dashing'), filter: getComputedStyle(el).filter, anims: el.getAnimations().length };
    });
    assert.ok(during.dashing, `not dashing at dodge ${i + 1}`);
    assert.match(during.filter, /runaway-blur/);
    assert.ok(during.anims > 0);
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => document.querySelector('#no').classList.contains('is-dashing')), false);
    assert.equal(await page.locator('.runaway-ghost').count(), 0);
  }
  await page.locator('#no').dispatchEvent('click');
  assert.equal(await screenOf(page), 'question');
  await context.close();
});

test('reduced motion: No jumps without dash or blur', async () => {
  const { context, page } = await open(sampleConfig(), { reducedMotion: 'reduce' });
  const { no } = await rects(page);
  await page.mouse.move(no.left + no.width / 2, no.top + no.height / 2);
  assert.equal(await page.evaluate(() => document.querySelector('#no').classList.contains('is-dashing')), false);
  assert.equal(await page.locator('.runaway-ghost').count(), 0);
  assert.ok(await page.evaluate(() => document.querySelector('#no').classList.contains('is-running')));
  await context.close();
});

test('language toggle overrides the invite language and is remembered', async () => {
  const { context, page } = await open(sampleConfig());
  assert.equal(await page.textContent('#yes'), 'Sì');
  await page.click('.lang-opt[data-lang="en"]');
  assert.equal(await page.textContent('#yes'), 'Yes');
  assert.match(await page.textContent('h1'), /Saro, would you like/);
  await page.reload();
  await page.waitForSelector('[data-screen="question"]');
  assert.equal(await page.textContent('#yes'), 'Yes');
  await goToDatetime(page);
  await page.fill('#date', '2026-11-07');
  assert.match(await page.textContent('.date-long'), /Saturday, November 7/);
  await context.close();
});

test('mobile: tapping No 10 times keeps the question, no horizontal scroll at 360px', async () => {
  const { context, page } = await open(sampleConfig(), { ...devices['iPhone 13'], hasTouch: true });
  for (let i = 0; i < 10; i++) {
    await page.tap('#no', { timeout: 800 }).catch(() => {});
    await page.waitForTimeout(120);
  }
  assert.equal(await screenOf(page), 'question');
  assert.notEqual(await page.textContent('#no'), 'No');
  await page.setViewportSize({ width: 360, height: 740 });
  const noScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  assert.ok(await noScroll());
  const r = await rects(page);
  assert.ok(inside(r.yes, r.vw, r.vh));
  await page.tap('#yes');
  assert.equal(await screenOf(page), 'places');
  assert.ok(await noScroll());
  await page.tap('.place-pick >> nth=0');
  await page.tap('.btn-next');
  assert.ok(await noScroll());
  await context.close();
});

test('personal flow sends accept and shows DONE with the right calendar dates', async () => {
  const cfg = sampleConfig({ api: API, k: 'secret-key' });
  const { context, page, bodies } = await open(cfg);
  await page.click('#yes');
  await page.click('.place-pick >> nth=0');
  const [popup] = await Promise.all([page.waitForEvent('popup'), page.click('.place-maps')]);
  await popup.close();
  assert.equal(await page.getAttribute('.place-pick >> nth=0', 'aria-pressed'), 'true');
  await page.click('.btn-next');
  await page.fill('#date', '2026-11-07');
  assert.match(await page.textContent('.date-long'), /sabato 7 novembre/);
  await page.click('[data-slot="20:00"]');
  await page.click('.btn-next');
  await page.click('.btn-back');
  assert.equal(await screenOf(page), 'datetime');
  await page.click('.btn-next');
  await page.fill('#guest', 'not-an-email');
  await page.click('.btn-next');
  assert.equal(await screenOf(page), 'email');
  await page.fill('#guest', 'giulia@example.com');
  await page.click('.btn-next');
  await page.waitForSelector('[data-screen="done"]');
  assert.equal(bodies.length, 1);
  const b = bodies[0];
  assert.equal(b.action, 'accept');
  assert.equal(b.k, 'secret-key');
  assert.equal(b.guest, 'giulia@example.com');
  assert.equal(b.date, '2026-11-07');
  assert.equal(b.time, '20:00');
  assert.ok(b.id);
  const href = await page.getAttribute('#gcal', 'href');
  assert.equal(new URL(href).searchParams.get('dates'), '20261107T190000Z/20261107T210000Z');
  assert.equal(await page.locator('.fallback').count(), 0);
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#ics')]);
  assert.equal(download.suggestedFilename(), 'cena.ics');
  await context.close();
});

for (const [name, reply] of [['back-end error', { ok: false, error: 'limit' }], ['network abort', 'abort']]) {
  test(`${name} still shows DONE with the fallback line`, async () => {
    const { context, page, bodies } = await open(sampleConfig({ api: API, k: 'secret-key' }), { reply });
    await chooseDefaults(page);
    await page.fill('#guest', 'giulia@example.com');
    await page.click('.btn-next');
    await page.waitForSelector('[data-screen="done"]');
    assert.equal(bodies.length, 1);
    assert.match(await page.textContent('.fallback'), /non inviata/);
    assert.ok(await page.getAttribute('#gcal', 'href'));
    await context.close();
  });
}

test('client mode skips the email step and sends nothing', async () => {
  const { context, page } = await open(sampleConfig());
  const requests = [];
  page.on('request', (r) => { if (r.method() === 'POST') requests.push(r.url()); });
  await goToDatetime(page);
  await page.fill('#date', '2026-11-07');
  await page.click('[data-slot="21:00"]');
  await page.click('.btn-next');
  await page.waitForSelector('[data-screen="done"]');
  assert.equal(requests.length, 0);
  const dates = new URL(await page.getAttribute('#gcal', 'href')).searchParams.get('dates');
  assert.equal(dates, '20261107T200000Z/20261107T220000Z');
  await context.close();
});

test('past dates are not selectable and past slots are disabled today', async () => {
  const { context, page } = await open(sampleConfig({ days: 30 }));
  await goToDatetime(page);
  assert.equal(await page.getAttribute('#date', 'min'), '2026-10-25');
  assert.equal(await page.getAttribute('#date', 'max'), '2026-11-24');
  await page.fill('#date', '2026-10-25');
  assert.equal(await page.isDisabled('[data-slot="19:30"]'), true);
  assert.equal(await page.isDisabled('[data-slot="20:00"]'), true);
  assert.equal(await page.isDisabled('[data-slot="20:30"]'), false);
  await page.fill('#date', '2026-10-24');
  assert.equal(await page.isDisabled('.btn-next'), true);
  await page.fill('#date', '2026-10-26');
  assert.equal(await page.isDisabled('[data-slot="19:30"]'), false);
  await context.close();
});

test('double click on Send makes exactly one request', async () => {
  const { context, page, bodies } = await open(sampleConfig({ api: API, k: 'secret-key' }));
  await chooseDefaults(page);
  await page.fill('#guest', 'giulia@example.com');
  await page.evaluate(() => {
    const b = document.querySelector('.btn-next');
    b.click();
    b.click();
  });
  await page.waitForSelector('[data-screen="done"]');
  await page.waitForTimeout(300);
  assert.equal(bodies.length, 1);
  await context.close();
});

test('guest_not_allowed goes back to the email step, a corrected email succeeds', async () => {
  const reply = [{ ok: false, error: 'guest_not_allowed' }, { ok: true }];
  const { context, page, bodies } = await open(sampleConfig({ api: API, k: 'secret-key' }), { reply });
  await chooseDefaults(page);
  await page.fill('#guest', 'wrong@example.com');
  await page.click('.btn-next');
  await page.waitForSelector('[data-screen="email"]');
  assert.match(await page.textContent('#guest-err'), /previsto da Ciuchi/);
  await page.fill('#guest', 'giulia@example.com');
  await page.click('.btn-next');
  await page.waitForSelector('[data-screen="done"]');
  assert.equal(bodies.length, 2);
  assert.notEqual(bodies[0].id, bodies[1].id);
  assert.equal(await page.locator('.fallback').count(), 0);
  await context.close();
});

test('personal payload carries the language', async () => {
  const { context, page, bodies } = await open(sampleConfig({ api: API, k: 'secret-key', lang: 'en' }));
  await chooseDefaults(page);
  await page.fill('#guest', 'giulia@example.com');
  await page.click('.btn-next');
  await page.waitForSelector('[data-screen="done"]');
  assert.equal(bodies[0].lang, 'en');
  await context.close();
});

test('bad_time from the server goes back to the date and time step with a message', async () => {
  const { context, page } = await open(sampleConfig({ api: API, k: 'secret-key' }), { reply: { ok: false, error: 'bad_time' } });
  await chooseDefaults(page);
  await page.fill('#guest', 'giulia@example.com');
  await page.click('.btn-next');
  await page.waitForSelector('[data-screen="datetime"]');
  assert.match(await page.textContent('[data-screen="datetime"] .field-error[role="alert"]'), /non più disponibile/);
  assert.equal(await page.isDisabled('.btn-next'), true);
  await context.close();
});

test('a slot that passed while the page was open sends nothing and returns to the date step', async () => {
  const { context, page, bodies } = await open(sampleConfig({ api: API, k: 'secret-key' }));
  await goToDatetime(page);
  await page.fill('#date', '2026-10-25');
  await page.click('[data-slot="20:30"]');
  await page.click('.btn-next');
  await page.fill('#guest', 'giulia@example.com');
  await page.clock.setFixedTime(new Date('2026-10-25T20:45:00+01:00'));
  await page.click('.btn-next');
  await page.waitForSelector('[data-screen="datetime"]');
  assert.match(await page.textContent('[data-screen="datetime"] .field-error[role="alert"]'), /non più disponibile/);
  assert.equal(await page.isDisabled('[data-slot="20:30"]'), true);
  assert.equal(bodies.length, 0);
  await context.close();
});

test('today follows the invite time zone, not the browser one', async () => {
  const { context, page } = await open(sampleConfig({ tz: 'Asia/Tokyo' }));
  await goToDatetime(page);
  assert.equal(await page.getAttribute('#date', 'min'), '2026-10-26');
  await context.close();
});
