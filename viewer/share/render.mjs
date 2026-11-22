// Render viewer/share/card.html to viewer/share/card.png (1200x630, the social-media preview image).
import { chromium } from '/Users/brent/node_modules/playwright/index.mjs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const dir = path.dirname(fileURLToPath(import.meta.url));
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
await p.goto(pathToFileURL(path.join(dir, 'card.html')).href);
await p.waitForTimeout(500);
await p.screenshot({ path: path.join(dir, 'card.png'), clip: { x: 0, y: 0, width: 1200, height: 630 } });
await b.close();
console.log('written card.png');
