// Minimal static file server for the viewer folder (follows the data/ symlink). Usage: node test/serve.mjs [port]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.gz': 'application/gzip', '.bin': 'application/octet-stream', '.png': 'image/png', '.svg': 'image/svg+xml' };

// mounts: { '/real/': '/abs/dir' } serves extra folders read-only (e.g. the git-ignored real results)
export function serve(port = 0, mounts = {}) {
  const server = createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p.endsWith('/')) p += 'index.html';
      let root = ROOT, rel = p;
      for (const [prefix, dir] of Object.entries(mounts)) {
        if (p.startsWith(prefix)) { root = normalize(dir.replace(/\/?$/, '/')); rel = p.slice(prefix.length); }
      }
      const file = normalize(join(root, rel));
      if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
      await stat(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(await readFile(file));
    } catch {
      res.writeHead(404); res.end('not found');
    }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const s = await serve(+(process.argv[2] || 4418), process.env.VIEWER_DATA_DIR ? { '/real/': process.env.VIEWER_DATA_DIR } : {});
  console.log(`viewer on http://127.0.0.1:${s.address().port}/`);
}
