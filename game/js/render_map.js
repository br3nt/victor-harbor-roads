// Map chunk renderer: bakes the OpenStreetMap layers into cached pixel-art tiles.
'use strict';
(function (VH) {
  const U = VH.U, W = VH.World;
  const S = 4;            // art pixels per metre
  const CH = 64;          // chunk size in metres
  const CPX = CH * S;     // chunk size in art pixels
  const R = VH.MapRender = { S, CH, CPX, cache: new Map(), queue: [], marks: new Map(), maxCache: 150, stats: { rendered: 0 } };

  // ---------- palette ----------
  const P = R.PAL = {
    land: ['#a8a466', '#9c985b', '#b4b073', '#8c8a52'], grass: ['#79a94b', '#6e9c43', '#86b556', '#679340'], lawn: ['#83b457', '#79aa4e', '#8cbd5f', '#73a24a'],
    crop: ['#d3bc5d', '#c4ab4c', '#dfca6c', '#b89f42'], scrub: ['#8e9a5d', '#7f8b50', '#9aa66a', '#6f7c45'], wood: ['#4f7a39', '#456d31', '#5a8743', '#3c602a'],
    sand: ['#ead6a0', '#e2cc92', '#f1dfae', '#dac288'], paved: ['#aaa69c', '#a19d93', '#b2aea4', '#97938a'], asphalt: ['#4a4d56', '#45484f', '#50535c', '#41444b'],
    dirt: ['#a98d62', '#9c8157', '#b5996d', '#8f764f'], rock: ['#8d877b', '#7f796e', '#9a9488', '#716b61'], water: ['#3d80a6', '#37779c', '#4489ae', '#336f93'],
    golf: ['#6cba4e', '#63ae47', '#75c457', '#5ca241'], pitch: ['#6db24c', '#64a645', '#76bb55', '#5e9c40'], court: ['#5e8f6c', '#578664', '#669874', '#517d5d'],
    wetland: ['#6f8e68', '#66855f', '#789870', '#5d7b57'], pier: ['#9b7752', '#8d6b48', '#a8835c', '#7f603f'], foot: ['#cdc6b6', '#c4bdac', '#d6cfbf', '#bbb4a3'],
    industrial: ['#9d9483', '#928a79', '#a89f8e', '#887f6f'], cemetery: ['#78a24f', '#6e9748', '#82ac58', '#668d42'],
    kerb: '#a3a097', line: '#e8e4d6', lineY: '#e6c34a', shadow: 'rgba(24,26,52,0.38)',
    roofs: ['#b65b3d', '#a24f36', '#7d8588', '#6c7477', '#4f6b57', '#d4c7a2', '#9a3c33', '#4a6788', '#55555e', '#c27b4f', '#8b6b5a', '#5f7f8c'],
    walls: ['#e7dcc0', '#d9cba8', '#c9a27e', '#a7654b', '#e3e0d8', '#bfb6a2'],
    flat: ['#b5b6b1', '#a9aaa5', '#c2c2bc', '#9d9e9a', '#cfcac0'],
  };
  const PAT = {};
  function makePattern(name, cols, fn) {
    const [c, x] = U.canvas(64, 64); const img = x.createImageData(64, 64); const d = img.data;
    const rgb = cols.map(U.hex); const rand = U.seeded(name.length * 7919 + name.charCodeAt(0));
    for (let y = 0; y < 64; y++) for (let xx = 0; xx < 64; xx++) {
      const r = rand(); let ci = r < 0.62 ? 0 : r < 0.8 ? 1 : r < 0.95 ? 2 : 3;
      if (fn) ci = fn(xx, y, ci, rand);
      const k = (y * 64 + xx) * 4; const col = rgb[ci] || rgb[0]; d[k] = col[0]; d[k + 1] = col[1]; d[k + 2] = col[2]; d[k + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    PAT[name] = { canvas: c, ctx: x };
  }
  R.initPatterns = function () {
    makePattern('land', P.land, (x, y, c, r) => (U.hash(x >> 2, y >> 2, 3) < 0.08 ? 3 : c));
    makePattern('grass', P.grass, (x, y, c, r) => (r() < 0.06 && y % 3 === 0 ? 2 : c));
    makePattern('lawn', P.lawn, (x, y, c) => ((x >> 3) % 2 === 0 && c === 0 ? 2 : c));
    makePattern('crop', P.crop, (x, y, c) => (y % 4 === 0 ? 3 : y % 4 === 1 ? 1 : c === 3 ? 0 : c));
    makePattern('scrub', P.scrub, (x, y, c) => (U.hash(x >> 1, y >> 1, 9) < 0.12 ? 3 : c));
    makePattern('wood', P.wood, (x, y, c) => (U.hash(x >> 1, y >> 1, 5) < 0.2 ? 3 : c));
    makePattern('sand', P.sand, (x, y, c, r) => (c === 3 && r() < 0.7 ? 0 : c));
    makePattern('paved', P.paved, (x, y, c) => (x % 8 === 0 || y % 8 === 0 ? 3 : c === 3 ? 0 : c));
    makePattern('asphalt', P.asphalt, (x, y, c) => c);
    makePattern('dirt', P.dirt, (x, y, c) => c);
    makePattern('rock', P.rock, (x, y, c) => (U.hash(x >> 2, y >> 1, 4) < 0.1 ? 3 : c));
    makePattern('water', P.water, (x, y, c) => ((y + (x >> 3)) % 7 === 0 && U.hash(x >> 2, y, 1) < 0.5 ? 2 : c === 3 ? 0 : c));
    makePattern('golf', P.golf, (x, y, c) => ((x >> 4) % 2 === 0 ? (c === 0 ? 2 : c) : c));
    makePattern('pitch', P.pitch, (x, y, c) => ((y >> 4) % 2 === 0 ? (c === 0 ? 2 : c) : c));
    makePattern('court', P.court, (x, y, c) => (c === 3 ? 0 : c));
    makePattern('wetland', P.wetland, (x, y, c) => (U.hash(x >> 2, y >> 2, 7) < 0.15 ? 3 : c));
    makePattern('pier', P.pier, (x, y, c) => (x % 6 === 0 ? 3 : c === 3 ? 1 : c));
    makePattern('foot', P.foot, (x, y, c) => (x % 6 === 0 || y % 6 === 0 ? 3 : c === 3 ? 0 : c));
    makePattern('industrial', P.industrial, (x, y, c) => c);
    makePattern('cemetery', P.cemetery, (x, y, c) => c);
    // headstones on the cemetery pattern (spooky but tidy)
    const cx = PAT.cemetery.ctx; for (let y = 4; y < 64; y += 10) for (let x = 3; x < 64; x += 8) { cx.fillStyle = '#c9c6bd'; cx.fillRect(x + ((y / 10) % 2) * 4, y, 2, 3); cx.fillStyle = '#5c6a4a'; cx.fillRect(x + ((y / 10) % 2) * 4, y + 3, 2, 1); }
  };
  const AREA_PAT = { residential: 'lawn', commercial: 'paved', industrial: 'industrial', campus: 'lawn', crop: 'crop', dirt: 'dirt', golf: 'golf', grass: 'grass', scrub: 'scrub',
    wood: 'wood', park: 'grass', cemetery: 'cemetery', pitch: 'pitch', court: 'court', fairway: 'golf', green: 'golf', wetland: 'wetland', rock: 'rock', sand: 'sand',
    paved: 'paved', water: 'water', pool: 'water', pier: 'pier' };
  function pat(ctx, name, ox, oy) {
    const p = ctx.createPattern(PAT[name].canvas, 'repeat');
    // pattern pixels = art pixels, aligned to world pixel grid
    p.setTransform(new DOMMatrix([1 / S, 0, 0, 1 / S, 0, 0]));
    return p;
  }

  // ---------- feature → chunk index ----------
  const idx = new Map();
  const ck = (cx, cy) => cx * 4096 + cy;
  const emptyEntry = () => ({ areas: [], roads: [], buildings: [], rails: [], barriers: [], waterways: [], trees: [], junctions: [], islands: [], splitters: [], minis: [], turning: [], xings: [], walls: [], labels: [], places: [] });
  function addIdx(kind, item, x0, y0, x1, y1) {
    for (let cx = Math.floor(x0 / CH); cx <= Math.floor(x1 / CH); cx++) for (let cy = Math.floor(y0 / CH); cy <= Math.floor(y1 / CH); cy++) {
      const k = ck(cx, cy); let e = idx.get(k); if (!e) idx.set(k, e = emptyEntry()); e[kind].push(item);
    }
  }
  const dmA = a => { const f = new Float32Array(a.length); for (let i = 0; i < a.length; i++) f[i] = a[i] / 10; return f; };
  const bbA = p => { let a = 1e9, b = 1e9, c = -1e9, d = -1e9; for (let i = 0; i < p.length; i += 2) { a = Math.min(a, p[i]); b = Math.min(b, p[i + 1]); c = Math.max(c, p[i]); d = Math.max(d, p[i + 1]); } return [a, b, c, d]; };
  // road furniture baked by tools/build_map.mjs (map.json `decor`, `walls`)
  R.decor = { junctions: [], islands: [], splitters: [], minis: [], turning: [], xings: [], labels: [], places: [] };
  function indexDecor() {
    const D = W.decor; if (!D) return; const RD = R.decor;
    for (const j of D.junctions || []) { const p = dmA(j[3]); const it = { x: j[0] / 10, y: j[1] / 10, r: j[2] / 10, p, gw: j[4].map(g => [g[0] / 10, g[1] / 10, g[2] / 10, g[3] / 10, g[4]]) }; RD.junctions.push(it); addIdx('junctions', it, ...pad(bbA(p), 1)); }
    for (const i of D.islands || []) { const p = dmA(i[2]); const it = { x: i[0] / 10, y: i[1] / 10, p, seed: RD.islands.length }; RD.islands.push(it); addIdx('islands', it, ...pad(bbA(p), 2)); }
    for (const sp of D.splitters || []) { const p = dmA(sp); const it = { p }; RD.splitters.push(it); addIdx('splitters', it, ...pad(bbA(p), 1)); }
    for (const m of D.minis || []) { const it = { x: m[0] / 10, y: m[1] / 10, r: m[2] / 10 }; RD.minis.push(it); addIdx('minis', it, it.x - it.r - 1, it.y - it.r - 1, it.x + it.r + 1, it.y + it.r + 1); }
    for (const t of D.turning || []) { const it = { x: t[0] / 10, y: t[1] / 10, r: t[2] / 10 }; RD.turning.push(it); addIdx('turning', it, it.x - it.r - 1, it.y - it.r - 1, it.x + it.r + 1, it.y + it.r + 1); }
    for (const x of D.xings || []) { const it = { x: x[0] / 10, y: x[1] / 10, a: x[2] / 1000, w: x[3] / 10, d: x[4] }; RD.xings.push(it); addIdx('xings', it, it.x - 6, it.y - 6, it.x + 6, it.y + 6); }
    for (const l of D.labels || []) {
      const it = { x: l[0] / 10, y: l[1] / 10, a: l[2] / 1000, text: W.names[l[3]] || '', tier: l[4] }; RD.labels.push(it); if (it.tier > 1) continue;
      const hw = ((it.text.length * 6 + 2) / S) / 2 + 0.5; addIdx('labels', it, it.x - hw, it.y - hw, it.x + hw, it.y + hw);
    }
    for (const l of D.places || []) { const it = { x: l[0] / 10, y: l[1] / 10, text: l[2], size: l[3] }; RD.places.push(it); const hw = (it.text.length * 6 * it.size / S) / 2 + 1, hh = 6 * it.size / S; addIdx('places', it, it.x - hw, it.y - hh, it.x + hw, it.y + hh); }
    for (const w of W.walls || []) addIdx('walls', w, w.bb[0] - 1, w.bb[1] - 1, w.bb[2] + 1, w.bb[3] + 1);
  }
  const pad = (bb, m) => [bb[0] - m, bb[1] - m, bb[2] + m, bb[3] + m];
  R.buildIndex = function () {
    W.areas.forEach((a, i) => { a.order = i; if (a.bb[2] - a.bb[0] < 8000) addIdx('areas', a, ...a.bb); else addIdx('areas', a, ...a.bb); });
    for (const r of W.roads) { const m = Math.max(r.w, (r.dk || 0) * 2) + 1.5; addIdx('roads', r, r.bb[0] - m, r.bb[1] - m, r.bb[2] + m, r.bb[3] + m); }
    for (const r of W.rails) addIdx('rails', r, r.bb[0] - 3, r.bb[1] - 3, r.bb[2] + 3, r.bb[3] + 3);
    for (const b of W.barriers) addIdx('barriers', b, ...b.bb);
    for (const w of W.waterways) addIdx('waterways', w, w.bb[0] - w.w, w.bb[1] - w.w, w.bb[2] + w.w, w.bb[3] + w.w);
    for (const b of W.buildings) { const h = b.h; addIdx('buildings', b, b.bb[0] - 1, b.bb[1] - h * 0.4 - 1, b.bb[2] + h * 0.6 + 1, b.bb[3] + h * 0.45 + 1); }
    const pr = W.propsRaw;
    for (let i = 0; i < pr.length; i++) {
      const k = pr[i][0]; if (k !== 8 && k !== 9) continue;
      const x = pr[i][1] / 10, y = pr[i][2] / 10; const near = W.seaDist(x, y) < 140 && y < 3600 && x > 3800;
      const t = { x, y, k, r: k === 8 ? 2.2 + U.hash(i, 1) * 1.6 : 0.9 + U.hash(i, 2) * 0.6, pine: k === 8 && near && U.hash(i, 3) < 0.7, seed: i };
      addIdx('trees', t, x - t.r - 2, y - t.r - 2, x + t.r + 3, y + t.r + 3);
    }
    indexDecor();
  };

  // ---------- drawing helpers ----------
  function poly(ctx, p, dx = 0, dy = 0) { ctx.beginPath(); ctx.moveTo(p[0] + dx, p[1] + dy); for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i] + dx, p[i + 1] + dy); ctx.closePath(); }
  function line(ctx, p) { ctx.beginPath(); ctx.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]); }
  const isClosed = p => p.length > 6 && Math.abs(p[0] - p[p.length - 2]) < 0.05 && Math.abs(p[1] - p[p.length - 1]) < 0.05;

  function drawSea(ctx, ox, oy) {
    // skip if no sea/shore in this chunk (sample raster)
    let minD = 999; const step = W.cell;
    for (let y = oy - 4; y <= oy + CH + 4; y += step) for (let x = ox - 4; x <= ox + CH + 4; x += step) { const k = W.cellIdx(x, y); const v = k < 0 ? 0 : W.seaD[k] - 128; if (v < minD) minD = v; }
    if (minD > 3) return;
    const img = ctx.createImageData(CPX, CPX); const d = img.data;
    const deep = U.hex('#1c4675'), mid = U.hex('#245d8c'), shal = U.hex('#2f84a6'), turq = U.hex('#46a9b4'), foam = U.hex('#d9efe8'), wet = U.hex('#000000');
    for (let py = 0; py < CPX; py++) for (let px = 0; px < CPX; px++) {
      const wx = ox + (px + 0.5) / S, wy = oy + (py + 0.5) / S; const sd = W.seaDist(wx, wy);
      const k = (py * CPX + px) * 4;
      if (sd > 0) {
        if (sd < 2.2) { d[k] = 40; d[k + 1] = 30; d[k + 2] = 20; d[k + 3] = Math.round(70 * (1 - sd / 2.2)); } // wet edge darkening
        continue;
      }
      const n = U.hash(px + ox * S, py + oy * S, 11);
      const lowN = U.vnoise(wx / 23, wy / 23, 4) * 0.65 + U.vnoise(wx / 7, wy / 7, 5) * 0.35;
      const depth = -sd * (0.75 + lowN * 0.6) + (n - 0.5) * 1.6 + (lowN - 0.5) * 6 * Math.min(1, -sd / 8);
      let c;
      if (depth < 1.4) c = foam;
      else if (depth < 6) c = turq;
      else if (depth < 15) c = shal;
      else if (depth < 34) c = mid;
      else c = deep;
      // scattered wavelets (little crescents)
      let f = 1;
      const gx = Math.floor(wx / 7), gy = Math.floor(wy / 3.5), h = U.hash(gx, gy, 21);
      if (h < 0.32 && depth > 3) {
        const u = (wx - (gx + 0.2 + h * 1.8) * 7) / 2.2, v = wy - (gy + 0.5) * 3.5 + 0.45 * u * u;
        if (Math.abs(u) < 1 && v > -0.13 && v < 0.12) f = 1.18;
        else if (Math.abs(u) < 1 && v >= 0.12 && v < 0.3) f = 0.92;
      }
      if (depth > 1.4 && depth < 2.8 && n > 0.55) c = foam;
      d[k] = c[0] * f; d[k + 1] = c[1] * f; d[k + 2] = c[2] * f; d[k + 3] = 255;
    }
    const [tc, tx] = U.canvas(CPX, CPX); tx.putImageData(img, 0, 0);
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(tc, 0, 0); ctx.restore();
  }

  // scratch layer for markings and rail ballast, so junctions and level crossings can be cut out of them
  let scratch = null;
  function scratchCtx(ox, oy) {
    if (!scratch) { scratch = U.canvas(CPX, CPX); scratch[1].imageSmoothingEnabled = false; }
    const x = scratch[1]; x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = 'source-over'; x.clearRect(0, 0, CPX, CPX); x.setTransform(S, 0, 0, S, -ox * S, -oy * S); return x;
  }
  function blitScratch(ctx) { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(scratch[0], 0, 0); ctx.restore(); }
  const circle = (ctx, x, y, r) => { ctx.beginPath(); ctx.arc(x, y, r, 0, U.TAU); };
  // shrink a roughly round polygon toward its centre by d metres
  function inset(p, cx, cy, d) { const o = new Float32Array(p.length); for (let i = 0; i < p.length; i += 2) { const dx = p[i] - cx, dy = p[i + 1] - cy, L = Math.hypot(dx, dy) || 1, k = Math.max(0, L - d) / L; o[i] = cx + dx * k; o[i + 1] = cy + dy * k; } return o; }
  const MAJOR = ['primary', 'secondary', 'trunk'];

  function drawRoads(ctx, roads, ox, oy, e) {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const D = e || { junctions: [], islands: [], splitters: [], minis: [], turning: [] };
    // footways and paths
    for (const r of roads) {
      if (r.d) continue;
      if (r.c === 'pier') continue;
      ctx.strokeStyle = r.c === 'path' || r.c === 'bridleway' ? '#c8b48c' : pat(ctx, 'foot'); ctx.lineWidth = r.w; line(ctx, r.p); ctx.stroke();
    }
    // kerbs
    for (const r of roads) { if (!r.d || r.c === 'track') continue; ctx.strokeStyle = P.kerb; ctx.lineWidth = r.w + 0.7; line(ctx, r.p); ctx.stroke(); }
    ctx.fillStyle = P.kerb; ctx.strokeStyle = P.kerb; ctx.lineWidth = 0.7;
    for (const j of D.junctions) { poly(ctx, j.p); ctx.fill(); ctx.stroke(); }
    for (const t of D.turning) { circle(ctx, t.x, t.y, t.r + 0.35); ctx.fill(); }
    // tracks
    for (const r of roads) { if (!r.d || r.c !== 'track') continue; ctx.strokeStyle = pat(ctx, 'dirt'); ctx.lineWidth = r.w; line(ctx, r.p); ctx.stroke(); }
    // asphalt: roads, then the junction polygons and cul-de-sac bulbs that join them
    const asp = pat(ctx, 'asphalt');
    for (const r of roads) { if (!r.d || r.c === 'track') continue; ctx.strokeStyle = r.sf && /unpaved|gravel|dirt|compacted/.test(r.sf) ? pat(ctx, 'dirt') : asp; ctx.lineWidth = r.w; line(ctx, r.p); ctx.stroke(); }
    ctx.fillStyle = asp;
    for (const j of D.junctions) { poly(ctx, j.p); ctx.fill(); }
    for (const t of D.turning) { circle(ctx, t.x, t.y, t.r); ctx.fill(); }
    // splitter islands between the two carriageways of a divided road at a roundabout: grass inside the polygon between
    // the centrelines, then the bounding roads' kerbs and asphalt drawn again inside it (the junction fillets are not),
    // which leaves a kerbed island
    for (const sp of D.splitters) {
      ctx.save(); poly(ctx, sp.p); ctx.clip(); ctx.fillStyle = pat(ctx, 'grass'); ctx.fill();
      ctx.strokeStyle = P.kerb; for (const r of roads) { if (!r.d || r.c === 'track') continue; ctx.lineWidth = r.w + 0.7; line(ctx, r.p); ctx.stroke(); }
      ctx.strokeStyle = asp; for (const r of roads) { if (!r.d || r.c === 'track') continue; ctx.lineWidth = r.w; line(ctx, r.p); ctx.stroke(); }
      ctx.restore();
    }
    // roundabout islands: a raised kerb, a paved truck apron, grass and a few shrubs (a tree on the big ones)
    for (const is of D.islands) {
      ctx.fillStyle = '#cfc9ba'; poly(ctx, is.p); ctx.fill();
      ctx.fillStyle = 'rgba(40,40,60,0.35)'; poly(ctx, inset(is.p, is.x, is.y, 0.3)); ctx.fill();
      ctx.fillStyle = pat(ctx, 'paved'); poly(ctx, inset(is.p, is.x, is.y, 0.4)); ctx.fill();
      const g = inset(is.p, is.x, is.y, 1.3); ctx.fillStyle = '#d9d3c4'; poly(ctx, inset(is.p, is.x, is.y, 1.15)); ctx.fill();
      ctx.fillStyle = pat(ctx, 'grass'); poly(ctx, g); ctx.fill();
      let rad = 0; for (let i = 0; i < g.length; i += 2) rad += Math.hypot(g[i] - is.x, g[i + 1] - is.y); rad /= g.length / 2;
      const rnd = U.seeded(is.seed * 31 + 7); const n = Math.min(14, Math.floor(rad * 1.6));
      for (let i = 0; i < n; i++) { const a = rnd() * U.TAU, d = rad * (0.45 + rnd() * 0.4), rr = 0.5 + rnd() * 0.5; ctx.fillStyle = i % 3 ? '#4f7f39' : '#6b9a48'; circle(ctx, is.x + Math.cos(a) * d, is.y + Math.sin(a) * d, rr); ctx.fill(); ctx.fillStyle = '#8fbf62'; circle(ctx, is.x + Math.cos(a) * d - rr * 0.3, is.y + Math.sin(a) * d - rr * 0.3, rr * 0.4); ctx.fill(); }
      if (rad > 3.5) { ctx.fillStyle = 'rgba(24,30,52,0.3)'; circle(ctx, is.x + 1, is.y + 0.8, Math.min(2.6, rad * 0.4)); ctx.fill(); for (const [c, k, o] of [['#3f6631', 1, 0], ['#4d7a3a', 0.72, 0.25], ['#6a9550', 0.42, 0.45]]) { ctx.fillStyle = c; circle(ctx, is.x - o, is.y - o, Math.min(2.6, rad * 0.4) * k); ctx.fill(); } }
    }
    // mini-roundabouts (and rings too tight for a planted island): a white domed disc
    for (const m of D.minis) { ctx.fillStyle = '#e8e4d6'; circle(ctx, m.x, m.y, m.r); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,0.6)'; circle(ctx, m.x - m.r * 0.25, m.y - m.r * 0.25, m.r * 0.45); ctx.fill(); ctx.strokeStyle = 'rgba(40,40,50,0.4)'; ctx.lineWidth = 0.15; circle(ctx, m.x, m.y, m.r); ctx.stroke(); }
    // markings, painted on a scratch layer and cut back to the edge of each junction
    const mk = scratchCtx(ox, oy); let any = false;
    mk.lineCap = 'butt'; mk.lineJoin = 'round';
    for (const r of roads) {
      if (!r.d || r.c === 'track' || r.c === 'service' || r.rb) continue;
      if (r.w >= 6.5 && r.ow === 0) {
        mk.strokeStyle = P.line; mk.lineWidth = 0.16; mk.setLineDash(MAJOR.includes(r.c) ? [3, 6] : [2, 7]); mk.lineDashOffset = 0; line(mk, r.p); mk.stroke(); any = true;
      }
      if (MAJOR.includes(r.c) && r.w >= 8) {
        mk.setLineDash([]); mk.strokeStyle = 'rgba(232,228,214,0.65)'; mk.lineWidth = 0.14;
        offsetLine(mk, r.p, r.w / 2 - 0.5); mk.stroke(); offsetLine(mk, r.p, -r.w / 2 + 0.5); mk.stroke(); any = true;
      }
    }
    mk.setLineDash([]);
    if (any) {
      mk.globalCompositeOperation = 'destination-out'; mk.fillStyle = '#000';
      for (const j of D.junctions) { poly(mk, j.p); mk.fill(); }
      for (const t of D.turning) { circle(mk, t.x, t.y, t.r); mk.fill(); }
      blitScratch(ctx);
    }
    // give-way (dashed) and stop (solid) lines across the inbound lanes
    ctx.lineCap = 'butt';
    for (const j of D.junctions) for (const g of j.gw) {
      ctx.strokeStyle = '#ebe7d9';
      if (g[4] === 1) { ctx.setLineDash([]); ctx.lineWidth = 0.45; } else { ctx.setLineDash([0.6, 0.45]); ctx.lineWidth = 0.32; }
      ctx.beginPath(); ctx.moveTo(g[0], g[1]); ctx.lineTo(g[2], g[3]); ctx.stroke();
    }
    ctx.setLineDash([]); ctx.lineCap = 'round';
  }
  // road bridges: shadow on the water, a concrete deck with footpaths, kerbs, asphalt and the markings
  function drawBridges(ctx, roads, ox, oy) {
    if (!roads.length) return;
    ctx.lineJoin = 'round';
    for (const r of roads) {
      const dw = (r.dk || r.w / 2 + 1.6) * 2;
      ctx.lineCap = 'butt';
      ctx.strokeStyle = 'rgba(8,20,36,0.42)'; ctx.lineWidth = dw; ctx.save(); ctx.translate(1.1, 0.9); line(ctx, r.p); ctx.stroke(); ctx.restore();
      ctx.strokeStyle = '#7d786e'; ctx.lineWidth = dw + 0.5; line(ctx, r.p); ctx.stroke();
      ctx.strokeStyle = '#cdc7b8'; ctx.lineWidth = dw; line(ctx, r.p); ctx.stroke();
      ctx.strokeStyle = P.kerb; ctx.lineWidth = r.w + 0.5; line(ctx, r.p); ctx.stroke();
      ctx.strokeStyle = pat(ctx, 'asphalt'); ctx.lineWidth = r.w; line(ctx, r.p); ctx.stroke();
      // expansion joints across the deck
      const cum = U.cumLen(r.p), L = cum[cum.length - 1]; ctx.strokeStyle = 'rgba(30,30,36,0.5)'; ctx.lineWidth = 0.15;
      for (let s = 6; s < L - 3; s += 12) { const [x, y, a] = U.alongPoly(r.p, cum, s); const nx = -Math.sin(a) * dw / 2, ny = Math.cos(a) * dw / 2; ctx.beginPath(); ctx.moveTo(x - nx, y - ny); ctx.lineTo(x + nx, y + ny); ctx.stroke(); }
    }
    const mk = scratchCtx(ox, oy); let any = false; mk.lineCap = 'butt';
    for (const r of roads) {
      if (r.rb || r.c === 'service') continue;
      if (r.w >= 6.5 && r.ow === 0) { mk.strokeStyle = P.line; mk.lineWidth = 0.16; mk.setLineDash([3, 6]); line(mk, r.p); mk.stroke(); any = true; }
      if (r.w >= 8) { mk.setLineDash([]); mk.strokeStyle = 'rgba(232,228,214,0.65)'; mk.lineWidth = 0.14; offsetLine(mk, r.p, r.w / 2 - 0.5); mk.stroke(); offsetLine(mk, r.p, -r.w / 2 + 0.5); mk.stroke(); any = true; }
    }
    mk.setLineDash([]); if (any) blitScratch(ctx);
    ctx.lineCap = 'round';
  }
  // railings on bridge edges (these are solid: world.js puts them in the wall grid)
  function drawWalls(ctx, list) {
    ctx.lineCap = 'butt'; ctx.lineJoin = 'round';
    for (const w of list) {
      const timber = w.k === 'footrail';
      ctx.strokeStyle = 'rgba(6,10,24,0.5)'; ctx.lineWidth = 0.4; ctx.save(); ctx.translate(0.55, 0.5); line(ctx, w.p); ctx.stroke(); ctx.restore();
      ctx.strokeStyle = timber ? '#3a2716' : '#2f353c'; ctx.lineWidth = 0.5; line(ctx, w.p); ctx.stroke();
      ctx.strokeStyle = timber ? '#24180d' : '#1f2328'; ctx.lineWidth = 0.6; ctx.setLineDash([0.3, 1.2]); line(ctx, w.p); ctx.stroke(); ctx.setLineDash([]);
      ctx.strokeStyle = timber ? '#f0d9a8' : '#f1f4f6'; ctx.lineWidth = 0.2; line(ctx, w.p); ctx.stroke();
    }
    ctx.lineCap = 'round';
  }
  function offsetLine(ctx, p, off) {
    ctx.beginPath();
    for (let i = 0; i < p.length; i += 2) {
      const a = Math.max(0, i - 2), b = Math.min(p.length - 2, i + 2);
      const dx = p[b] - p[a], dy = p[b + 1] - p[a + 1], L = Math.hypot(dx, dy) || 1;
      const x = p[i] - dy / L * off, y = p[i + 1] + dx / L * off; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
  }
  function drawPiers(ctx, e) {
    for (const a of e.areas) if (a.k === 'pier') {
      ctx.fillStyle = 'rgba(10,30,50,0.35)'; poly(ctx, a.p, 0.6, 0.8); ctx.fill();
      ctx.fillStyle = pat(ctx, 'pier'); poly(ctx, a.p); ctx.fill(); ctx.strokeStyle = '#6d5236'; ctx.lineWidth = 0.25; ctx.stroke();
    }
    for (const r of e.roads) if (r.c === 'pier' || (r.br && !r.d)) {
      ctx.lineCap = 'butt';
      ctx.strokeStyle = 'rgba(10,30,50,0.35)'; ctx.lineWidth = r.w; ctx.save(); ctx.translate(0.6, 0.8); line(ctx, r.p); ctx.stroke(); ctx.restore();
      ctx.strokeStyle = '#6d5236'; ctx.lineWidth = r.w + 0.4; line(ctx, r.p); ctx.stroke();
      ctx.strokeStyle = pat(ctx, 'pier'); ctx.lineWidth = r.w; line(ctx, r.p); ctx.stroke();
      ctx.lineCap = 'round';
    }
  }
  // Rails: ballast and sleepers go on a scratch layer that is cut away where a road or path crosses (level crossings),
  // so the road surface carries straight over and only the steel rails (with a dark flangeway) show on it.
  function drawRails(ctx, rails, xings, ox, oy) {
    if (!rails.length) return;
    const b = scratchCtx(ox, oy); b.lineCap = 'butt'; b.lineJoin = 'round';
    for (const r of rails) {
      const tram = r.k === 'tram';
      if (!tram) { b.strokeStyle = '#8b8072'; b.lineWidth = 3.4; line(b, r.p); b.stroke(); }
      b.strokeStyle = tram ? '#6b5a44' : '#5a4430'; b.lineWidth = tram ? 1.9 : 2.6; b.setLineDash([0.3, 0.45]); line(b, r.p); b.stroke(); b.setLineDash([]);
    }
    if (xings && xings.length) {
      b.globalCompositeOperation = 'destination-out'; b.fillStyle = '#000';
      for (const x of xings) { b.save(); b.translate(x.x, x.y); b.rotate(x.a); b.fillRect(-3.5, -x.w / 2, 7, x.w); b.restore(); }
    }
    blitScratch(ctx);
    ctx.lineCap = 'butt'; ctx.lineJoin = 'round';
    for (const r of rails) {
      const g = r.k === 'tram' ? 0.55 : 0.8;
      if (xings && xings.length) {
        ctx.save(); ctx.beginPath(); for (const x of xings) { ctx.save(); ctx.translate(x.x, x.y); ctx.rotate(x.a); ctx.rect(-3.5, -x.w / 2, 7, x.w); ctx.restore(); } ctx.clip();
        ctx.strokeStyle = 'rgba(20,20,26,0.55)'; ctx.lineWidth = 0.18; offsetLine(ctx, r.p, g - 0.17); ctx.stroke(); offsetLine(ctx, r.p, -g + 0.17); ctx.stroke(); ctx.restore();
      }
      ctx.strokeStyle = '#c9ccd4'; ctx.lineWidth = 0.14;
      offsetLine(ctx, r.p, g); ctx.stroke(); offsetLine(ctx, r.p, -g); ctx.stroke();
    }
  }
  function drawBarriers(ctx, list) {
    for (const b of list) {
      if (b.k === 'cliff') { ctx.strokeStyle = 'rgba(70,60,50,0.55)'; ctx.lineWidth = 1.2; ctx.setLineDash([0.4, 0.5]); line(ctx, b.p); ctx.stroke(); ctx.setLineDash([]); continue; }
      ctx.strokeStyle = b.k === 'hedge' ? '#3f6a30' : b.k === 'wall' || b.k === 'retaining_wall' ? '#b8aa92' : '#8b6c49';
      ctx.lineWidth = b.k === 'hedge' ? 1.2 : 0.3; line(ctx, b.p); ctx.stroke();
    }
  }

  // principal axis (for roof ridges)
  function axis(p, cx, cy) {
    let sxx = 0, syy = 0, sxy = 0; for (let i = 0; i < p.length; i += 2) { const dx = p[i] - cx, dy = p[i + 1] - cy; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
    return 0.5 * Math.atan2(2 * sxy, sxx - syy);
  }
  function drawBuildings(ctx, list) {
    const sorted = list.slice().sort((a, b) => a.cy - b.cy);
    ctx.fillStyle = P.shadow;
    for (const b of sorted) { const h = b.h; poly(ctx, b.p, h * 0.55, h * 0.38); ctx.fill(); }
    for (const b of sorted) {
      const flat = b.k !== 'house' && b.k !== 'residential' && b.k !== 'detached' && b.k !== 'semidetached_house' && b.k !== 'bungalow' && b.k !== 'terrace' && b.k !== 'garage' && b.k !== 'shed';
      const big = Math.abs(b.bb[2] - b.bb[0]) * Math.abs(b.bb[3] - b.bb[1]) > 500;
      const flatRoof = flat && big;
      const off = Math.max(0.75, b.h * 0.3);
      const wallC = P.walls[b.seed % P.walls.length];
      // walls: sweep the footprint upward
      const steps = Math.ceil(off * S);
      for (let k = 0; k <= steps; k++) { ctx.fillStyle = U.shade(wallC, 0.62 + 0.38 * (k / steps)); poly(ctx, b.p, 0, -k / S); ctx.fill(); }
      // windows on south-facing walls
      const p = b.p, n = p.length;
      ctx.fillStyle = '#3b4a63';
      for (let i = 0; i < n; i += 2) {
        const j = (i + 2) % n; const ax = p[i], ay = p[i + 1], bx = p[j], by = p[j + 1]; const L = Math.hypot(bx - ax, by - ay);
        const nyy = (bx - ax) / (L || 1); // outward normal y for clockwise-in-screen polygons may be flipped; use both
        if (L < 2.5) continue;
        const facing = Math.abs(nyy) > 0.55;
        if (!facing) continue;
        const cnt = Math.floor(L / 2.4);
        for (let w = 0; w < cnt; w++) {
          const t = (w + 0.5) / cnt; const wx = ax + (bx - ax) * t, wy = ay + (by - ay) * t;
          ctx.fillRect(wx - 0.35, wy - off * 0.72, 0.7, off * 0.42);
        }
      }
      // roof
      const roofC = flatRoof ? P.flat[b.seed % P.flat.length] : P.roofs[(b.seed * 7) % P.roofs.length];
      ctx.fillStyle = roofC; poly(ctx, b.p, 0, -off); ctx.fill();
      ctx.save(); poly(ctx, b.p, 0, -off); ctx.clip();
      if (flatRoof) {
        ctx.strokeStyle = U.shade(roofC, 0.82); ctx.lineWidth = 0.9; poly(ctx, b.p, 0, -off); ctx.stroke();
        const r = U.seeded(b.seed + 1); const nAc = 1 + Math.floor(r() * 4);
        for (let i = 0; i < nAc; i++) {
          const x = U.lerp(b.bb[0], b.bb[2], 0.2 + r() * 0.6), y = U.lerp(b.bb[1], b.bb[3], 0.2 + r() * 0.6) - off;
          ctx.fillStyle = 'rgba(20,20,40,0.3)'; ctx.fillRect(x + 0.4, y + 0.3, 1.6, 1.2); ctx.fillStyle = '#d9dad5'; ctx.fillRect(x, y, 1.6, 1.2); ctx.fillStyle = '#8f918c'; ctx.fillRect(x + 0.4, y + 0.3, 0.8, 0.6);
        }
      } else {
        // hip/gable shading: darker half on the side away from the NW sun
        const a = axis(b.p, b.cx, b.cy); const ux = Math.cos(a), uy = Math.sin(a); let nx = -uy, ny = ux; if (nx + ny < 0) { nx = -nx; ny = -ny; }
        ctx.fillStyle = 'rgba(30,20,40,0.28)';
        ctx.beginPath(); const cx = b.cx, cy = b.cy - off, L = 60;
        ctx.moveTo(cx - ux * L, cy - uy * L); ctx.lineTo(cx + ux * L, cy + uy * L); ctx.lineTo(cx + ux * L + nx * L, cy + uy * L + ny * L); ctx.lineTo(cx - ux * L + nx * L, cy - uy * L + ny * L); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(255,240,220,0.35)'; ctx.lineWidth = 0.22; ctx.beginPath(); ctx.moveTo(cx - ux * L, cy - uy * L); ctx.lineTo(cx + ux * L, cy + uy * L); ctx.stroke();
        // corrugated iron texture on some roofs
        if (b.seed % 3 === 0) { ctx.strokeStyle = 'rgba(0,0,0,0.08)'; ctx.lineWidth = 0.12; for (let t = -20; t < 20; t += 0.7) { ctx.beginPath(); ctx.moveTo(cx + nx * t - ux * 30, cy + ny * t - uy * 30); ctx.lineTo(cx + nx * t + ux * 30, cy + ny * t + uy * 30); ctx.stroke(); } }
      }
      ctx.restore();
      ctx.strokeStyle = U.shade(roofC, 0.6); ctx.lineWidth = 0.22; poly(ctx, b.p, 0, -off); ctx.stroke();
    }
  }
  function drawTrees(ctx, trees) {
    const sorted = trees.slice().sort((a, b) => a.y - b.y);
    for (const t of sorted) { ctx.fillStyle = 'rgba(24,30,52,0.32)'; ctx.beginPath(); ctx.ellipse(t.x + t.r * 0.6, t.y + t.r * 0.45, t.r * 1.05, t.r * 0.8, 0, 0, U.TAU); ctx.fill(); }
    for (const t of sorted) {
      if (t.pine) { // Norfolk Island pine, the foreshore's tall silhouette
        const r = t.r * 1.05;
        for (let l = 0; l < 4; l++) {
          const rr = r * (1 - l * 0.22); ctx.fillStyle = ['#2c4d2c', '#355c33', '#3f6b3b', '#4b7b45'][l];
          ctx.beginPath(); for (let k = 0; k < 7; k++) { const a = k / 7 * U.TAU + l * 0.4; ctx.lineTo(t.x + Math.cos(a) * rr, t.y - l * 0.5 + Math.sin(a) * rr); ctx.lineTo(t.x + Math.cos(a + 0.45) * rr * 0.45, t.y - l * 0.5 + Math.sin(a + 0.45) * rr * 0.45); } ctx.closePath(); ctx.fill();
        }
        ctx.fillStyle = '#6b4a2f'; ctx.fillRect(t.x - 0.25, t.y - 2.1, 0.5, 0.5);
        continue;
      }
      const rand = U.seeded(t.seed * 13 + 1);
      const base = t.k === 9 ? ['#4d7a35', '#5c8b3f', '#6f9e4c'] : rand() < 0.5 ? ['#3f6631', '#4d7a3a', '#6a9550'] : ['#556f3c', '#66844a', '#83a05f']; // eucalypt grey-greens
      const blobs = t.k === 9 ? 3 : 5;
      for (let layer = 0; layer < 3; layer++) {
        ctx.fillStyle = base[layer];
        for (let i = 0; i < blobs; i++) {
          const a = rand() * U.TAU, d = rand() * t.r * 0.45; const rr = t.r * (0.55 - layer * 0.14) * (0.8 + rand() * 0.4);
          ctx.beginPath(); ctx.arc(t.x + Math.cos(a) * d - layer * 0.25 * t.r * 0.3, t.y + Math.sin(a) * d - layer * 0.3 * t.r * 0.3, rr, 0, U.TAU); ctx.fill();
        }
      }
      if (t.k === 9 && t.seed % 4 === 0) { ctx.fillStyle = '#e7d35a'; for (let i = 0; i < 3; i++) ctx.fillRect(t.x + (rand() - 0.5) * t.r, t.y + (rand() - 0.5) * t.r, 0.25, 0.25); } // wattle flowers
    }
  }

  R.renderChunk = function (cx, cy) {
    const ox = cx * CH, oy = cy * CH;
    const [c, ctx] = U.canvas(CPX, CPX);
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(S, 0, 0, S, -ox * S, -oy * S);
    const e = idx.get(ck(cx, cy)) || emptyEntry();
    ctx.fillStyle = pat(ctx, 'land'); ctx.fillRect(ox, oy, CH, CH);
    const areas = e.areas.slice().sort((a, b) => a.order - b.order);
    for (const a of areas) {
      if (a.k === 'pier') continue;
      ctx.fillStyle = pat(ctx, AREA_PAT[a.k] || 'grass'); poly(ctx, a.p); ctx.fill();
      if (a.k === 'water' || a.k === 'pool') { ctx.strokeStyle = a.k === 'pool' ? '#e8e6de' : 'rgba(60,80,50,0.6)'; ctx.lineWidth = a.k === 'pool' ? 0.4 : 0.7; ctx.stroke(); }
      if (a.k === 'pitch') { ctx.strokeStyle = 'rgba(240,240,230,0.55)'; ctx.lineWidth = 0.18; ctx.stroke(); }
      if (a.k === 'sand' || a.k === 'green') { ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 0.4; ctx.stroke(); }
    }
    for (const w of e.waterways) { ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#5f7a52'; ctx.lineWidth = w.w + 1.2; line(ctx, w.p); ctx.stroke(); ctx.strokeStyle = pat(ctx, 'water'); ctx.lineWidth = w.w; line(ctx, w.p); ctx.stroke(); }
    drawRoads(ctx, e.roads.filter(r => !r.br), ox, oy, e);
    drawSea(ctx, ox, oy);
    drawPiers(ctx, e);
    drawBridges(ctx, e.roads.filter(r => r.br && r.d), ox, oy);
    drawRails(ctx, e.rails, e.xings, ox, oy);
    drawWalls(ctx, e.walls);
    drawBarriers(ctx, e.barriers);
    // persistent tyre marks
    const mk = R.marks.get(ck(cx, cy)); if (mk) for (const m of mk) strokeMark(ctx, m);
    drawBuildings(ctx, e.buildings);
    drawTrees(ctx, e.trees);
    drawPlaces(ctx, e.places, ox, oy);
    if (R.debug) { ctx.lineWidth = 0.15; for (const j of e.junctions) { ctx.strokeStyle = '#ff2020'; poly(ctx, j.p); ctx.stroke(); } for (const r of e.roads) if (r.d) { ctx.strokeStyle = r.rb ? '#20ffff' : '#ffff20'; line(ctx, r.p); ctx.stroke(); } for (const sp of e.splitters) { ctx.strokeStyle = '#ff20ff'; poly(ctx, sp.p); ctx.stroke(); } }
    R.stats.rendered++;
    R.lastLabels = labelOverlays(e.labels, ox, oy);
    return c;
  };

  // ---------- names on the ground ----------
  // Street names are painted along the road in the 5x7 pixel font (one font pixel per art pixel), light with a dark
  // outline. They are baked once per chunk into small overlay canvases, one per tier, so the camera can drop the
  // local-street tier at wide zoom without re-rendering any chunk; drawing them costs one drawImage per chunk.
  const sprites = new Map();
  function textSprite(text, size, fg, outline) {
    const key = text + '|' + size + '|' + fg + '|' + outline; let sp = sprites.get(key); if (sp) return sp;
    const w = U.textWidth(text, size) + 2 * size, h = 7 * size + 2 * size; const [c, x] = U.canvas(w, h);
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [1, 1]]) U.text(x, text, size + dx * size, size + dy * size, { scale: size, color: outline, shadow: false });
    U.text(x, text, size, size, { scale: size, color: fg, shadow: false });
    sp = { c, w, h }; sprites.set(key, sp); if (sprites.size > 1500) sprites.delete(sprites.keys().next().value); return sp;
  }
  const LABEL_FG = ['#fbf7e9', '#efeadb'], LABEL_OUT = 'rgba(14,14,24,0.78)';
  function snapAngle(a) { for (const t of [0, Math.PI / 2, -Math.PI / 2]) if (Math.abs(a - t) < 0.07) return t; return a; }
  function labelOverlays(list, ox, oy) {
    if (!list || !list.length) return null;
    const out = [];
    for (const tier of [0, 1]) {
      const ls = list.filter(l => l.tier === tier); if (!ls.length) continue;
      const items = ls.map(l => { const sp = textSprite(l.text, 1, LABEL_FG[tier], LABEL_OUT); const px = (l.x - ox) * S, py = (l.y - oy) * S, R2 = Math.hypot(sp.w, sp.h) / 2 + 1; return { l, sp, px, py, R2 }; });
      let x0 = Math.max(0, Math.floor(Math.min(...items.map(i => i.px - i.R2)))), y0 = Math.max(0, Math.floor(Math.min(...items.map(i => i.py - i.R2))));
      const x1 = Math.min(CPX, Math.ceil(Math.max(...items.map(i => i.px + i.R2)))), y1 = Math.min(CPX, Math.ceil(Math.max(...items.map(i => i.py + i.R2))));
      if (x1 <= x0 || y1 <= y0) continue;
      const [c, x] = U.canvas(x1 - x0, y1 - y0); x.imageSmoothingEnabled = false;
      for (const it of items) {
        const a = snapAngle(it.l.a);
        if (a === 0) x.drawImage(it.sp.c, Math.round(it.px - x0 - it.sp.w / 2), Math.round(it.py - y0 - it.sp.h / 2));
        else { x.save(); x.translate(Math.round(it.px - x0), Math.round(it.py - y0)); x.rotate(a); x.drawImage(it.sp.c, -Math.round(it.sp.w / 2), -Math.round(it.sp.h / 2)); x.restore(); }
      }
      out.push({ tier, c, x: x0, y: y0 });
    }
    return out.length ? out : null;
  }
  // suburb and landmark names: big, faint letters on the ground
  function drawPlaces(ctx, list, ox, oy) {
    if (!list.length) return;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.imageSmoothingEnabled = false; ctx.globalAlpha = 0.42;
    for (const p of list) { const sp = textSprite(p.text, p.size, '#fff8e2', 'rgba(20,16,30,0.55)'); ctx.drawImage(sp.c, Math.round((p.x - ox) * S - sp.w / 2), Math.round((p.y - oy) * S - sp.h / 2)); }
    ctx.restore();
  }
  function strokeMark(ctx, m) { ctx.strokeStyle = m[5]; ctx.lineWidth = m[4]; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(m[0], m[1]); ctx.lineTo(m[2], m[3]); ctx.stroke(); }
  // Tyre marks / flattened crop: stored per chunk so they survive cache eviction.
  R.addMark = function (x0, y0, x1, y1, w, color) {
    const m = [x0, y0, x1, y1, w, color];
    for (let cx = Math.floor((Math.min(x0, x1) - w) / CH); cx <= Math.floor((Math.max(x0, x1) + w) / CH); cx++)
      for (let cy = Math.floor((Math.min(y0, y1) - w) / CH); cy <= Math.floor((Math.max(y0, y1) + w) / CH); cy++) {
        const k = ck(cx, cy); let l = R.marks.get(k); if (!l) R.marks.set(k, l = []); if (l.length < 6000) l.push(m);
        const ch = R.cache.get(k);
        if (ch && ch.canvas) { const x = ch.canvas.getContext('2d'); x.setTransform(S, 0, 0, S, -cx * CH * S, -cy * CH * S); strokeMark(x, m); }
      }
  };

  // ---------- cache + budgeted rendering ----------
  const makeEntry = (cx, cy) => { const canvas = R.renderChunk(cx, cy); return { canvas, labels: R.lastLabels, used: performance.now() }; };
  R.getEntry = function (cx, cy) {
    const k = ck(cx, cy); const e = R.cache.get(k);
    if (e) { e.used = performance.now(); return e; }
    if (!R.queue.some(q => q[0] === cx && q[1] === cy)) R.queue.push([cx, cy]);
    return null;
  };
  R.get = function (cx, cy) { const e = R.getEntry(cx, cy); return e ? e.canvas : null; };
  R.pump = function (camX, camY, budgetMs = 6) {
    const t0 = performance.now();
    R.queue.sort((a, b) => Math.hypot(a[0] * CH + CH / 2 - camX, a[1] * CH + CH / 2 - camY) - Math.hypot(b[0] * CH + CH / 2 - camX, b[1] * CH + CH / 2 - camY));
    while (R.queue.length && performance.now() - t0 < budgetMs) {
      const [cx, cy] = R.queue.shift(); const k = ck(cx, cy); if (R.cache.has(k)) continue;
      R.cache.set(k, makeEntry(cx, cy));
    }
    if (R.cache.size > R.maxCache) {
      const arr = [...R.cache.entries()].sort((a, b) => a[1].used - b[1].used);
      for (let i = 0; i < arr.length - R.maxCache; i++) R.cache.delete(arr[i][0]);
    }
  };
  // prefetch chunks around a point (synchronous, for loading screens)
  R.prefetch = function (x, y, radius) {
    for (let cx = Math.floor((x - radius) / CH); cx <= Math.floor((x + radius) / CH); cx++) for (let cy = Math.floor((y - radius) / CH); cy <= Math.floor((y + radius) / CH); cy++) {
      const k = ck(cx, cy); if (!R.cache.has(k)) R.cache.set(k, makeEntry(cx, cy));
    }
  };
  // draw map region into ctx; view in art px, cam in metres (top-left)
  // Street-name tiers by view width: local streets go when the view is wider than this (metres), main roads stay.
  R.minorLabelView = 270; R.labelView = 900;
  R.draw = function (ctx, left, top, vw, vh) {
    const x0 = Math.floor(left / CH), y0 = Math.floor(top / CH), x1 = Math.floor((left + vw / S) / CH), y1 = Math.floor((top + vh / S) / CH);
    const span = Math.max(vw, vh) / S, tierMax = span > R.labelView ? -1 : span > R.minorLabelView ? 0 : 1; const lab = [];
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
      const e = R.getEntry(cx, cy);
      const sx = Math.round((cx * CH - left) * S), sy = Math.round((cy * CH - top) * S);
      if (e) { ctx.drawImage(e.canvas, sx, sy); if (e.labels) for (const o of e.labels) if (o.tier <= tierMax) lab.push(o, sx, sy); }
      else { ctx.fillStyle = '#7c8a5a'; ctx.fillRect(sx, sy, CPX, CPX); }
    }
    for (let i = 0; i < lab.length; i += 3) ctx.drawImage(lab[i].c, lab[i + 1] + lab[i].x, lab[i + 2] + lab[i].y);
  };

  // ---------- overview map (minimap / full map) ----------
  R.buildOverview = function () {
    const sc = 4; // metres per pixel
    const w = Math.ceil(W.width / sc), h = Math.ceil(W.height / sc);
    const [c, x] = U.canvas(w, h); const img = x.createImageData(w, h); const d = img.data;
    const PALC = [];
    const GC = W.GC; const set = (g, hex) => PALC[g] = U.hex(hex);
    set(GC.SEA, '#1f4f7d'); set(GC.LAND, '#a99a63'); set(GC.GRASS, '#6e9c45'); set(GC.CROP, '#c4ad55'); set(GC.SCRUB, '#7f8b52'); set(GC.SAND, '#e3cf98'); set(GC.ROAD, '#e9e4d4');
    set(GC.BUILDING, '#c46a4f'); set(GC.WATER, '#3c7fa6'); set(GC.PAVED, '#b8b3a8'); set(GC.ROCK, '#888276'); set(GC.LAWN, '#7aa851'); set(GC.DIRT, '#a28660'); set(GC.WOOD, '#3f6a30');
    set(GC.WETLAND, '#66855f'); set(GC.GOLF, '#68b54b'); set(GC.PITCH, '#68b04b');
    for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) {
      const g = W.groundAt(xx * sc + 2, y * sc + 2); const col = PALC[g] || PALC[1]; const k = (y * w + xx) * 4;
      d[k] = col[0]; d[k + 1] = col[1]; d[k + 2] = col[2]; d[k + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    x.setTransform(1 / sc, 0, 0, 1 / sc, 0, 0); x.lineCap = 'round';
    for (const r of W.roads) if (r.d) { x.strokeStyle = ['primary', 'secondary', 'trunk'].includes(r.c) ? '#f3d77b' : '#efeadb'; x.lineWidth = Math.max(r.w, 6); line(x, r.p); x.stroke(); }
    for (const r of W.rails) { x.strokeStyle = '#5a4635'; x.lineWidth = 5; line(x, r.p); x.stroke(); }
    R.overview = c; R.overviewScale = sc;
  };
  // Street, suburb and landmark names on the full map (M). toM maps world metres to screen pixels, ppm is screen
  // pixels per metre, ts the UI text scale, clip = [x, y, w, h]. Labels are horizontal, culled where they would
  // overlap, main roads first; local streets appear once the map is zoomed in far enough to read them.
  R.drawMapLabels = function (ctx, toM, ppm, ts, clip) {
    const D = R.decor; if (!D) return; const boxes = [];
    const free = (x, y, w, h) => { if (x < clip[0] || y < clip[1] || x + w > clip[0] + clip[2] || y + h > clip[1] + clip[3]) return false; for (const b of boxes) if (x < b[0] + b[2] && x + w > b[0] && y < b[1] + b[3] && y + h > b[1]) return false; boxes.push([x - 3, y - 2, w + 6, h + 4]); return true; };
    // suburbs first (big, faint), then streets, then parks and reserves
    for (const p of D.places) {
      if (p.size < 3 || p.text === 'GRANITE ISLAND' || p.text === 'THE BLUFF' || (p.text === 'VICTOR HARBOR' && ppm < 0.3)) continue; // ui.js already labels Granite Island and the Bluff
      const sc = Math.max(1, ts) * (ppm > 0.6 ? 2 : 1); const [x, y] = toM(p.x, p.y); const w = U.textWidth(p.text, sc), h = 7 * sc;
      if (!free(x - w / 2, y - h / 2, w, h)) continue; ctx.globalAlpha = 0.7; U.text(ctx, p.text, x, y - h / 2, { scale: sc, color: '#ffe9a8', align: 'center' }); ctx.globalAlpha = 1;
    }
    const sc = Math.max(1, ts); const seen = new Map();
    for (const tier of [0, 1, 2]) {
      if (tier === 0 && ppm < 0.1) continue; if (tier > 0 && ppm < 0.2) continue;
      for (const l of D.labels) {
        if (l.tier !== tier) continue; const [x, y] = toM(l.x, l.y); const w = U.textWidth(l.text, sc), h = 7 * sc;
        const prev = seen.get(l.text); if (prev && prev.some(([px, py]) => Math.hypot(px - x, py - y) < 160 * sc)) continue;
        if (!free(x - w / 2, y - h / 2, w, h)) continue;
        U.text(ctx, l.text, x, y - h / 2, { scale: sc, color: tier === 0 ? '#fff6cf' : '#f1eee4', align: 'center' });
        if (!prev) seen.set(l.text, [[x, y]]); else prev.push([x, y]);
      }
    }
    if (ppm >= 0.22) for (const p of D.places) {
      if (p.size >= 3) continue; const [x, y] = toM(p.x, p.y); const w = U.textWidth(p.text, sc), h = 7 * sc;
      if (!free(x - w / 2, y - h / 2, w, h)) continue; U.text(ctx, p.text, x, y - h / 2, { scale: sc, color: '#b6ef8a', align: 'center' });
    }
  };
})(window.VH);
