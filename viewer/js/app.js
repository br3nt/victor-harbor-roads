// Viewer application: state, pickers, maps, timeline, details. Pure logic lives in the other modules.
import { findData, Store, laneValues, laneValue, runChoices } from './data.js';
import { travelTimesTo, routeFrom, zoneMedians, nearestNode, ttAt } from './graph.js';
import { emphasis, summariseChanges, summaryText } from './changes.js';
import { METRICS, scaleFor, legendStops, niceMax, quantile, NO_DATA } from './colour.js';
import { groupBookmarks, diffBookmarks, stepBookmark } from './bookmarks.js';
import { Timeline, sparkline } from './timeline.js';
import { clock, clockRange, minutes, signedMinutes, directionLabel, laneLabel, pct, escapeHtml, yearLong } from './format.js';
import { MapView, laneFeatures, edgeFeatures } from './mapview.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const S = {
  view: 'access', cmp: 'off', metric: 'speed', i: null,
  a: null, b: null,            // run ids
  target: null,                // {lon, lat, name}
  origin: null,                // edge id (string; matched by id across networks)
  selected: null,              // lane id
  zones: false, pois: true, basemap: false, landmarks: true, d3: false, theme: 'auto', swipe: 0.5,
};
const NO_ROUTE_IN_B = 1e6;   // minutes; drawn at the end of the difference scale
const R = { store: null, choices: null, runA: null, runB: null, mapA: null, mapB: null, timeline: null,
  timeDomain: null, timeKey: null, pickTarget: false, routeCache: new Map(), last: {} };

// ------------------------------------------------------------------ labels
const SCEN = { baseline: "Today's network", test_variant: 'Test variant',
  c1a: 'C1a · 30 km/h town centre (not Torrens/Victoria St)', c1b: 'C1b · 30 km/h incl. Torrens St',
  c2: 'C2 · 20 km/h shared streets', c3: 'C3 · One-way loop (clockwise)', c3b: 'C3b · One-way loop (anticlockwise)',
  c4: 'C4 · Signals at Torrens/Seaview and Torrens/Crozier', cp: "Council's town-centre package",
  b3: 'B3 · Four-lane ring road', b4: 'B4 · Two-lane McCracken roundabout', b5: 'B5 · Roundabout slip lanes',
  bp: "Brent's package (B3+B4+B5)", n1: 'N1 · Grantley Ave crossing closed',
  n2: 'N2 · Armstrong/Crozier roundabout', n3: 'N3 · Crozier Rd turn lanes at Armstrong Rd',
  n4: 'N4 · Hindmarsh/Grantley roundabout', n5: 'N5 · Armstrong/Crozier + Armstrong/Greenhills roundabouts',
  n6: 'N6 · No right turns from Granite St, Coral St, Wattle Dr', n7: 'N7 · Three roundabouts (N5 + N4)',
  n8: 'N8 · Victoria St left-turn lanes', n9: 'N9 · Crozier Rd turn lanes + Grantley roundabout (N3 + N4)' };
const COND = { weekday_term: 'Weekday, school term', saturday: 'Saturday', summer_peak: 'Summer peak weekday', event_nye: "New Year's Eve" };
const scenLabel = (s) => SCEN[s] || s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
const condLabel = (c) => COND[c] || c.replace(/_/g, ' ');
const demandLabel = (d) => { const [y, g] = d.split('-'); return g === 'base' ? yearLong(+y) : `${yearLong(+y)}, ${g} growth`; };   // this year is 2026; the 2025 runs are "now"
const runLabel = (run) => `${scenLabel(run.entry.scenario)} · ${condLabel(run.entry.condition)} · ${demandLabel(`${run.entry.year}-${run.entry.growth}`)}`;

function theme() {
  if (S.theme === 'light' || S.theme === 'dark') return S.theme;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

// ------------------------------------------------------------------ URL state
function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  const g = (k) => h.get(k);
  if (g('v')) S.view = g('v') === 'congestion' ? 'congestion' : 'access';
  if (g('cmp')) S.cmp = ['off', 'side', 'swipe', 'diff'].includes(g('cmp')) ? g('cmp') : 'off';
  if (g('m') && METRICS[g('m')]) S.metric = g('m');
  if (g('a')) S.a = g('a');
  if (g('b')) S.b = g('b');
  if (g('i')) S.i = +g('i');
  if (g('tg')) { const [lon, lat] = g('tg').split(',').map(Number); if (Number.isFinite(lon)) S.target = { lon, lat, name: g('tn') || null }; }
  if (g('o')) S.origin = g('o');
  if (g('sel')) S.selected = g('sel');
  if (g('z')) S.zones = g('z') === '1';
  if (g('p')) S.pois = g('p') !== '0';
  if (g('bm')) S.basemap = g('bm') === '1';
  if (g('lm')) S.landmarks = g('lm') !== '0';
  if (g('3d')) S.d3 = g('3d') === '1';
  if (g('th')) S.theme = g('th');
}
let hashTimer = null;
function writeHash() {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => {
    const h = new URLSearchParams();
    h.set('v', S.view); h.set('cmp', S.cmp); h.set('a', S.a); if (S.cmp !== 'off') h.set('b', S.b);
    h.set('i', S.i); if (S.view === 'congestion') h.set('m', S.metric);
    if (S.target) { h.set('tg', `${S.target.lon.toFixed(5)},${S.target.lat.toFixed(5)}`); if (S.target.name) h.set('tn', S.target.name); }
    if (S.origin) h.set('o', S.origin);
    if (S.selected) h.set('sel', S.selected);
    if (S.zones) h.set('z', '1');
    if (!S.pois) h.set('p', '0');
    if (S.basemap) h.set('bm', '1');
    if (!S.landmarks) h.set('lm', '0');
    if (S.d3) h.set('3d', '1');
    if (S.theme !== 'auto') h.set('th', S.theme);
    history.replaceState(null, '', `#${h}`);
  }, 150);
}

