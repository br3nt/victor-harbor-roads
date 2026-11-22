// Headless browser smoke test: loads the viewer with the committed sample data, switches views and
// comparison modes, scrubs the timeline, and saves screenshots to viewer/screenshots/.
// Usage: node test/smoke.mjs   (needs `npm install` for playwright-core + the local maplibre-gl copy)
import { chromium } from 'playwright-core';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { serve } from './serve.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SHOTS = fileURLToPath(new URL('../screenshots/', import.meta.url));
const MAPLIBRE = fileURLToPath(new URL('../node_modules/maplibre-gl/dist/', import.meta.url));

await mkdir(SHOTS, { recursive: true });
const server = await serve(0);
const url = `http://127.0.0.1:${server.address().port}/index.html`;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
const results = [];
const step = async (name, fn) => {
  const t0 = Date.now();
  try { await fn(); results.push(`ok   ${name} (${Date.now() - t0} ms)`); } catch (e) { results.push(`FAIL ${name}: ${e.message}`); throw e; }
};

async function newPage(opts) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  // serve the CDN copy of MapLibre locally so the test runs offline; block map tiles
  await page.route('https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/5.6.0/*', async (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    route.fulfill({ body: await readFile(MAPLIBRE + name), contentType: name.endsWith('.css') ? 'text/css' : 'text/javascript' });
  });
  await page.route('https://tile.openstreetmap.org/**', (r) => r.abort());
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 404/.test(m.text())) errors.push(`console: ${m.text()}`); });
  // the only expected 404 is data/index.json (no real runs exported yet -> the viewer falls back to data/sample/)
  page.on('response', (r) => { if (r.status() >= 400 && !r.url().endsWith('/data/index.json')) errors.push(`HTTP ${r.status()} ${r.url()}`); });
  return page;
}

const idle = (page, which = 'mapA') => page.evaluate((w) => new Promise((res) => {
  const v = window.__viewer.R[w];
  if (!v) return res();
  const m = v.map;
  const done = () => res();
  if (m.loaded() && !m.isMoving()) setTimeout(done, 150);
  m.once('idle', done);
  // the idle event may already have fired before this ran: also settle once the map reports itself loaded
  const poll = setInterval(() => { if (m.loaded() && !m.isMoving()) { clearInterval(poll); setTimeout(done, 150); } }, 50);
  setTimeout(() => { clearInterval(poll); done(); }, 4000);
}), which);

async function ready(page) {
  await page.waitForFunction(() => window.__viewer && window.__viewer.ready, null, { timeout: 20000 });
  await page.evaluate(() => window.__viewer.ready);
  await idle(page);
}


// a screen point where `layer` feature is rendered with no place marker nearby
const pointOn = (page, layer, which = 'mapA') => page.evaluate(([layer, which]) => {
  const { R } = window.__viewer;
  const v = R[which], m = v.map, net = v.net;
  const box = document.querySelector('#' + which).getBoundingClientRect();
  const vals = v.state[layer];
  for (let id = 0; id < vals.length; id++) {
    if (vals[id] === null) continue;
    const e = layer === 'lanes' ? net.lanes.edge[id] : id;
    const s = net.edges.shape[e];
    if (s.length < 4) continue;
    const p0 = m.project([s[0], s[1]]), p1 = m.project([s[2], s[3]]);
    if (Math.hypot(p1.x - p0.x, p1.y - p0.y) < 30) continue;
    for (const f of [0.3, 0.5, 0.7]) {
      const x = p0.x + f * (p1.x - p0.x), y = p0.y + f * (p1.y - p0.y);
      if (x < 20 || y < 20 || x > box.width - 60 || y > box.height - 40) continue;
      const near = m.queryRenderedFeatures([[x - 8, y - 8], [x + 8, y + 8]], { layers: ['pois'] });
      if (near.length) continue;
      for (const dx of [-6, -3, 0, 3, 6]) for (const dy of [-6, -3, 0, 3, 6]) {
        const hit = m.queryRenderedFeatures([x + dx, y + dy], { layers: [layer] });
        if (hit.length && hit[0].id === id) return { x: box.left + x + dx, y: box.top + y + dy, id };
      }
    }
  }
  return null;
}, [layer, which]);

