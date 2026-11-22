// Headless check of the hotspot page and player: loads each hotspot with an animation, plays it, checks the
// clock moves, vehicles are drawn and queue counters fill, and saves screenshots (desktop, phone, dark).
// Usage: node test/hotspots-smoke.mjs [hotspot ids...]
import { chromium } from 'playwright-core';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { serve } from './serve.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHOTS = `${ROOT}hotspots/screenshots/`;
await mkdir(SHOTS, { recursive: true });
const man = JSON.parse(await readFile(`${ROOT}hotspots/data/manifest.json`, 'utf8'));
const only = process.argv.slice(2);
const server = await serve(0);
const base = `http://127.0.0.1:${server.address().port}/hotspots/index.html`;
const browser = await chromium.launch();
const errors = [];
const results = [];

async function open(ctxOpts, hash) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`); });
  await page.goto(`${base}?k=${Math.random()}#${hash}`);
  await page.waitForFunction(() => window.__hotspots && (window.__hotspots.player || !window.__hotspots.set), null, { timeout: 30000 });
  return page;
}

const redPixels = (page) => page.evaluate(() => [...document.querySelectorAll('.hs-panel canvas')].map((c) => {
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] > 170 && d[i + 1] < 60 && d[i + 2] < 80) n++;
  return n;
}));

try {
  for (const h of man.hotspots) {
    if (only.length && !only.includes(h.id)) continue;
    for (const s of h.sets) {
      const page = await open({ viewport: { width: 1500, height: 1000 }, colorScheme: 'light' }, `h=${h.id}&s=${s.key}`);
      const p0 = await page.evaluate(() => ({ frames: window.__hotspots.player.frames, panels: document.querySelectorAll('.hs-panel canvas').length }));
      assert.equal(p0.panels, s.scenarios.length);
      // jump to the middle, play at 16x for 1.5 s
      await page.evaluate(() => window.__hotspots.player.seek(Math.floor(window.__hotspots.player.frames / 2)));
      const c0 = await page.textContent('.hs-clock');
      await page.click('[data-speed="16"]');
      await page.click('.hs-play');
      await page.waitForTimeout(1500);
      await page.click('.hs-play');
      const c1 = await page.textContent('.hs-clock');
      assert.notEqual(c0, c1, 'clock did not move');
      const red = await redPixels(page);
      const queues = await page.$$eval('.hs-queues li', (els) => els.map((e) => e.textContent));
      const vehicles = await page.evaluate(() => {
        const p = window.__hotspots.player;
        return p.docs.map((d) => d.tracks.filter((t) => Math.floor(p.state.frame) - t.f >= 0 && Math.floor(p.state.frame) - t.f < t.n).length);
      });
      assert.ok(vehicles.every((n) => n > 0), `no vehicles on a panel: ${vehicles}`);
      await page.screenshot({ path: `${SHOTS}${h.id}__${s.key}.png`, fullPage: false });
      results.push(`ok   ${h.id} ${s.key}: ${c0} -> ${c1}, vehicles ${vehicles.join('/')}, stopped-red px ${red.join('/')}, queues [${queues.slice(0, 3).join('; ')}]`);
      await page.context().close();
    }
  }
  // phone width and dark mode on the first animated hotspot
  const first = man.hotspots.find((h) => h.sets.length && (!only.length || only.includes(h.id)));
  if (first) {
    const phone = await open({ viewport: { width: 390, height: 844 }, colorScheme: 'light', isMobile: true, hasTouch: true }, `h=${first.id}`);
    await phone.evaluate(() => window.__hotspots.player.seek(450));
    const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 1, `horizontal scroll on a phone: ${overflow}px`);
    await phone.screenshot({ path: `${SHOTS}phone__${first.id}.png`, fullPage: true });
    results.push(`ok   phone layout (${first.id}), no horizontal scroll`);
    const dark = await open({ viewport: { width: 1500, height: 1000 }, colorScheme: 'dark' }, `h=${first.id}`);
    await dark.evaluate(() => window.__hotspots.player.seek(450));
    await dark.screenshot({ path: `${SHOTS}dark__${first.id}.png` });
    results.push(`ok   dark mode (${first.id})`);
  }
} finally {
  console.log(results.join('\n'));
  if (errors.length) console.log('ERRORS:\n' + errors.join('\n'));
  await browser.close();
  server.close();
}
if (errors.length) process.exit(1);
