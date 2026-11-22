// World data: loads the baked OpenStreetMap layers and answers spatial queries.
'use strict';
(function (VH) {
  const U = VH.U;
  const GC = { SEA: 0, LAND: 1, GRASS: 2, CROP: 3, SCRUB: 4, SAND: 5, ROAD: 6, BUILDING: 7, WATER: 8, PAVED: 9, ROCK: 10, LAWN: 11, DIRT: 12, WOOD: 13, WETLAND: 14, GOLF: 15, PITCH: 16 };
  // ground behaviour: grip multiplier, drag, leaves marks, mark colour
  const SURF = [];
  SURF[GC.SEA] = { grip: 0.3, drag: 3.0, soft: 0 };
  SURF[GC.LAND] = { grip: 0.62, drag: 0.55, soft: 1, mark: 'rgba(92,78,40,0.55)' };
  SURF[GC.GRASS] = { grip: 0.6, drag: 0.5, soft: 1, mark: 'rgba(66,96,34,0.6)' };
  SURF[GC.CROP] = { grip: 0.55, drag: 0.8, soft: 1, mark: 'rgba(150,120,50,0.75)' };
  SURF[GC.SCRUB] = { grip: 0.55, drag: 0.9, soft: 1, mark: 'rgba(70,70,40,0.6)' };
  SURF[GC.SAND] = { grip: 0.45, drag: 1.1, soft: 1, mark: 'rgba(176,150,96,0.7)' };
  SURF[GC.ROAD] = { grip: 1, drag: 0.15, soft: 0 };
  SURF[GC.BUILDING] = { grip: 1, drag: 0.2, soft: 0 };
  SURF[GC.WATER] = { grip: 0.3, drag: 3.0, soft: 0 };
  SURF[GC.PAVED] = { grip: 0.95, drag: 0.2, soft: 0 };
  SURF[GC.ROCK] = { grip: 0.7, drag: 0.6, soft: 0 };
  SURF[GC.LAWN] = { grip: 0.62, drag: 0.5, soft: 1, mark: 'rgba(60,92,30,0.6)' };
  SURF[GC.DIRT] = { grip: 0.6, drag: 0.5, soft: 1, mark: 'rgba(100,80,50,0.55)' };
  SURF[GC.WOOD] = { grip: 0.55, drag: 0.9, soft: 1, mark: 'rgba(50,60,30,0.6)' };
  SURF[GC.WETLAND] = { grip: 0.4, drag: 1.6, soft: 1, mark: 'rgba(60,70,50,0.7)' };
  SURF[GC.GOLF] = { grip: 0.6, drag: 0.45, soft: 1, mark: 'rgba(70,100,30,0.75)' };
  SURF[GC.PITCH] = { grip: 0.6, drag: 0.45, soft: 1, mark: 'rgba(70,100,30,0.7)' };

  const SUBURBS = [
    ['Victor Harbor', 4842, 2715], ['Victor Harbor', 4100, 2000], ['Victor Harbor', 3500, 2800], ['Victor Harbor', 3900, 2300], ['Encounter Bay', 2718, 4976], ['Encounter Bay', 3000, 3600], ['Encounter Bay', 2400, 6000],
    ['Hayborough', 6794, 1659], ['Hayborough', 6000, 1900], ['McCracken', 4529, 553], ['McCracken', 5500, 900], ['Granite Island', 5800, 3750],
    ['Rosetta Head (The Bluff)', 3016, 6790], ['Hindmarsh Valley', 906, 1106], ['Chiton Rocks', 7566, 922], ['the paddocks', 900, 3500], ['the paddocks', 1200, 6500],
  ];

  const W = VH.World = { GC, SURF };
  const dm = arr => { const f = new Float32Array(arr.length); for (let i = 0; i < arr.length; i++) f[i] = arr[i] / 10; return f; };
  const bbOf = p => { let a = 1e9, b = 1e9, c = -1e9, d = -1e9; for (let i = 0; i < p.length; i += 2) { if (p[i] < a) a = p[i]; if (p[i + 1] < b) b = p[i + 1]; if (p[i] > c) c = p[i]; if (p[i + 1] > d) d = p[i + 1]; } return [a, b, c, d]; };

  W.load = async function (onProgress) {
    onProgress && onProgress(0.05, 'Unfolding the street directory');
    const map = await (await fetch('data/map.json', { cache: 'no-cache' })).json();
    W.meta = map.meta; W.names = map.names;
    W.width = map.meta.worldW; W.height = map.meta.worldH; W.cell = map.meta.cell; W.gw = map.meta.gw; W.gh = map.meta.gh;
    onProgress && onProgress(0.35, 'Pouring the sea');
    W.ground = new Uint8Array(W.gw * W.gh); W.seaD = new Uint8Array(W.gw * W.gh); W.roadD = new Uint8Array(W.gw * W.gh);
    for (const r of map.meta.raster) {
      const img = new Image(); img.src = 'data/' + r.f; await img.decode();
      const [c, x] = U.canvas(img.width, img.height); x.drawImage(img, 0, 0);
      const d = x.getImageData(0, 0, img.width, img.height).data;
      const off = r.y0 * W.gw;
      for (let i = 0, n = img.width * img.height; i < n; i++) { W.ground[off + i] = d[i * 4]; W.seaD[off + i] = d[i * 4 + 1]; W.roadD[off + i] = d[i * 4 + 2]; }
      c.width = c.height = 1;
    }
    onProgress && onProgress(0.6, 'Building the roundabouts');
    W.roads = map.roads.map(r => { const p = dm(r.p); return { ...r, p, bb: bbOf(p), name: r.n >= 0 ? map.names[r.n] : '' }; });
    W.rails = map.rails.map(r => { const p = dm(r.p); return { ...r, p, bb: bbOf(p) }; });
    W.areas = map.areas.map(a => { const p = dm(a.p); return { ...a, p, bb: bbOf(p) }; });
    W.barriers = map.barriers.map(b => { const p = dm(b.p); return { ...b, p, bb: bbOf(p) }; });
    W.waterways = map.waterways.map(b => { const p = dm(b.p); return { ...b, p, bb: bbOf(p) }; });
    W.buildings = map.buildings.map((b, i) => {
      const p = dm(b.p); const bb = bbOf(p); let cx = 0, cy = 0; for (let k = 0; k < p.length; k += 2) { cx += p[k]; cy += p[k + 1]; }
      return { ...b, p, bb, cx: cx / (p.length / 2), cy: cy / (p.length / 2), seed: i, h: b.lv * 3 };
    });
    W.railRoutes = {}; for (const k of ['train', 'tram']) { const p = dm(map.railRoutes[k]); W.railRoutes[k] = { p, cum: U.cumLen(p) }; }
    W.pois = map.pois.map(p => ({ ...p, x: p.x / 10, y: p.y / 10 }));
    W.doors = map.doors.map(d => ({ x: d[0] / 10, y: d[1] / 10, lx: d[2] / 10, ly: d[3] / 10, lit: 0 }));
    W.shore = dm(map.shore);
    W.propsRaw = map.props;
    // collision walls (building edges) in a grid
    W.wallGrid = new U.Grid(8);
    for (const b of W.buildings) {
      if (b.ov) continue; // [Round C map] canopies and raised buildings with a road beneath: drawn, not solid
      const p = b.p, n = p.length;
      for (let i = 0; i < n; i += 2) {
        const j = (i + 2) % n; const s = { ax: p[i], ay: p[i + 1], bx: p[j], by: p[j + 1], b };
        W.wallGrid.addBox(s, Math.min(s.ax, s.bx), Math.min(s.ay, s.by), Math.max(s.ax, s.bx), Math.max(s.ay, s.by));
      }
    }
    // [Round C map] bridge railings (map.json `walls`) block vehicles and walkers like building walls. Their segments
    // carry b: false (never a building, never equal to a null/undefined "skip this shop" building) and `wall`.
    // `decor` is road furniture for the renderer.
    W.walls = (map.walls || []).map(w => { const p = dm(w.p); return { ...w, p, bb: bbOf(p) }; });
    for (const w of W.walls) for (let i = 0; i + 3 < w.p.length; i += 2) { const s = { ax: w.p[i], ay: w.p[i + 1], bx: w.p[i + 2], by: w.p[i + 3], b: false, wall: w }; W.wallGrid.addBox(s, Math.min(s.ax, s.bx), Math.min(s.ay, s.by), Math.max(s.ax, s.bx), Math.max(s.ay, s.by)); }
    W.decor = map.decor || null;
    W.buildingGrid = new U.Grid(32);
    for (const b of W.buildings) W.buildingGrid.addBox(b, b.bb[0], b.bb[1], b.bb[2], b.bb[3]);
    W.doorGrid = new U.Grid(16); for (const d of W.doors) W.doorGrid.add(d, d.x, d.y);
    onProgress && onProgress(0.75, 'Teaching the traffic to give way');
    // road graph
    const gn = map.graph.nodes; W.gNodes = dm(gn); const NN = gn.length / 2;
    W.gOut = Array.from({ length: NN }, () => []); W.gOutAll = Array.from({ length: NN }, () => []);
    W.edges = map.graph.edges.map((e, i) => {
      const p = dm(e[7]); const cum = U.cumLen(p);
      const ed = { i, a: e[0], b: e[1], ow: e[2], w: e[3] / 10, speed: e[4] / 3.6, n: e[5] >= 0 ? map.names[e[5]] : '', rb: e[6], p, cum, len: Math.max(0.1, cum[cum.length - 1]), bb: bbOf(p) };
      if (ed.ow >= 0) W.gOut[ed.a].push({ e: ed, dir: 1 });
      if (ed.ow <= 0) W.gOut[ed.b].push({ e: ed, dir: -1 });
      W.gOutAll[ed.a].push({ e: ed, dir: 1 }); W.gOutAll[ed.b].push({ e: ed, dir: -1 });
      return ed;
    });
    W.edgeGrid = new U.Grid(24);
    for (const e of W.edges) W.edgeGrid.addBox(e, e.bb[0] - e.w, e.bb[1] - e.w, e.bb[2] + e.w, e.bb[3] + e.w);
    // area lookup for named places (golf course etc.)
    W.areaByName = n => W.areas.find(a => a.n === n);
    W.poi = re => W.pois.find(p => re.test(p.n));
    onProgress && onProgress(0.85, 'Polishing the steam train');
  };

  W.cellIdx = (x, y) => { const gx = Math.floor(x / W.cell), gy = Math.floor(y / W.cell); if (gx < 0 || gy < 0 || gx >= W.gw || gy >= W.gh) return -1; return gy * W.gw + gx; };
  W.groundAt = (x, y) => { const k = W.cellIdx(x, y); return k < 0 ? GC.SEA : W.ground[k]; };
  W.surfAt = (x, y) => SURF[W.groundAt(x, y)] || SURF[GC.LAND];
  // signed distance to shore in metres (negative = in the sea), bilinear
  W.seaDist = (x, y) => {
    const fx = x / W.cell - 0.5, fy = y / W.cell - 0.5; const gx = Math.floor(fx), gy = Math.floor(fy); const tx = fx - gx, ty = fy - gy;
    const s = (cx, cy) => { if (cx < 0 || cy < 0 || cx >= W.gw || cy >= W.gh) return -60; return W.seaD[cy * W.gw + cx] - 128; };
    return U.lerp(U.lerp(s(gx, gy), s(gx + 1, gy), tx), U.lerp(s(gx, gy + 1), s(gx + 1, gy + 1), tx), ty);
  };
  W.roadDist = (x, y) => { const k = W.cellIdx(x, y); return k < 0 ? 255 : W.roadD[k]; };
  W.isWet = (x, y) => { const g = W.groundAt(x, y); return g === GC.SEA || g === GC.WATER; };
  W.inBounds = (x, y, m = 0) => x >= m && y >= m && x <= W.width - m && y <= W.height - m;

  W.nearestEdge = (x, y, maxD = 40) => {
    let best = null, bd = maxD;
    W.edgeGrid.query(x - maxD, y - maxD, x + maxD, y + maxD, e => {
      const p = e.p;
      for (let i = 0; i + 3 < p.length; i += 2) {
        const [d, qx, qy, t] = U.segPointDist(x, y, p[i], p[i + 1], p[i + 2], p[i + 3]);
        if (d < bd) { bd = d; const s = e.cum[i / 2] + t * (e.cum[i / 2 + 1] - e.cum[i / 2]); best = { e, s, d, x: qx, y: qy, ang: Math.atan2(p[i + 3] - p[i + 1], p[i + 2] - p[i]) }; }
      }
    });
    return best;
  };
  W.streetName = (x, y) => { const n = W.nearestEdge(x, y, 25); return n && n.e.n ? n.e.n : ''; };
  W.suburb = (x, y) => { let best = SUBURBS[0], bd = 1e12; for (const s of SUBURBS) { const d = (s[1] - x) ** 2 + (s[2] - y) ** 2; if (d < bd) { bd = d; best = s; } } return best[0]; };
  // random point on the road network near (x,y) between rMin and rMax away, optionally off-screen
  W.randomRoadPoint = (x, y, rMin, rMax, filter) => {
    for (let tries = 0; tries < 30; tries++) {
      const a = Math.random() * U.TAU, r = U.rand(rMin, rMax);
      const n = W.nearestEdge(x + Math.cos(a) * r, y + Math.sin(a) * r, 30);
      if (n && (!filter || filter(n.e)) && W.inBounds(n.x, n.y, 5)) return n;
    }
    return null;
  };
})(window.VH);
