#!/usr/bin/env node
// Schoolies Siege map baker.
// Reads the raw OpenStreetMap extract (game/data/raw/G-01-victor-harbor-all.osm, ODbL)
// and writes compact game data the browser loads with no network access:
//   game/data/map.json      vector layers (roads, rails, buildings, areas, barriers, props, POIs, road graph)
//   game/data/ground_N.png  2 m/cell raster: R = ground class, G = signed distance to sea (m, 128 = shore),
//                           B = distance to nearest drivable road (m, clamped 255)
// No dependencies beyond Node's standard library. Run: node game/tools/build_map.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAME = path.resolve(HERE, '..');
const RAW = path.join(GAME, 'data/raw/G-01-victor-harbor-all.osm');
const OUT = path.join(GAME, 'data');

const BBOX = { minLon: 138.57, maxLon: 138.66, minLat: -35.598, maxLat: -35.53 };
const LAT0 = (BBOX.minLat + BBOX.maxLat) / 2;
const MPX = 111320 * Math.cos(LAT0 * Math.PI / 180);
const MPY = 110574;
const WORLD_W = (BBOX.maxLon - BBOX.minLon) * MPX;
const WORLD_H = (BBOX.maxLat - BBOX.minLat) * MPY;
const CELL = 2; // metres per raster cell
const GW = Math.ceil(WORLD_W / CELL), GH = Math.ceil(WORLD_H / CELL);

// Ground classes (shared with game/js/world.js)
const G = {
  SEA: 0, LAND: 1, GRASS: 2, CROP: 3, SCRUB: 4, SAND: 5, ROAD: 6, BUILDING: 7, WATER: 8,
  PAVED: 9, ROCK: 10, LAWN: 11, DIRT: 12, WOOD: 13, WETLAND: 14, GOLF: 15, PITCH: 16,
};

const proj = (lon, lat) => [(lon - BBOX.minLon) * MPX, (BBOX.maxLat - lat) * MPY];

// ---------- seeded RNG ----------
let seed = 20261121;
const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };

// ---------- parse OSM XML ----------
console.log('reading', RAW);
const xml = fs.readFileSync(RAW, 'utf8');
const decode = s => s.replace(/&(amp|quot|apos|lt|gt|#\d+|#x[0-9a-f]+);/gi, (m, e) =>
  e === 'amp' ? '&' : e === 'quot' ? '"' : e === 'apos' ? "'" : e === 'lt' ? '<' : e === 'gt' ? '>' :
  e[1] === 'x' || e[1] === 'X' ? String.fromCodePoint(parseInt(e.slice(2), 16)) : String.fromCodePoint(parseInt(e.slice(1), 10)));
const attrs = s => { const o = {}; for (const m of s.matchAll(/([\w:]+)="([^"]*)"/g)) o[m[1]] = m[2]; return o; };
const tagsOf = body => { const t = {}; if (body) for (const m of body.matchAll(/<tag k="([^"]*)" v="([^"]*)"\s*\/>/g)) t[decode(m[1])] = decode(m[2]); return t; };

const nodes = new Map(); // id -> {x,y,t}
for (const m of xml.matchAll(/<node\s([^>]*?)(?:\/>|>([\s\S]*?)<\/node>)/g)) {
  const a = attrs(m[1]);
  const [x, y] = proj(+a.lon, +a.lat);
  nodes.set(a.id, { x, y, t: m[2] ? tagsOf(m[2]) : null });
}
const ways = new Map();
for (const m of xml.matchAll(/<way\s([^>]*?)>([\s\S]*?)<\/way>/g)) {
  const a = attrs(m[1]);
  const nd = [...m[2].matchAll(/<nd ref="(\d+)"\s*\/>/g)].map(x => x[1]);
  ways.set(a.id, { id: a.id, nd, t: tagsOf(m[2]) });
}
const relations = [];
for (const m of xml.matchAll(/<relation\s([^>]*?)>([\s\S]*?)<\/relation>/g)) {
  const a = attrs(m[1]);
  const members = [...m[2].matchAll(/<member type="(\w+)" ref="(\d+)" role="([^"]*)"\s*\/>/g)].map(x => ({ type: x[1], ref: x[2], role: x[3] }));
  relations.push({ id: a.id, members, t: tagsOf(m[2]) });
}
const osmBase = (xml.match(/<meta osm_base="([^"]+)"/) || [])[1] || 'unknown';
console.log(`nodes ${nodes.size} ways ${ways.size} relations ${relations.length} osm_base ${osmBase}`);

const wayPts = w => { const p = []; for (const id of w.nd) { const n = nodes.get(id); if (n) p.push(n.x, n.y); } return p; };
const closed = w => w.nd.length > 3 && w.nd[0] === w.nd[w.nd.length - 1];

// ---------- geometry helpers ----------
const inWorld = (x, y, m = 0) => x >= -m && y >= -m && x <= WORLD_W + m && y <= WORLD_H + m;
function ringArea(p) { let a = 0; for (let i = 0, n = p.length; i < n; i += 2) { const j = (i + 2) % n; a += p[i] * p[j + 1] - p[j] * p[i + 1]; } return a / 2; }
function centroid(p) { let x = 0, y = 0; const n = p.length / 2; for (let i = 0; i < p.length; i += 2) { x += p[i]; y += p[i + 1]; } return [x / n, y / n]; }
function bboxOf(p) { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (let i = 0; i < p.length; i += 2) { a = Math.min(a, p[i]); b = Math.min(b, p[i + 1]); c = Math.max(c, p[i]); d = Math.max(d, p[i + 1]); } return [a, b, c, d]; }
function bboxHits(bb, m = 50) { return bb[2] >= -m && bb[3] >= -m && bb[0] <= WORLD_W + m && bb[1] <= WORLD_H + m; }
// Clip a polyline to the world rectangle (with margin); returns list of pieces.
function clipLine(p, m = 30) {
  const out = []; let cur = [];
  const x0 = -m, y0 = -m, x1 = WORLD_W + m, y1 = WORLD_H + m;
  for (let i = 0; i + 3 < p.length; i += 2) {
    let ax = p[i], ay = p[i + 1], bx = p[i + 2], by = p[i + 3];
    let t0 = 0, t1 = 1; const dx = bx - ax, dy = by - ay; let ok = true;
    for (const [pp, q] of [[-dx, ax - x0], [dx, x1 - ax], [-dy, ay - y0], [dy, y1 - ay]]) {
      if (pp === 0) { if (q < 0) { ok = false; break; } continue; }
      const r = q / pp;
      if (pp < 0) { if (r > t1) { ok = false; break; } if (r > t0) t0 = r; }
      else { if (r < t0) { ok = false; break; } if (r < t1) t1 = r; }
    }
    if (!ok) { if (cur.length >= 4) out.push(cur); cur = []; continue; }
    const sx = ax + dx * t0, sy = ay + dy * t0, ex = ax + dx * t1, ey = ay + dy * t1;
    if (cur.length === 0 || cur[cur.length - 2] !== sx || cur[cur.length - 1] !== sy) { if (cur.length >= 4) out.push(cur); cur = [sx, sy]; }
    cur.push(ex, ey);
    if (t1 < 1) { out.push(cur); cur = []; }
  }
  if (cur.length >= 4) out.push(cur);
  return out;
}
// Douglas-Peucker simplification.
// A closed loop (first point == last point, e.g. a roundabout ring) has no chord to measure against, which used to
// collapse the whole loop to its start point; loops are split at their farthest point and each half simplified.
function simplify(p, tol) {
  const n = p.length / 2; if (n < 3) return p;
  if (n > 3 && p[0] === p[p.length - 2] && p[1] === p[p.length - 1]) {
    let fi = 1, fd = -1; for (let i = 1; i < n - 1; i++) { const d = Math.hypot(p[i * 2] - p[0], p[i * 2 + 1] - p[1]); if (d > fd) { fd = d; fi = i; } }
    const a = simplify(p.slice(0, fi * 2 + 2), tol), b = simplify(p.slice(fi * 2), tol);
    return a.concat(b.slice(2));
  }
  const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(); let md = 0, mi = -1;
    const ax = p[a * 2], ay = p[a * 2 + 1], bx = p[b * 2], by = p[b * 2 + 1];
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1e-9;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((p[i * 2] - ax) * dy - (p[i * 2 + 1] - ay) * dx) / L; if (d > md) { md = d; mi = i; } }
    if (md > tol) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  const o = []; for (let i = 0; i < n; i++) if (keep[i]) o.push(p[i * 2], p[i * 2 + 1]); return o;
}
const q = v => Math.round(v * 10); // decimetres
const Q = p => p.map(q);

// Join member ways into rings (for multipolygons).
function assembleRings(wayIds) {
  const segs = wayIds.map(id => ways.get(id)).filter(Boolean).map(w => w.nd.slice());
  const rings = [];
  while (segs.length) {
    let cur = segs.shift();
    let guard = 0;
    while (cur[0] !== cur[cur.length - 1] && guard++ < 1000) {
      const end = cur[cur.length - 1];
      let found = -1, rev = false;
      for (let i = 0; i < segs.length; i++) {
        if (segs[i][0] === end) { found = i; break; }
        if (segs[i][segs[i].length - 1] === end) { found = i; rev = true; break; }
      }
      if (found < 0) break;
      const s = segs.splice(found, 1)[0]; if (rev) s.reverse();
      cur = cur.concat(s.slice(1));
    }
    const p = []; for (const id of cur) { const n = nodes.get(id); if (n) p.push(n.x, n.y); }
    if (p.length >= 6) rings.push(p);
  }
  return rings;
}

// ---------- classification ----------
const DRIVABLE = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'service', 'living_street',
  'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link', 'track', 'road']);
const ROAD_W = { motorway: 14, trunk: 12, primary: 11, secondary: 10, tertiary: 9, unclassified: 7, residential: 7.5, living_street: 6, service: 4.5,
  track: 3.5, road: 6, pedestrian: 6, footway: 2, path: 1.6, cycleway: 2.4, steps: 2, bridleway: 2.5 };
const roadClass = h => h.replace('_link', '');
// carriageway width in metres (the roads layer and the raster)
function roadWidthOf(t) {
  const cls = roadClass(t.highway), lanes = +t.lanes || 0;
  let width = parseFloat(t.width) || 0;
  if (!width) width = lanes ? Math.max(ROAD_W[cls] * 0.8, lanes * 3.3 + (cls === 'service' ? 0 : 1)) : ROAD_W[cls] || 6;
  return Math.min(width, 25);
}