// ------------------------------------------------------------------ run pickers
function fillPicker(card, runId) {
  const ch = R.choices;
  const run = R.store.index.runs.find((r) => r.id === runId);
  const cur = { scenario: run.scenario, condition: run.condition, demand: `${run.year}-${run.growth}` };
  const sel = (k) => $(`select[data-k="${k}"]`, card);
  const opts = (k, values, label, avail) => {
    sel(k).innerHTML = values.map((v) => `<option value="${escapeHtml(v)}"${v === cur[k] ? ' selected' : ''}${avail(v) ? '' : ' disabled'}>${escapeHtml(label(v))}${avail(v) ? '' : ' (not run)'}</option>`).join('');
  };
  opts('scenario', ch.scenarios, scenLabel, () => true);
  opts('condition', ch.conditions, condLabel, (c) => ch.has({ scenario: cur.scenario, condition: c }));
  opts('demand', ch.demands, demandLabel, (d) => ch.has({ scenario: cur.scenario, condition: cur.condition, demand: d }));
  const demands = $$('option:not([disabled])', sel('demand')).map((o) => o.value);
  const k = demands.indexOf(cur.demand);
  $('.step[data-step="-1"]', card).disabled = k <= 0;
  $('.step[data-step="1"]', card).disabled = k < 0 || k >= demands.length - 1;
}

function pickerRun(card, changedKey) {
  const ch = R.choices;
  const v = (k) => $(`select[data-k="${k}"]`, card).value;
  let scenario = v('scenario'), condition = v('condition'), demand = v('demand');
  let r = ch.find(scenario, condition, demand);
  if (!r) {   // keep what the user just changed, relax the rest
    const runs = R.store.index.runs.filter((x) => x.scenario === scenario);
    r = runs.find((x) => x.condition === condition) || runs.find((x) => `${x.year}-${x.growth}` === demand) || runs[0];
    if (changedKey === 'condition') r = runs.find((x) => x.condition === condition) || r;
  }
  return r.id;
}

function wirePicker(card, which) {
  card.addEventListener('change', (e) => {
    const k = e.target.dataset.k;
    if (!k) return;
    S[which] = pickerRun(card, k);
    update({ runs: true });
  });
  for (const b of $$('.step', card)) {
    b.addEventListener('click', () => {
      const sel = $('select[data-k="demand"]', card);
      const opts = $$('option:not([disabled])', sel).map((o) => o.value);
      const k = opts.indexOf(sel.value) + +b.dataset.step;
      if (k < 0 || k >= opts.length) return;
      sel.value = opts[k];
      S[which] = pickerRun(card, 'demand');
      update({ runs: true });
    });
  }
}

// ------------------------------------------------------------------ helpers
function intervalFor(run, i) {
  // interval of `run` covering the same clock time as interval i of run A; -1 when `run` has no data then
  const t = R.runA.meta.begin_s + i * R.runA.meta.interval_s;
  const k = Math.round((t - run.meta.begin_s) / run.meta.interval_s);
  return k >= 0 && k < run.meta.n_intervals ? k : -1;
}
const tDep = () => R.runA.meta.begin_s + S.i * R.runA.meta.interval_s;

function nodeLabel(net, n) {
  if (net.nodes.name?.[n]) return net.nodes.name[n];
  const names = new Set();
  const E = net.edges;
  for (let e = 0; e < E.id.length; e++) if ((E.to[e] === n || E.from[e] === n) && E.name[e]) names.add(E.name[e]);
  const list = [...names];
  return list.length ? list.slice(0, 3).join(' / ') : `junction ${net.nodes.id[n]}`;
}

function targetNode(net) {
  return nearestNode(net, net.graph, S.target.lon, S.target.lat);
}

function defaultTarget(net) {
  const pois = net.pois || [];
  const p = pois.find((x) => /supermarket/.test(x.category)) || pois[0];
  if (p) return { lon: p.lon, lat: p.lat, name: p.name };
  const n = nearestNode(net, net.graph, (net.bbox[0] + net.bbox[2]) / 2, (net.bbox[1] + net.bbox[3]) / 2);
  return { lon: net.nodes.lon[n], lat: net.nodes.lat[n], name: null };
}

function edgeMinutes(run, i) {
  const net = run.net;
  const n = targetNode(net);
  if (i < 0) return { minutes: new Float64Array(net.edges.id.length).fill(NaN), node: n };
  const tt = travelTimesTo(net.graph, run.times, n, run.meta.begin_s + i * run.meta.interval_s);
  R.last.ms = tt.ms; R.last.anchors = tt.anchors;
  const out = new Float64Array(tt.fromMid.length);
  for (let e = 0; e < out.length; e++) out[e] = net.edges.routable[e] ? tt.fromMid[e] / 60 : NaN;   // Infinity = no route
  return { minutes: out, node: n };
}

// value of lane iB in B minus lane in A (matched by id); NaN when not comparable
function laneDiff(metric) {
  const A = R.runA, B = R.runB;
  const iA = S.i, iB = intervalFor(B, S.i);
  const netA = A.net, netB = B.net;
  const out = new Float32Array(netB.lanes.id.length);
  for (let k = 0; k < out.length; k++) {
    const j = netA.laneIndex.get(netB.lanes.id[k]);
    if (j === undefined) { out[k] = NaN; continue; }
    let a = laneValue(A.lanes, metric, iA, j, A.meta.interval_s), b = laneValue(B.lanes, metric, iB, k, B.meta.interval_s);
    if (iB < 0 || (Number.isNaN(a) && Number.isNaN(b))) { out[k] = NaN; continue; }
    if (metric === 'speed') {
      // no vehicles = free-flowing; anything at or above the free-flow anchor (80%) counts as free-flowing,
      // so an empty lane in A and a lightly used one in B do not show as a slow-down
      const ff = METRICS.speed.domain[0];
      a = Math.min(Number.isNaN(a) ? ff : a, ff);
      b = Math.min(Number.isNaN(b) ? ff : b, ff);
    } else {
      if (Number.isNaN(a)) a = 0;
      if (Number.isNaN(b)) b = 0;
    }
    out[k] = b - a;
  }
  return out;
}

function removedFeatures(kind) {
  const key = `${kind}:${R.runA.net.name}:${R.runB.net.name}`;
  if (R.last.removedKey === key) return R.last.removed;
  const netA = R.runA.net, netB = R.runB.net;
  let fc;
  if (kind === 'lanes') {
    const all = laneFeatures(netA);
    fc = { type: 'FeatureCollection', features: all.features.filter((f) => !netB.laneIndex.has(netA.lanes.id[f.id])) };
  } else {
    fc = edgeFeatures(netA, (e) => !netB.edgeIndex.has(netA.edges.id[e]));
  }
  R.last.removedKey = key; R.last.removed = fc;
  return fc;
}

// ------------------------------------------------------------------ main update
let busy = Promise.resolve();
function update(what = {}) {
  busy = busy.then(() => doUpdate(what)).catch((e) => { console.error(e); setStatus(`Error: ${e.message}`); });
  return busy;
}

