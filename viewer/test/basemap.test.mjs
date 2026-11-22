import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { basemapLayers, BASEMAP_COLOURS, labelsAt, demSourceTile, buildingHeight, LABEL_CLASSES, PITCH_3D } from '../js/basemap.js';
import { oklabL, chroma } from '../js/colour.js';

const colours = (layers) => layers.flatMap((l) => Object.entries(l.paint || {})
  .filter(([k]) => /color$/.test(k) && !k.startsWith('hillshade')).map(([k, v]) => [l.id, k, v]))
  .flatMap(([id, k, v]) => (typeof v === 'string' ? [[id, k, v]] : JSON.stringify(v).match(/#[0-9a-f]{6}/gi)?.map((c) => [id, k, c]) ?? []));

test('base map layers are all "bm-" layers on the base map sources', () => {
  for (const theme of ['light', 'dark']) {
    const L = basemapLayers(theme);
    assert.ok(L.length >= 8);
    for (const l of L) {
      assert.match(l.id, /^bm-/);
      assert.ok(['bm', 'bm-buildings', 'bm-hillshade'].includes(l.source), l.id);
    }
    for (const id of ['bm-sea', 'bm-landuse', 'bm-water', 'bm-waterway', 'bm-rail', 'bm-pier', 'bm-buildings', 'bm-buildings-3d', 'bm-hillshade']) {
      assert.ok(L.some((l) => l.id === id), `${theme}: ${id}`);
    }
    assert.ok(L.findIndex((l) => l.id === 'bm-hillshade') < L.findIndex((l) => l.id === 'bm-buildings'), 'hill shading under the buildings');
    assert.equal(L.find((l) => l.id === 'bm-buildings-3d').layout.visibility, 'none', '3D buildings only in 3D');
  }
});

test('base map layers are valid MapLibre style layers (style-spec validator from the maplibre-gl dev dependency)', async (t) => {
  let spec;
  try { spec = await import('@maplibre/maplibre-gl-style-spec'); } catch { t.skip('npm install first'); return; }
  for (const theme of ['light', 'dark']) {
    const style = { version: 8, sources: {
      bm: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      'bm-buildings': { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      'bm-hillshade': { type: 'raster-dem', tiles: ['x://{z}/{x}/{y}'], tileSize: 512, encoding: 'terrarium' } },
    layers: basemapLayers(theme) };
    assert.deepEqual(spec.validateStyleMin(style).map((e) => e.message), [], theme);
  }
});

test('base map colours are quiet: pale and greyish in light mode, dark in dark mode, so traffic colours dominate', () => {
  for (const [id, k, c] of colours(basemapLayers('light'))) {
    assert.ok(oklabL(c) >= 0.72, `${id} ${k} ${c} is too dark for a background`);
    assert.ok(chroma(c) <= 0.06, `${id} ${k} ${c} is too colourful`);
  }
  for (const [id, k, c] of colours(basemapLayers('dark'))) {
    assert.ok(oklabL(c) <= 0.42, `${id} ${k} ${c} is too light for a dark background`);
    assert.ok(chroma(c) <= 0.06, `${id} ${k} ${c}`);
  }
  assert.notEqual(BASEMAP_COLOURS.light.sea, BASEMAP_COLOURS.light.land, 'sea and land differ');
});

test('labels appear from their own zoom, and every class in the baked base map has a style', () => {
  const labels = [{ name: 'Granite Island', c: 'island', z: 12 }, { name: 'Warland Reserve', c: 'park', z: 14.5 }];
  assert.deepEqual(labelsAt(labels, 12.5).map((l) => l.name), ['Granite Island']);
  assert.deepEqual(labelsAt(labels, 15).map((l) => l.name), ['Granite Island', 'Warland Reserve']);
  const bm = JSON.parse(readFileSync(new URL('../basemap/basemap.json', import.meta.url)));
  const classes = new Set(bm.features.filter((f) => f.properties.l === 'label').map((f) => f.properties.c));
  for (const c of classes) assert.ok(LABEL_CLASSES.includes(c), c);
  for (const n of ['Granite Island', 'Encounter Bay', 'Town centre', 'Mount Breckan', 'Warland Reserve', 'Hindmarsh River', 'Inman River', 'South Coast District Hospital']) {
    assert.ok(bm.features.some((f) => f.properties.l === 'label' && f.properties.name.startsWith(n)), n);
  }
});

test('terrain: a bundled tile is used as is; a missing deeper tile is cut from its nearest bundled ancestor', () => {
  const have = new Set(['10/905/619', '11/1810/1239', '12/3624/2480']);
  assert.deepEqual(demSourceTile(12, 3624, 2480, have), { z: 12, x: 3624, y: 2480, k: 1, dx: 0, dy: 0 });
  // 12/3621/2479 is in 11/1810/1239, lower-right quarter
  assert.deepEqual(demSourceTile(12, 3621, 2479, have), { z: 11, x: 1810, y: 1239, k: 2, dx: 1, dy: 1 });
  // 12/3620/2476 -> 11/1810/1238 (missing) -> 10/905/619 at quarter-scale offset (0, 0)
  assert.deepEqual(demSourceTile(12, 3620, 2476, have), { z: 10, x: 905, y: 619, k: 4, dx: 0, dy: 0 });
  assert.equal(demSourceTile(12, 100, 100, have), null);
});

test('building heights: baked height, never below a metre; 3D starts tilted', () => {
  assert.deepEqual(buildingHeight(), ['max', 1, ['coalesce', ['get', 'h'], 4.5]]);
  assert.ok(PITCH_3D >= 45 && PITCH_3D <= 70);
});
