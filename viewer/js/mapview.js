// One MapLibre map showing a network: per-lane lines (congestion), per-direction edge lines (travel
// time), zones, places, route, target, over a base map (land, sea, buildings, labels, hill shading; see
// basemap.js) with an optional tilted 3D view (terrain and extruded buildings). Values arrive as feature-state
// `v` so recolouring is cheap; on comparison maps an emphasis `e` (changes.js) sets line width and opacity.
import { colourExpression, NO_DATA, CASING } from './colour.js';
import { basemapLayers, basemapPaint, BASEMAP_COLOURS, OSM_CREDIT, TERRAIN_CREDIT, PITCH_3D, TERRAIN_EXAGGERATION, labelsAt, demSourceTile } from './basemap.js';

// Lane width in pixels by zoom: exaggerated at town zoom, close to true scale (3.2 m) from zoom 16.
const W = [12, 1.2, 14, 2.1, 15, 2.7, 16, 3.6, 20, 52.8];
// zoom must be the top-level input, so data-driven parts go inside each stop's output
const zoomed = (out) => ['interpolate', ['exponential', 2], ['zoom'], ...W.flatMap((v, i) => (i % 2 === 0 ? [v] : [out(v)]))];
const scaled = (expr, k = 1) => zoomed((v) => ['*', expr, v * k]);
const widthOf = (k, add = 0) => zoomed((v) => Math.max(1, v * k) + add);

// emphasis (feature-state e: 0 = inside the noise band, up to 1 = a big change): width factor and opacity
const E = ['coalesce', ['feature-state', 'e'], 0];
const emphFactor = ['+', 0.45, ['*', 1.35, E]];
const lineWidth = (src, k, add, emph) => {
  if (src === 'lanes') return emph ? zoomed((v) => ['+', ['*', Math.max(1, v * k), emphFactor], add]) : widthOf(k, add);
  const base = (v) => ['max', 1.2, ['*', ['get', 'n'], v * k]];
  return zoomed((v) => (emph ? ['+', ['*', base(v), emphFactor], add] : add ? ['+', base(v), add] : base(v)));
};
const emphOpacity = (faint) => ['case', ['>', E, 0], 1, faint];

function shapeCoords(flat) {
  const c = [];
  for (let i = 0; i < flat.length; i += 2) c.push([flat[i], flat[i + 1]]);
  return c;
}

export function laneFeatures(net) {
  const L = net.lanes, E = net.edges;
  if (!L) return { type: 'FeatureCollection', features: [] };   // routing-only (lite) network
  return {
    type: 'FeatureCollection',
    features: L.id.map((id, i) => ({
      type: 'Feature', id: i,
      properties: { slot: L.slot[i] },
      geometry: { type: 'LineString', coordinates: shapeCoords(E.shape[L.edge[i]]) },
    })),
  };
}

export function edgeFeatures(net, only = null) {
  const E = net.edges;
  const feats = [];
  for (let i = 0; i < E.id.length; i++) {
    if (only && !only(i)) continue;
    feats.push({ type: 'Feature', id: i, properties: { slot: E.slot[i], n: E.lanes ? E.lanes[i].length : (E.n_lanes?.[i] ?? 1) },
      geometry: { type: 'LineString', coordinates: shapeCoords(E.shape[i]) } });
  }
  return { type: 'FeatureCollection', features: feats };
}

const EMPTY = { type: 'FeatureCollection', features: [] };

// ---------------------------------------------------------------- bundled terrain tiles (no tile server)
// Tiles are served by a custom protocol so a tile that isn't bundled (outside the town at the deepest zoom) is
// cut from its nearest bundled ancestor instead of failing with a 404.
const DEM = { sets: new Map(), files: new Map(), cuts: new Map(), registered: false };