function areaClass(t) {
  const lu = t.landuse, nat = t.natural, le = t.leisure, am = t.amenity;
  if (t.golf === 'green' || t.golf === 'tee') return 'green';
  if (t.golf === 'fairway') return 'fairway';
  if (t.golf === 'bunker') return 'sand';
  if (t.golf === 'rough') return 'grass';
  if (t.golf === 'water_hazard' || t.golf === 'lateral_water_hazard') return 'water';
  if (nat === 'water' || lu === 'reservoir' || lu === 'basin' || t.waterway === 'riverbank' || t.water) return 'water';
  if (nat === 'wetland') return 'wetland';
  if (nat === 'beach' || nat === 'sand' || lu === 'beach') return 'sand';
  if (nat === 'bare_rock' || nat === 'scree' || nat === 'rock' || nat === 'shingle') return 'rock';
  if (nat === 'wood' || lu === 'forest') return 'wood';
  if (nat === 'scrub' || nat === 'heath') return 'scrub';
  if (nat === 'grassland' || lu === 'meadow' || lu === 'grass' || lu === 'village_green' || lu === 'recreation_ground' || nat === 'grass') return 'grass';
  if (lu === 'farmland' || lu === 'orchard' || lu === 'vineyard' || lu === 'allotments' || lu === 'greenhouse_horticulture' || lu === 'plant_nursery') return 'crop';
  if (lu === 'farmyard') return 'dirt';
  if (le === 'golf_course') return 'golf';
  if (le === 'pitch' || le === 'track' || le === 'stadium') return t.surface && /asphalt|concrete|paved|tartan|acrylic|clay/.test(t.surface) ? 'court' : 'pitch';
  if (le === 'park' || le === 'garden' || le === 'playground' || le === 'dog_park' || le === 'common' || le === 'nature_reserve' && false) return 'park';
  if (le === 'swimming_pool') return 'pool';
  if (lu === 'cemetery' || am === 'grave_yard') return 'cemetery';
  if (am === 'parking' || t['area:highway'] || (t.highway === 'pedestrian' && t.area === 'yes') || am === 'marketplace' || lu === 'railway' && false) return 'paved';
  if (am === 'school' || am === 'college' || am === 'kindergarten' || am === 'hospital' || am === 'place_of_worship') return 'campus';
  if (lu === 'residential') return 'residential';
  if (lu === 'commercial' || lu === 'retail') return 'commercial';
  if (lu === 'industrial' || lu === 'construction' || lu === 'brownfield' || lu === 'landfill' || lu === 'quarry') return 'industrial';
  if (lu === 'railway') return 'dirt';
  if (t.man_made === 'pier' || t.man_made === 'breakwater' || t.man_made === 'groyne' || t.man_made === 'bridge') return 'pier';
  return null;
}
const AREA_PRI = { residential: 1, commercial: 2, industrial: 2, campus: 3, crop: 4, dirt: 5, golf: 6, grass: 7, scrub: 7, wood: 8, park: 9, cemetery: 9,
  pitch: 10, court: 11, fairway: 11, green: 12, wetland: 12, rock: 12, sand: 13, paved: 14, water: 15, pool: 16, pier: 20 };
const AREA_GROUND = { residential: G.LAWN, commercial: G.PAVED, industrial: G.DIRT, campus: G.LAWN, crop: G.CROP, dirt: G.DIRT, golf: G.GOLF, grass: G.GRASS,
  scrub: G.SCRUB, wood: G.WOOD, park: G.GRASS, cemetery: G.GRASS, pitch: G.PITCH, court: G.PAVED, fairway: G.GOLF, green: G.GOLF, wetland: G.WETLAND,
  rock: G.ROCK, sand: G.SAND, paved: G.PAVED, water: G.WATER, pool: G.WATER, pier: G.PAVED };

// ---------- collect features ----------
const roads = [], rails = [], buildings = [], areas = [], barriers = [], coast = [], waterways = [];
const nameIdx = new Map(), names = [];
const nm = s => { if (!s) return -1; if (!nameIdx.has(s)) { nameIdx.set(s, names.length); names.push(s); } return nameIdx.get(s); };

function addArea(cls, rings, t) {
  for (const r of rings) {
    const bb = bboxOf(r); if (!bboxHits(bb)) continue;
    areas.push({ k: cls, p: simplify(r, 0.4), n: t.name || null, bb });
  }
}

const usedInRel = new Set();
for (const rel of relations) {
  if (rel.t.type !== 'multipolygon') continue;
  const t = rel.t;
  const outer = rel.members.filter(m => m.type === 'way' && m.role !== 'inner').map(m => m.ref);
  const inner = rel.members.filter(m => m.type === 'way' && m.role === 'inner').map(m => m.ref);
  if (t.building) {
    for (const r of assembleRings(outer)) buildings.push({ p: r, t });
    continue;
  }
  const cls = areaClass(t);
  if (!cls) continue;
  addArea(cls, assembleRings(outer), t);
  // inner rings of water/landuse: ignore (rare here), but mark ways so they're not double used
  for (const id of outer) usedInRel.add(id + ':' + cls);
}

for (const w of ways.values()) {
  const t = w.t;
  const p = wayPts(w);
  if (p.length < 4) continue;
  if (t.natural === 'coastline') { coast.push(p); continue; }
  if (t.building || t['building:part'] && false) {
    if (closed(w)) buildings.push({ p: p.slice(0, -2), t, wid: w.id });
    continue;
  }
  if (t.highway && !(t.area === 'yes' && t.highway === 'pedestrian')) {
    const h = t.highway;
    if (h === 'proposed' || h === 'construction' || h === 'platform' || h === 'bus_stop' || h === 'elevator') continue;
    if (!ROAD_W[roadClass(h)] && !DRIVABLE.has(h)) continue;
    const cls = roadClass(h);
    const lanes = +t.lanes || 0;
    const width = roadWidthOf(t);
    let ow = 0; if (t.oneway === 'yes' || t.oneway === '1' || t.junction === 'roundabout' || t.junction === 'circular') ow = 1; if (t.oneway === '-1') ow = -1;
    const pieces = clipLine(p);
    for (const pc of pieces) roads.push({ c: cls, w: Math.round(width * 10) / 10, l: lanes, ow, rb: t.junction === 'roundabout' ? 1 : 0, br: t.bridge && t.bridge !== 'no' ? 1 : 0,
      n: nm(t.name), sf: t.surface || '', p: simplify(pc, 0.15), drive: DRIVABLE.has(h) && t.access !== 'no' && t.motor_vehicle !== 'no', way: w, piece: pieces.length === 1 });
    if (t.area === 'yes' && closed(w)) addArea('paved', [p.slice(0, -2)], t);
    continue;
  }
  if (t.railway === 'rail' || t.railway === 'tram' || t.railway === 'narrow_gauge' || t.railway === 'preserved' || t.railway === 'light_rail') {
    for (const pc of clipLine(p)) rails.push({ k: t.railway === 'tram' ? 'tram' : 'train', n: t.name || '', p: pc, br: t.bridge && t.bridge !== 'no' ? 1 : 0, nd: w.nd });
    continue;
  }
  if (t.barrier && ['fence', 'wall', 'hedge', 'retaining_wall', 'guard_rail', 'city_wall'].includes(t.barrier)) {
    for (const pc of clipLine(p)) barriers.push({ k: t.barrier, p: simplify(pc, 0.2) });
    if (!closed(w)) continue;
  }
  if (t.waterway && ['river', 'stream', 'canal', 'drain', 'ditch'].includes(t.waterway) && !closed(w)) {
    for (const pc of clipLine(p)) waterways.push({ k: t.waterway, n: t.name || '', p: simplify(pc, 0.5), w: t.waterway === 'river' ? 10 : t.waterway === 'canal' ? 6 : 2.5 });
    continue;
  }
  if (t.natural === 'cliff' || t.natural === 'ridge') { for (const pc of clipLine(p)) barriers.push({ k: 'cliff', p: simplify(pc, 0.5) }); continue; }
  if ((t.man_made === 'pier' || t.man_made === 'breakwater' || t.man_made === 'groyne') && !closed(w)) {
    for (const pc of clipLine(p)) roads.push({ c: 'pier', w: parseFloat(t.width) || 4, l: 0, ow: 0, rb: 0, br: 1, n: nm(t.name), sf: 'wood', p: pc, drive: false });
    continue;
  }
  if (closed(w)) {
    const cls = areaClass(t);
    if (cls) addArea(cls, [p.slice(0, -2)], t);
  }
}
console.log(`roads ${roads.length} rails ${rails.length} buildings ${buildings.length} areas ${areas.length} barriers ${barriers.length} coast ${coast.length}`);

// overhead structures you can drive or walk under: canopies (building=roof/carport) and raised buildings (layer >= 1)
// with a road or path running beneath; they are drawn but not solid (map.json buildings[].ov = 1)
function inPoly(x, y, p) { let c = false; for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) if ((p[i + 1] > y) !== (p[j + 1] > y) && x < (p[j] - p[i]) * (y - p[i + 1]) / (p[j + 1] - p[i + 1]) + p[i]) c = !c; return c; }
for (const b of buildings) {
  const k = b.t.building; if (k === 'roof' || k === 'carport') { b.ov = 1; continue; }
  if (!(+b.t.layer >= 1)) continue; const bb = bboxOf(b.p);
  for (const r of roads) { if (r.c === 'pier') continue; for (let i = 0; i < r.p.length && !b.ov; i += 2) if (r.p[i] > bb[0] && r.p[i] < bb[2] && r.p[i + 1] > bb[1] && r.p[i + 1] < bb[3] && inPoly(r.p[i], r.p[i + 1], b.p)) b.ov = 1; if (b.ov) break; }
}
console.log(`overhead structures (not solid) ${buildings.filter(b => b.ov).length}`);

// ---------- polyline helpers ----------
function polyLen(p) { let l = 0; for (let i = 2; i < p.length; i += 2) l += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]); return l; }
// point and unit tangent at arc length s (clamped to the line)
function along(p, s) {
  let acc = 0;
  for (let i = 2; i < p.length; i += 2) {
    const dx = p[i] - p[i - 2], dy = p[i + 1] - p[i - 1], L = Math.hypot(dx, dy); if (!L) continue;
    if (acc + L >= s || i === p.length - 2) { const t = Math.max(0, Math.min(1, (s - acc) / L)); return [p[i - 2] + dx * t, p[i - 1] + dy * t, dx / L, dy / L]; }
    acc += L;
  }
  return [p[0], p[1], 1, 0];
}
// the piece of a polyline between arc lengths s0 and s1
function subLine(p, s0, s1) {
  const out = []; const a = along(p, s0); out.push(a[0], a[1]); let acc = 0;
  for (let i = 2; i < p.length; i += 2) { acc += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]); if (acc > s0 && acc < s1) out.push(p[i], p[i + 1]); }
  const b = along(p, s1); out.push(b[0], b[1]); return out;
}
// offset a polyline sideways (positive = to the right of travel on screen, i.e. +normal (-ty, tx))
function offsetPoly(p, off) {
  const o = [], n = p.length / 2;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    let nx = 0, ny = 0;
    for (const [u, v] of [[a, i], [i, b]]) { if (u === v) continue; const dx = p[v * 2] - p[u * 2], dy = p[v * 2 + 1] - p[u * 2 + 1], L = Math.hypot(dx, dy) || 1; nx += -dy / L; ny += dx / L; }
    const L = Math.hypot(nx, ny) || 1; nx /= L; ny /= L;
    // mitre length correction, capped
    let k = 1; if (i > 0 && i < n - 1) { const dx = p[b * 2] - p[i * 2], dy = p[b * 2 + 1] - p[i * 2 + 1], l = Math.hypot(dx, dy) || 1; const c = Math.abs((-dy / l) * nx + (dx / l) * ny); k = Math.min(2, 1 / Math.max(0.5, c)); }
    o.push(p[i * 2] + nx * off * k, p[i * 2 + 1] + ny * off * k);
  }
  return o;
}
function segDist(x, y, ax, ay, bx, by) { const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1e-9; const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)); return Math.hypot(x - ax - dx * t, y - ay - dy * t); }
function polyDist(x, y, p) { let d = Infinity; for (let i = 0; i + 3 < p.length; i += 2) d = Math.min(d, segDist(x, y, p[i], p[i + 1], p[i + 2], p[i + 3])); return d; }