async function doUpdate(what) {
  if (what.runs || !R.runA) {
    setStatus('Loading…');
    R.runA = await R.store.run(S.a);
    R.runB = S.cmp !== 'off' ? await R.store.run(S.b) : null;
    if (R.runB && R.runB.meta.interval_s !== R.runA.meta.interval_s) {
      throw new Error(`A and B use different time steps (${R.runA.meta.interval_s} s and ${R.runB.meta.interval_s} s); re-export one of them`);
    }
    if (S.i === null || S.i >= R.runA.meta.n_intervals) S.i = R.runA.meta.series.delay_veh_h.indexOf(Math.max(...R.runA.meta.series.delay_veh_h));
    if (!S.target) S.target = defaultTarget(R.runA.net);
    fillPicker($('#run-a'), S.a);
    if (S.b) fillPicker($('#run-b'), S.b);
    setStatus('');
  }
  layout();
  await setNetworks();
  updateTimelineData();
  R.timeline.set(S.i);
  renderFrame();
  renderLegend();
  renderBanner();
  writeHash();
}

function layout() {
  const maps = $('#maps');
  maps.className = `maps mode-${S.cmp}`;
  const two = S.cmp === 'side' || S.cmp === 'swipe';
  $('#mapB').hidden = !two;
  $('#swipe').hidden = S.cmp !== 'swipe';
  $('#run-b').hidden = S.cmp === 'off';
  $('.run-title', $('#run-a')).textContent = S.cmp === 'off' ? 'Scenario' : 'Scenario A';
  $('.tag-a').hidden = !two && S.cmp !== 'diff';
  $('.tag-b').hidden = !two;
  $('.tag-a').textContent = S.cmp === 'diff' ? 'B − A' : 'A';
  $('#opts-access').hidden = S.view !== 'access';
  $('#opts-congestion').hidden = S.view !== 'congestion';
  for (const r of $$('input[name="view"]')) r.checked = r.value === S.view;
  for (const r of $$('input[name="cmp"]')) r.checked = r.value === S.cmp;
  if (two && !R.mapB) {
    R.mapB = makeMap('#mapB', 'B');
    syncMaps(R.mapA, R.mapB);
  }
  if (S.cmp === 'swipe') applySwipe(); else $('#mapB').style.clipPath = '';
  requestAnimationFrame(() => { R.mapA.resize(); R.mapB?.resize(); });
}

async function setNetworks() {
  const lanes = S.view === 'congestion';
  const diff = S.cmp === 'diff';
  const first = !R.last.fitted;
  await R.mapA.setNetwork(diff ? R.runB.net : R.runA.net, { fit: first, removed: diff ? removedFeatures(lanes ? 'lanes' : 'edges') : null });
  R.last.fitted = true;
  R.mapA.setMode(lanes ? 'lanes' : 'edges');
  R.mapA.setPoisVisible(S.pois && !lanes);
  R.mapA.setBasemap(S.basemap);
  R.mapA.setBaseLayers(S.landmarks);
  if (R.mapA.is3D !== S.d3) R.mapA.set3D(S.d3, { animate: false });
  if (R.mapB && !$('#mapB').hidden) {
    await R.mapB.setNetwork(R.runB.net);
    R.mapB.setMode(lanes ? 'lanes' : 'edges');
    R.mapB.setPoisVisible(S.pois && !lanes);
    R.mapB.setBasemap(S.basemap);
    R.mapB.setBaseLayers(S.landmarks);
    if (R.mapB.is3D !== S.d3) R.mapB.set3D(S.d3, { animate: false });
    R.mapB.map.jumpTo({ center: R.mapA.map.getCenter(), zoom: R.mapA.map.getZoom(), pitch: R.mapA.map.getPitch(), bearing: R.mapA.map.getBearing() });
  }
}

function updateTimelineData() {
  const A = R.runA, B = R.runB;
  const key = `${A.id}|${B?.id}|${S.cmp}`;
  if (R.last.tlKey === key) return;
  R.last.tlKey = key;
  const m = A.meta;
  let seriesB = null, bms = [...m.bookmarks];
  if (B) {
    seriesB = Array.from({ length: m.n_intervals }, (_, i) => { const k = intervalFor(B, i); return k < 0 ? null : B.meta.series.delay_veh_h[k]; });
    bms = bms.concat(diffBookmarks(m.series.delay_veh_h, seriesB, m.begin_s, m.interval_s));
    for (const b of B.meta.bookmarks) if (b.kind === 'scenario' && !bms.some((x) => x.label === b.label)) bms.push(b);
  }
  R.groups = groupBookmarks(bms, m.begin_s, m.interval_s, m.n_intervals);
  R.timeline.setData({ T: m.n_intervals, begin: m.begin_s, dt: m.interval_s, seriesA: m.series.delay_veh_h, seriesB,
    groups: R.groups, labelA: `A: ${runLabel(A)}`, labelB: B ? `B: ${runLabel(B)}` : '' });
}