function registerDemProtocol() {
  if (DEM.registered || typeof maplibregl === 'undefined' || !maplibregl.addProtocol) return;
  DEM.registered = true;
  maplibregl.addProtocol('vhdem', async (params) => {
    const [, set, z, x, y] = params.url.match(/^vhdem:\/\/([^/]+)\/(\d+)\/(\d+)\/(\d+)/);
    const d = DEM.sets.get(set);
    const src = demSourceTile(+z, +x, +y, d.have, d.minzoom);
    if (!src) return { data: await flatTile(d.size) };
    const url = `${d.base}${src.z}/${src.x}/${src.y}.png`;
    if (!DEM.files.has(url)) {
      DEM.files.set(url, fetch(url).then((r) => { if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.blob(); })
        .catch((e) => { DEM.files.delete(url); throw e; }));   // a failed download can be retried
    }
    const blob = await DEM.files.get(url);
    if (src.k === 1) return { data: await blob.arrayBuffer() };
    const key = `${set}/${z}/${x}/${y}`;   // hill shading and terrain both ask for each tile: cut it once
    if (!DEM.cuts.has(key)) {
      DEM.cuts.set(key, (async () => {
        const s = d.size / src.k;
        const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
        // nearest-neighbour only: smoothing would blend the encoded bytes (terrarium packs metres across R, G and B)
        return canvasPng(d.size, (ctx) => { ctx.imageSmoothingEnabled = false; ctx.drawImage(bmp, src.dx * s, src.dy * s, s, s, 0, 0, d.size, d.size); });
      })().catch((e) => { DEM.cuts.delete(key); throw e; }));
    }
    return { data: (await DEM.cuts.get(key)).slice(0) };
  });
}

async function canvasPng(size, draw) {
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(size, size) : Object.assign(document.createElement('canvas'), { width: size, height: size });
  draw(c.getContext('2d'));
  const blob = c.convertToBlob ? await c.convertToBlob({ type: 'image/png' }) : await new Promise((res) => c.toBlob(res, 'image/png'));
  return blob.arrayBuffer();
}
let FLAT = null;   // sea level everywhere (terrarium 0 m = rgb(128, 0, 0))
const flatTile = (size) => (FLAT ||= canvasPng(size, (ctx) => { ctx.fillStyle = 'rgb(128,0,0)'; ctx.fillRect(0, 0, size, size); }));

// ---------------------------------------------------------------- labels (HTML: no glyph server needed)
const LABEL_CSS = `
.bm-label { pointer-events: none; font: 600 12px/1.15 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #55544f; white-space: nowrap;
  text-align: center; text-shadow: 0 0 2px var(--bm-halo, #fff), 0 0 3px var(--bm-halo, #fff), 0 0 5px var(--bm-halo, #fff); }
.bm-label small { display: block; font-weight: 500; font-size: 10.5px; opacity: 0.85; }
.bm-label-water { color: #4f7187; font-style: italic; font-weight: 500; font-size: 13px; letter-spacing: 0.04em; }
.bm-label-island, .bm-label-landmark { color: #3e3d39; font-size: 12.5px; }
.bm-label-peak::before { content: "▲ "; font-size: 9px; }
.bm-label-suburb { color: #7a7972; text-transform: uppercase; letter-spacing: 0.12em; font-size: 11px; font-weight: 600; }
.bm-label-park { color: #5d7350; font-weight: 500; font-size: 11px; }
.bm-label-school, .bm-label-hospital { color: #6a6963; font-weight: 500; font-size: 11px; }
.bm-dark .bm-label { --bm-halo: #141413; color: #b2b1aa; }
.bm-dark .bm-label-water { color: #7fa2b8; }
.bm-dark .bm-label-island, .bm-dark .bm-label-landmark { color: #d8d7d1; }
.bm-dark .bm-label-park { color: #8fa57f; }
.maplibregl-ctrl button.bm-3d-btn { font: 700 12px/1 system-ui, sans-serif; width: 29px; height: 29px; color: #333; }
.maplibregl-ctrl button.bm-3d-btn[aria-pressed="true"] { background: #333; color: #fff; }
`;
function injectLabelCss() {
  if (typeof document === 'undefined' || document.getElementById('bm-label-css')) return;
  const st = document.createElement('style');
  st.id = 'bm-label-css'; st.textContent = LABEL_CSS;
  document.head.append(st);
}

