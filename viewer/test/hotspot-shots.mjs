// Static before/after pictures per hotspot from the engineer viewer (real results, bundled base map):
// congestion ("vehicles queued", 15-minute average) for today's network, the council package and the
// hotspot's alternative at its peak quarter-hour, and the difference maps (council − today, alternative − today).
// Usage: node test/hotspot-shots.mjs   (needs viewer/data -> the real viewer export, and playwright-core)
// Writes viewer/hotspots/img/<hotspot>__<what>.png and viewer/hotspots/img/shots.json.
import { chromium } from 'playwright-core';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { serve } from './serve.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const IMG = `${ROOT}hotspots/img/`;
const MAPLIBRE = `${ROOT}node_modules/maplibre-gl/dist/`;
const manifest = JSON.parse(await readFile(`${ROOT}hotspots/data/shots-plan.json`, 'utf8'));
const resume = process.argv.includes('--resume');   // keep pictures already taken
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));   // optional hotspot ids
if (only.length) manifest.hotspots = manifest.hotspots.filter((h) => only.includes(h.id));
const index = JSON.parse(await readFile(`${ROOT}data/index.json`, 'utf8'));
const runIds = new Set(index.runs.map((r) => r.id));
await mkdir(IMG, { recursive: true });

const server = await serve(0);
const base = `http://127.0.0.1:${server.address().port}/index.html`;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'light', deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.route('https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/5.6.0/*', async (route) => {
  const name = new URL(route.request().url()).pathname.split('/').pop();
  route.fulfill({ body: await readFile(MAPLIBRE + name), contentType: name.endsWith('.css') ? 'text/css' : 'text/javascript' });
});
await page.route('https://tile.openstreetmap.org/**', (r) => r.abort());
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

const idle = () => page.evaluate(() => new Promise((res) => {
  const m = window.__viewer.R.mapA.map;
  let done = false;
  const fin = () => { if (!done) { done = true; setTimeout(res, 400); } };
  m.once('idle', fin);
  const poll = setInterval(() => { if (m.loaded() && !m.isMoving()) { clearInterval(poll); fin(); } }, 100);
  setTimeout(() => { clearInterval(poll); fin(); }, 8000);
}));

const runId = (sc, cond, year, growth) => {
  for (const s of ['mean', 's1']) {
    const id = `${sc}__${cond}__${year}-${growth}__${s}`;
    if (runIds.has(id)) return id;
  }
  return null;
};

const done = [];
for (const h of manifest.hotspots) {
  for (const shot of h.shots) {
    const a = runId(shot.a, h.condition, h.year, h.growth);
    const b = shot.b ? runId(shot.b, h.condition, h.year, h.growth) : null;
    if (!a || (shot.b && !b)) { done.push({ hotspot: h.id, name: shot.name, skipped: 'run not in the viewer export' }); continue; }
    const hash = new URLSearchParams({ v: 'congestion', m: 'waiting', cmp: b ? 'diff' : 'off', a, i: String(h.interval), bm: '1', lm: '1', p: '0' });
    if (b) hash.set('b', b);
    const file0 = `${h.id}__${shot.name}.png`;
    if (resume && existsSync(IMG + file0)) { done.push({ hotspot: h.id, name: shot.name, file: `img/${file0}`, a, b, interval: h.interval, time: h.time }); continue; }
    // a new query string forces a real reload; one retry if the page is slow to load under heavy CPU load
    try { await page.goto(`${base}?shot=${done.length}#${hash}`, { timeout: 90000 }); }
    catch { await page.goto(`${base}?shot=${done.length}r#${hash}`, { timeout: 120000 }); }
    await page.waitForFunction(() => window.__viewer && window.__viewer.ready, null, { timeout: 90000 });
    await page.evaluate(() => window.__viewer.ready);
    const st = await page.evaluate(() => ({ a: window.__viewer.state.a, b: window.__viewer.state.b, cmp: window.__viewer.state.cmp, i: window.__viewer.state.i }));
    if (st.a !== a || (b && (st.b !== b || st.cmp !== 'diff')) || st.i !== h.interval) throw new Error(`viewer state ${JSON.stringify(st)} != ${a} ${b} ${h.interval}`);
    await page.evaluate((bb) => window.__viewer.R.mapA.map.fitBounds(bb, { padding: 10, duration: 0 }), h.bounds);
    await idle();
    // fold the "What changed" panel (its text goes into shots.json) and label the streets and places
    const changed = await page.evaluate(() => {
      const el = document.querySelector('#diff-summary');
      const text = el ? el.innerText.replace(/\s+/g, ' ').trim() : '';
      document.querySelectorAll('#diff-summary details').forEach((d) => { d.open = false; });
      return text;
    });
    await page.evaluate((labels) => {
      const v = window.__viewer.R.mapA, box = document.querySelector('#mapA');
      box.querySelectorAll('.hs-shot-label').forEach((e) => e.remove());
      // places first, then streets; a label that would overlap one already placed moves up or down, else is left out
      const taken = [];
      for (const [text, lon, lat] of [...labels].reverse()) {
        const p = v.map.project([lon, lat]);
        const d = document.createElement('div');
        d.className = 'hs-shot-label';
        d.textContent = text;
        Object.assign(d.style, { position: 'absolute', left: `${p.x}px`, top: `${p.y}px`, transform: 'translate(-50%, -50%)',
          font: '600 13px system-ui, sans-serif', color: '#111', textShadow: '0 0 3px #fff, 0 0 3px #fff, 0 0 3px #fff',
          pointerEvents: 'none', zIndex: 5, whiteSpace: 'nowrap', visibility: 'hidden' });
        box.appendChild(d);
        const w = d.offsetWidth / 2 + 3, h = d.offsetHeight / 2;
        let placed = false;
        for (const dy of [0, -18, 18, -36, 36]) {
          const r = [p.x - w, p.y + dy - h, p.x + w, p.y + dy + h];
          if (taken.some((t) => r[0] < t[2] && r[2] > t[0] && r[1] < t[3] && r[3] > t[1])) continue;
          taken.push(r);
          d.style.top = `${p.y + dy}px`;
          d.style.visibility = 'visible';
          placed = true;
          break;
        }
        if (!placed) d.remove();
      }
    }, h.labels || []);
    const file = `${h.id}__${shot.name}.png`;
    await page.locator('#mapA').screenshot({ path: IMG + file });
    const legend = (await page.textContent('#legend').catch(() => '')).replace(/\s+/g, ' ').trim();
    done.push({ hotspot: h.id, name: shot.name, file: `img/${file}`, a, b, interval: h.interval, time: h.time, legend: legend.slice(0, 300), changed: changed.slice(0, 600) });
    console.log('ok', file);
  }
}
await writeFile(`${IMG}shots.json`, JSON.stringify({ shots: done, errors }, null, 1));
await browser.close();
server.close();
if (errors.length) console.log('page errors:', errors.slice(0, 5));