function renderFrame() {
  const th = theme();
  const A = R.runA, B = R.runB;
  if (S.view === 'congestion') {
    if (S.cmp === 'diff') {
      const key = `diff_${S.metric}`, m = METRICS[key];
      const d = laneDiff(S.metric);
      R.mapA.setScale(scaleFor(key, th));
      R.mapA.setValues('lanes', d);
      R.mapA.setEmphasis('lanes', emphasis(d, m.deadband, Math.abs(m.domain[1])));
      const net = B.net;
      const sum = summariseChanges({ values: d, names: net.edges.name, shapes: net.edges.shape, section: (k) => net.lanes.edge[k], deadband: m.deadband, notable: m.notable });
      const dA = A.meta.series.delay_veh_h[S.i], iB = intervalFor(B, S.i), dB = iB < 0 ? NaN : B.meta.series.delay_veh_h[iB];
      const delay = Number.isFinite(dA) && Number.isFinite(dB)
        ? `Delay on the whole network in these 15 minutes: ${dA.toFixed(1)} vehicle-hours in A, ${dB.toFixed(1)} in B (${dB - dA >= 0 ? '+' : '−'}${Math.abs(dB - dA).toFixed(1)}).` : '';
      renderDiffSummary(sum, m, (v) => `${m.fmt(v)} ${m.unit}`, delay);
    } else {
      const sc = scaleFor(S.metric, th);
      R.mapA.setScale(sc);
      R.mapA.setEmphasis('lanes', null);
      renderDiffSummary(null);
      R.mapA.setValues('lanes', laneValues(A, S.metric, S.i));
      if (B && R.mapB && !$('#mapB').hidden) { R.mapB.setScale(sc); R.mapB.setValues('lanes', laneValues(B, S.metric, intervalFor(B, S.i))); }
    }
    R.mapA.setZoneScale(null, false); R.mapB?.setZoneScale(null, false);
    R.mapA.setMarker('target', null); R.mapB?.setMarker('target', null);
    R.mapA.setRoute(A.net, null); R.mapB?.setRoute(B?.net, null);
    R.mapA.setMarker('origin', null); R.mapB?.setMarker('origin', null);
    setStatus('');
  } else {
    const resA = edgeMinutes(A, S.i);
    const msA = R.last.ms, ancA = R.last.anchors;
    const tkey = `${A.id}|${S.target.lon},${S.target.lat}`;
    if (R.timeKey !== tkey) {
      R.timeKey = tkey;
      R.timeDomain = [0, niceMax(Math.max(1, quantile(resA.minutes, 0.98) * 1.15))];
    }
    const sc = scaleFor('time', th, R.timeDomain);
    const tgt = [A.net.nodes.lon[resA.node], A.net.nodes.lat[resA.node]];
    let resB = null;
    if (B) resB = edgeMinutes(B, intervalFor(B, S.i));
    if (S.cmp === 'diff') {
      const netA = A.net, netB = B.net;
      const d = new Float64Array(netB.edges.id.length);
      for (let e = 0; e < d.length; e++) {
        const j = netA.edgeIndex.get(netB.edges.id[e]);
        if (j === undefined) { d[e] = NaN; continue; }
        const a = resA.minutes[j], b = resB.minutes[e];
        // a route lost (or gained) in B is the largest possible change, not "no data"
        d[e] = Number.isFinite(a) && Number.isFinite(b) ? b - a
          : Number.isFinite(a) && b === Infinity ? NO_ROUTE_IN_B
            : a === Infinity && Number.isFinite(b) ? -NO_ROUTE_IN_B : NaN;
      }
      const m = METRICS.diff_time;
      R.mapA.setScale(scaleFor('diff_time', th));
      R.mapA.setValues('edges', d);
      R.mapA.setEmphasis('edges', emphasis(d, m.deadband, Math.abs(m.domain[1])));
      zoneValues(R.mapA, netB, d, 'diff_time', th);
      // the time to the target changes for every road behind a changed junction; the change in each road's own
      // driving time shows where that time is gained or lost
      const t = tDep(), iB = intervalFor(B, S.i), own = new Float64Array(d.length).fill(NaN);
      if (iB >= 0) {
        for (let e = 0; e < own.length; e++) {
          const j = netA.edgeIndex.get(netB.edges.id[e]);
          if (j === undefined || !netB.edges.routable[e] || !netA.edges.routable[j]) continue;
          const tb = ttAt(B.times, e, t), ta = ttAt(A.times, j, t);
          if (Number.isFinite(ta) && Number.isFinite(tb)) own[e] = tb - ta;
        }
      }
      const shapes = netB.edges.shape, names = netB.edges.name;
      renderDiffSummary(summariseChanges({ values: d, names, shapes, deadband: m.deadband, notable: m.notable }), m,
        (v) => (Math.abs(v) >= NO_ROUTE_IN_B ? (v > 0 ? 'no route in B' : 'route only in B') : signedMinutes(v * 60)), '',
        summariseChanges({ values: own, names, shapes, deadband: 2, notable: 10, limit: 6 }));
      R.mapA.setMarker('target', [netB.nodes.lon[resB.node], netB.nodes.lat[resB.node]]);
    } else {
      R.mapA.setScale(sc);
      R.mapA.setEmphasis('edges', null);
      renderDiffSummary(null);
      R.mapA.setValues('edges', resA.minutes);
      zoneValues(R.mapA, A.net, resA.minutes, 'time', th, R.timeDomain);
      R.mapA.setMarker('target', tgt);
      if (B && R.mapB && !$('#mapB').hidden) {
        R.mapB.setScale(sc);
        R.mapB.setValues('edges', resB.minutes);
        zoneValues(R.mapB, B.net, resB.minutes, 'time', th, R.timeDomain);
        R.mapB.setMarker('target', [B.net.nodes.lon[resB.node], B.net.nodes.lat[resB.node]]);
      }
    }
    $('#target-label').textContent = `Target: ${S.target.name ? `${S.target.name}, at ` : ''}${nodeLabel(A.net, resA.node)}. Departing ${clock(tDep())}.`;
    setStatus(`Travel times computed in ${msA.toFixed(0)} ms (${ancA} arrival-time anchors${B ? ', plus scenario B' : ''})`);
    R.last.access = { resA, resB };
    drawRoute();
  }
  renderDetails();
  window.__viewer.frames++;
}

function zoneValues(view, net, edgeVals, metric, th, domain) {
  if (!S.zones || !(net.zones || []).length) { view.setZoneScale(null, false); return; }
  view.setZoneScale(scaleFor(metric, th, domain), true);
  view.setValues('zones', zoneMedians(net.zones, edgeVals).map((x) => (x === null ? NaN : x)));
}

// ------------------------------------------------------------------ route + details
function routeSeconds(run, originId, i) {
  const net = run.net;
  const e = net.edgeIndex.get(originId);
  if (e === undefined) return { seconds: NaN, edges: [] };
  const n = targetNode(net);
  if (i < 0) return { seconds: NaN, edges: [] };
  const key = `${run.id}|${originId}|${n}|${i}`;
  if (!R.routeCache.has(key)) {
    const r = routeFrom(net.graph, run.times, e, n, run.meta.begin_s + i * run.meta.interval_s);
    // same rule as the map: from the middle of the section, i.e. minus half its free-flow time
    R.routeCache.set(key, { seconds: Math.max(0, r.seconds - 0.5 * net.graph.ff[e]), edges: r.edges });
    if (R.routeCache.size > 5000) R.routeCache.clear();
  }
  return R.routeCache.get(key);
}

