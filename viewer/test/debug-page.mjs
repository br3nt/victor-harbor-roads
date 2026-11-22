// Debug helper: load a viewer page headless and print console output and failed requests.
// Usage: node test/debug-page.mjs residents/index.html
import { chromium } from 'playwright-core';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { serve } from './serve.mjs';

const MAPLIBRE = fileURLToPath(new URL('../node_modules/maplibre-gl/dist/', import.meta.url));
const server = await serve(0, process.env.VIEWER_DATA_DIR ? { '/real/': process.env.VIEWER_DATA_DIR } : {});
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.route('https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/5.6.0/*', async (route) => {
  const name = new URL(route.request().url()).pathname.split('/').pop();
  route.fulfill({ body: await readFile(MAPLIBRE + name), contentType: name.endsWith('.css') ? 'text/css' : 'text/javascript' });
});
page.on('console', (m) => console.log(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => console.log(`[failed] ${r.url()}`));
page.on('response', (r) => { if (r.status() >= 400) console.log(`[${r.status()}] ${r.url()}`); });
await page.goto(`http://127.0.0.1:${server.address().port}/${process.argv[2] || 'residents/index.html'}`);
await page.waitForTimeout(4000);
console.log(await page.evaluate(() => JSON.stringify({ r: !!window.__residents, notice: document.querySelector('#notice')?.textContent })));
await browser.close();
server.close();
