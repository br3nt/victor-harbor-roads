// Shared helpers: maths, seeded RNG, spatial hash, colour, pixel font.
'use strict';
window.VH = window.VH || {};
(function (VH) {
  const U = VH.U = {};
  U.TAU = Math.PI * 2;
  U.clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  U.lerp = (a, b, t) => a + (b - a) * t;
  U.smooth = t => t * t * (3 - 2 * t);
  U.dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
  U.angDiff = (a, b) => { let d = (b - a) % U.TAU; if (d > Math.PI) d -= U.TAU; if (d < -Math.PI) d += U.TAU; return d; };
  U.rand = (a = 0, b = 1) => a + Math.random() * (b - a);
  U.pick = arr => arr[(Math.random() * arr.length) | 0];
  U.chance = p => Math.random() < p;
  // deterministic hash noise for textures
  U.hash = (x, y, s = 0) => { let h = (x * 374761393 + y * 668265263 + s * 2246822519) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  // smooth value noise in [0,1]
  U.vnoise = (x, y, s = 0) => {
    const xi = Math.floor(x), yi = Math.floor(y), tx = x - xi, ty = y - yi; const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const a = U.hash(xi, yi, s), b = U.hash(xi + 1, yi, s), c = U.hash(xi, yi + 1, s), d = U.hash(xi + 1, yi + 1, s);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
  U.seeded = seed => { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; };
  U.hex = h => h.length === 4 ? [parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16), parseInt(h[3] + h[3], 16)] : [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  U.rgb = (r, g, b, a = 1) => a >= 1 ? `rgb(${r | 0},${g | 0},${b | 0})` : `rgba(${r | 0},${g | 0},${b | 0},${a})`;
  U.mix = (c1, c2, t) => [U.lerp(c1[0], c2[0], t), U.lerp(c1[1], c2[1], t), U.lerp(c1[2], c2[2], t)];
  U.shade = (hex, f) => { const c = U.hex(hex); return U.rgb(U.clamp(c[0] * f, 0, 255), U.clamp(c[1] * f, 0, 255), U.clamp(c[2] * f, 0, 255)); };
  U.canvas = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); const x = c.getContext('2d'); x.imageSmoothingEnabled = false; return [c, x]; };
  U.segPointDist = (px, py, ax, ay, bx, by) => {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1e-9;
    const t = U.clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1);
    const qx = ax + dx * t, qy = ay + dy * t; return [Math.hypot(px - qx, py - qy), qx, qy, t];
  };
  U.pointInPoly = (x, y, p) => { let inside = false; for (let a = 0, b = p.length - 2; a < p.length; b = a, a += 2) { if ((p[a + 1] > y) !== (p[b + 1] > y) && x < (p[b] - p[a]) * (y - p[a + 1]) / (p[b + 1] - p[a + 1]) + p[a]) inside = !inside; } return inside; };
  U.polyLen = p => { let l = 0; for (let i = 2; i < p.length; i += 2) l += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]); return l; };
  // point + tangent at distance s along a polyline with cumulative lengths cum[]
  U.alongPoly = (p, cum, s) => {
    const n = cum.length; if (s <= 0) return [p[0], p[1], Math.atan2(p[3] - p[1], p[2] - p[0])];
    if (s >= cum[n - 1]) return [p[2 * n - 2], p[2 * n - 1], Math.atan2(p[2 * n - 1] - p[2 * n - 3], p[2 * n - 2] - p[2 * n - 4])];
    let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
    const t = (s - cum[lo]) / (cum[hi] - cum[lo] || 1);
    const ax = p[lo * 2], ay = p[lo * 2 + 1], bx = p[hi * 2], by = p[hi * 2 + 1];
    return [ax + (bx - ax) * t, ay + (by - ay) * t, Math.atan2(by - ay, bx - ax)];
  };
  U.cumLen = p => { const c = [0]; for (let i = 2; i < p.length; i += 2) c.push(c[c.length - 1] + Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1])); return c; };
  U.fmtMoney = v => '$' + Math.round(v);
  U.store = {
    get(k, d) { try { const v = localStorage.getItem('schoolies-siege:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('schoolies-siege:' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };

  // Uniform-grid spatial hash keyed on integer cells.
  class Grid {
    constructor(size) { this.size = size; this.map = new Map(); }
    key(cx, cy) { return (cx + 32768) * 65536 + (cy + 32768); }
    add(item, x, y) { const k = this.key(Math.floor(x / this.size), Math.floor(y / this.size)); let l = this.map.get(k); if (!l) this.map.set(k, l = []); l.push(item); return k; }
    addBox(item, x0, y0, x1, y1) {
      const s = this.size;
      for (let cx = Math.floor(x0 / s); cx <= Math.floor(x1 / s); cx++) for (let cy = Math.floor(y0 / s); cy <= Math.floor(y1 / s); cy++) {
        const k = this.key(cx, cy); let l = this.map.get(k); if (!l) this.map.set(k, l = []); l.push(item);
      }
    }
    remove(item, x, y) { const k = this.key(Math.floor(x / this.size), Math.floor(y / this.size)); const l = this.map.get(k); if (l) { const i = l.indexOf(item); if (i >= 0) l.splice(i, 1); } }
    query(x0, y0, x1, y1, fn) {
      const s = this.size;
      for (let cx = Math.floor(x0 / s); cx <= Math.floor(x1 / s); cx++) for (let cy = Math.floor(y0 / s); cy <= Math.floor(y1 / s); cy++) {
        const l = this.map.get(this.key(cx, cy)); if (l) for (let i = 0; i < l.length; i++) fn(l[i]);
      }
    }
  }
  U.Grid = Grid;

  // ---------- 5x7 pixel font (original glyphs) ----------
  const GLYPHS = {
    'A': '.###.|#...#|#...#|#####|#...#|#...#|#...#', 'B': '####.|#...#|#...#|####.|#...#|#...#|####.', 'C': '.###.|#...#|#....|#....|#....|#...#|.###.',
    'D': '####.|#...#|#...#|#...#|#...#|#...#|####.', 'E': '#####|#....|#....|####.|#....|#....|#####', 'F': '#####|#....|#....|####.|#....|#....|#....',
    'G': '.###.|#...#|#....|#.###|#...#|#...#|.####', 'H': '#...#|#...#|#...#|#####|#...#|#...#|#...#', 'I': '.###.|..#..|..#..|..#..|..#..|..#..|.###.',
    'J': '..###|...#.|...#.|...#.|...#.|#..#.|.##..', 'K': '#...#|#..#.|#.#..|##...|#.#..|#..#.|#...#', 'L': '#....|#....|#....|#....|#....|#....|#####',
    'M': '#...#|##.##|#.#.#|#.#.#|#...#|#...#|#...#', 'N': '#...#|#...#|##..#|#.#.#|#..##|#...#|#...#', 'O': '.###.|#...#|#...#|#...#|#...#|#...#|.###.',
    'P': '####.|#...#|#...#|####.|#....|#....|#....', 'Q': '.###.|#...#|#...#|#...#|#.#.#|#..#.|.##.#', 'R': '####.|#...#|#...#|####.|#.#..|#..#.|#...#',
    'S': '.####|#....|#....|.###.|....#|....#|####.', 'T': '#####|..#..|..#..|..#..|..#..|..#..|..#..', 'U': '#...#|#...#|#...#|#...#|#...#|#...#|.###.',
    'V': '#...#|#...#|#...#|#...#|#...#|.#.#.|..#..', 'W': '#...#|#...#|#...#|#.#.#|#.#.#|#.#.#|.#.#.', 'X': '#...#|#...#|.#.#.|..#..|.#.#.|#...#|#...#',
    'Y': '#...#|#...#|.#.#.|..#..|..#..|..#..|..#..', 'Z': '#####|....#|...#.|..#..|.#...|#....|#####',
    '0': '.###.|#...#|#..##|#.#.#|##..#|#...#|.###.', '1': '..#..|.##..|..#..|..#..|..#..|..#..|.###.', '2': '.###.|#...#|....#|...#.|..#..|.#...|#####',
    '3': '####.|....#|....#|.###.|....#|....#|####.', '4': '...#.|..##.|.#.#.|#..#.|#####|...#.|...#.', '5': '#####|#....|####.|....#|....#|#...#|.###.',
    '6': '..##.|.#...|#....|####.|#...#|#...#|.###.', '7': '#####|....#|...#.|..#..|.#...|.#...|.#...', '8': '.###.|#...#|#...#|.###.|#...#|#...#|.###.',
    '9': '.###.|#...#|#...#|.####|....#|...#.|.##..',
    ' ': '.....|.....|.....|.....|.....|.....|.....', '.': '.....|.....|.....|.....|.....|.##..|.##..', ',': '.....|.....|.....|.....|.##..|..#..|.#...',
    '!': '..#..|..#..|..#..|..#..|..#..|.....|..#..', '?': '.###.|#...#|....#|...#.|..#..|.....|..#..', ':': '.....|.##..|.##..|.....|.##..|.##..|.....',
    ';': '.....|.##..|.##..|.....|.##..|..#..|.#...', "'": '..#..|..#..|.#...|.....|.....|.....|.....', '"': '.#.#.|.#.#.|.....|.....|.....|.....|.....',
    '-': '.....|.....|.....|.###.|.....|.....|.....', '+': '.....|..#..|..#..|#####|..#..|..#..|.....', '/': '....#|...#.|...#.|..#..|.#...|.#...|#....',
    '(': '...#.|..#..|.#...|.#...|.#...|..#..|...#.', ')': '.#...|..#..|...#.|...#.|...#.|..#..|.#...', '$': '..#..|.####|#.#..|.###.|..#.#|####.|..#..',
    '%': '##..#|##..#|...#.|..#..|.#...|#..##|#..##', '&': '.##..|#..#.|#.#..|.#...|#.#.#|#..#.|.##.#', '#': '.#.#.|#####|.#.#.|.#.#.|.#.#.|#####|.#.#.',
    '=': '.....|.....|#####|.....|#####|.....|.....', '*': '.....|#.#.#|.###.|#####|.###.|#.#.#|.....', '<': '...#.|..#..|.#...|#....|.#...|..#..|...#.',
    '>': '.#...|..#..|...#.|....#|...#.|..#..|.#...', '_': '.....|.....|.....|.....|.....|.....|#####', '@': '.###.|#...#|#.###|#.#.#|#.###|#....|.###.',
    '~': '.....|.....|.#...|#.#.#|...#.|.....|.....',
    '^': '..#..|.###.|#.#.#|..#..|..#..|..#..|..#..', // up arrow
    '`': '..#..|..#..|..#..|..#..|#.#.#|.###.|..#..', // down arrow
    '[': '..#..|.#...|#####|.#...|..#..|.....|.....', // left arrow
    ']': '..#..|...#.|#####|...#.|..#..|.....|.....', // right arrow
    '{': '.....|.##.#|#..#.|#..#.|.##.#|.....|.....', // heart-ish: unused
    '|': '..#..|..#..|..#..|..#..|..#..|..#..|..#..',
    '·': '.....|.....|.....|.##..|.##..|.....|.....',
  };
  const fontCache = new Map();
  const glyphBits = {};
  for (const [ch, rows] of Object.entries(GLYPHS)) glyphBits[ch] = rows.split('|').map(r => [...r].map(c => c === '#'));
  // Pre-render one coloured atlas per (colour) lazily.
  function atlas(color) {
    let a = fontCache.get(color); if (a) return a;
    const chars = Object.keys(glyphBits);
    const [c, x] = U.canvas(chars.length * 6, 7);
    x.fillStyle = color;
    chars.forEach((ch, i) => glyphBits[ch].forEach((row, ry) => row.forEach((on, rx) => { if (on) x.fillRect(i * 6 + rx, ry, 1, 1); })));
    a = { c, idx: Object.fromEntries(chars.map((ch, i) => [ch, i])) }; fontCache.set(color, a); return a;
  }
  // draw text at integer pixel position; scale multiplies glyph size; returns width
  U.text = (ctx, str, x, y, opts = {}) => {
    const s = opts.scale || 1, color = opts.color || '#fff', align = opts.align || 'left';
    str = String(str).toUpperCase();
    const w = U.textWidth(str, s);
    let px = Math.round(align === 'center' ? x - w / 2 : align === 'right' ? x - w : x); const py = Math.round(y);
    if (opts.shadow !== false) {
      const sh = atlas(opts.shadow || 'rgba(10,8,25,0.85)');
      let sx = px; for (const ch of str) { const i = sh.idx[ch] ?? sh.idx['?']; ctx.drawImage(sh.c, i * 6, 0, 5, 7, sx + s, py + s, 5 * s, 7 * s); sx += 6 * s; }
    }
    const a = atlas(color);
    for (const ch of str) { const i = a.idx[ch] ?? a.idx['?']; ctx.drawImage(a.c, i * 6, 0, 5, 7, px, py, 5 * s, 7 * s); px += 6 * s; }
    return w;
  };
  U.textWidth = (str, s = 1) => String(str).length * 6 * s - s;
  U.wrap = (str, maxChars) => {
    const out = []; for (const para of String(str).split('\n')) {
      let line = ''; for (const word of para.split(' ')) { if ((line + ' ' + word).trim().length > maxChars) { if (line) out.push(line); line = word; } else line = (line ? line + ' ' : '') + word; }
      out.push(line);
    } return out;
  };
})(window.VH);