function drawRoute() {
  const A = R.runA, B = R.runB;
  if (!S.origin) {
    R.mapA.setRoute(A.net, null); R.mapA.setMarker('origin', null);
    R.mapB?.setRoute(B?.net, null); R.mapB?.setMarker('origin', null);
    return;
  }
  const onA = S.cmp === 'diff' ? B : A;
  const rA = routeSeconds(onA, S.origin, onA === A ? S.i : intervalFor(B, S.i));
  R.mapA.setRoute(onA.net, rA.edges);
  const e = onA.net.edgeIndex.get(S.origin);
  if (e !== undefined) { const s = onA.net.edges.shape[e]; R.mapA.setMarker('origin', [s[0], s[1]]); }
  if (B && R.mapB && !$('#mapB').hidden) {
    const rB = routeSeconds(B, S.origin, intervalFor(B, S.i));
    R.mapB.setRoute(B.net, rB.edges);
    const eb = B.net.edgeIndex.get(S.origin);
    R.mapB.setMarker('origin', eb === undefined ? null : [B.net.edges.shape[eb][0], B.net.edges.shape[eb][1]]);
  }
}

function streetsOf(net, edges) {
  const out = [];
  for (const e of edges) { const n = net.edges.name[e] || 'unnamed road'; if (out[out.length - 1] !== n) out.push(n); }
  return out;
}

function renderDetails() {
  const box = $('#details');
  const A = R.runA, B = R.runB;
  if (S.view === 'access' && S.origin) {
    const net = A.net;
    const e = net.edgeIndex.get(S.origin) ?? B?.net.edgeIndex.get(S.origin);
    const refNet = net.edgeIndex.has(S.origin) ? net : B.net;
    const T = A.meta.n_intervals;
    const rA = routeSeconds(A, S.origin, S.i);
    const dayKey = `${A.id}|${B?.id}|${S.origin}|${S.target.lon},${S.target.lat}`;
    const day = (run) => Array.from({ length: T }, (_, k) => routeSeconds(run, S.origin, run === A ? k : intervalFor(run, k)).seconds / 60);
    const ready = R.last.dayKey === dayKey;
    if (!ready && !R.last.dayPending) {
      // the day series needs one route search per interval: do it after this paint
      R.last.dayPending = true;
      setTimeout(() => { day(A); if (B) day(B); R.last.dayKey = dayKey; R.last.dayPending = false; renderDetails(); }, 30);
    }
    const series = ready ? [day(A)] : [];
    let rows = `<dt>${B ? 'A' : 'Time'}</dt><dd>${minutes(rA.seconds)}</dd>`;
    if (B) {
      const rB = routeSeconds(B, S.origin, intervalFor(B, S.i));
      if (ready) series.push(day(B));
      rows += `<dt>B</dt><dd>${minutes(rB.seconds)}</dd><dt>B − A</dt><dd>${signedMinutes(rB.seconds - rA.seconds)}</dd>`;
    }
    const via = streetsOf(A.net, rA.edges);
    box.innerHTML = `<h2>Route to the target</h2>
      <p class="details-title">From ${escapeHtml(refNet.edges.name[e] || 'unnamed road')} (${directionLabel(refNet.edges.bearing[e])})</p>
      <p class="hint">Departing ${clock(tDep())}, from the middle of this road section.</p>
      <dl class="kv">${rows}</dl>
      ${via.length ? `<p class="hint">Via ${escapeHtml(via.slice(0, 8).join(', '))}${via.length > 8 ? ', …' : ''}</p>` : ''}
      ${ready ? sparkline(series, S.i) : '<p class="hint">Working out the rest of the day…</p>'}<div class="spark-caption">Travel time over the day (minutes)${B ? '; solid A, dashed B' : ''}</div>
      <button class="link-btn" id="clear-origin">Clear route</button>`;
    $('#clear-origin').onclick = () => { S.origin = null; update(); };
    return;
  }
  if (S.view === 'congestion' && S.selected) {
    const netRef = (S.cmp === 'diff' ? B : A).net;
    const k = netRef.laneIndex.get(S.selected);
    if (k === undefined) { S.selected = null; box.innerHTML = '<h2>Details</h2><p class="hint">Hover or click a road.</p>'; return; }
    const L = netRef.lanes;
    const n = netRef.edges.lanes[L.edge[k]].length;
    const vals = (run) => {
      const j = run.net.laneIndex.get(S.selected);
      if (j === undefined) return null;
      const i = run === A ? S.i : intervalFor(run, S.i), dt = run.meta.interval_s;
      const v = (m) => laneValue(run.lanes, m, i, j, dt);
      // gaps where the lane had no vehicles
      const series = Array.from({ length: A.meta.n_intervals }, (_, t) => laneValue(run.lanes, S.metric, run === A ? t : intervalFor(run, t), j, dt));
      return { speed: v('speed'), waiting: v('waiting'), density: v('density'), vehicles: v('vehicles'), series, limit: run.net.lanes.speed_kmh[j] };
    };
    const a = vals(A), b = B ? vals(B) : null;
    const fmt = (x, m) => {
      if (!x) return 'not in this network';
      if (m === 'speed') return Number.isNaN(x.speed) ? 'no vehicles' : `${Math.round(x.speed * x.limit)} km/h (${pct(x.speed)} of the limit)`;
      if (m === 'waiting') return `${x.waiting.toFixed(1)} vehicles halted on average`;
      if (m === 'density') { const d = Math.round(x.density); return Number.isNaN(x.density) ? 'no vehicles' : `${d} vehicle${d === 1 ? '' : 's'} per km`; }
      return `${Math.round(x.vehicles)} vehicles per hour`;
    };
    let rows = '';
    for (const [m, name] of [['speed', 'Speed'], ['waiting', 'Queue'], ['density', 'Density'], ['vehicles', 'Volume']]) {
      rows += `<dt>${name}${b ? ' A' : ''}</dt><dd>${fmt(a, m)}</dd>`;
      if (b) rows += `<dt>${name} B</dt><dd>${fmt(b, m)}</dd>`;
    }
    const series = [a?.series || [], ...(b ? [b.series] : [])];
    box.innerHTML = `<h2>Lane details</h2>
      <p class="details-title">${escapeHtml(L.name[k] || 'Unnamed road')}, ${directionLabel(L.bearing[k])}</p>
      <p class="hint">${laneLabel(L.index[k], n)} · limit ${Math.round(L.speed_kmh[k])} km/h · ${Math.round(L.length[k])} m · ${clockRange(tDep(), tDep() + A.meta.interval_s)}</p>
      <dl class="kv">${rows}</dl>
      ${sparkline(series, S.i, { max: S.metric === 'speed' ? 1 : null })}
      <div class="spark-caption">${escapeHtml(METRICS[S.metric].title)} over the day (${escapeHtml(METRICS[S.metric].unit)})${b ? '; solid A, dashed B' : ''}</div>`;
    return;
  }
  box.innerHTML = '<h2>Details</h2><p class="hint">Hover or click a road.</p>';
}