// ---------- bridges: a comfortable deck, footpaths and railings that block the way off the edge ----------
// Car-scale widths: a two-way road bridge carries at least 9 m of carriageway (two 3.5 m lanes and shoulders) and is
// never narrower than the road leading onto it; each side gets a 1.6 m footpath; railings sit on the deck edges.
const hwByNode = new Map(); // OSM node id -> highway ways through it
for (const w of ways.values()) if (w.t.highway && !(w.t.area === 'yes')) for (const id of w.nd) { let l = hwByNode.get(id); if (!l) hwByNode.set(id, l = []); if (!l.includes(w)) l.push(w); }
const bridgeW = new Map(); // way id -> widened carriageway width
const decks = []; // { p, hw, nd: Set of OSM nodes, kind }
for (const r of roads) {
  if (!r.br || r.c === 'pier') continue;
  const ends = [r.way.nd[0], r.way.nd[r.way.nd.length - 1]];
  if (r.drive) {
    let approach = 0;
    for (const id of ends) for (const o of hwByNode.get(id) || []) if (o !== r.way && DRIVABLE.has(o.t.highway)) approach = Math.max(approach, roadWidthOf(o.t));
    r.w = Math.round(Math.max(r.w, approach, r.ow ? 6.5 : 9) * 10) / 10;
    r.deck = r.w / 2 + 1.6;
    bridgeW.set(r.way.id, r.w);
  } else {
    if (r.c === 'footway' || r.c === 'path' || r.c === 'cycleway' || r.c === 'steps' || r.c === 'bridleway') r.w = Math.max(r.w, 2.6);
    r.deck = r.w / 2 + 0.1;
  }
  decks.push({ p: r.p, hw: r.deck, nd: new Set(r.way.nd), kind: r.drive ? 'rail' : 'footrail', way: r.way });
}
for (const r of rails) if (r.br) { const w = [...ways.values()].find(x => x.nd === r.nd); decks.push({ p: r.p, hw: r.k === 'tram' ? 1.9 : 2.1, nd: new Set(r.nd), kind: r.k === 'tram' ? 'footrail' : 'rail', way: w }); }
const walls = []; // { k, p } solid lines that block vehicles and walkers (map.json `walls`)
for (const d of decks) {
  // roads joining this deck (side roads at the ends, paths dropping off it) and the other decks beside it
  const others = [];
  for (const id of d.nd) for (const o of hwByNode.get(id) || []) if (o !== d.way) others.push({ p: wayPts(o), hw: (bridgeW.get(o.id) || (o.t.highway ? roadWidthOf(o.t) : 3)) / 2 });
  for (const e of decks) if (e !== d) others.push({ p: e.p, hw: e.hw });
  // roads, paths and railways that pass under the deck: leave a gap in the railing over them (railings are plain
  // 2D walls, so a continuous one would block whatever runs underneath)
  const bb = bboxOf(d.p); const near = q => { const b2 = bboxOf(q); return b2[2] > bb[0] - 15 && b2[0] < bb[2] + 15 && b2[3] > bb[1] - 15 && b2[1] < bb[3] + 15; };
  for (const r of roads) if (!r.br && r.c !== 'pier' && r.way !== d.way && near(r.p)) others.push({ p: r.p, hw: r.w / 2 + 0.2 });
  for (const r of rails) if (!r.br && near(r.p)) others.push({ p: r.p, hw: 1.9 });
  const L = polyLen(d.p); if (L < 2) continue;
  // extend the railings a little past the abutments unless something joins there
  const endBusy = [d.way && d.way.nd[0], d.way && d.way.nd[d.way.nd.length - 1]].map(id => (hwByNode.get(id) || []).length > 2);
  for (const side of [-1, 1]) {
    const op = offsetPoly(d.p, side * (d.hw + 0.15)); const OL = polyLen(op);
    const ext0 = endBusy[0] ? 0 : 1.5, ext1 = endBusy[1] ? 0 : 1.5;
    let run = [];
    const flush = () => { if (run.length >= 4 && polyLen(run) >= 2) walls.push({ k: d.kind, p: simplify(run, 0.08) }); run = []; };
    for (let s = -ext0; s <= OL + ext1 + 1e-6; s += 0.75) {
      let x, y;
      if (s < 0) { const [ax, ay, tx, ty] = along(op, 0); x = ax + tx * s; y = ay + ty * s; }
      else if (s > OL) { const [ax, ay, tx, ty] = along(op, OL); x = ax + tx * (s - OL); y = ay + ty * (s - OL); }
      else { const a = along(op, s); x = a[0]; y = a[1]; }
      const inside = others.some(o => polyDist(x, y, o.p) < o.hw + 0.3);
      if (inside) flush(); else run.push(x, y);
    }
    flush();
  }
}
console.log(`bridges ${decks.length} decks, railings ${walls.length}`);
{ // a railing must never cut across a road, path or railway (it would block traffic underneath)
  const segX = (ax, ay, bx, by, cx, cy, dx, dy) => { const d = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx); if (Math.abs(d) < 1e-9) return false; const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / d, u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / d; return t >= 0 && t <= 1 && u >= 0 && u <= 1; };
  const lines = roads.filter(r => !r.br && r.c !== 'pier').map(r => r.p).concat(rails.filter(r => !r.br).map(r => r.p)); let bad = 0; const ex = [];
  for (const w of walls) { const wb = bboxOf(w.p); for (const p of lines) { const pb = bboxOf(p); if (pb[2] < wb[0] || pb[0] > wb[2] || pb[3] < wb[1] || pb[1] > wb[3]) continue;
    for (let i = 0; i + 3 < w.p.length; i += 2) for (let j = 0; j + 3 < p.length; j += 2) if (segX(w.p[i], w.p[i + 1], w.p[i + 2], w.p[i + 3], p[j], p[j + 1], p[j + 2], p[j + 3])) { bad++; if (ex.length < 5) ex.push(w.p[i].toFixed(0) + ',' + w.p[i + 1].toFixed(0)); } } }
  if (bad) throw new Error(`${bad} railing segments cross a road, path or railway: ${ex.join(' ')}`);
}

// ---------- road graph (drivable) ----------
const nodeUse = new Map();
const driveWays = [...new Set(roads.filter(r => r.drive && r.way).map(r => r.way))];
for (const w of driveWays) w.nd.forEach((id, i) => { nodeUse.set(id, (nodeUse.get(id) || 0) + (i === 0 || i === w.nd.length - 1 ? 2 : 1)); });
const gIndex = new Map(), gNodes = [], gEdges = [];
const gNode = id => { if (!gIndex.has(id)) { const n = nodes.get(id); gIndex.set(id, gNodes.length / 2); gNodes.push(n.x, n.y); } return gIndex.get(id); };
for (const w of driveWays) {
  const t = w.t; const cls = roadClass(t.highway);
  const lanes = +t.lanes || 0;
  let width = bridgeW.get(w.id) || parseFloat(t.width) || (lanes ? Math.max(ROAD_W[cls] * 0.8, lanes * 3.3 + 1) : ROAD_W[cls] || 6);
  let ow = 0; if (t.oneway === 'yes' || t.oneway === '1' || t.junction === 'roundabout' || t.junction === 'circular') ow = 1; if (t.oneway === '-1') ow = -1;
  let speed = parseFloat(t.maxspeed) || ({ primary: 60, secondary: 60, tertiary: 50, residential: 50, service: 20, track: 30, unclassified: 50, living_street: 20, trunk: 80 }[cls] || 40);
  let start = 0;
  for (let i = 1; i < w.nd.length; i++) {
    const id = w.nd[i];
    if (i === w.nd.length - 1 || nodeUse.get(id) > 1) {
      const seg = w.nd.slice(start, i + 1).map(x => nodes.get(x)).filter(Boolean);
      if (seg.length >= 2) {
        const pts = []; seg.forEach(n => pts.push(n.x, n.y));
        const inside = seg.some(n => inWorld(n.x, n.y, 20));
        if (inside) {
          let len = 0; for (let k = 2; k < pts.length; k += 2) len += Math.hypot(pts[k] - pts[k - 2], pts[k + 1] - pts[k - 1]);
          gEdges.push({ a: gNode(w.nd[start]), b: gNode(id), ow, w: width, s: speed, c: cls, n: nm(t.name), rb: t.junction === 'roundabout' ? 1 : 0, len, p: simplify(pts, 0.25),
            full: pts, way: w, br: t.bridge && t.bridge !== 'no' ? 1 : 0, sf: t.surface || '' });
        }
      }
      start = i;
    }
  }
}
console.log(`graph nodes ${gNodes.length / 2} edges ${gEdges.length}`);

