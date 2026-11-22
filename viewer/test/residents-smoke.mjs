// Headless smoke test of the residents' site: adds two trips, switches options, works out all options,
// scrubs the years, shows a heat map, reloads (trips persist) and checks it works with storage blocked.
// Screenshots go to viewer/residents/screenshots/.
//   node test/residents-smoke.mjs                       # committed sample data
//   VIEWER_DATA_DIR=/path/to/sim/data/viewer node test/residents-smoke.mjs   # real results (read-only)
import { chromium } from 'playwright-core';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { serve } from './serve.mjs';

const SHOTS = fileURLToPath(new URL('../residents/screenshots/', import.meta.url));
const MAPLIBRE = fileURLToPath(new URL('../node_modules/maplibre-gl/dist/', import.meta.url));
const REAL = process.env.VIEWER_DATA_DIR;
await mkdir(SHOTS, { recursive: true });
const server = await serve(0, REAL ? { '/real/': REAL } : {});
const url = `http://127.0.0.1:${server.address().port}/residents/index.html${REAL ? '?data=/real/' : ''}`;
const tag = REAL ? 'real' : 'sample';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [], results = [], requests = [];
const step = async (name, fn) => {
  const t0 = Date.now();
  try { await fn(); results.push(`ok   ${name} (${Date.now() - t0} ms)`); } catch (e) { results.push(`FAIL ${name}: ${e.message}`); throw e; }
};