// ------------------------------------------------------------------ difference summary (on the map)
const signedSeconds = (s) => `${s > 0 ? '+' : '−'}${Math.round(Math.abs(s))} s`;
function renderDiffSummary(sum, m, fmtValue, extra = '', own = null) {
  const el = $('#diff-summary');
  if (!sum) { el.hidden = true; el.innerHTML = ''; R.diffBoxes = []; R.diffBody = null; return; }
  const boxes = [];
  const item = (g, fmt) => {
    boxes.push(g.bbox);
    const cls = (g.value > 0) === (m.domain[1] > m.domain[0]) ? 'up' : 'down';   // 'up' = the red end of the scale
    return `<li><button type="button" class="link-btn" data-box="${boxes.length - 1}">${escapeHtml(g.name)}</button>
      <span class="chg ${cls}">${escapeHtml(fmt(g.value))}</span></li>`;
  };
  const text = summaryText(sum, m.say);
  const ownList = own && own.streets.length
    ? `<h3>Roads whose own driving time changed most</h3>
      <p class="hint">Whole network, at this time of day: the time to drive the road itself. The time to the target changes for every
      road behind a slower or faster one, so these point at where the change comes from.</p>
      <ul>${own.streets.map((g) => item(g, signedSeconds)).join('')}</ul>` : '';
  const body = `<p>${escapeHtml(text)}</p>${extra ? `<p class="hint">${escapeHtml(extra)}</p>` : ''}
    ${sum.streets.length ? `<h3>Biggest changes <span class="hint">(click to zoom)</span></h3><ul>${sum.streets.map((g) => item(g, fmtValue)).join('')}</ul>` : ''}
    ${ownList}`;
  el.hidden = false;
  // rebuilt only when it says something new (the timeline replays frames; keep focus and scroll position)
  if (R.diffBody === body && el.firstChild) return;
  R.diffBody = body; R.diffBoxes = boxes;
  const open = el.dataset.closed !== '1' && !matchMedia('(max-width: 700px)').matches;
  el.innerHTML = `<details${open ? ' open' : ''}><summary>What changed, B − A</summary>${body}</details>`;
  $('details', el).addEventListener('toggle', (e) => { el.dataset.closed = e.target.open ? '0' : '1'; });
  for (const b of $$('[data-box]', el)) b.addEventListener('click', () => R.mapA.zoomToBox(R.diffBoxes[+b.dataset.box]));
}

function renderLegend() {
  const th = theme();
  const access = S.view === 'access';
  const key = S.cmp === 'diff' ? (access ? 'diff_time' : `diff_${S.metric}`) : (access ? 'time' : S.metric);
  const st = legendStops(key, th, key === 'time' ? R.timeDomain : null);
  const nd = NO_DATA[th];
  const noData = access ? (S.cmp === 'diff' ? 'no route in A or B, or road only in B' : 'no route to the target')
    : (S.cmp === 'diff' ? 'no vehicles in either run, or lane only in B' : 'no vehicles in these 15 minutes');
  $('#legend').innerHTML = `<h2>Legend</h2>
    <div class="legend-title">${escapeHtml(st.title)} <span class="legend-unit">(${escapeHtml(st.unit)})</span></div>
    <div class="legend-bar" style="background:${st.gradient}"></div>
    <div class="legend-ticks">${st.ticks.map((t) => `<span style="left:${t.pos * 100}%">${escapeHtml(t.label)}</span>`).join('')}</div>
    ${st.ends ? `<div class="legend-ends"><span>${escapeHtml(st.ends[0])}</span><span>${escapeHtml(st.ends[1])}</span></div>` : ''}
    ${st.deadband ? `<p class="hint">${escapeHtml(st.deadband)}</p>` : ''}
    ${!access && S.metric === 'speed' && S.cmp !== 'diff' ? '<div class="legend-ends"><span>free-flowing</span><span>stopped</span></div>' : ''}
    <div class="swatch-row"><span class="swatch" style="--sw:${nd}"></span>${escapeHtml(noData)}</div>
    ${S.cmp === 'diff' ? '<div class="swatch-row"><span class="swatch dashed" style="--sw:var(--muted)"></span>removed in B (only in A)</div>' : ''}
    ${S.cmp === 'diff' && access ? '<p class="hint">A road with a route in A but none in B shows as the darkest red.</p>' : ''}`;
}

function renderBanner() {
  const metas = [R.runA.meta, R.runB?.meta].filter(Boolean);
  const syn = metas.find((m) => m.synthetic);
  const el = $('#banner');
  el.hidden = !syn;
  if (syn) el.textContent = syn.notes || 'Sample data, not results.';
}

function setStatus(t) { const el = $('#status'); if (el.textContent !== t) el.textContent = t; }

// ------------------------------------------------------------------ hover / click
function hoverText(view, h) {
  const A = R.runA, B = R.runB;
  const net = view === R.mapB ? B.net : (S.cmp === 'diff' ? B.net : A.net);
  if (h.layer === 'pois') return `${h.props.name || 'Place'} (${h.props.category.replace(/[_:]/g, ' ')})`;
  if (h.layer === 'zones-fill') {
    const v = view.state.zones?.[h.id];
    return `${h.props.name}: median ${v === null || v === undefined ? 'n/a' : S.cmp === 'diff' ? signedMinutes(v * 60) : minutes(v * 60)}`;
  }
  const v = view.state[h.layer]?.[h.id];
  if (h.layer === 'lanes') {
    const L = net.lanes;
    const n = net.edges.lanes[L.edge[h.id]].length;
    const head = `${L.name[h.id] || 'Unnamed road'}, ${directionLabel(L.bearing[h.id])}, ${laneLabel(L.index[h.id], n)}`;
    let val;
    if (v === null || v === undefined) val = S.cmp === 'diff' ? 'not comparable' : 'no vehicles';
    else if (S.cmp === 'diff') val = `${METRICS[`diff_${S.metric}`].fmt(v)} ${METRICS[`diff_${S.metric}`].unit}`;
    else val = S.metric === 'speed' ? `${pct(v)} of the ${Math.round(L.speed_kmh[h.id])} km/h limit` : `${METRICS[S.metric].fmt(v)} ${METRICS[S.metric].unit}`;
    return `${head}: ${val}`;
  }
  const E = net.edges;
  const head = `${E.name[h.id] || 'Unnamed road'}, ${directionLabel(E.bearing[h.id])}`;
  if (v === null || v === undefined) return `${head}: ${S.cmp === 'diff' ? 'not comparable' : 'no route'}`;
  if (S.cmp === 'diff' && Math.abs(v) >= NO_ROUTE_IN_B) return `${head}: ${v > 0 ? 'no route to the target in B' : 'route only in B'}`;
  return `${head}: ${S.cmp === 'diff' ? signedMinutes(v * 60) : minutes(v * 60)} to the target`;
}