// ---------- junctions: continuous asphalt where roads meet ----------
// Every graph node where three or more road arms meet gets a junction polygon: each arm is carried in at full width to
// the point where it clears its neighbours, and the corners between arms are filled with a kerb-radius fillet (the
// flares at a roundabout come from the same fillets). The renderer fills it with asphalt inside a kerb, stops lane
// and centre markings at its edge, and paints give-way or stop lines across the inbound lanes.
const RANK = { trunk: 8, primary: 7, secondary: 6, tertiary: 5, unclassified: 4, residential: 3, road: 3, living_street: 2, service: 1, track: 0 };
const revPts = p => { const o = []; for (let i = p.length - 2; i >= 0; i -= 2) o.push(p[i], p[i + 1]); return o; };
const nodeArms = new Map(); // graph node -> arms (pts run outward from the node)
gEdges.forEach(e => {
  const add = (n, pts, fromA) => { let l = nodeArms.get(n); if (!l) nodeArms.set(n, l = []); l.push({ e, pts, inbound: e.ow === 0 || (fromA ? e.ow === -1 : e.ow === 1), outbound: e.ow === 0 || (fromA ? e.ow === 1 : e.ow === -1) }); };
  add(e.a, e.full, true); add(e.b, revPts(e.full), false);
});
const gOsm = []; for (const [id, i] of gIndex) gOsm[i] = id; // graph node -> OSM node id
const signalPts = []; for (const n of nodes.values()) if (n.t && n.t.highway === 'traffic_signals' && inWorld(n.x, n.y, 30)) signalPts.push([n.x, n.y]);
const lineX = (px, py, tx, ty, qx, qy, ux, uy) => { const den = tx * uy - ty * ux; if (Math.abs(den) < 1e-6) return null; const s = ((qx - px) * uy - (qy - py) * ux) / den, u = ((qx - px) * ty - (qy - py) * tx) / den; return [px + tx * s, py + ty * s, s, u]; };
const junctions = []; // { x, y, r, poly, gw: [[x1,y1,x2,y2,kind]] }
const junctionAt = new Map(); // graph node -> junction
for (const [n, raw] of nodeArms) {
  if (raw.length < 3) continue;
  const Nx = gNodes[n * 2], Ny = gNodes[n * 2 + 1];
  if (!inWorld(Nx, Ny, 20)) continue;
  if (raw.every(a => a.e.c === 'track')) continue;
  const arms = raw.map(a => { const L = a.e.len; const q = along(a.pts, Math.min(3, L * 0.45)); return { ...a, L, h: a.e.w / 2, th: Math.atan2(q[1] - Ny, q[0] - Nx), dn: 0, dp: 0 }; }).sort((p, q) => p.th - q.th);
  const K = arms.length;
  for (let i = 0; i < K; i++) {
    const A = arms[i], B = arms[(i + 1) % K]; let g = B.th - A.th; if (i === K - 1) g += Math.PI * 2; A.gap = g;
    if (g < 0.03) { A.dn = B.dp = 3 * Math.max(A.h, B.h); } // arms leaving on the same heading overlap for a while
    else if (g < Math.PI - 0.17) { const s = Math.sin(g), c = Math.cos(g); A.dn = Math.max(0, (B.h + A.h * c) / s); B.dp = Math.max(0, (A.h + B.h * c) / s); }
  }
  for (const A of arms) {
    const f = Math.max(1.2, Math.min(4, A.h * 0.7));
    A.m = Math.max(0.6, Math.min(Math.max(A.dn, A.dp) + f, A.L * 0.5, 25));
    const [px, py, tx, ty] = along(A.pts, A.m); A.px = px; A.py = py; A.tx = tx; A.ty = ty;
    const nx = -ty, ny = tx; A.nx = nx; A.ny = ny;
    A.minus = [px - nx * A.h, py - ny * A.h]; A.plus = [px + nx * A.h, py + ny * A.h];
  }
  const poly = []; const maxH = Math.max(...arms.map(a => a.h));
  for (let i = 0; i < K; i++) {
    const A = arms[i], B = arms[(i + 1) % K];
    poly.push(...A.minus, ...A.plus);
    const [Px, Py] = A.plus, [Qx, Qy] = B.minus; const g = A.gap;
    const X = lineX(Px, Py, A.tx, A.ty, Qx, Qy, B.tx, B.ty);
    if (g < Math.PI - 0.17) {
      if (X && X[2] < 0.3 && X[3] < 0.3 && Math.hypot(X[0] - Nx, X[1] - Ny) < Math.max(A.m, B.m) + maxH + 1) {
        for (let k = 1; k < 5; k++) { const t = k / 5, u = 1 - t; poly.push(u * u * Px + 2 * u * t * X[0] + t * t * Qx, u * u * Py + 2 * u * t * X[1] + t * t * Qy); }
      }
    } else if (g > Math.PI + 0.17) {
      if (X && X[2] < 0 && X[3] < 0 && Math.hypot(X[0] - Nx, X[1] - Ny) < 2.5 * Math.max(A.h, B.h)) poly.push(X[0], X[1]);
      else { const bis = A.th + g / 2; poly.push(Nx + Math.cos(bis) * maxH, Ny + Math.sin(bis) * maxH); }
    }
  }
  // give-way and stop lines
  const gw = [];
  const ring = arms.some(a => a.e.rb);
  const signals = signalPts.some(([x, y]) => Math.hypot(x - Nx, y - Ny) < 30);
  let yields = new Set();
  if (ring) { for (const A of arms) if (!A.e.rb) yields.add(A); }
  else {
    const ranks = arms.map(a => RANK[a.e.c] ?? 3).sort((a, b) => b - a);
    let pair = null;
    if (K === 3) for (let i = 0; i < 3; i++) { const g = arms[i].gap; if (Math.abs(g - Math.PI) < 0.45 && (!pair || Math.abs(g - Math.PI) < pair.err)) pair = { a: arms[i], b: arms[(i + 1) % 3], err: Math.abs(g - Math.PI) }; }
    for (const A of arms) {
      const rk = RANK[A.e.c] ?? 3;
      if (pair) { if (A !== pair.a && A !== pair.b && rk <= Math.max(RANK[pair.a.e.c] ?? 3, RANK[pair.b.e.c] ?? 3)) yields.add(A); }
      else if (rk < ranks[1]) yields.add(A);
    }
  }
  for (const A of arms) {
    if (!A.inbound || A.e.c === 'service' || A.e.c === 'track' || A.h < 2.4 || A.e.rb) continue;
    const kind = signals ? 1 : yields.has(A) ? 0 : -1; if (kind < 0) continue;
    const s = Math.max(0.3, A.m - 0.35); const [px, py, tx, ty] = along(A.pts, s); const nx = -ty, ny = tx; const e = A.h - 0.3;
    const from = A.outbound ? 0 : -e; gw.push([px + nx * from, py + ny * from, px + nx * e, py + ny * e, kind]);
  }
  const r = Math.max(...arms.map(a => a.m + a.h * 0.5));
  const j = { x: Nx, y: Ny, r, poly, gw, ring };
  junctions.push(j); junctionAt.set(n, j);
}
console.log(`junctions ${junctions.length}, give-way/stop lines ${junctions.reduce((s, j) => s + j.gw.length, 0)}`);

// ---------- roundabouts: rings with a kerbed central island, splitter islands between divided arms ----------
const rbWays = [...ways.values()].filter(w => (w.t.junction === 'roundabout' || w.t.junction === 'circular') && DRIVABLE.has(w.t.highway));
const rbByStart = new Map(); for (const w of rbWays) rbByStart.set(w.nd[0], w);
const rbUsed = new Set(); const rings = [];
for (const w0 of rbWays) {
  if (rbUsed.has(w0)) continue;
  let nd = w0.nd.slice(); rbUsed.add(w0); const parts = [w0];
  for (let guard = 0; guard < 20 && nd[0] !== nd[nd.length - 1]; guard++) { const nx = rbByStart.get(nd[nd.length - 1]); if (!nx || rbUsed.has(nx)) break; rbUsed.add(nx); parts.push(nx); nd = nd.concat(nx.nd.slice(1)); }
  if (nd[0] !== nd[nd.length - 1] || nd.length < 5) continue;
  const pts = []; for (const id of nd) { const q = nodes.get(id); if (q) pts.push(q.x, q.y); }
  const ring = pts.slice(0, -2); let A2 = 0, cx = 0, cy = 0;
  for (let i = 0; i < ring.length; i += 2) { const j = (i + 2) % ring.length; const c = ring[i] * ring[j + 1] - ring[j] * ring[i + 1]; A2 += c; cx += (ring[i] + ring[j]) * c; cy += (ring[i + 1] + ring[j + 1]) * c; }
  cx /= 3 * A2; cy /= 3 * A2;
  if (!inWorld(cx, cy, 10)) continue;
  const h = roadWidthOf(parts[0].t) / 2;
  const radii = []; for (let i = 0; i < ring.length; i += 2) radii.push(Math.hypot(ring[i] - cx, ring[i + 1] - cy));
  const rMin = Math.min(...radii), rMean = radii.reduce((a, b) => a + b, 0) / radii.length;
  const island = []; for (let i = 0; i < ring.length; i += 2) { const k = Math.max(0, (radii[i / 2] - h - 0.15)) / radii[i / 2]; island.push(cx + (ring[i] - cx) * k, cy + (ring[i + 1] - cy) * k); }
  rings.push({ id: parts.map(p => p.id).join('+'), nd, cx, cy, h, rMean, rMin, island: rMin - h > 1.2 ? simplify(island.concat(island.slice(0, 2)), 0.1).slice(0, -2) : null,
    name: parts.map(p => p.t.name).find(Boolean) || '', cw: A2 > 0, cls: roadClass(parts[0].t.highway) });
}
// splitter islands: the triangle between the two one-way carriageways of a divided road where it meets the ring
const splitters = [];
for (const rg of rings) {
  const ringNodes = rg.nd.slice(0, -1); const armsAt = [];
  ringNodes.forEach((id, k) => {
    const n = gIndex.get(id); if (n === undefined) return; const arms = (nodeArms.get(n) || []).filter(a => !a.e.rb);
    if (arms.length === 1 && arms[0].e.ow !== 0) armsAt.push({ k, n, arm: arms[0] });
  });
  for (let i = 0; i + 1 < armsAt.length + (armsAt.length > 2 ? 1 : 0); i++) {
    const A = armsAt[i], B = armsAt[(i + 1) % armsAt.length]; if (A.arm.inbound === B.arm.inbound) continue;
    const walk = (n, arm) => { const pts = arm.pts.slice(); let cur = arm, end = arm.e.a === n ? arm.e.b : arm.e.a, len = arm.e.len; const seen = new Set([n]);
      while (len < 120) { const nxt = (nodeArms.get(end) || []); if (nxt.length !== 2 || seen.has(end)) break; seen.add(end); const o = nxt.find(a => a.e !== cur.e); if (!o) break; pts.push(...o.pts.slice(2)); len += o.e.len; end = o.e.a === end ? o.e.b : o.e.a; cur = o; }
      return { pts, end }; };
    const wa = walk(A.n, A.arm), wb = walk(B.n, B.arm); if (wa.end !== wb.end) continue;
    // ring arc from A to B (ring order)
    const arc = []; for (let k = A.k; ; k = (k + 1) % ringNodes.length) { const q = nodes.get(ringNodes[k]); arc.push(q.x, q.y); if (k === B.k) break; if (arc.length > 400) break; }
    const poly = arc.concat(wb.pts.slice(2), revPts(wa.pts).slice(2, -2));
    const area = Math.abs(ringArea(poly)); if (area < 4 || area > 3000) continue;
    splitters.push(simplify(poly.concat(poly.slice(0, 2)), 0.15).slice(0, -2));
  }
}
const minis = []; for (const n of nodes.values()) if (n.t && n.t.highway === 'mini_roundabout' && inWorld(n.x, n.y)) minis.push([n.x, n.y]);
console.log(`roundabouts ${rings.length} (islands ${rings.filter(r => r.island).length}), splitter islands ${splitters.length}, mini-roundabouts ${minis.length}`);
for (const rg of rings) console.log(`  roundabout ${rg.id} at ${rg.cx.toFixed(0)},${rg.cy.toFixed(0)} r ${rg.rMean.toFixed(1)} ${rg.cw ? 'clockwise' : 'ANTICLOCKWISE'} ${rg.cls}`);