class ThreeDControl {
  constructor(view) { this.view = view; }
  onAdd() {
    this.el = document.createElement('div');
    this.el.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    this.btn = document.createElement('button');
    this.btn.type = 'button'; this.btn.className = 'bm-3d-btn'; this.btn.textContent = '3D';
    this.btn.title = 'Tilt the map to show hills and buildings (drag with the right mouse button or two fingers to turn it)';
    this.btn.setAttribute('aria-label', '3D view: tilt the map to show hills and buildings');
    this.btn.setAttribute('aria-pressed', 'false');
    this.btn.addEventListener('click', () => this.view.set3D(!this.view.is3D, { user: true }));
    this.el.append(this.btn);
    return this.el;
  }
  set(on) { this.btn?.setAttribute('aria-pressed', on ? 'true' : 'false'); }
  onRemove() { this.el.remove(); }
}

export class MapView {
  /** basemap: URL of the folder with basemap.json, buildings.json and terrain/ (null = no base map). */
  constructor(container, { theme, onHover, onClick, onReady, on3D, basemap = 'basemap/' }) {
    this.theme = theme;
    this.onHover = onHover;
    this.onClick = onClick;
    this.on3D = on3D;
    this.mode = 'edges';
    this.state = { lanes: null, edges: null, zones: null };
    this.emph = { lanes: false, edges: false };
    this.net = null;
    this.is3D = false;
    this.basemapOn = true;
    this.labels = [];
    this.basemapUrl = basemap ? new URL(basemap, document.baseURI).href : null;
    this.bm = this.basemapUrl ? loadBasemap(this.basemapUrl) : Promise.resolve(null);
    registerDemProtocol();
    injectLabelCss();
    this.map = new maplibregl.Map({
      container,
      style: this.baseStyle(),
      center: [138.62, -35.553], zoom: 14,
      attributionControl: { compact: true },
      dragRotate: false, pitchWithRotate: false, maxPitch: 70,
      fadeDuration: 0,
    });
    this.map.touchZoomRotate.disableRotation();
    this.map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), 'top-right');
    this.ctl3D = new ThreeDControl(this);
    this.map.addControl(this.ctl3D, 'top-right');
    this.map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');
    container.classList.toggle('bm-dark', theme === 'dark');
    this.ready = new Promise((res) => this.map.on('load', async () => {
      await this.addBasemap();
      this.addLayers();
      // credits (OpenStreetMap, terrain): MapLibre's compact control shows them on load and folds them away once the map is moved
      res(); onReady?.();
    }));
  }

  baseStyle() {
    return {
      version: 8,
      sources: {
        // optional extra for local development only (the published artifact may not load tiles from the internet)
        osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19, attribution: OSM_CREDIT },
      },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': BASEMAP_COLOURS[this.theme === 'dark' ? 'dark' : 'light'].land } },
        { id: 'osm', type: 'raster', source: 'osm', layout: { visibility: 'none' },
          paint: { 'raster-opacity': 0.5, 'raster-saturation': -0.7 } },
      ],
    };
  }

  cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#f6f5f2'; }

  async addBasemap() {
    const m = this.map;
    const bm = await this.bm;
    if (!bm) return;
    m.addSource('bm', { type: 'geojson', data: bm.basemap, attribution: OSM_CREDIT });
    m.addSource('bm-buildings', { type: 'geojson', data: bm.buildings || EMPTY, attribution: OSM_CREDIT });
    if (bm.terrain) {
      const t = bm.terrain;
      const set = `t${DEM.sets.size}`;
      DEM.sets.set(set, { base: `${this.basemapUrl}terrain/`, have: new Set(t.tiles), minzoom: t.minzoom, size: t.tileSize });
      const dem = { type: 'raster-dem', tiles: [`vhdem://${set}/{z}/{x}/{y}`], tileSize: t.tileSize, encoding: t.encoding,
        minzoom: t.minzoom, maxzoom: t.maxzoom, bounds: t.bounds, attribution: TERRAIN_CREDIT };
      m.addSource('bm-hillshade', dem);
      m.addSource('bm-dem', { ...dem });
    }
    for (const l of basemapLayers(this.theme)) {
      if (l.source === 'bm-hillshade' && !bm.terrain) continue;
      m.addLayer(l);
    }
    this.labels = bm.basemap.features.filter((f) => f.properties.l === 'label').map((f) => ({ ...f.properties, lngLat: f.geometry.coordinates }));
    for (const l of this.labels) {
      const el = document.createElement('div');
      el.className = `bm-label bm-label-${l.c}`;
      el.textContent = l.name;
      if (l.ele) { const s = document.createElement('small'); s.textContent = `${l.ele} m`; el.append(s); }
      el.setAttribute('aria-hidden', 'true');   // decoration: the map is described in words elsewhere
      l.marker = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(l.lngLat);
    }
    const show = () => {
      const on = new Set(this.basemapOn ? labelsAt(this.labels, m.getZoom()) : []);
      for (const l of this.labels) {
        if (on.has(l) && !l.shown) { l.marker.addTo(m); l.shown = true; }
        else if (!on.has(l) && l.shown) { l.marker.remove(); l.shown = false; }
      }
    };
    this.showLabels = show;
    m.on('zoomend', show); m.on('moveend', show);
    show();
  }

  addLayers() {
    const m = this.map;
    for (const s of ['lanes', 'edges', 'zones', 'pois', 'route', 'removed']) m.addSource(s, { type: 'geojson', data: EMPTY });
    const nd = NO_DATA[this.theme];
    m.addLayer({ id: 'zones-fill', type: 'fill', source: 'zones', layout: { visibility: 'none' },
      paint: { 'fill-color': nd, 'fill-opacity': 0.35 } });
    m.addLayer({ id: 'zones-line', type: 'line', source: 'zones', layout: { visibility: 'none' },
      paint: { 'line-color': this.cssVar('--axis'), 'line-width': 1 } });
    m.addLayer({ id: 'removed', type: 'line', source: 'removed',
      paint: { 'line-color': this.cssVar('--muted'), 'line-dasharray': [1.5, 1.5], 'line-width': widthOf(0.8),
        'line-offset': scaled(['get', 'slot']) } });
    for (const [src, k] of [['lanes', 0.8], ['edges', 0.9]]) {
      m.addLayer({ id: `${src}-casing`, type: 'line', source: src, layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: { 'line-color': CASING[this.theme], 'line-width': lineWidth(src, k, 1.6, false), 'line-offset': scaled(['get', 'slot']) } });
      m.addLayer({ id: src, type: 'line', source: src, layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: { 'line-color': nd, 'line-width': lineWidth(src, k, 0, false), 'line-offset': scaled(['get', 'slot']) } });
    }
    m.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': this.cssVar('--surface'), 'line-width': 9, 'line-offset': scaled(['get', 'slot']) } });
    m.addLayer({ id: 'route', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': this.routeColour(), 'line-width': 4, 'line-offset': scaled(['get', 'slot']) } });
    m.addLayer({ id: 'pois', type: 'circle', source: 'pois',
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 2.5, 16, 5], 'circle-color': this.cssVar('--surface'), 'circle-stroke-color': this.cssVar('--ink'), 'circle-stroke-width': 1.5 } });
    this.applyMode();
    for (const layer of ['lanes', 'edges', 'pois', 'zones-fill']) {
      m.on('mousemove', layer, (e) => {
        if (layer === 'zones-fill' && m.queryRenderedFeatures(e.point, { layers: ['lanes', 'edges', 'pois'] }).length) return;
        m.getCanvas().style.cursor = 'pointer';
        this.onHover?.({ layer, id: e.features[0].id, props: e.features[0].properties, point: e.point, lngLat: e.lngLat });
      });
      m.on('mouseleave', layer, () => { m.getCanvas().style.cursor = ''; this.onHover?.(null); });
    }
    m.on('click', (e) => {
      const f = m.queryRenderedFeatures([[e.point.x - 4, e.point.y - 4], [e.point.x + 4, e.point.y + 4]],
        { layers: ['pois', this.mode === 'lanes' ? 'lanes' : 'edges'] });
      const hit = f.find((x) => x.layer.id === 'pois') || f[0];
      this.onClick?.({ layer: hit?.layer.id ?? null, id: hit?.id ?? null, lngLat: e.lngLat });
    });
  }

  async setNetwork(net, { fit = false, removed = null } = {}) {
    await this.ready;
    if (this.net !== net) {
      this.net = net;
      this.state = { lanes: null, edges: null, zones: null };
      this.emphState = null;   // feature-state survives setData, but the ids now mean other roads: set it afresh
      this.map.getSource('lanes').setData(laneFeatures(net));
      this.map.getSource('edges').setData(edgeFeatures(net));
      this.map.getSource('zones').setData({ type: 'FeatureCollection',
        features: (net.zones || []).map((z, i) => ({ type: 'Feature', id: i, properties: { name: z.name }, geometry: z.geometry })) });
      this.map.getSource('pois').setData({ type: 'FeatureCollection',
        features: (net.pois || []).map((p, i) => ({ type: 'Feature', id: i, properties: { name: p.name, category: p.category },
          geometry: { type: 'Point', coordinates: [p.lon, p.lat] } })) });
      // feature-state (the colours) set before the new data is loaded is dropped: wait for it
      await new Promise((resolve) => {
        const m = this.map;
        const loaded = () => m.isSourceLoaded('edges') && m.isSourceLoaded('lanes');
        if (loaded()) return resolve();
        let timer = null;
        const finish = () => { m.off('sourcedata', done); m.off('idle', done); clearTimeout(timer); resolve(); };
        const done = () => { if (loaded()) finish(); };
        m.on('sourcedata', done); m.on('idle', done);
        timer = setTimeout(finish, 2000);   // never hang (e.g. a map that isn't painting yet)
      });
      if (fit) {
        // open on the town (Victor Harbor, Encounter Bay, McCracken), not the network's long rural roads
        const [w, s, e, n] = net.view_bbox || [138.585, -35.580, 138.655, -35.530];
        this.map.fitBounds([[Math.max(w, net.bbox[0]), Math.max(s, net.bbox[1])], [Math.min(e, net.bbox[2]), Math.min(n, net.bbox[3])]], { padding: 20, duration: 0 });
      }
    }
    this.map.getSource('removed').setData(removed || EMPTY);
  }

  setMode(mode) { this.mode = mode; if (this.map.getLayer('lanes')) this.applyMode(); }

  applyMode() {
    const lanes = this.mode === 'lanes';
    for (const id of ['lanes', 'lanes-casing']) this.map.setLayoutProperty(id, 'visibility', lanes ? 'visible' : 'none');
    for (const id of ['edges', 'edges-casing']) this.map.setLayoutProperty(id, 'visibility', lanes ? 'none' : 'visible');
  }

  setScale(scale) {
    this.scale = scale;
    if (!this.map.getLayer('lanes')) return;
    const nd = NO_DATA[this.theme];
    this.map.setPaintProperty(this.mode === 'lanes' ? 'lanes' : 'edges', 'line-color', colourExpression(scale, nd));
  }

  setZoneScale(scale, visible) {
    if (!this.map.getLayer('zones-fill')) return;
    for (const id of ['zones-fill', 'zones-line']) this.map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
    if (scale) this.map.setPaintProperty('zones-fill', 'fill-color', colourExpression(scale, NO_DATA[this.theme]));
  }

  /** values: Float32Array/Float64Array (NaN or non-finite = no data) for source 'lanes' | 'edges' | 'zones'. */
  setValues(source, values) {
    const prev = this.state[source];
    const m = this.map;
    for (let i = 0; i < values.length; i++) {
      const v = Number.isFinite(values[i]) ? values[i] : null;
      if (prev && prev[i] === v) continue;
      m.setFeatureState({ source, id: i }, { v });
    }
    this.state[source] = Array.from(values, (x) => (Number.isFinite(x) ? x : null));
  }

  /**
   * Comparison maps: per-feature emphasis (changes.js `emphasis`: 0 = inside the noise band, drawn faint and thin;
   * up to 1 = a big change, drawn thick). null switches back to plain widths.
   */
  setEmphasis(source, em) {
    const m = this.map;
    if (!m.getLayer(source)) return;
    const on = !!em;
    if (on) {
      const prev = this.emphState?.[source];
      for (let i = 0; i < em.length; i++) {
        const e = Number.isFinite(em[i]) ? em[i] : 0;
        if (prev && prev[i] === e) continue;
        m.setFeatureState({ source, id: i }, { e });
      }
      this.emphState = { ...this.emphState, [source]: Array.from(em, (x) => (Number.isFinite(x) ? x : 0)) };
    }
    if (this.emph[source] === on) return;
    this.emph[source] = on;
    const k = source === 'lanes' ? 0.8 : 0.9;
    m.setPaintProperty(source, 'line-width', lineWidth(source, k, 0, on));
    m.setPaintProperty(`${source}-casing`, 'line-width', lineWidth(source, k, 1.6, on));
    m.setPaintProperty(source, 'line-opacity', on ? emphOpacity(0.55) : 1);
    m.setPaintProperty(`${source}-casing`, 'line-opacity', on ? emphOpacity(0.25) : 1);
  }

  // a route section may carry its own colour (`colours[k]` for edges[k]); otherwise the ink colour
  routeColour() { return ['coalesce', ['get', 'c'], this.cssVar('--ink')]; }

  setRoute(net, edges, colours = null, source = 'route') {
    if (!this.map.getSource(source)) return;
    const feats = (edges || []).map((e, k) => ({ type: 'Feature', properties: { slot: net.edges.slot[e], ...(colours ? { c: colours[k] } : {}) },
      geometry: { type: 'LineString', coordinates: shapeCoords(net.edges.shape[e]) } }));
    this.map.getSource(source).setData({ type: 'FeatureCollection', features: feats });
  }

  setPoisVisible(v) { if (this.map.getLayer('pois')) this.map.setLayoutProperty('pois', 'visibility', v ? 'visible' : 'none'); }

  setMarker(kind, lngLat) {
    this.markers = this.markers || {};
    if (this.markers[kind]) { this.markers[kind].remove(); this.markers[kind] = null; }
    if (!lngLat) return;
    const el = document.createElement('div');
    el.className = `${kind}-marker`;
    el.setAttribute('aria-label', kind === 'target' ? 'Target' : 'Start of route');
    this.markers[kind] = new maplibregl.Marker({ element: el }).setLngLat(lngLat).addTo(this.map);
  }

  /** OpenStreetMap raster tiles from the internet (local development extra; blocked in the published artifact). */
  setBasemap(on) { this.map.setLayoutProperty('osm', 'visibility', on ? 'visible' : 'none'); }

  /** The bundled base map (land, sea, buildings, labels, hill shading). */
  setBaseLayers(on) {
    this.basemapOn = on;
    const m = this.map;
    for (const l of basemapLayers(this.theme)) {
      if (!m.getLayer(l.id)) continue;
      const vis = on && (l.id === 'bm-buildings-3d' ? this.is3D : l.id === 'bm-buildings' ? !this.is3D : true);
      m.setLayoutProperty(l.id, 'visibility', vis ? 'visible' : 'none');
    }
    this.showLabels?.();
  }

  /** Tilted view with terrain and extruded buildings (on), or the flat north-up map (off). */
  set3D(on, { user = false, animate = true } = {}) {
    const m = this.map;
    this.is3D = on;
    this.ctl3D.set(on);
    const hasDem = !!m.getSource('bm-dem');
    if (hasDem) m.setTerrain(on ? { source: 'bm-dem', exaggeration: TERRAIN_EXAGGERATION } : null);
    if (m.getLayer('bm-buildings')) {
      m.setLayoutProperty('bm-buildings-3d', 'visibility', on && this.basemapOn ? 'visible' : 'none');
      m.setLayoutProperty('bm-buildings', 'visibility', !on && this.basemapOn ? 'visible' : 'none');
    }
    if (on) { m.dragRotate.enable(); m.touchZoomRotate.enableRotation(); m.touchPitch.enable(); m.keyboard.enableRotation?.(); }
    else { m.dragRotate.disable(); m.touchZoomRotate.disableRotation(); }
    const cam = on ? { pitch: PITCH_3D, bearing: m.getBearing() || -12 } : { pitch: 0, bearing: 0 };
    if (animate) m.easeTo({ ...cam, duration: 600 }); else m.jumpTo(cam);
    if (user) this.on3D?.(on);
  }

  setTheme(theme) {
    this.theme = theme;
    const m = this.map;
    m.getContainer().classList.toggle('bm-dark', theme === 'dark');
    if (!m.getLayer('lanes')) return;
    m.setPaintProperty('bg', 'background-color', BASEMAP_COLOURS[theme === 'dark' ? 'dark' : 'light'].land);
    for (const [id, k, v] of basemapPaint(theme)) if (m.getLayer(id)) m.setPaintProperty(id, k, v);
    for (const id of ['lanes-casing', 'edges-casing']) m.setPaintProperty(id, 'line-color', CASING[theme]);
    m.setPaintProperty('route', 'line-color', this.routeColour());
    m.setPaintProperty('route-casing', 'line-color', this.cssVar('--surface'));
    m.setPaintProperty('pois', 'circle-color', this.cssVar('--surface'));
    m.setPaintProperty('pois', 'circle-stroke-color', this.cssVar('--ink'));
    m.setPaintProperty('removed', 'line-color', this.cssVar('--muted'));
    m.setPaintProperty('zones-line', 'line-color', this.cssVar('--axis'));
    if (this.scale) this.setScale(this.scale);
  }

  /** Zoom to a [w, s, e, n] box (e.g. a street in the list of biggest changes). */
  zoomToBox(b, padding = 60) {
    const pad = 0.0015;
    this.map.fitBounds([[b[0] - pad, b[1] - pad], [b[2] + pad, b[3] + pad]], { padding, maxZoom: 16.5, duration: 500,
      bearing: this.map.getBearing(), pitch: this.map.getPitch() });
  }

  resize() { this.map.resize(); }
}

/**
 * basemap.json (its labels are drawn as HTML), buildings.json and the terrain tile list; null if there is no base map.
 * All fetched here on the page rather than by MapLibre's worker, so they load wherever the page itself can fetch.
 */
async function loadBasemap(base) {
  try {
    const optional = (name) => fetch(`${base}${name}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const [basemap, buildings, terrain] = await Promise.all([
      fetch(`${base}basemap.json`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`basemap.json: HTTP ${r.status}`)))),
      optional('buildings.json'), optional('terrain/tiles.json'),
    ]);
    return { basemap, buildings, terrain };
  } catch (e) {
    console.warn(`No base map (${e.message}): showing the roads only`);
    return null;
  }
}