function onHover(view, container) {
  return (h) => {
    const tip = $('#tooltip');
    if (!h) { tip.hidden = true; return; }
    tip.textContent = hoverText(view, h);
    const box = $(container).getBoundingClientRect(), outer = $('#maps').getBoundingClientRect();
    tip.style.left = `${Math.min(box.left - outer.left + h.point.x + 14, outer.width - 270)}px`;
    tip.style.top = `${box.top - outer.top + h.point.y + 14}px`;
    tip.hidden = false;
  };
}

function onClick(view) {
  return (c) => {
    const net = view === R.mapB ? R.runB.net : (S.cmp === 'diff' ? R.runB.net : R.runA.net);
    if (S.view === 'access') {
      if (R.pickTarget || c.layer === 'pois') {
        if (c.layer === 'pois') { const p = net.pois[c.id]; S.target = { lon: p.lon, lat: p.lat, name: p.name }; }
        else S.target = { lon: c.lngLat.lng, lat: c.lngLat.lat, name: null };
        S.origin = null;
        setPickTarget(false);
        syncPoiSelect();
      } else if (c.layer === 'edges' && c.id !== null) S.origin = net.edges.id[c.id];
      else S.origin = null;
    } else S.selected = c.layer === 'lanes' && c.id !== null ? net.lanes.id[c.id] : null;
    update();
  };
}

function makeMap(sel, which) {
  return new MapView($(sel), { theme: theme(), onHover: null, onClick: null,
    on3D: (on) => { S.d3 = on; for (const v of [R.mapA, R.mapB]) if (v && v.is3D !== on) v.set3D(on); writeHash(); } });
}

function wireMap(view, sel) {
  view.onHover = onHover(view, sel);
  view.onClick = onClick(view);
}

function syncMaps(a, b) {
  let lock = false;
  const link = (src, dst) => src.map.on('move', () => {
    if (lock) return;
    lock = true;
    dst.map.jumpTo({ center: src.map.getCenter(), zoom: src.map.getZoom(), bearing: src.map.getBearing(), pitch: src.map.getPitch() });
    lock = false;
  });
  link(a, b); link(b, a);
  wireMap(b, '#mapB');
}

function applySwipe() {
  const w = $('#maps').clientWidth;
  const x = Math.round(S.swipe * w);
  $('#mapB').style.clipPath = `inset(0 0 0 ${x}px)`;
  const d = $('#swipe');
  d.style.left = `${x}px`;
  d.setAttribute('aria-valuenow', String(Math.round(S.swipe * 100)));
}

function wireSwipe() {
  const d = $('#swipe');
  let drag = false;
  d.addEventListener('pointerdown', (e) => { drag = true; d.setPointerCapture(e.pointerId); });
  d.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const r = $('#maps').getBoundingClientRect();
    S.swipe = Math.max(0.02, Math.min(0.98, (e.clientX - r.left) / r.width));
    applySwipe();
  });
  d.addEventListener('pointerup', () => { drag = false; });
  d.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      S.swipe = Math.max(0.02, Math.min(0.98, S.swipe + (e.key === 'ArrowLeft' ? -0.05 : 0.05)));
      applySwipe(); e.preventDefault();
    }
  });
  new ResizeObserver(() => { if (S.cmp === 'swipe') applySwipe(); }).observe($('#maps'));
}

function setPickTarget(on) {
  R.pickTarget = on;
  $('#pick-target').setAttribute('aria-pressed', String(on));
  $('#pick-target').textContent = on ? 'Click the map to place the target…' : 'Pick target on the map';
  for (const v of [R.mapA, R.mapB]) if (v) v.map.getCanvas().style.cursor = on ? 'crosshair' : '';
}

function syncPoiSelect() {
  const sel = $('#poi');
  const net = R.runA.net;
  const k = (net.pois || []).findIndex((p) => p.lon === S.target.lon && p.lat === S.target.lat);
  sel.value = k >= 0 ? String(k) : '';
}

function fillPois(net) {
  const groups = new Map();
  (net.pois || []).forEach((p, i) => {
    const cat = (p.category || 'other').replace(/[_:]/g, ' ');
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push([i, p]);
  });
  $('#poi').innerHTML = '<option value="">Chosen on the map</option>' + [...groups.entries()].sort().map(([cat, ps]) =>
    `<optgroup label="${escapeHtml(cat)}">${ps.map(([i, p]) => `<option value="${i}">${escapeHtml(p.name || p.id)}</option>`).join('')}</optgroup>`).join('');
}