// turning circles at the end of cul-de-sacs: a round bulb of asphalt
const turning = [];
for (const [id, n] of nodes) {
  if (!n.t || n.t.highway !== 'turning_circle' || !inWorld(n.x, n.y)) continue;
  const gi = gIndex.get(id); if (gi === undefined) continue; const arms = nodeArms.get(gi) || []; if (arms.length !== 1) continue;
  const h = arms[0].e.w / 2; turning.push([n.x, n.y, Math.min(10, Math.max(h + 2.5, 6.5))]);
}
// level crossings: the road surface carries on over the tracks
const xings = [];
for (const [id, n] of nodes) {
  if (!n.t || (n.t.railway !== 'level_crossing' && n.t.railway !== 'crossing') || !inWorld(n.x, n.y)) continue;
  for (const w of hwByNode.get(id) || []) {
    const i = w.nd.indexOf(id); const a = nodes.get(w.nd[Math.max(0, i - 1)]), b = nodes.get(w.nd[Math.min(w.nd.length - 1, i + 1)]); if (!a || !b || a === b) continue;
    xings.push([n.x, n.y, Math.atan2(b.y - a.y, b.x - a.x), bridgeW.get(w.id) || roadWidthOf(w.t), DRIVABLE.has(w.t.highway) ? 1 : 0]);
  }
}
console.log(`turning circles ${turning.length}, level crossings ${xings.length}`);

// connectivity check: drivable roads that cross on the same level without sharing a node (drawn as joined, not in the graph)
{
  const segs = []; const G2 = new Map();
  for (const e of gEdges) { if (e.br) continue; const p = e.full; for (let i = 0; i + 3 < p.length; i += 2) { const s = { i: segs.length, e, ax: p[i], ay: p[i + 1], bx: p[i + 2], by: p[i + 3] }; segs.push(s); const k = (Math.floor((s.ax + s.bx) / 2 / 50) << 16) ^ Math.floor((s.ay + s.by) / 2 / 50); if (!G2.has(k)) G2.set(k, []); G2.get(k).push(s); } }
  let crossings = 0; const ex = [];
  for (const s of segs) {
    const gx = Math.floor((s.ax + s.bx) / 2 / 50), gy = Math.floor((s.ay + s.by) / 2 / 50);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const t of G2.get(((gx + dx) << 16) ^ (gy + dy)) || []) {
      if (t.e === s.e || t.e.way === s.e.way || t.e.a === s.e.a || t.e.a === s.e.b || t.e.b === s.e.a || t.e.b === s.e.b || t.i <= s.i) continue;
      if (+(s.e.way.t.layer || 0) !== +(t.e.way.t.layer || 0) || s.e.way.t.tunnel || t.e.way.t.tunnel) continue;
      const X = lineX(s.ax, s.ay, s.bx - s.ax, s.by - s.ay, t.ax, t.ay, t.bx - t.ax, t.by - t.ay);
      if (X && X[2] > 0.001 && X[2] < 0.999 && X[3] > 0.001 && X[3] < 0.999) { crossings++; if (ex.length < 8) ex.push(`${X[0].toFixed(0)},${X[1].toFixed(0)} ${s.e.way.t.name || s.e.c} x ${t.e.way.t.name || t.e.c}`); }
    }
  }
  console.log(`unjoined same-level road crossings ${crossings}${ex.length ? ': ' + ex.join('; ') : ''}`);
}

// ---------- raster ----------
console.log(`raster ${GW}x${GH}`);
const ground = new Uint8Array(GW * GH).fill(G.LAND);
function fillPoly(rings, val, grid = ground, w = GW, h = GH, cell = CELL) {
  // scanline even-odd over all rings
  let minY = Infinity, maxY = -Infinity;
  for (const r of rings) for (let i = 1; i < r.length; i += 2) { minY = Math.min(minY, r[i]); maxY = Math.max(maxY, r[i]); }
  const y0 = Math.max(0, Math.floor(minY / cell)), y1 = Math.min(h - 1, Math.ceil(maxY / cell));
  const xs = [];
  for (let cy = y0; cy <= y1; cy++) {
    const yy = (cy + 0.5) * cell; xs.length = 0;
    for (const r of rings) {
      const n = r.length;
      for (let i = 0; i < n; i += 2) {
        const j = (i + 2) % n; const ay = r[i + 1], by = r[j + 1];
        if ((ay <= yy && by > yy) || (by <= yy && ay > yy)) xs.push(r[i] + (yy - ay) / (by - ay) * (r[j] - r[i]));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.round(xs[k] / cell)), xb = Math.min(w - 1, Math.round(xs[k + 1] / cell) - 1);
      for (let cx = xa; cx <= xb; cx++) grid[cy * w + cx] = val;
    }
  }
}
function strokeLine(p, width, val, grid = ground, onlyIf = null) {
  const r = Math.max(0.5, width / 2 / CELL);
  for (let i = 0; i + 3 < p.length; i += 2) {
    const ax = p[i] / CELL, ay = p[i + 1] / CELL, bx = p[i + 2] / CELL, by = p[i + 3] / CELL;
    const L = Math.hypot(bx - ax, by - ay), steps = Math.max(1, Math.ceil(L * 2));
    for (let s = 0; s <= steps; s++) {
      const cx = ax + (bx - ax) * s / steps, cy = ay + (by - ay) * s / steps;
      const ri = Math.ceil(r);
      for (let dy = -ri; dy <= ri; dy++) for (let dx = -ri; dx <= ri; dx++) {
        if (dx * dx + dy * dy > r * r + 0.25) continue;
        const gx = Math.floor(cx + dx), gy = Math.floor(cy + dy);
        if (gx < 0 || gy < 0 || gx >= GW || gy >= GH) continue;
        const k = gy * GW + gx; if (onlyIf && !onlyIf(grid[k])) continue; grid[k] = val;
      }
    }
  }
}
function bresenham(p, mark) {
  for (let i = 0; i + 3 < p.length; i += 2) {
    let x0 = Math.floor(p[i] / CELL), y0 = Math.floor(p[i + 1] / CELL); const x1 = Math.floor(p[i + 2] / CELL), y1 = Math.floor(p[i + 3] / CELL);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1; let err = dx + dy;
    for (let g = 0; g < 100000; g++) {
      if (x0 >= 0 && y0 >= 0 && x0 < GW && y0 < GH) mark[y0 * GW + x0] = 1;
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err; if (e2 >= dy) { err += dy; x0 += sx; } if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
}
// areas by priority
const sortedAreas = areas.slice().sort((a, b) => (AREA_PRI[a.k] || 0) - (AREA_PRI[b.k] || 0));
for (const a of sortedAreas) if (a.k !== 'pier') fillPoly([a.p], AREA_GROUND[a.k]);
for (const w of waterways) strokeLine(w.p, w.w, G.WATER);
for (const r of roads) if (r.drive) strokeLine(r.p, r.w, r.c === 'track' ? G.DIRT : G.ROAD);
  else if (r.c !== 'pier' && r.c !== 'path' && r.c !== 'steps' && r.c !== 'bridleway') strokeLine(r.p, r.w, G.PAVED, ground, v => v !== G.ROAD);
for (const j of junctions) fillPoly([j.poly], G.ROAD);
// splitter islands: grass between the carriageways, then the roads that bound them stroked again (as drawn)
for (const sp of splitters) {
  fillPoly([sp], G.GRASS); const bb = bboxOf(sp);
  for (const r of roads) { if (!r.drive) continue; const b2 = bboxOf(r.p); if (b2[2] < bb[0] - r.w || b2[0] > bb[2] + r.w || b2[3] < bb[1] - r.w || b2[1] > bb[3] + r.w) continue; strokeLine(r.p, r.w, r.c === 'track' ? G.DIRT : G.ROAD); }
}
for (const [x, y, r] of turning) strokeLine([x, y, x + 0.01, y], r * 2, G.ROAD);
for (const rg of rings) if (rg.island) fillPoly([rg.island], G.GRASS);
for (const b of buildings) if (!b.ov) fillPoly([b.p], G.BUILDING);

// sea: coastline barrier then 4-connected flood fill from sea seeds
const barrier = new Uint8Array(GW * GH);
for (const c of coast) bresenham(c, barrier);
const sea = new Uint8Array(GW * GH);
const seeds = [[BBOX.maxLon - 0.001, BBOX.minLat + 0.001], [138.64, -35.592], [138.62, -35.585]].map(([lo, la]) => proj(lo, la));
const stack = [];
for (const [sx, sy] of seeds) { const gx = Math.floor(sx / CELL), gy = Math.floor(sy / CELL); if (gx >= 0 && gy >= 0 && gx < GW && gy < GH) stack.push(gy * GW + gx); }
while (stack.length) {
  const k = stack.pop(); if (sea[k] || barrier[k]) continue; sea[k] = 1;
  const x = k % GW, y = (k / GW) | 0;
  if (x > 0) stack.push(k - 1); if (x < GW - 1) stack.push(k + 1); if (y > 0) stack.push(k - GW); if (y < GH - 1) stack.push(k + GW);
}
// barrier cells adjacent to sea become sea too
for (let k = 0; k < GW * GH; k++) if (barrier[k] && !sea[k]) { const x = k % GW; if ((x > 0 && sea[k - 1]) || (x < GW - 1 && sea[k + 1]) || sea[k - GW] || sea[k + GW]) sea[k] = 2; }
let seaCount = 0; for (let k = 0; k < GW * GH; k++) if (sea[k]) { seaCount++; ground[k] = G.SEA; }
console.log(`sea fraction ${(seaCount / (GW * GH)).toFixed(3)}`);
if (seaCount / (GW * GH) > 0.7 || seaCount / (GW * GH) < 0.05) throw new Error('sea flood fill looks wrong (coastline leak?)');
// structures over water: piers, causeway, bridges, rails
for (const r of roads) if (r.c === 'pier' || r.br) {
  if (r.deck) strokeLine(r.p, Math.max(r.deck * 2, 3), G.PAVED);
  strokeLine(r.p, Math.max(r.w, 3), r.drive ? G.ROAD : G.PAVED);
}
for (const r of rails) strokeLine(r.p, r.k === 'tram' ? 3 : 3.5, G.PAVED, ground, v => v === G.SEA || v === G.WATER);
for (const a of areas) if (a.k === 'pier') fillPoly([a.p], G.PAVED);

// chamfer distance transform (3-4) in metres
function distance(isSrc) {
  const INF = 1e9; const d = new Float32Array(GW * GH);
  for (let k = 0; k < GW * GH; k++) d[k] = isSrc(k) ? 0 : INF;
  const a = 1, b = Math.SQRT2;
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    const k = y * GW + x; let v = d[k]; if (v === 0) continue;
    if (x > 0) v = Math.min(v, d[k - 1] + a);
    if (y > 0) { v = Math.min(v, d[k - GW] + a); if (x > 0) v = Math.min(v, d[k - GW - 1] + b); if (x < GW - 1) v = Math.min(v, d[k - GW + 1] + b); }
    d[k] = v;
  }
  for (let y = GH - 1; y >= 0; y--) for (let x = GW - 1; x >= 0; x--) {
    const k = y * GW + x; let v = d[k]; if (v === 0) continue;
    if (x < GW - 1) v = Math.min(v, d[k + 1] + a);
    if (y < GH - 1) { v = Math.min(v, d[k + GW] + a); if (x < GW - 1) v = Math.min(v, d[k + GW + 1] + b); if (x > 0) v = Math.min(v, d[k + GW - 1] + b); }
    d[k] = v;
  }
  for (let k = 0; k < GW * GH; k++) d[k] *= CELL;
  return d;
}
const isSea = k => ground[k] === G.SEA;
const dLand = distance(k => !isSea(k)); // for sea cells: distance to land
const dSea = distance(isSea);           // for land cells: distance to sea
const dRoad = distance(k => ground[k] === G.ROAD);

// ---------- procedural props ----------
// spatial grid of drivable road segments for frontage lookup
const SG = 40; const segGrid = new Map();
const segKey = (x, y) => (Math.floor(x / SG) << 16) ^ Math.floor(y / SG);
const roadSegs = [];
for (const r of roads) {
  if (!r.drive) continue;
  for (let i = 0; i + 3 < r.p.length; i += 2) {
    const s = { ax: r.p[i], ay: r.p[i + 1], bx: r.p[i + 2], by: r.p[i + 3], r };
    roadSegs.push(s);
    const bb = [Math.min(s.ax, s.bx), Math.min(s.ay, s.by), Math.max(s.ax, s.bx), Math.max(s.ay, s.by)];
    for (let gx = Math.floor(bb[0] / SG); gx <= Math.floor(bb[2] / SG); gx++) for (let gy = Math.floor(bb[1] / SG); gy <= Math.floor(bb[3] / SG); gy++) {
      const k = (gx << 16) ^ gy; if (!segGrid.has(k)) segGrid.set(k, []); segGrid.get(k).push(s);
    }
  }
}
function nearestSeg(x, y, maxD, filter) {
  let best = null, bd = maxD;
  const g0x = Math.floor((x - maxD) / SG), g1x = Math.floor((x + maxD) / SG), g0y = Math.floor((y - maxD) / SG), g1y = Math.floor((y + maxD) / SG);
  const seen = new Set();
  for (let gx = g0x; gx <= g1x; gx++) for (let gy = g0y; gy <= g1y; gy++) {
    const L = segGrid.get((gx << 16) ^ gy); if (!L) continue;
    for (const s of L) {
      if (seen.has(s)) continue; seen.add(s); if (filter && !filter(s)) continue;
      const dx = s.bx - s.ax, dy = s.by - s.ay, l2 = dx * dx + dy * dy || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (y - s.ay) * dy) / l2));
      const px = s.ax + dx * t, py = s.ay + dy * t, d = Math.hypot(x - px, y - py);
      if (d < bd) { bd = d; best = { s, px, py, d, t }; }
    }
  }
  return best;
}
const cellAt = (x, y) => { const gx = Math.floor(x / CELL), gy = Math.floor(y / CELL); return gx < 0 || gy < 0 || gx >= GW || gy >= GH ? G.SEA : ground[gy * GW + gx]; };
const free = (x, y) => { const c = cellAt(x, y); return c !== G.BUILDING && c !== G.SEA && c !== G.WATER && c !== G.ROAD; };

