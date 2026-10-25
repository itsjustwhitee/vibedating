import test from 'node:test';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { startServer, newPage, sampleConfig, inviteUrl, shot, openBuilder, SCREENS_DIR, API } from './helpers.js';

const SIZES = { mobile: { width: 390, height: 844 }, desktop: { width: 1280, height: 800 } };
const NOW = new Date('2026-10-25T20:10:00+01:00');

async function freezeDash(page) {
  await page.evaluate(() => {
    const els = [document.querySelector('#no'), ...document.querySelectorAll('.runaway-ghost')];
    for (const a of els.flatMap((el) => el.getAnimations())) {
      a.pause();
      a.currentTime = 20;
    }
  });
  await page.waitForTimeout(50);
}

async function invite(browser, server, tag, viewport, colorScheme) {
  const { context, page } = await newPage(browser, { viewport, colorScheme, fonts: true });
  await page.clock.setFixedTime(NOW);
  let release;
  await page.route(API, async (route) => {
    const body = JSON.parse(route.request().postData());
    await new Promise((r) => { release = r; });
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body.guest === 'fail@example.com' ? { ok: false, error: 'network' } : { ok: true }) });
  });
  const settle = () => page.waitForTimeout(450);

  await page.goto(`${server.base}index.html`);
  await page.evaluate(() => document.fonts.ready);
  await settle();
  await shot(page, `${tag}-landing`);

  await page.goto('about:blank');
  await page.goto(`${server.base}index.html#c=@@broken`);
  await settle();
  await shot(page, `${tag}-error`);

  for (const guest of ['saro@example.com', 'fail@example.com']) {
    const main = guest.startsWith('saro');
    await page.goto('about:blank');
    await page.goto(inviteUrl(server.base, sampleConfig({ api: API, k: 'secret' })));
    await settle();
    if (main) {
      await shot(page, `${tag}-question`);
      const box = await page.locator('#no').boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y - 10);
      await freezeDash(page);
      await shot(page, `${tag}-question-dash`);
      await page.evaluate(() => document.getAnimations().forEach((a) => a.play()));
      for (let i = 0; i < 4; i++) {
        const b = await page.locator('#no').boundingBox();
        await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
        await page.waitForTimeout(200);
      }
      await page.mouse.move(2, 2);
      await settle();
      await shot(page, `${tag}-question-dodged`);
    }
    await page.click('#yes');
    await page.click('.place-pick >> nth=0');
    await settle();
    if (main) await shot(page, `${tag}-places`);
    await page.click('.btn-next');
    await page.fill('#date', '2026-10-25');
    await page.click('[data-slot="20:30"]');
    await settle();
    if (main) await shot(page, `${tag}-datetime-today`);
    await page.fill('#date', '2026-11-07');
    await page.click('[data-slot="20:30"]');
    await page.click('.btn-next');
    await page.fill('#guest', guest);
    await settle();
    if (main) await shot(page, `${tag}-email`);
    await page.click('.btn-next');
    await page.waitForSelector('[data-screen="sending"]');
    await settle();
    if (main) await shot(page, `${tag}-sending`);
    release();
    await page.waitForSelector('[data-screen="done"]');
    await settle();
    await shot(page, `${tag}-${main ? 'done' : 'done-fallback'}`);
  }
  await context.close();
}

async function builder(browser, server, tag, viewport, colorScheme) {
  const { context, page } = await openBuilder(browser, server.base, { viewport, colorScheme, fonts: true, siteApi: API });
  await page.route(API, (route) => route.fulfill({ contentType: 'application/json', body: '{"ok":true}' }));
  const settle = () => page.waitForTimeout(450);
  const steps = async (name) => {
    const all = page.locator('.step');
    for (let i = 0; i < await all.count(); i++) {
      await all.nth(i).screenshot({ path: join(SCREENS_DIR, `${tag}-${name}-step${i + 1}.png`) });
    }
  };
  await page.evaluate(() => document.fonts.ready);
  await settle();
  await shot(page, `${tag}-create`);
  if (tag.startsWith('mobile')) {
    await steps('create');
    await page.click('#preview-open');
    await settle();
    await page.screenshot({ path: join(SCREENS_DIR, `${tag}-create-preview.png`) });
    await page.click('#preview-close');
  }
  await page.click('#build');
  await settle();
  await shot(page, `${tag}-create-errors`);
  await page.fill('#to', 'Saro');
  await page.fill('#from', 'Ciuchi');
  await page.fill('.place-row [data-key="name"]', 'Sushi Sapporo');
  await page.fill('.place-row [data-key="note"]', 'Nigiri al bancone, uno dopo l’altro');
  await page.click('#add-place');
  await page.fill('.place-row >> nth=1 >> [data-key="emoji"]', '🍜');
  await page.fill('.place-row >> nth=1 >> [data-key="name"]', 'Hideo Ramen');
  await page.click('#texts summary');
  await page.click('#more-options summary');
  await page.check('input[name="delivery"][value="link"]');
  await page.click('#build');
  await settle();
  await shot(page, `${tag}-create-link`);
  if (tag.startsWith('mobile')) await steps('create-filled');
  await page.check('input[name="delivery"][value="email"]');
  await page.fill('#owner', 'ciuchi@example.com');
  await page.click('#build');
  await page.waitForSelector('#sent:not([hidden])');
  await settle();
  await page.locator('.step >> nth=4').screenshot({ path: join(SCREENS_DIR, `${tag}-create-sent.png`) });
  await page.click('#advanced summary');
  await page.fill('#k', 'a-long-shared-key');
  await settle();
  await page.locator('.step >> nth=3').screenshot({ path: join(SCREENS_DIR, `${tag}-create-advanced.png`) });
  await context.close();

  const plain = await openBuilder(browser, server.base, { viewport, colorScheme, fonts: true });
  await plain.page.click('#advanced summary');
  await plain.page.waitForTimeout(300);
  await plain.page.locator('.step >> nth=3').screenshot({ path: join(SCREENS_DIR, `${tag}-create-nometa.png`) });
  await plain.context.close();
}

test('screenshots of every screen', { timeout: 300000 }, async () => {
  const server = await startServer();
  const browser = await chromium.launch();
  try {
    for (const [size, viewport] of Object.entries(SIZES)) {
      for (const scheme of ['light', 'dark']) {
        const tag = `${size}-${scheme}`;
        await invite(browser, server, tag, viewport, scheme);
        await builder(browser, server, tag, viewport, scheme);
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }
});