function aboutHtml() {
  const idx = R.store.index;
  return `
  <p>Results of microscopic traffic simulations of Victor Harbor made with <abbr title="Simulation of Urban MObility">SUMO</abbr>.
  ${idx.runs.length} runs on ${Object.keys(idx.networks).length} network variants are loaded from <code>${escapeHtml(R.store.base)}</code>.</p>
  <h3>Travel time to a target</h3>
  <p>Each road section is coloured by the driving time from the middle of that section to the target, departing at the selected time.
  Travel times per road section come from the simulation (mean of the vehicles on it in each 15-minute interval; the speed-limit time where no vehicle drove there),
  interpolated between interval mid-points. Turns follow the simulated network's allowed movements, including the time to cross each junction.</p>
  <p><strong>Method:</strong> time-dependent. For arrival times at the target of t, t + 3¾ min, t + 7½ min, … a reverse search finds the latest time one can
  leave every road section and still arrive, and the route that does it. For each road section, the routes of the two arrival times that bracket a departure at t
  are then driven forward from t with the time-dependent travel times, and the faster is shown. Each value is therefore the exact time of a real route;
  in tests with sudden 1–10 minute queues it was within 5 seconds of a full forward search from each place. Vehicles do not re-route as conditions change during a trip;
  road closures and parking search are not represented.</p>
  <h3>Congestion</h3>
  <p>Each direction of a road is drawn on its own side (left-hand traffic), and each lane separately. Colours show the mean speed of the vehicles in that lane during
  the 15 minutes as a share of the lane's speed limit, or the average number of vehicles halted, the density, or the volume. Lanes with no vehicles are grey.</p>
  <h3>Timeline and bookmarks</h3>
  <p>The chart shows network-wide delay (time lost compared with driving at the desired speed, in vehicle-hours per 15 minutes). Bookmarks are detected
  automatically (the peak, the sharpest rises and falls, the first time an approach to a junction queues past ${R.runA.meta.queue_threshold_vehicles ?? 5} vehicles per lane on average),
  come from the scenario (events), or mark where A and B differ most.</p>
  <h3>Comparing scenarios</h3>
  <p>Side by side and swipe keep both maps at the same place and time. Difference shows B − A: blue where B is better (faster, shorter queues), red where B is worse.
  Roads are matched by their network id; roads that exist in only one scenario are shown as such.</p>
  <h3>Colours</h3>
  <p>Sequential scales change lightness steadily (more = darker in light mode, lighter in dark mode), so they stay readable with colour-vision deficiency;
  travel time uses viridis. Differences use a blue–grey–red diverging scale with grey for no change.</p>
  <h3>Keyboard</h3>
  <ul><li><kbd>Space</kbd> play or pause</li><li><kbd>←</kbd> <kbd>→</kbd> step 15 minutes</li><li><kbd>[</kbd> <kbd>]</kbd> previous / next bookmark</li></ul>`;
}

// ------------------------------------------------------------------ init
async function init() {
  window.__viewer = { state: S, frames: 0, ready: null, R };
  if (typeof maplibregl === 'undefined') {
    setStatus('');
    document.querySelector('#maps').innerHTML = '<p class="hint" style="padding:20px">The map library could not be loaded. It comes from cdnjs.cloudflare.com, so this page needs internet access.</p>';
    return;
  }
  readHash();
  if (S.theme !== 'auto') document.documentElement.dataset.theme = S.theme;
  const { base, index } = await findData();
  R.store = new Store(base, index);
  R.choices = runChoices(index);
  const ids = index.runs.map((r) => r.id);
  if (!ids.includes(S.a)) {   // default: baseline, a school-term weekday, today's demand
    const score = (r) => (r.scenario === 'baseline' ? 4 : 0) + (r.condition === 'weekday_term' ? 2 : 0) + (r.growth === 'base' ? 1 : 0);
    S.a = [...index.runs].sort((x, y) => score(y) - score(x))[0].id;
  }
  if (!ids.includes(S.b)) {
    const a = index.runs.find((r) => r.id === S.a);
    S.b = (index.runs.find((r) => r.scenario !== a.scenario && r.condition === a.condition && r.year === a.year && r.growth === a.growth)
      || index.runs.find((r) => r.id !== S.a) || a).id;
  }
  R.mapA = makeMap('#mapA', 'A');
  wireMap(R.mapA, '#mapA');
  R.timeline = new Timeline($('#timeline'), { onChange: (i) => { if (i !== S.i) { S.i = i; frame(); } } });
  wirePicker($('#run-a'), 'a');
  wirePicker($('#run-b'), 'b');
  for (const r of $$('input[name="view"]')) r.addEventListener('change', () => { S.view = r.value; update(); });
  for (const r of $$('input[name="cmp"]')) r.addEventListener('change', () => { S.cmp = r.value; update({ runs: true }); });
  $('#metric').value = S.metric;
  $('#metric').addEventListener('change', (e) => { S.metric = e.target.value; update(); });
  $('#swap-ab').addEventListener('click', () => { [S.a, S.b] = [S.b, S.a]; update({ runs: true }); });
  $('#pick-target').addEventListener('click', () => setPickTarget(!R.pickTarget));
  $('#poi').addEventListener('change', (e) => {
    const p = R.runA.net.pois[+e.target.value];
    if (p) { S.target = { lon: p.lon, lat: p.lat, name: p.name }; S.origin = null; update(); }
  });
  $('#show-zones').checked = S.zones;
  $('#show-zones').addEventListener('change', (e) => { S.zones = e.target.checked; update(); });
  $('#show-pois').checked = S.pois;
  $('#show-pois').addEventListener('change', (e) => { S.pois = e.target.checked; update(); });
  // OpenStreetMap tiles from the internet: a local-development extra (the published copy may not load them)
  $('#osm-row').hidden = !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  if ($('#osm-row').hidden) S.basemap = false;
  $('#basemap').checked = S.basemap;
  $('#basemap').addEventListener('change', (e) => { S.basemap = e.target.checked; update(); });
  $('#landmarks').checked = S.landmarks;
  $('#landmarks').addEventListener('change', (e) => { S.landmarks = e.target.checked; update(); });
  $('#theme').value = S.theme;
  const applyTheme = () => {
    if (S.theme === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = S.theme;
    for (const v of [R.mapA, R.mapB]) v?.setTheme(theme());
    update();
  };
  $('#theme').addEventListener('change', (e) => { S.theme = e.target.value; applyTheme(); });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (S.theme === 'auto') applyTheme(); });
  $('#toggle-panel').addEventListener('click', () => {
    const open = $('#panel').classList.toggle('open');
    $('#toggle-panel').setAttribute('aria-expanded', String(open));
  });
  $('#about-btn').addEventListener('click', () => { $('#about-body').innerHTML = aboutHtml(); $('#about').showModal(); });
  wireSwipe();
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, select, textarea, button, a, [role="slider"]')) return;
    if (e.key === ' ') { R.timeline.toggle(); e.preventDefault(); }
    else if (e.key === 'ArrowRight') R.timeline.set(S.i + 1, true);
    else if (e.key === 'ArrowLeft') R.timeline.set(S.i - 1, true);
    else if (e.key === ']') R.timeline.set(stepBookmark(R.groups, S.i, 1), true);
    else if (e.key === '[') R.timeline.set(stepBookmark(R.groups, S.i, -1), true);
  });
  const ready = update({ runs: true }).then(() => { fillPois(R.runA.net); syncPoiSelect(); });
  window.__viewer.ready = ready;
  await ready;
}

// fast path for the timeline: values only
let pending = false;
function frame() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    busy = busy.then(() => { renderFrame(); renderLegend(); writeHash(); }).catch((e) => { console.error(e); setStatus(`Error: ${e.message}`); });
  });
}

init().catch((e) => { console.error(e); setStatus(`Could not start: ${e.message}`); });