const shot = (page, name) => page.screenshot({ path: `${SHOTS}${name}.png` });
const stateCount = (page, src, which = 'mapA') => page.evaluate(([s, w]) =>
  (window.__viewer.R[w].state[s] || []).filter((v) => v !== null).length, [src, which]);

try {
  const page = await newPage({ viewport: { width: 1360, height: 860 }, colorScheme: 'light' });
  await page.goto(url);

  await step('loads sample data and draws travel times', async () => {
    await ready(page);
    assert.match(await page.textContent('#status'), /Travel times computed in \d+ ms/);
    assert.ok((await stateCount(page, 'edges')) > 300);
    assert.match(await page.textContent('#banner'), /Sample data/);
    assert.match(await page.textContent('#legend'), /minutes/);
    await shot(page, '01-travel-time');
  });

  await step('zones shaded by median travel time', async () => {
    await page.check('#show-zones');
    await page.waitForFunction(() => (window.__viewer.R.mapA.state.zones || []).filter((v) => v !== null).length > 10);
    await idle(page);
    await shot(page, '01b-travel-time-zones');
    await page.uncheck('#show-zones');
    await page.waitForFunction(() => !window.__viewer.state.zones);
  });

  await step('click a road: route and minutes', async () => {
    const pt = await pointOn(page, 'edges');
    await page.mouse.click(pt.x, pt.y);
    await page.waitForFunction(() => window.__viewer.state.origin !== null, null, { timeout: 5000 });
    await idle(page);
    const det = await page.textContent('#details');
    assert.match(det, /Route to the target/);
    assert.match(det, /\d+(\.\d)? min/);
    await shot(page, '02-route');
  });

  await step('congestion view colours lanes', async () => {
    await page.click('label:has(input[value="congestion"])');
    await page.waitForFunction(() => window.__viewer.state.view === 'congestion');
    await idle(page);
    assert.ok((await stateCount(page, 'lanes')) > 100);
    assert.match(await page.textContent('#legend'), /% of the limit/);
    await shot(page, '03-congestion');
  });

  await step('scrub the timeline with the keyboard and jump to a bookmark', async () => {
    const before = await page.evaluate(() => window.__viewer.state.i);
    const frames0 = await page.evaluate(() => window.__viewer.frames);
    await page.focus('.tl-range');
    for (let k = 0; k < 8; k++) await page.keyboard.press('ArrowLeft');
    await page.waitForFunction((b) => window.__viewer.state.i === b - 8, before);
    await page.waitForFunction((f) => window.__viewer.frames > f, frames0, { timeout: 3000 });
    await idle(page);
    await shot(page, '04-timeline-scrubbed');
    const chip = page.locator('.tl-bookmarks .chip').first();
    const ci = +(await chip.getAttribute('data-i'));
    await chip.click();
    await page.waitForFunction((i) => window.__viewer.state.i === i, ci);
    assert.equal(await chip.getAttribute('aria-current'), 'true');
    assert.ok((await page.locator('.tl-marker').count()) >= 3);
  });

  await step('click a lane: lane details with sparkline', async () => {
    const pt = await page.evaluate(() => {
      const { R } = window.__viewer;
      const vals = R.mapA.state.lanes;
      const net = R.runA.net;
      let best = -1;
      for (let i = 0; i < vals.length; i++) if (vals[i] !== null && vals[i] < 0.6 && net.lanes.length[i] > 60) { best = i; break; }
      if (best < 0) best = vals.findIndex((v) => v !== null);
      const s = net.edges.shape[net.lanes.edge[best]];
      const k = (s.length / 2) >> 1;
      const a = [s[2 * k], s[2 * k + 1]], b = [s[2 * k - 2] ?? s[2 * k + 2], s[2 * k - 1] ?? s[2 * k + 3]];
      R.mapA.map.jumpTo({ center: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], zoom: 17 });
      return net.lanes.id[best];
    });
    await idle(page);
    const hit = await pointOn(page, 'lanes');
    assert.ok(hit, 'no lane rendered near the centre');
    await page.mouse.click(hit.x, hit.y);
    await page.waitForFunction(() => window.__viewer.state.selected !== null);
    const det = await page.textContent('#details');
    assert.match(det, /Lane details/);
    assert.match(det, /km\/h/);
    await shot(page, '05-lane-details');
    await page.evaluate(() => { const { R } = window.__viewer; const [w, s, e, n] = R.runA.net.bbox; R.mapA.map.fitBounds([[w, s], [e, n]], { duration: 0, padding: 20 }); });
  });

  await step('side by side (synced) comparison', async () => {
    await page.click('label:has(input[value="side"])');
    await page.waitForFunction(() => window.__viewer.state.cmp === 'side' && window.__viewer.R.runB);
    await idle(page); await idle(page, 'mapB');
    assert.ok((await stateCount(page, 'lanes', 'mapB')) > 100);
    const [ca, cb] = await page.evaluate(() => [window.__viewer.R.mapA.map.getCenter(), window.__viewer.R.mapB.map.getCenter()]);
    assert.ok(Math.abs(ca.lng - cb.lng) < 1e-6 && Math.abs(ca.lat - cb.lat) < 1e-6, 'maps not synced');
    assert.ok((await page.locator('.tl-legend').textContent()).includes('B:'));
    await shot(page, '06-side-by-side');
  });

  await step('swipe comparison with a draggable divider', async () => {
    await page.click('label:has(input[value="swipe"])');
    await page.waitForFunction(() => window.__viewer.state.cmp === 'swipe');
    await idle(page); await idle(page, 'mapB');
    const box = await page.locator('#swipe .grip').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x - 200, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();
    const sw = await page.evaluate(() => window.__viewer.state.swipe);
    assert.ok(sw < 0.45, `swipe ${sw}`);
    assert.match(await page.evaluate(() => document.querySelector('#mapB').style.clipPath), /inset/);
    await shot(page, '07-swipe');
  });

  await step('difference view (congestion and travel time)', async () => {
    await page.click('label:has(input[value="diff"])');
    await page.waitForFunction(() => window.__viewer.state.cmp === 'diff');
    await idle(page);
    // jump to the "largest difference" bookmark (diamond)
    const mk = page.locator('.tl-marker.compare').first();
    const mi = +(await mk.getAttribute('data-i'));
    await mk.click();
    await page.waitForFunction((i) => window.__viewer.state.i === i, mi);
    await idle(page);
    assert.match(await page.textContent('#legend'), /B − A/);
    const nonzero = await page.evaluate(() => window.__viewer.R.mapA.state.lanes.filter((v) => v !== null && Math.abs(v) > 0.05).length);
    assert.ok(nonzero > 5, `only ${nonzero} lanes differ`);
    const removed = await page.evaluate(() => window.__viewer.R.last.removed.features.length);
    assert.ok(removed > 0, 'variant removes Victoria Street lanes: expected removed features');
    // changed lanes stand out: emphasis per lane, and a "what changed" panel naming streets with a zoom button
    const em = await page.evaluate(() => { const v = window.__viewer.R.mapA; return { on: v.emph.lanes, faint: v.emphState.lanes.filter((e) => e === 0).length, strong: v.emphState.lanes.filter((e) => e > 0.2).length }; });
    assert.ok(em.on && em.faint > 0 && em.strong > 0, JSON.stringify(em));
    assert.match(await page.textContent('#diff-summary'), /What changed[\s\S]*of lanes change by less than/);
    await shot(page, '08-difference-congestion');
    await page.click('label:has(input[value="access"])');
    await page.waitForFunction(() => window.__viewer.state.view === 'access');
    await idle(page);
    assert.match(await page.textContent('#legend'), /slower in B/);
    assert.equal(await page.evaluate(() => window.__viewer.R.mapA.emph.edges), true);
    assert.match(await page.textContent('#diff-summary'), /road sections change by less than 15 seconds/);
    const zoom0 = await page.evaluate(() => window.__viewer.R.mapA.map.getZoom());
    const zoomBtn = page.locator('#diff-summary [data-box]').first();
    if (await zoomBtn.count()) {
      await zoomBtn.click();
      await page.waitForFunction((z) => Math.abs(window.__viewer.R.mapA.map.getZoom() - z) > 0.2, zoom0);
      await idle(page);
    }
    await shot(page, '09-difference-travel-time');
  });

  await step('base map: sea, buildings, landmark labels, and the 3D view with terrain', async () => {
    await page.click('label:has(input[value="off"])');
    await page.waitForFunction(() => window.__viewer.state.cmp === 'off');
    await idle(page);
    await page.evaluate(() => window.__viewer.R.mapA.map.jumpTo({ center: [138.617, -35.562], zoom: 14.3 }));
    await idle(page);
    const bm = await page.evaluate(() => {
      const m = window.__viewer.R.mapA.map;
      return { sea: m.queryRenderedFeatures({ layers: ['bm-sea'] }).length, buildings: m.queryRenderedFeatures({ layers: ['bm-buildings'] }).length,
        labels: [...document.querySelectorAll('#mapA .bm-label')].map((e) => e.textContent) };
    });
    assert.ok(bm.sea > 0 && bm.buildings > 50, JSON.stringify(bm).slice(0, 200));
    for (const n of ['Granite Island', 'Encounter Bay', 'The Causeway']) assert.ok(bm.labels.some((l) => l.startsWith(n)), `label ${n}: ${bm.labels}`);
    await page.click('#mapA .bm-3d-btn');
    await page.waitForFunction(() => window.__viewer.R.mapA.map.getPitch() > 45);
    await idle(page);
    const d3 = await page.evaluate(() => { const v = window.__viewer.R.mapA, m = v.map;
      return { terrain: !!m.getTerrain(), ext: m.getLayoutProperty('bm-buildings-3d', 'visibility'), elev: m.queryTerrainElevation([138.6038, -35.5914]), state: window.__viewer.state.d3 }; });
    assert.ok(d3.terrain && d3.ext === 'visible' && d3.state === true, JSON.stringify(d3));
    assert.ok(d3.elev > 40, `the Bluff should stand up in 3D: ${d3.elev}`);
    await shot(page, '09b-3d');
    await page.click('#mapA .bm-3d-btn');
    await page.waitForFunction(() => window.__viewer.R.mapA.map.getPitch() < 1 && !window.__viewer.R.mapA.map.getTerrain());
  });

  await step('dark mode', async () => {
    await page.selectOption('#theme', 'dark');
    await page.click('label:has(input[value="off"])');
    await page.click('label:has(input[value="congestion"])');
    await page.waitForFunction(() => window.__viewer.state.cmp === 'off' && window.__viewer.state.view === 'congestion');
    await idle(page);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
    await shot(page, '10-dark-congestion');
  });

  await step('URL hash restores the state', async () => {
    const hash = await page.evaluate(() => new Promise((r) => setTimeout(() => r(location.hash), 300)));
    assert.match(hash, /v=congestion/);
    assert.match(hash, /th=dark/);
  });

  await step('phone layout: controls collapse into a drawer', async () => {
    const phone = await newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: 'light' });
    await phone.goto(url);
    await ready(phone);
    assert.ok(await phone.isVisible('#toggle-panel'));
    const panelX = await phone.evaluate(() => document.querySelector('#panel').getBoundingClientRect().right);
    assert.ok(panelX <= 1, `panel visible at ${panelX}`);
    const scrollW = await phone.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(scrollW <= 390, `horizontal scroll ${scrollW}`);
    await shot(phone, '11-phone');
    await phone.click('#toggle-panel');
    await phone.waitForTimeout(300);
    await shot(phone, '12-phone-controls');
    await phone.context().close();
  });

  await step('no console or page errors', async () => {
    assert.deepEqual(errors, []);
  });
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  console.log(results.join('\n'));
  if (errors.length) console.log('errors:\n' + errors.join('\n'));
  await browser.close();
  server.close();
}