const props = []; // [kind, x, y, angle]
const PK = { lamp: 0, signal: 1, bin: 2, letterbox: 3, fence: 4, chair: 5, table: 6, bench: 7, tree: 8, bush: 9, bollard: 10, sign: 11, binR: 12, binY: 13, binG: 14, hydrant: 15, phonebox: 16 };
const addProp = (k, x, y, a = 0) => { if (inWorld(x, y, -2)) props.push([PK[k], q(x), q(y), Math.round(a * 100) / 100]); };
const doors = []; // ding-dong-ditch doors [x,y, lbX, lbY]
const LOCAL = new Set(['residential', 'unclassified', 'living_street', 'tertiary']);

// houses: letterbox, bins, front fence, door
const houseKinds = new Set(['house', 'detached', 'residential', 'yes', 'semidetached_house', 'bungalow', 'terrace']);
let houses = 0;
for (const b of buildings) {
  const A = Math.abs(ringArea(b.p));
  if (!houseKinds.has(b.t.building) || A < 50 || A > 500) continue;
  const [cx, cy] = centroid(b.p);
  if (!inWorld(cx, cy)) continue;
  const ns = nearestSeg(cx, cy, 45, s => LOCAL.has(s.r.c));
  if (!ns) continue;
  houses++;
  const { s, px, py, d } = ns;
  const nx = (cx - px) / (d || 1), ny = (cy - py) / (d || 1);
  const tx = (s.bx - s.ax), ty = (s.by - s.ay), tl = Math.hypot(tx, ty) || 1; const ux = tx / tl, uy = ty / tl;
  const hw = s.r.w / 2;
  let lo = hw + 1.4; while (lo < hw + 9 && cellAt(px + nx * lo, py + ny * lo) === G.ROAD) lo += 0.5; // past a turning bulb or junction fillet
  const lbx = px + nx * lo, lby = py + ny * lo;
  if (!free(lbx, lby)) continue;
  const ang = Math.atan2(ny, nx);
  addProp('letterbox', lbx, lby, ang);
  if (rnd() < 0.8) { const o = 1.4 + rnd(); addProp('binR', lbx + ux * o, lby + uy * o, ang); if (rnd() < 0.55) addProp(rnd() < 0.5 ? 'binY' : 'binG', lbx + ux * (o + 0.9), lby + uy * (o + 0.9), ang); }
  if (rnd() < 0.5) {
    const off = hw + 2.0;
    for (let k = -3; k <= 3; k++) {
      if (k === 0 || k === -1) continue; // gate gap
      const fx = px + nx * off + ux * k * 2, fy = py + ny * off + uy * k * 2;
      if (free(fx, fy)) addProp('fence', fx, fy, Math.atan2(uy, ux));
    }
  }
  // door: point on building ring nearest the road
  let bd = Infinity, dx = cx, dy = cy;
  for (let i = 0; i < b.p.length; i += 2) {
    const j = (i + 2) % b.p.length; const ax = b.p[i], ay = b.p[i + 1], bx2 = b.p[j], by2 = b.p[j + 1];
    const mx = (ax + bx2) / 2, my = (ay + by2) / 2; const dd = Math.hypot(mx - px, my - py); if (dd < bd) { bd = dd; dx = mx; dy = my; }
  }
  doors.push([q(dx + (px - dx) / (bd || 1) * 0.6), q(dy + (py - dy) / (bd || 1) * 0.6), q(lbx), q(lby)]);
}
console.log(`houses with frontage ${houses}`);

// street lamps: OSM lamps + generated along roads
const lampPts = [];
for (const n of nodes.values()) if (n.t && n.t.highway === 'street_lamp' && inWorld(n.x, n.y)) { lampPts.push([n.x, n.y]); addProp('lamp', n.x, n.y, 0); }
const lampGrid = new Set(lampPts.map(([x, y]) => (Math.floor(x / 25) << 16) ^ Math.floor(y / 25)));
for (const r of roads) {
  if (!r.drive || !['primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street', 'trunk'].includes(r.c)) continue;
  const spacing = r.c === 'residential' ? 55 : 42; let acc = spacing * rnd(), side = 1;
  for (let i = 0; i + 3 < r.p.length; i += 2) {
    const ax = r.p[i], ay = r.p[i + 1], bx = r.p[i + 2], by = r.p[i + 3]; const L = Math.hypot(bx - ax, by - ay); if (!L) continue;
    const ux = (bx - ax) / L, uy = (by - ay) / L;
    let t = spacing - acc;
    while (t < L) {
      const x = ax + ux * t - uy * side * (r.w / 2 + 0.7), y = ay + uy * t + ux * side * (r.w / 2 + 0.7);
      const gk = (Math.floor(x / 25) << 16) ^ Math.floor(y / 25);
      if (!lampGrid.has(gk) && free(x, y)) { addProp('lamp', x, y, Math.atan2(ux * side, -uy * side)); lampGrid.add(gk); }
      side = -side; t += spacing;
    }
    acc = (acc + L) % spacing;
  }
}
// traffic signals, crossings, benches, bins, trees, hydrants etc from OSM nodes
for (const n of nodes.values()) {
  const t = n.t; if (!t || !inWorld(n.x, n.y)) continue;
  if (t.highway === 'traffic_signals' || t.crossing === 'traffic_signals') {
    const ns = nearestSeg(n.x, n.y, 15);
    const hw = ns ? ns.s.r.w / 2 + 1.2 : 5;
    const a0 = ns ? Math.atan2(ns.s.by - ns.s.ay, ns.s.bx - ns.s.ax) : 0;
    for (const k of [0, 1, 2, 3]) { const a = a0 + Math.PI / 4 + k * Math.PI / 2; const x = n.x + Math.cos(a) * hw * 1.41, y = n.y + Math.sin(a) * hw * 1.41; if (free(x, y)) addProp('signal', x, y, a0 + k * Math.PI / 2); }
  }
  if (t.amenity === 'bench') addProp('bench', n.x, n.y, rnd() * 6.28);
  if (t.amenity === 'waste_basket' || t.amenity === 'waste_disposal' || t.amenity === 'recycling') addProp('bin', n.x, n.y, 0);
  if (t.natural === 'tree') addProp('tree', n.x, n.y, rnd() * 6.28);
  if (t.emergency === 'fire_hydrant') addProp('hydrant', n.x, n.y, 0);
  if (t.barrier === 'bollard') addProp('bollard', n.x, n.y, 0);
  if (t.amenity === 'telephone') addProp('phonebox', n.x, n.y, 0);
}
// café furniture
const pois = [];
const POI_KINDS = new Set(['cafe', 'restaurant', 'fast_food', 'pub', 'bar', 'ice_cream', 'fuel', 'police', 'townhall', 'library', 'toilets', 'school', 'hospital',
  'cinema', 'theatre', 'bank', 'post_office', 'pharmacy', 'place_of_worship', 'community_centre', 'marketplace', 'bus_station', 'ferry_terminal', 'parking']);