async function newPage(opts, init = null) {
  const ctx = await browser.newContext(opts);
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  await page.route('https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/5.6.0/*', async (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    route.fulfill({ body: await readFile(MAPLIBRE + name), contentType: name.endsWith('.css') ? 'text/css' : 'text/javascript' });
  });
  await page.route('https://tile.openstreetmap.org/**', (r) => r.abort());
  page.on('request', (r) => requests.push({ url: r.url(), post: r.postData() || '', method: r.method() }));
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 404/.test(m.text())) errors.push(`console: ${m.text()}`); });
  // expected 404s: data/index.json when only the sample exists, and .lite.json when a folder has no lite networks
  // ... and the knowledge-base link probe (the link is hidden when the method note is not served alongside)
  page.on("response", (r) => { if (r.status() >= 400 && !/\/data\/index\.json$|\.lite\.json$|\/kb\//.test(r.url())) errors.push(`HTTP ${r.status()} ${r.url()}`); });
  return page;
}

const ready = async (page) => {
  await page.waitForFunction(() => !!(window.__residents && window.__residents.ready), null, { timeout: 30000 });
  await page.evaluate(() => window.__residents.ready);
};
const idle = (page) => page.evaluate(() => new Promise((res) => {
  const m = window.__residents.R.view.map;
  m.once('idle', () => res()); setTimeout(res, 3000);
}));
const shot = (page, name) => page.screenshot({ path: `${SHOTS}${tag}-${name}.png`, fullPage: false });
const settled = (page) => page.waitForFunction(() => [...document.querySelectorAll('.t-change')].every((e) => e.textContent.trim().length > 0), null, { timeout: 30000 });

async function clickMapNear(page, lonlat) {
  const pt = await page.evaluate(([lon, lat]) => {
    const m = window.__residents.R.view.map;
    const p = m.project([lon, lat]);
    const box = document.querySelector('#map').getBoundingClientRect();
    return { x: box.left + p.x, y: box.top + p.y };
  }, lonlat);
  await page.mouse.click(pt.x, pt.y);
}

try {
  const page = await newPage({ viewport: { width: 1360, height: 900 } });
  await page.goto(url);
  let poiA, poiB;

  await step('loads with no trips and a privacy note', async () => {
    await ready(page);
    await idle(page);
    assert.match(await page.textContent('#trips-card .privacy'), /never sent anywhere/);
    assert.match(await page.textContent('#trips-card .privacy'), /searched on this device/);
    // the address list is not downloaded until an address box is used
    assert.equal(requests.filter((r) => /addresses\.json/.test(r.url)).length, 0);
    assert.ok(await page.isVisible('#no-trips'));
    [poiA, poiB] = await page.evaluate(() => {
      const labels = [...document.querySelectorAll('#place-list option')].map((o) => o.value);
      const pick = (re) => labels.find((l) => re.test(l));
      return [pick(/supermarket/) || labels[0], pick(/school|beach|medical/) || labels[5] || labels[1]];
    });
    assert.ok(poiA && poiB);
    await shot(page, '01-empty');
  });

  await step('add a trip from a point picked on the map, named Home', async () => {
    await page.click('button[data-pick="from"]');
    const centre = await page.evaluate(() => {
      const n = window.__residents.R.baseNet;
      // a junction about 1 km north-west of the first supermarket: a plausible home
      const p = window.__residents.R.pois.find((x) => /supermarket/.test(x.category)) || window.__residents.R.pois[0];
      return [p.lon - 0.008, p.lat + 0.006, n.bbox];
    });
    await clickMapNear(page, centre.slice(0, 2));
    assert.match(await page.inputValue('#from'), /Point near/);
    await page.fill('#from', 'Home');
    await page.fill('#to', poiA);
    await page.selectOption('#time', String(8.5 * 3600));
    await page.selectOption('#day', 'weekday');
    await page.click('#add-trip button[type="submit"]');
    await page.waitForFunction(() => document.querySelectorAll('.trip').length === 1);
    await settled(page);
    assert.match(await page.textContent('.trip .t-today'), /minute|under/);
  });

  await step('add a second trip from the saved place "Home"', async () => {
    await page.fill('#from', 'Home');
    await page.fill('#to', poiB);
    await page.selectOption('#time', String(15 * 3600));
    await page.selectOption('#day', 'summer');
    await page.click('#add-trip button[type="submit"]');
    await page.waitForFunction(() => document.querySelectorAll('.trip').length === 2);
    await settled(page);
    await idle(page);
    await shot(page, '02-two-trips');
  });

  await step('type an address (keyboard), choose it, name it, and add a trip to a street picked with the mouse', async () => {
    await page.locator('#from').click();
    await page.waitForFunction(() => !!window.__residents.R.addr.index, null, { timeout: 15000 });
    assert.equal(requests.filter((r) => /addresses\.json/.test(r.url)).length, 1);
    await page.locator('#from').pressSequentially('106 Bay Rd Encounter Bay', { delay: 5 });
    const list = page.locator('#from-list');
    await list.waitFor({ state: 'visible' });
    assert.equal(await page.getAttribute('#from', 'role'), 'combobox');
    assert.equal(await page.getAttribute('#from', 'aria-expanded'), 'true');
    const first = (await list.locator('li[role="option"]').first().textContent());
    assert.match(first, /^106 Bay Road, Encounter Bay/);
    await shot(page, '02a-suggestions');
    await page.keyboard.press('ArrowDown');
    assert.match(await page.getAttribute('#from', 'aria-activedescendant'), /^from-list-/);
    await page.keyboard.press('Enter');
    assert.equal(await page.inputValue('#from'), '106 Bay Road, Encounter Bay');
    assert.equal(await page.isVisible('#from-list'), false);
    assert.match(await page.textContent('#from-note'), /Pin placed at 106 Bay Road, Encounter Bay/);
    assert.equal(await page.locator('.from-marker').count(), 1);
    await shot(page, '02a-address-chosen');
    // offer to save it under a name by typing over it
    await page.fill('#from', 'Our house');
    assert.match(await page.textContent('#from-note'), /saved as Our house/);
    // a street, chosen with the mouse
    await page.locator('#to').pressSequentially('ocean st', { delay: 5 });
    await page.locator('#to-list li[role="option"]', { hasText: 'Ocean Street, Victor Harbor' }).first().click();
    assert.match(await page.inputValue('#to'), /Ocean Street, Victor Harbor/);
    const toLabel = await page.inputValue('#to');
    await page.selectOption('#time', String(17 * 3600));
    await page.selectOption('#day', 'weekday');
    await page.click('#add-trip button[type="submit"]');
    await page.waitForFunction(() => document.querySelectorAll('.trip').length === 3);
    await settled(page);
    const saved = await page.evaluate(() => window.__residents.R.trips.places.map((p) => [p.name, p.lon, p.lat]));
    const home = saved.find((p) => p[0] === 'Our house');
    assert.ok(home, 'the address was saved as a named place');
    assert.ok(Math.abs(home[1] - 138.603) < 0.01 && Math.abs(home[2] + 35.563) < 0.01, `saved at ${home}`);
    const names = await page.$$eval('.trip .trip-name', (els) => els.map((e) => e.textContent));
    assert.ok(names.some((n) => n.startsWith('Our house → ') && n.includes('Ocean Street')), names.join(' | '));
    assert.equal(await page.isVisible('#from-note'), false);
    // a typed address that was not chosen from the list is still used when it is the only match
    await page.fill('#from', '106 bay rd encounter bay');
    await page.fill('#to', poiA);
    await page.click('#add-trip button[type="submit"]');
    await page.waitForFunction(() => document.querySelectorAll('.trip').length === 4);
    await settled(page);
    await page.locator('.trip').nth(3).locator('.remove').click();
    await page.waitForFunction(() => document.querySelectorAll('.trip').length === 3);
    await page.locator('.trip').first().locator('.show').click();
    await idle(page);
    await shot(page, '02b-address-trip');
    assert.ok(toLabel);
  });

  await step('what was typed never left the browser', async () => {
    const sent = requests.filter((r) => /106|bay|ocean|encounter|our%20house|our house/i.test(decodeURIComponent(r.url.replace(/^https?:\/\/[^/]+/, ''))) || /106|ocean|our house/i.test(r.post));
    assert.deepEqual(sent.map((r) => r.url), [], 'typed text appeared in a request');
    assert.deepEqual(requests.filter((r) => r.method !== 'GET' && !(r.method === 'HEAD' && /\/kb\//.test(r.url))).map((r) => r.url), [], 'no non-GET requests');
    const external = requests.filter((r) => !/^(http:\/\/127\.0\.0\.1|data:|blob:)/.test(r.url) && !/cdnjs\.cloudflare\.com\/ajax\/libs\/maplibre-gl|tile\.openstreetmap\.org/.test(r.url));
    assert.deepEqual(external.map((r) => r.url), [], 'only the page, its data and the map library/tiles are requested');
    assert.equal(requests.filter((r) => /addresses\.json/.test(r.url)).length, 1, 'the address list is fetched once');
    assert.equal(new URL(page.url()).search, REAL ? '?data=/real/' : '', 'nothing typed is in the page address');
    assert.equal(new URL(page.url()).hash, '');
  });

  await step('switch options: cards and route colours update', async () => {
    const opts = await page.$$eval('input[name="option"]:not([disabled])', (els) => els.map((e) => e.value));
    assert.ok(opts.length >= 1);
    const current = await page.evaluate(() => window.__residents.S.option);
    const other = opts.find((o) => o !== current && o !== 'baseline') || opts[0];
    await page.check(`input[name="option"][value="${other}"]`);
    await page.waitForFunction((o) => window.__residents.S.option === o, other);
    await settled(page);
    await page.locator('.trip').first().locator('.show').click();      // the weekday trip
    await page.waitForFunction(() => /Today's network/.test(document.querySelector('#map-caption').textContent), null, { timeout: 30000 });
    await idle(page);
    const chips = await page.$$eval('.trip .t-change .chip', (els) => els.map((e) => e.className));
    assert.ok(chips.length >= 1);
    await shot(page, '03-option-route');
    if (opts.includes('cp')) await page.check('input[name="option"][value="cp"]');
    await settled(page);
  });

  await step('all options at a glance', async () => {
    await page.click('#glance-go');
    await page.waitForFunction(() => document.querySelectorAll('#glance td').length > 0
      && [...document.querySelectorAll('#glance td')].every((td) => td.textContent.trim() !== '…'), null, { timeout: 120000 });
    await page.locator('#glance-card').scrollIntoViewIfNeeded();
    await shot(page, '04-at-a-glance');
    assert.match(await page.textContent('#glance caption'), /now \(2025 data\)/);
    await page.check('input[name="glance-when"][value="near"]');
    await page.waitForFunction(() => /2031 \(in about 5 years\)/.test(document.querySelector('#glance caption')?.textContent || '')
      && [...document.querySelectorAll('#glance td')].every((td) => td.textContent.trim() !== '…'), null, { timeout: 120000 });
    await page.check('input[name="glance-when"][value="now"]');
    await page.waitForFunction(() => /now \(2025 data\)/.test(document.querySelector('#glance caption')?.textContent || ''));
    assert.deepEqual(await page.$$eval('.trip:first-of-type .period h4', (e) => e.map((x) => x.textContent)), ['Now', 'In about 5 years (2031)']);
  });

  await step('scrub the years (timeline) and switch growth', async () => {
    await page.locator('#ahead-card').scrollIntoViewIfNeeded();
    await page.focus('#year');
    for (let k = 0; k < 3; k++) await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => window.__residents.S.yearIdx === 3);
    assert.equal(await page.evaluate(() => window.__residents.S.growth), 'moderate');   // moderate is the default
    await page.check('input[name="growth"][value="high"]');
    await page.waitForFunction(() => window.__residents.S.growth === 'high');
    await page.waitForFunction(() => [...document.querySelectorAll('.ahead-trip .chart')].every((c) => c.querySelector('svg')), null, { timeout: 60000 });
    assert.match(await page.textContent('#year-note'), /simulated/);
    await page.check('input[name="growth"][value="moderate"]');
    await page.waitForFunction(() => window.__residents.S.growth === 'moderate');
    await page.waitForFunction(() => [...document.querySelectorAll('.ahead-trip .chart')].every((c) => c.querySelector('svg')), null, { timeout: 60000 });
    await shot(page, '05-looking-ahead');
    await page.focus('#year');
    for (let k = 0; k < 3; k++) await page.keyboard.press('ArrowLeft');
    await page.check('input[name="growth"][value="moderate"]');
  });

  await step('heat map: today, option and change', async () => {
    await page.locator('#heat-card').scrollIntoViewIfNeeded();
    await page.check('input[name="heat-show"][value="today"]');
    await page.click('#heat-go');
    await page.waitForFunction(() => /Driving time to/.test(document.querySelector('#map-caption').textContent));
    await idle(page);
    const n = await page.evaluate(() => window.__residents.R.view.state.edges.filter((v) => v !== null).length);
    assert.ok(n > 100, `${n} edges coloured`);
    await shot(page, '06-heat-today');
    await page.check('input[name="heat-show"][value="diff"]');
    await page.waitForFunction(() => /change with/.test(document.querySelector('#map-caption').textContent));
    await idle(page);
    assert.match(await page.textContent('#map-legend'), /about the same/);
    await shot(page, '07-heat-change');
  });

  await step('trips persist across a reload', async () => {
    await page.reload();
    await ready(page);
    assert.equal(await page.locator('.trip').count(), 3);
    await settled(page);
  });

  await step('works when the browser blocks storage', async () => {
    const blocked = await newPage({ viewport: { width: 1000, height: 800 } }, () => {
      Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('blocked', 'SecurityError'); } });
    });
    await blocked.goto(url);
    await ready(blocked);
    assert.match(await blocked.textContent('#storage-state'), /not letting the page save/);
    await blocked.fill('#from', poiB);
    await blocked.fill('#to', poiA);
    await blocked.click('#add-trip button[type="submit"]');
    await blocked.waitForFunction(() => document.querySelectorAll('.trip').length === 1);
    await blocked.context().close();
  });

  await step('phone layout', async () => {
    const phone = await newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await phone.goto(url);
    await ready(phone);
    const w = await phone.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(w <= 390, `horizontal scroll ${w}`);
    await phone.locator('#from').tap();
    await phone.locator('#from').pressSequentially('5 adelaide rd mccracken', { delay: 5 });
    await phone.locator('#from-list li[role="option"]').first().waitFor({ state: 'visible' });
    await phone.locator('#from-list li[role="option"]').first().tap();
    assert.match(await phone.inputValue('#from'), /Adelaide Road, McCracken/);
    assert.match(await phone.textContent('#from-note'), /Pin placed/);
    const w2 = await phone.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(w2 <= 390, `horizontal scroll ${w2} with the suggestion list`);
    await phone.locator('#from').scrollIntoViewIfNeeded();
    await shot(phone, '08-phone');
    await phone.context().close();
  });

  await step('no console or page errors', async () => { assert.deepEqual(errors, []); });
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  console.log(`[${tag}]\n` + results.join('\n'));
  if (errors.length) console.log('errors:\n' + errors.join('\n'));
  await browser.close();
  server.close();
}