function addPoi(t, x, y) {
  if (!inWorld(x, y)) return;
  const kind = t.amenity && POI_KINDS.has(t.amenity) ? t.amenity : t.tourism || t.shop && 'shop' || t.leisure || t.railway === 'station' && 'station' || t.historic && 'historic' || t.place || null;
  if (!kind) return;
  pois.push({ k: kind, n: t.name || '', x: q(x), y: q(y) });
  if (['cafe', 'restaurant', 'fast_food', 'ice_cream', 'pub', 'bar'].includes(t.amenity)) {
    const ns = nearestSeg(x, y, 40);
    if (!ns) return;
    const nx = (x - ns.px) / (ns.d || 1), ny = (y - ns.py) / (ns.d || 1); const ux = -ny, uy = nx; const off = ns.s.r.w / 2 + 2.6;
    for (let c = 0; c < 2; c++) {
      const tx = ns.px + nx * off + ux * (c * 3.2 - 1.6), ty = ns.py + ny * off + uy * (c * 3.2 - 1.6);
      if (!free(tx, ty)) continue;
      addProp('table', tx, ty, 0);
      for (let s = 0; s < 4; s++) { const a = s * Math.PI / 2 + 0.3 * rnd(); addProp('chair', tx + Math.cos(a) * 0.9, ty + Math.sin(a) * 0.9, a + Math.PI); }
    }
  }
}
for (const n of nodes.values()) if (n.t) addPoi(n.t, n.x, n.y);
for (const w of ways.values()) if (closed(w) && (w.t.amenity || w.t.tourism || w.t.leisure === 'park' || w.t.railway === 'station' || w.t.shop || w.t.historic)) { const [x, y] = centroid(wayPts(w)); if (w.t.name) addPoi(w.t, x, y); }
for (const rel of relations) if (rel.t.name && (rel.t.leisure || rel.t.amenity)) { const r = assembleRings(rel.members.filter(m => m.role !== 'inner').map(m => m.ref))[0]; if (r) { const [x, y] = centroid(r); addPoi(rel.t, x, y); } }
// places (suburb names)
const places = [];
for (const n of nodes.values()) if (n.t && n.t.place && n.t.name && ['suburb', 'town', 'village', 'hamlet', 'neighbourhood', 'locality', 'island', 'islet'].includes(n.t.place)) places.push({ n: n.t.name, k: n.t.place, x: q(n.x), y: q(n.y) });

// scattered trees and bushes in green areas and backyards
function scatter(poly, density, kindFn) {
  const bb = bboxOf(poly); const A = Math.abs(ringArea(poly)); const n = Math.min(4000, Math.round(A * density));
  for (let i = 0; i < n; i++) {
    const x = bb[0] + rnd() * (bb[2] - bb[0]), y = bb[1] + rnd() * (bb[3] - bb[1]);
    if (!inWorld(x, y)) continue;
    // point in polygon
    let inside = false; for (let a = 0, b = poly.length - 2; a < poly.length; b = a, a += 2) { if ((poly[a + 1] > y) !== (poly[b + 1] > y) && x < (poly[b] - poly[a]) * (y - poly[a + 1]) / (poly[b + 1] - poly[a + 1]) + poly[a]) inside = !inside; }
    if (!inside || !free(x, y)) continue;
    const c = cellAt(x, y); if (c === G.PITCH || c === G.PAVED || c === G.SAND) continue;
    addProp(kindFn(), x, y, rnd() * 6.28);
  }
}
for (const a of areas) {
  if (a.k === 'wood') scatter(a.p, 1 / 70, () => rnd() < 0.7 ? 'tree' : 'bush');
  else if (a.k === 'scrub') scatter(a.p, 1 / 110, () => rnd() < 0.25 ? 'tree' : 'bush');
  else if (a.k === 'park' || a.k === 'cemetery') scatter(a.p, 1 / 500, () => rnd() < 0.7 ? 'tree' : 'bush');
  else if (a.k === 'residential') scatter(a.p, 1 / 380, () => rnd() < 0.6 ? 'tree' : 'bush');
  else if (a.k === 'golf') scatter(a.p, 1 / 900, () => 'tree');
}
const counts = {}; for (const p of props) counts[p[0]] = (counts[p[0]] || 0) + 1;
console.log('props', props.length, Object.entries(counts).map(([k, v]) => Object.keys(PK)[k] + ':' + v).join(' '));

// coastline sample points for surf (every ~6 m along the shore)
const shore = [];
for (let y = 1; y < GH - 1; y += 3) for (let x = 1; x < GW - 1; x += 3) {
  const k = y * GW + x; if (ground[k] !== G.SEA) continue;
  if (dLand[k] <= CELL * 1.5) shore.push(q(x * CELL + 1), q(y * CELL + 1));
}

// ---------- write raster PNGs ----------
function crc32(buf) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
const CRC_T = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crcFast(buf) { let crc = 0xffffffff; for (let i = 0; i < buf.length; i++) crc = CRC_T[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crcFast(td)); return Buffer.concat([len, td, c]); }
function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = y === 0 ? 0 : 2;
    for (let i = 0; i < w * 3; i++) raw[y * (w * 3 + 1) + 1 + i] = y === 0 ? rgb[i] : (rgb[y * w * 3 + i] - rgb[(y - 1) * w * 3 + i]) & 255;
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const TILE_ROWS = Math.ceil(GH / 2);
const rasterFiles = [];
for (let part = 0; part * TILE_ROWS < GH; part++) {
  const y0 = part * TILE_ROWS, h = Math.min(TILE_ROWS, GH - y0);
  const rgb = Buffer.alloc(GW * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < GW; x++) {
    const k = (y0 + y) * GW + x, o = (y * GW + x) * 3;
    rgb[o] = ground[k];
    const sd = ground[k] === G.SEA ? -dLand[k] : dSea[k];
    rgb[o + 1] = Math.max(0, Math.min(255, Math.round(128 + sd)));
    rgb[o + 2] = Math.min(255, Math.round(dRoad[k]));
  }
  const f = `ground_${part}.png`; fs.writeFileSync(path.join(OUT, f), png(GW, h, rgb)); rasterFiles.push({ f, y0, h });
  console.log('wrote', f, fs.statSync(path.join(OUT, f)).size);
}

// ---------- street name labels ----------
// Painted along the road in the game's 5x7 pixel font (one font pixel = one art pixel = 0.25 m), in the left-hand lane
// when the road has a centre line, never over a junction, roundabout, bridge or level crossing, never upside down.
// Tier 0 = main roads (kept at wide zoom), 1 = local streets, 2 = full-map only (streets too short for painted text).
const SUFFIX = { street: 'ST', road: 'RD', terrace: 'TCE', avenue: 'AVE', drive: 'DR', parade: 'PDE', crescent: 'CRES', court: 'CT', boulevard: 'BVD', place: 'PL',
  circuit: 'CCT', grove: 'GR', close: 'CL', highway: 'HWY', square: 'SQ', lane: 'LANE', way: 'WAY', rise: 'RISE', walk: 'WALK', mews: 'MEWS', parkway: 'PWY', boulevarde: 'BVD' };
const abbr = s => { const w = s.trim().split(/\s+/); if (w.length > 1 && !(w.length === 2 && /^the$/i.test(w[0])) && SUFFIX[w[w.length - 1].toLowerCase()]) w[w.length - 1] = SUFFIX[w[w.length - 1].toLowerCase()]; return w.join(' ').toUpperCase(); };
const MAJOR = new Set(['trunk', 'primary', 'secondary', 'tertiary']);
const avoid = []; // [x, y, r]
for (const j of junctions) avoid.push([j.x, j.y, j.r + 2]);
for (const rg of rings) avoid.push([rg.cx, rg.cy, rg.rMean + rg.h + 4]);
for (const [x, y, r] of turning) avoid.push([x, y, r + 1]);
for (const [x, y] of xings) avoid.push([x, y, 7]);
const avoidGrid = new Map(); const AG = 40;
for (const a of avoid) for (let gx = Math.floor((a[0] - a[2]) / AG); gx <= Math.floor((a[0] + a[2]) / AG); gx++) for (let gy = Math.floor((a[1] - a[2]) / AG); gy <= Math.floor((a[1] + a[2]) / AG); gy++) { const k = gx * 100003 + gy; if (!avoidGrid.has(k)) avoidGrid.set(k, []); avoidGrid.get(k).push(a); }
const blocked = (x, y) => { const L = avoidGrid.get(Math.floor(x / AG) * 100003 + Math.floor(y / AG)); if (L) for (const a of L) if (Math.hypot(x - a[0], y - a[1]) < a[2]) return true; return decks.some(d => polyDist(x, y, d.p) < d.hw + 3); };
const labels = []; const placedByName = new Map(); const allPlaced = [];
const named = roads.filter(r => r.drive && r.n >= 0 && !r.rb && !r.br && r.c !== 'track' && r.w >= 4.2).map(r => ({ r, L: polyLen(r.p) })).sort((a, b) => (MAJOR.has(b.r.c) - MAJOR.has(a.r.c)) || b.L - a.L);
for (const { r, L } of named) {
  const name = names[r.n]; const text = abbr(name); const tl = (text.length * 6 + 1) / 4; const tier = MAJOR.has(r.c) ? 0 : 1;
  if (decks.some(d => d.way === r.way)) continue;
  const spacing = tier === 0 ? 150 : 170; const mine = placedByName.get(name) || []; placedByName.set(name, mine);
  const lane = r.w >= 6.5 && r.ow === 0 && r.c !== 'service' ? r.w / 4 : 0;
  for (let s = tl / 2 + 3; s <= L - tl / 2 - 3; s += 5) {
    const a = along(r.p, s - tl / 2 - 1.5), b = along(r.p, s + tl / 2 + 1.5); const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2;
    if (mine.some(([x, y]) => Math.hypot(x - cx, y - cy) < spacing) || allPlaced.some(([x, y]) => Math.hypot(x - cx, y - cy) < 28)) continue;
    // straight enough under the text?
    const sub = subLine(r.p, s - tl / 2 - 1.5, s + tl / 2 + 1.5); let dev = 0; for (let i = 2; i + 2 < sub.length; i += 2) dev = Math.max(dev, segDist(sub[i], sub[i + 1], a[0], a[1], b[0], b[1]));
    if (dev > 0.7) continue;
    let ang = Math.atan2(b[1] - a[1], b[0] - a[0]); if (ang > Math.PI / 2) ang -= Math.PI; if (ang <= -Math.PI / 2 + 0.07) ang += Math.PI; // near-vertical names all read top to bottom
    const nx = -Math.sin(ang), ny = Math.cos(ang); const x = cx + nx * lane, y = cy + ny * lane;
    let bad = false; for (let k = -1; k <= 1 && !bad; k += 0.25) { const px = x + Math.cos(ang) * (tl / 2 + 1) * k, py = y + Math.sin(ang) * (tl / 2 + 1) * k; if (blocked(px, py) || !inWorld(px, py, -2)) bad = true; }
    if (bad) continue;
    labels.push([q(x), q(y), Math.round(ang * 1000), nm(text), tier]); mine.push([cx, cy]); allPlaced.push([cx, cy]);
    s += spacing - 5;
  }
}
// streets too short (or too busy) for painted text still get a name on the full map
for (const [name, mine] of placedByName) if (!mine.length) {
  const best = named.filter(o => names[o.r.n] === name).sort((a, b) => b.L - a.L)[0]; if (!best) continue;
  const [x, y] = along(best.r.p, best.L / 2); labels.push([q(x), q(y), 0, nm(abbr(name)), 2]);
}
console.log(`street labels ${labels.filter(l => l[4] < 2).length} painted, ${labels.filter(l => l[4] === 2).length} map-only`);
// suburb and landmark names, faint and large on the ground (and on the full map)
const placeLabels = [];
for (const [n, x, y] of [['VICTOR HARBOR', 4600, 2380], ['ENCOUNTER BAY', 2718, 4976], ['HAYBOROUGH', 6794, 1659], ['McCRACKEN', 4529, 553], ['GRANITE ISLAND', 5800, 3750],
  ['THE BLUFF', 3016, 6790], ['CHITON ROCKS', 7566, 922], ['HINDMARSH VALLEY', 906, 1106], ['ENCOUNTER LAKES', 2550, 4500]]) placeLabels.push([q(x), q(y), n.toUpperCase(), 3]);
const LANDMARK = new Set(['park', 'golf', 'grass', 'cemetery', 'campus', 'wetland', 'industrial']);
const seenLm = new Set();
for (const a of areas) {
  if (!a.n || !LANDMARK.has(a.k) || seenLm.has(a.n)) continue; const A = Math.abs(ringArea(a.p)); if (A < 3000) continue;
  const [x, y] = centroid(a.p); let inside = false; const p = a.p; for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) if ((p[i + 1] > y) !== (p[j + 1] > y) && x < (p[j] - p[i]) * (y - p[i + 1]) / (p[j + 1] - p[i + 1]) + p[i]) inside = !inside;
  if (!inside || !inWorld(x, y)) continue; seenLm.add(a.n); placeLabels.push([q(x), q(y), a.n.toUpperCase(), 2]);
}
console.log(`place labels ${placeLabels.length}`);

// ---------- write map.json ----------
const buildingKept = buildings.filter(b => bboxHits(bboxOf(b.p), 10));
const buildingOut = buildingKept.map(b => {
  const t = b.t; let lv = +t['building:levels'] || 0; const h = parseFloat(t.height) || 0;
  const A = Math.abs(ringArea(b.p));
  if (!lv) lv = h ? Math.max(1, Math.round(h / 3)) : A > 1500 ? 2 : 1;
  const kind = t.building === 'yes' ? (t.amenity || t.shop ? 'shop' : A > 600 ? 'big' : 'house') : t.building;
  return { p: Q(simplify(b.p, 0.25)), lv: Math.min(lv, 8), k: kind, n: t.name || undefined, ov: b.ov || undefined };
});
// ---------- car places: fuel stations, car washes, car yards, repairers ----------
// For the game's invented garages and respray shops. Only the kind is kept, never the business name.
// id = OSM element ("n123" / "w123"), b = index into map.json buildings (-1 if none), a = road access point.
const CAR_NAME = /smash|panel|motor|auto|mechanic|tyre|tyres|service centre|car care/i;
const carKind = t => t.shop === 'car_repair' || t.craft === 'car_repair' || t.craft === 'panel_beater' || t.shop === 'car_parts' ? 'repair'
  : t.shop === 'tyres' ? 'tyres' : t.amenity === 'car_wash' ? 'car_wash' : t.amenity === 'fuel' ? 'fuel' : t.shop === 'car' ? 'car_yard'
  : t.amenity === 'vehicle_inspection' ? 'repair' : CAR_NAME.test(t.name || '') && !t.club ? 'repair' : null;
const keptIdx = new Map(buildingKept.map((b, i) => [b, i]));
const bldGrid = new Map(); buildingKept.forEach(b => { const bb = bboxOf(b.p); for (let gx = Math.floor(bb[0] / 50); gx <= Math.floor(bb[2] / 50); gx++) for (let gy = Math.floor(bb[1] / 50); gy <= Math.floor(bb[3] / 50); gy++) { const k = gx * 100003 + gy; if (!bldGrid.has(k)) bldGrid.set(k, []); bldGrid.get(k).push(b); } });
function buildingFor(x, y, wid) {
  if (wid) { const own = buildingKept.find(b => b.wid === wid); if (own) return own; }
  let best = null, bd = 25; const L = bldGrid.get(Math.floor(x / 50) * 100003 + Math.floor(y / 50)) || [];
  for (const b of L) { if (inPoly(x, y, b.p)) return b; const d = polyDist(x, y, b.p.concat(b.p.slice(0, 2))); if (d < bd) { bd = d; best = b; } }
  return best;
}
const carPlaces = [];
const addCar = (id, t, x, y, wid) => {
  const kind = carKind(t); if (!kind || !inWorld(x, y)) return;
  const b = buildingFor(x, y, wid); const ns = nearestSeg(x, y, 80, s => s.r.c !== 'track');
  carPlaces.push({ id, kind, x: q(x), y: q(y), b: b ? keptIdx.get(b) : -1, a: ns ? [q(ns.px), q(ns.py)] : null });
};
for (const [id, n] of nodes) if (n.t) addCar('n' + id, n.t, n.x, n.y);
for (const w of ways.values()) if (closed(w) && carKind(w.t)) { const [x, y] = centroid(wayPts(w).slice(0, -2)); addCar('w' + w.id, w.t, x, y, w.t.building ? w.id : null); }
console.log('car places', carPlaces.length, Object.entries(carPlaces.reduce((o, c) => (o[c.kind] = (o[c.kind] || 0) + 1, o), {})).map(e => e.join(':')).join(' '));

// rail routes: join rail pieces end to end into the longest chain per kind (main line, tram line)
function longestChain(pieces) {
  const segs = pieces.map(p => p.slice());
  const near = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by) < 1.5;
  let best = [];
  for (let s = 0; s < segs.length; s++) {
    for (const flip of [false, true]) {
      let cur = flip ? rev(segs[s]) : segs[s].slice(); const used = new Set([s]);
      for (let grow = true; grow;) {
        grow = false; const ex = cur[cur.length - 2], ey = cur[cur.length - 1];
        let pick = -1, pickRev = false, pickLen = -1;
        for (let i = 0; i < segs.length; i++) {
          if (used.has(i)) continue; const g = segs[i]; const L = g.length;
          if (near(g[0], g[1], ex, ey) && L > pickLen) { pick = i; pickRev = false; pickLen = L; }
          else if (near(g[L - 2], g[L - 1], ex, ey) && L > pickLen) { pick = i; pickRev = true; pickLen = L; }
        }
        if (pick >= 0) { used.add(pick); cur = cur.concat((pickRev ? rev(segs[pick]) : segs[pick]).slice(2)); grow = true; }
      }
      if (lenOf(cur) > lenOf(best)) best = cur;
    }
  }
  return best;
  function rev(p) { const o = []; for (let i = p.length - 2; i >= 0; i -= 2) o.push(p[i], p[i + 1]); return o; }
  function lenOf(p) { let l = 0; for (let i = 2; i < p.length; i += 2) l += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]); return l; }
}
const railRoutes = {
  train: Q(simplify(longestChain(rails.filter(r => r.k === 'train' && /Victor/.test(r.n)).map(r => r.p)), 0.1)),
  tram: Q(simplify(longestChain(rails.filter(r => r.k === 'tram').map(r => r.p)), 0.1)),
};
console.log('rail routes', railRoutes.train.length / 2, railRoutes.tram.length / 2);

const out = {
  railRoutes,
  meta: {
    title: 'Victor Harbor, Encounter Bay, Hayborough and McCracken (South Australia)',
    attribution: '© OpenStreetMap contributors (ODbL 1.0)', bbox: BBOX, worldW: Math.round(WORLD_W), worldH: Math.round(WORLD_H), units: 'decimetres',
    cell: CELL, gw: GW, gh: GH, raster: rasterFiles, osmBase, built: new Date().toISOString(), groundClasses: G, propKinds: PK,
  },
  names,
  roads: roads.map(r => ({ c: r.c, w: r.w, l: r.l, ow: r.ow, rb: r.rb, br: r.br, n: r.n, sf: r.sf, d: r.drive ? 1 : 0, p: Q(r.p), ...(r.deck ? { dk: Math.round(r.deck * 10) / 10 } : {}) })),
  rails: rails.map(r => ({ k: r.k, n: r.n, br: r.br, p: Q(simplify(r.p, 0.1)) })),
  buildings: buildingOut,
  areas: sortedAreas.map(a => ({ k: a.k, n: a.n || undefined, p: Q(a.p) })),
  barriers: barriers.map(b => ({ k: b.k, p: Q(b.p) })),
  waterways: waterways.map(w => ({ k: w.k, w: w.w, p: Q(w.p) })),
  graph: { nodes: gNodes.map(q), edges: gEdges.map(e => [e.a, e.b, e.ow, Math.round(e.w * 10), e.s, e.n, e.rb, Q(e.p)]) },
  props, doors, pois, places, shore, carPlaces,
  // solid lines that block vehicles and people (bridge railings), joined to the building walls in world.js
  walls: walls.map(w => ({ k: w.k, p: Q(w.p) })),
  // road furniture for the renderer (decimetres): junction polygons with give-way (0) / stop (1) lines, roundabout
  // islands, splitter islands, mini-roundabouts, turning circles, level crossings, street-name and place labels
  decor: {
    junctions: junctions.map(j => [q(j.x), q(j.y), q(j.r), Q(j.poly), j.gw.map(g => [q(g[0]), q(g[1]), q(g[2]), q(g[3]), g[4]])]),
    islands: rings.filter(r => r.island).map(r => [q(r.cx), q(r.cy), Q(r.island)]),
    splitters: splitters.map(Q),
    minis: minis.map(([x, y]) => [q(x), q(y), 20]).concat(rings.filter(r => !r.island).map(r => [q(r.cx), q(r.cy), q(Math.max(1, r.rMin - r.h - 0.15))])),
    turning: turning.map(([x, y, r]) => [q(x), q(y), q(r)]),
    xings: xings.map(([x, y, a, w, d]) => [q(x), q(y), Math.round(a * 1000), q(w), d]),
    labels, places: placeLabels,
  },
};
const json = JSON.stringify(out);
fs.writeFileSync(path.join(OUT, 'map.json'), json);
console.log('wrote map.json', json.length);

// sha256 of the raw input for the SOURCES note
const sha = crypto.createHash('sha256').update(fs.readFileSync(RAW)).digest('hex');
console.log('raw sha256', sha);

// optional colour preview of the ground raster: node build_map.mjs --preview out.png
const pi = process.argv.indexOf('--preview');
if (pi > 0) {
  const PAL = [[40, 90, 150], [170, 160, 110], [110, 160, 80], [200, 180, 90], [90, 120, 70], [235, 215, 160], [70, 70, 75], [200, 80, 60], [60, 120, 190],
    [150, 150, 150], [130, 120, 110], [130, 175, 95], [160, 130, 90], [50, 100, 50], [80, 130, 110], [120, 200, 100], [90, 190, 90]];
  const S = 2, w = Math.floor(GW / S), h = Math.floor(GH / S); const rgb = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = PAL[ground[y * S * GW + x * S]] || [255, 0, 255]; rgb.set(c, (y * w + x) * 3); }
  fs.writeFileSync(process.argv[pi + 1], png(w, h, rgb)); console.log('preview', process.argv[pi + 1]);
}
