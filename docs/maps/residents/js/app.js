// Residents' site: my trips, options compared with today, looking ahead, travel time from anywhere.
// Everything is computed in the browser from the published simulation results; trips never leave it.
import { findData, Store } from '../../js/data.js';
import { nearestNode, routeFromNode, travelTimesTo } from '../../js/graph.js';
import { scaleFor, legendStops, niceMax, quantile } from '../../js/colour.js';
import { clock, escapeHtml } from '../../js/format.js';
import { MapView } from '../../js/mapview.js';
import { emphasis, summariseChanges, FAINT } from '../../js/changes.js';
import { TripStore, safeStorage, DAY_TYPES, timeOptions } from './trips.js';
import { classify, bandFor, plainTravelTime, plainDuration, routeClasses, heatDiff, HEAT_CODE, CLASS_COLOURS, CLASS_SYMBOL, SAME_ABS_S, SAME_REL, SINGLE_ABS_S, SINGLE_REL } from './change.js';
import { optionList, findRun, isJammed, timelineFor, YEARS, GROWTH, yearLong, yearShort, isLongRange, NEAR_YEAR, NOW_YEAR } from './outlook.js';
import { loadAddressIndex } from './address.js';
import { attachCombobox } from './suggest.js';

// Link to the method and results write-up; change to the published address when the knowledge base is online.
// The link is only shown when it can be reached from where this page is served.
const METHODS_URL = '../../kb/simulation-results.html';
// The address list: a static file downloaded once, the first time an address box is used, and searched here.
const ADDRESS_URL = 'data/addresses.json';
const MAX_SNAP_M = 800;           // places further than this from a simulated road are "outside the area"
const SHOW_SNAP_M = 100;          // say where the route starts when the nearest road is further than this
const TODAY = 'baseline';
const MAP_SAME = '#b4b3ad';       // "about the same" on the heat map (roads with no cars allowed stay lighter)
const ROUTE_SAME = '#8d8d87';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const S = { option: null, yearIdx: 0, growth: 'moderate', glanceWhen: 'now', season: 'trip', selected: null, mapMode: 'route', pick: null,
  heat: { place: '', time: 8.5 * 3600, day: 'weekday', show: 'today' } };
const R = { store: null, runs: [], options: [], trips: null, view: null, baseNet: null, pois: [], cache: new Map(),
  picked: { from: null, to: null }, addr: { index: null, loading: null, failed: false }, combos: {}, token: 0, drawToken: 0, heatValues: null, mapReady: null, glanceDone: false };

const year = () => YEARS[S.yearIdx];
const optionName = (id) => R.options.find((o) => o.id === id)?.name ?? id;
const dayFor = (trip) => (S.season === 'trip' ? trip.day : S.season);
// This year is 2026; the "now" runs are built on 2025 data, and other years are placed relative to 2026.
const yearLabel = (y, g = S.growth) => (y === NOW_YEAR ? 'now (2025 data)' : `${yearLong(y)}, ${GROWTH[g]}`);
const ucfirst = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const nanEdges = (net) => new Float64Array(net.edges.id.length).fill(NaN);

// ------------------------------------------------------------------ computing trips
function snap(net, p, leaving) {
  const node = nearestNode(net, net.graph, p.lon, p.lat, { leaving });
  const k = Math.cos((p.lat * Math.PI) / 180);
  const m = Math.hypot((net.nodes.lon[node] - p.lon) * k, net.nodes.lat[node] - p.lat) * 111320;
  return { node, m, far: m > MAX_SNAP_M };
}

/** { seconds, edges, run, snapFrom, snapTo } | { missing } | { outside } for a trip under a scenario and year. */
function tripTime(trip, scenario, y = year(), growth = S.growth, dayKey = dayFor(trip)) {
  const runId = findRun(R.runs, scenario, DAY_TYPES[dayKey].condition, y, growth);
  if (!runId) return Promise.resolve({ missing: true, dayKey,
    jammed: isJammed(R.jammed, scenario, DAY_TYPES[dayKey].condition, y, growth) });
  const key = `${runId}|${trip.from.lon},${trip.from.lat}|${trip.to.lon},${trip.to.lat}|${trip.time}`;
  if (!R.cache.has(key)) {
    R.cache.set(key, R.store.routing(runId).then((run) => {
      const a = snap(run.net, trip.from, true), b = snap(run.net, trip.to, false);
      if (a.far || b.far) return { outside: true, run, dayKey };
      const r = routeFromNode(run.net.graph, run.times, a.node, b.node, trip.time);
      return { seconds: r.seconds, edges: r.edges, run, dayKey, snapFrom: a, snapTo: b };
    }).catch((e) => { R.cache.delete(key); throw e; }));   // a failed download is retried next time
  }
  return R.cache.get(key);
}

/** One comparison of today's result `a` with an option's result `b`: what to say and how to class it. */
function compare(a, b) {
  // a simulation that jammed is a result ("the roads couldn't carry it"), not a gap
  if ((a.missing && !a.jammed) || (b.missing && !b.jammed)) return { kind: 'missing', dayKey: a.dayKey || b.dayKey };
  if (a.jammed || b.jammed) return { kind: 'jammed', today: !!a.jammed, option: !!b.jammed, dayKey: a.dayKey || b.dayKey };
  if (a.outside || b.outside) return { kind: 'outside' };
  if (!Number.isFinite(a.seconds)) return { kind: 'noroute' };
  const band = bandFor(a.run.entry.seed, b.run.entry.seed);
  return { kind: 'ok', c: classify(a.seconds, b.seconds, band), single: band.single };
}

const OUTSIDE = 'This trip starts or ends outside the simulated area.';
const SINGLE_NOTE = ` <span class="muted">(from a single simulation run, so less certain: "about the same" here means within ${SINGLE_ABS_S / 60} minute or ${SINGLE_REL * 100}%)</span>`;
const NOROUTE = "There is no route for this trip on today's simulated roads.";

function chip(c, { short = false } = {}) {
  if (!c) return '';
  const text = short
    ? (c.cls === 'same' ? 'same' : c.cls === 'unknown' ? '–' : !Number.isFinite(c.delta) ? 'no route'
      : `${c.delta > 0 ? '+' : '−'}${Math.abs(c.delta) < 60 ? '<1' : Math.round(Math.abs(c.delta) / 60)} min`)
    : c.words;
  return `<span class="chip ${c.cls}"><span aria-hidden="true">${CLASS_SYMBOL[c.cls]}</span> ${escapeHtml(text)}</span>`;
}

const jammedText = (cmp, y) => `In the simulation the roads jammed: more traffic than ${cmp.today && cmp.option ? "today's roads, or the roads with this option," : cmp.today ? "today's roads" : 'the roads with this option'} can carry (${DAY_TYPES[cmp.dayKey].label.toLowerCase()}, ${yearLabel(y)}).`;
const jammedChip = (cmp, y) => `<span class="chip jammed"><span aria-hidden="true">✕</span> ${escapeHtml(jammedText(cmp, y))}</span>`;
const notSimulated = (dayKey, y) => `<span class="chip missing">Not simulated yet for ${escapeHtml(DAY_TYPES[dayKey].label.toLowerCase())}, ${escapeHtml(yearLabel(y))}</span>`;

function compareHtml(cmp, y) {
  if (cmp.kind === 'missing') return notSimulated(cmp.dayKey, y);
  if (cmp.kind === 'jammed') return jammedChip(cmp, y);
  if (cmp.kind === 'outside') return `<span class="chip missing">${OUTSIDE}</span>`;
  if (cmp.kind === 'noroute') return `<span class="chip missing">${NOROUTE}</span>`;
  return chip(cmp.c) + (cmp.single ? SINGLE_NOTE : '');
}

function noteStorage() {
  $('#storage-state').textContent = R.trips.persisted || !R.trips.trips.length
    ? (R.storageOk ? 'You can remove them at any time.' : 'This browser is not letting the page save, so your trips will be forgotten when you close it.')
    : 'This browser could not save your latest change (its storage may be full or blocked), so it will be forgotten when you close the page.';
}

// ------------------------------------------------------------------ my trips
// Each trip card shows two results side by side: now, and about 5 years ahead (the growth control sets the growth).
const PERIODS = [
  { y: NOW_YEAR, title: 'Now', aria: 'Now (2025 data)' },
  { y: NEAR_YEAR, title: 'In about 5 years (2031)', aria: 'In about 5 years (2031)' },
];
function renderTrips(focusShowOf = null) {
  const list = $('#trip-list');
  const trips = R.trips.trips;
  $('#no-trips').hidden = trips.length > 0;
  if (!trips.some((t) => t.id === S.selected)) S.selected = trips[0]?.id ?? null;
  list.innerHTML = trips.map((t) => `
    <li class="trip${t.id === S.selected ? ' selected' : ''}" data-id="${t.id}">
      <div class="trip-head"><span class="trip-name">${escapeHtml(t.from.name)} → ${escapeHtml(t.to.name)}</span>
        <span class="trip-when">${escapeHtml(DAY_TYPES[dayFor(t)].label)}, leaving ${clock(t.time)}</span></div>
      <div class="trip-periods">${PERIODS.map((p) => `
        <section class="period" data-y="${p.y}" aria-label="${escapeHtml(p.aria)}"><h4>${escapeHtml(p.title)}</h4>
          <dl class="trip-times"><dt>Today's network</dt><dd class="t-today">…</dd>
            <dt class="t-opt-name">${escapeHtml(optionName(S.option))}</dt><dd class="t-opt">…</dd></dl>
          <div class="t-change" aria-live="polite"></div></section>`).join('')}</div>
      <div class="trip-actions">
        <button class="btn small show" type="button">Show on map</button>
        <button class="btn small link danger remove" type="button" aria-label="Remove trip ${escapeHtml(t.from.name)} to ${escapeHtml(t.to.name)}">Remove</button>
      </div>
    </li>`).join('');
  const token = ++R.token;
  for (const t of trips) {
    const li = $(`li[data-id="${t.id}"]`, list);
    for (const p of PERIODS) {
      const el = $(`.period[data-y="${p.y}"]`, li);
      Promise.all([tripTime(t, TODAY, p.y), tripTime(t, S.option, p.y)]).then(([a, b]) => {
        if (token !== R.token) return;
        const time = (r) => (r.jammed ? 'jammed' : r.missing ? '–' : r.outside ? 'outside the area' : plainTravelTime(r.seconds));
        $('.t-today', el).textContent = time(a);
        $('.t-opt', el).textContent = time(b);
        const cmp = compare(a, b);
        $('.t-change', el).innerHTML = compareHtml(cmp, p.y)
          + (cmp.kind === 'ok' ? ` <span class="muted">with ${escapeHtml(optionName(S.option))}, ${escapeHtml(yearLabel(p.y))}</span>` : '');
      }).catch((e) => { console.error(e); $('.t-change', el).textContent = `Could not work this out: ${e.message}`; });
    }
  }
  for (const li of $$('li.trip', list)) {
    $('.show', li).onclick = () => { S.selected = li.dataset.id; S.mapMode = 'route'; renderTrips(li.dataset.id); fillPlaceList(); drawMap(); };
    $('.remove', li).onclick = () => { R.trips.removeTrip(li.dataset.id); noteStorage(); refresh(); };
  }
  if (focusShowOf) $(`li[data-id="${focusShowOf}"] .show`, list)?.focus();
  renderOptionSummaries();
}

function placeChoices() {
  const saved = R.trips.places.map((p) => ({ label: p.name, place: p }));
  const pois = R.pois.map((p) => ({ label: `${p.name} (${p.category.replace(/_/g, ' ')})`, place: { name: p.name, lon: p.lon, lat: p.lat, poi: p.id } }));
  return saved.concat(pois);
}
const listMatch = (v) => placeChoices().find((c) => c.label.toLowerCase() === v.toLowerCase() || c.place.name.toLowerCase() === v.toLowerCase());

function fillPlaceList() {
  $('#place-list').innerHTML = placeChoices().map((c) => `<option value="${escapeHtml(c.label)}"></option>`).join('');
  const sel = $('#heat-place');
  const keep = sel.value;
  const tripDest = R.trips.trips.map((t) => t.to).concat(R.trips.places);
  const seen = new Set();
  const opts = [];
  for (const p of tripDest.concat(R.pois.map((x) => ({ name: x.name, lon: x.lon, lat: x.lat })))) {
    const k = `${p.lon.toFixed(5)},${p.lat.toFixed(5)}`;
    if (seen.has(k) || !p.name) continue;
    seen.add(k);
    opts.push(`<option value="${k}">${escapeHtml(p.name)}</option>`);
  }
  sel.innerHTML = opts.join('');
  // until the resident chooses, follow the selected trip's destination
  const trip = R.trips.trips.find((t) => t.id === S.selected);
  const dest = trip ? `${trip.to.lon.toFixed(5)},${trip.to.lat.toFixed(5)}` : null;
  if (R.heatChosen && keep && seen.has(keep)) sel.value = keep;
  else if (dest && seen.has(dest)) sel.value = dest;
}

/** A place for the field: a point picked on the map (named by what was typed) wins over a list match. */
function resolvePlace(field) {
  const v = $(`#${field}`).value.trim();
  if (!v) return null;
  const picked = R.picked[field];
  if (picked?.address && v !== picked.name && R.addr.index) {
    // a different address typed over a chosen one (not a name for the pin): use that address instead of the old pin
    const other = R.addr.index.search(v).filter((r) => r.kind === 'address');
    if (other.length === 1 && other[0].label !== picked.name) return { name: other[0].label, lon: other[0].lon, lat: other[0].lat };
  }
  if (picked) return { ...picked, name: v, save: v !== picked.name };
  const listed = listMatch(v)?.place;
  if (listed) return listed;
  // an address typed in full but not chosen from the list: use it when it is the only match
  const found = R.addr.index ? R.addr.index.search(v).filter((r) => r.kind === 'address') : [];
  return found.length === 1 ? { name: found[0].label, lon: found[0].lon, lat: found[0].lat } : null;
}

// ------------------------------------------------------------------ addresses and places in the From / To boxes
/** Download the address list once (first time a box is used). Never rejects: failure just turns address search off. */
function ensureAddresses() {
  if (!R.addr.loading) {
    R.addr.loading = loadAddressIndex(ADDRESS_URL)
      .then((ix) => { R.addr.index = ix; })
      .catch((e) => { R.addr.failed = true; console.warn('address search unavailable:', e.message); })
      .then(() => { for (const c of Object.values(R.combos)) c.refresh(); });
  }
  return R.addr.loading;
}

/** Suggestion rows for what has been typed: your places and the listed places that contain it, then addresses. */
function suggestionRows(query) {
  const q = query.trim();
  const lc = q.toLowerCase();
  const places = (lc ? placeChoices().filter((c) => c.label.toLowerCase().includes(lc)) : placeChoices()).slice(0, lc ? 4 : 6)
    .map((c) => ({ label: c.label, sub: R.trips.places.includes(c.place) ? 'Your saved place' : '', kind: 'place', place: c.place }));
  let addresses = [], status = null;
  if (q.replace(/[^a-z0-9]/gi, '').length >= 2) {
    if (R.addr.index) {
      addresses = R.addr.index.search(q, { limit: 6 }).map((r) => ({ label: r.label, sub: r.note || '', kind: 'address', result: r }));
      if (!addresses.length && !places.length) status = 'No address found. Try just the street name, or use "Pick on map".';
    } else if (R.addr.failed) {
      if (!places.length) status = 'Address search could not be loaded. Choose a place, or use "Pick on map".';
    } else {
      status = 'Loading the address list...';
    }
  }
  const rows = [];
  if (places.length) { if (addresses.length) rows.push({ group: 'Places' }); rows.push(...places); }
  if (addresses.length) { if (places.length) rows.push({ group: 'Addresses' }); rows.push(...addresses); }
  if (status) rows.push({ status });
  return rows;
}

function showAddressNote(field) {
  const note = $(`#${field}-note`);
  const p = R.picked[field];
  if (!p || !p.address) { note.hidden = true; note.textContent = ''; return; }
  const v = $(`#${field}`).value.trim();
  note.textContent = '';
  const strong = document.createElement('strong');
  strong.textContent = p.name;
  if (v && v !== p.name) {
    note.append('This place will be saved as ', Object.assign(document.createElement('strong'), { textContent: v }),
      ' and remembered for your next trips. It is the pin at ', strong, '.');
  } else {
    note.append('Pin placed at ', strong, '. ');
    if (p.note) note.append(`${p.note} `);
    note.append('To remember it, type a name such as "Home" over the address. To move the pin, use "Pick on map". ');
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn link'; b.textContent = 'Name this place';
    b.onclick = () => { const el = $(`#${field}`); el.focus(); el.select(); };
    note.append(b);
  }
  note.hidden = false;
}

function choosePlaceRow(field, row) {
  const input = $(`#${field}`);
  input.value = row.label;
  if (row.kind === 'place') {
    R.picked[field] = null;
    R.view?.setMarker(field, null);
  } else {
    const r = row.result;
    R.picked[field] = { name: r.label, lon: r.lon, lat: r.lat, address: true, note: r.note || '' };
    if (R.view) {
      R.view.setMarker(field, [r.lon, r.lat]);
      R.view.map.easeTo({ center: [r.lon, r.lat], zoom: Math.max(R.view.map.getZoom(), 15), duration: 600 });
    }
  }
  showAddressNote(field);
}

function wireForm() {
  const times = timeOptions();
  for (const id of ['#time', '#heat-time']) $(id).innerHTML = times.map((t) => `<option value="${t.value}">${t.label}</option>`).join('');
  $('#time').value = String(8.5 * 3600);
  $('#heat-time').value = String(S.heat.time);
  const simulated = new Set(R.runs.map((r) => r.condition));
  for (const id of ['#day', '#heat-day']) $(id).innerHTML = Object.entries(DAY_TYPES).map(([k, d]) => (simulated.has(d.condition)
    ? `<option value="${k}">${escapeHtml(d.label)}</option>`
    : `<option value="${k}" disabled>${escapeHtml(d.label)} (not simulated yet)</option>`)).join('');
  for (const field of ['from', 'to']) {
    // typing the exact name of a listed place replaces an earlier map or address pick
    $(`#${field}`).addEventListener('input', (e) => {
      const v = e.target.value.trim();
      if (R.picked[field] && listMatch(v) && placeChoices().some((c) => c.label === v)) {
        R.picked[field] = null;
        R.view?.setMarker(field, null);
      }
      if (!v && R.picked[field]?.address) { R.picked[field] = null; R.view?.setMarker(field, null); }   // cleared: forget the pin
      showAddressNote(field);
    });
    R.combos[field] = attachCombobox($(`#${field}`), $(`#${field}-list`), {
      rows: suggestionRows, choose: (row) => choosePlaceRow(field, row), onFocus: ensureAddresses,
      autoPick: () => !R.picked[field] });   // Enter doesn't swap the pin while a name is being typed for it
  }
  $('#add-trip').addEventListener('submit', (e) => {
    e.preventDefault();
    const err = $('#form-error');
    const from = resolvePlace('from'), to = resolvePlace('to');
    if (!from || !to) {
      err.textContent = `Choose ${!from ? 'where the trip starts' : 'where it goes'} from the suggestions (type an address or a place), or pick it on the map.`;
      err.hidden = false;
      return;
    }
    err.hidden = true;
    const keep = (p) => (p.save ? R.trips.savePlace(p.name, p.lon, p.lat) : p);   // remember named map picks
    const t = R.trips.addTrip({ from: keep(from), to: keep(to), time: +$('#time').value, day: $('#day').value });
    S.selected = t.id;
    S.mapMode = 'route';
    $('#from').value = ''; $('#to').value = '';
    R.picked = { from: null, to: null };
    for (const f of ['from', 'to']) showAddressNote(f);
    setPick(null);
    noteStorage();
    refresh();
  });
  for (const b of $$('.pick')) b.addEventListener('click', () => setPick(S.pick === b.dataset.pick ? null : b.dataset.pick));
  $('#clear-all').addEventListener('click', () => {
    if (!confirm('Remove all your trips and saved places from this browser?')) return;
    R.trips.clear();
    noteStorage();
    refresh();
  });
}

function setPick(which) {
  S.pick = which;
  for (const b of $$('.pick')) b.setAttribute('aria-pressed', String(b.dataset.pick === which));
  const banner = $('#pick-banner');
  banner.hidden = !which;
  banner.textContent = which === 'from' ? 'Tap the map where the trip starts' : 'Tap the map where the trip goes';
  if (R.view) R.view.map.getCanvas().style.cursor = which ? 'crosshair' : '';
}

function streetNear(net, lon, lat) {
  const n = nearestNode(net, net.graph, lon, lat);
  for (let e = 0; e < net.edges.id.length; e++) if ((net.edges.to[e] === n || net.edges.from[e] === n) && net.edges.name[e]) return net.edges.name[e];
  return null;
}

// ------------------------------------------------------------------ options
function buildOptions() {   // built once; refresh only updates the state (keeps keyboard focus)
  const box = $('#option-list');
  const groups = [['council', "The Council's proposals"], ['brent', 'An alternative package'],
    ['new', 'Other ideas tested (aimed at where the delay actually is)'], ['other', 'Other options']];
  let html = `<p class="muted"><strong>Today's network</strong>: the roads as they are now. Every option is compared with it.</p>`;
  for (const [g, title] of groups) {
    const opts = R.options.filter((o) => o.group === g);
    if (!opts.length) continue;
    html += `<div class="group-title">${escapeHtml(title)}</div>`;
    html += opts.map((o) => `
      <label class="option${o.part ? ' part' : ''}${o.available ? '' : ' unavailable'}">
        <input type="radio" name="option" value="${o.id}"${o.available ? '' : ' disabled'}>
        <span class="option-name">${escapeHtml(o.name)}${o.part ? ' <span class="muted">(part of the package)</span>' : ''}</span>
        <span class="option-desc">${escapeHtml(o.description)}${o.available ? '' : ' <strong>Not simulated yet.</strong>'}</span>
        <span class="option-sum" data-sum="${o.id}"></span>
      </label>`).join('');
  }
  box.innerHTML = html;
  for (const r of $$('input[name="option"]', box)) r.addEventListener('change', () => { S.option = r.value; refresh(); });
}

function updateOptions() {
  for (const r of $$('input[name="option"]')) r.checked = r.value === S.option;
  $('#heat-opt-name').textContent = optionName(S.option);
  const hy = $('#heat-year');
  if (hy) hy.textContent = `Year: ${yearLabel(year())}${year() !== NOW_YEAR ? ' (set by the "Looking ahead" slider)' : ''}.`;
}

async function summarise(optionId) {
  const out = { better: 0, same: 0, worse: 0, jammed: 0, missing: 0, outside: 0 };
  for (const t of R.trips.trips) {
    const cmp = compare(...await Promise.all([tripTime(t, TODAY, NOW_YEAR), tripTime(t, optionId, NOW_YEAR)]));
    if (cmp.kind === 'ok') out[cmp.c.cls in out ? cmp.c.cls : 'outside']++;
    else out[cmp.kind in out ? cmp.kind : 'outside']++;
  }
  return out;
}

function summaryText(s) {
  const parts = [];
  if (s.better) parts.push(`${s.better} faster`);
  if (s.same) parts.push(`${s.same} about the same`);
  if (s.worse) parts.push(`${s.worse} slower`);
  if (s.jammed) parts.push(`${s.jammed} jammed (more traffic than the roads can carry)`);
  if (s.missing) parts.push(`${s.missing} not simulated yet`);
  if (s.outside) parts.push(`${s.outside} outside the simulated roads`);
  return parts.length ? `Your trips now: ${parts.join(', ')}` : '';
}

function renderOptionSummaries() {
  // only for options whose data is already loaded (the chosen one, or after "work out all options")
  for (const o of R.options) {
    const el = $(`[data-sum="${o.id}"]`);
    if (!el) continue;
    if (!o.available || !R.trips.trips.length || (o.id !== S.option && !R.glanceDone)) { el.textContent = ''; continue; }
    summarise(o.id).then((s) => { el.textContent = summaryText(s); }).catch(() => { el.textContent = ''; });
  }
}

async function renderGlance() {
  R.glanceDone = true;
  const box = $('#glance');
  const trips = R.trips.trips;
  if (!trips.length) { box.innerHTML = '<p class="muted">Add a trip first.</p>'; return; }
  const token = R.token;
  const opts = R.options.filter((o) => o.available && o.id !== TODAY);
  const dayText = S.season === 'trip' ? 'each trip on its own day' : DAY_TYPES[S.season].label.toLowerCase();
  const gy = S.glanceWhen === 'near' ? NEAR_YEAR : NOW_YEAR;
  box.innerHTML = `<table><caption class="muted" style="text-align:left">Change from today's network: ${escapeHtml(yearLabel(gy))}, ${escapeHtml(dayText)}</caption>
    <thead><tr><th scope="col">Option</th>${trips.map((t) => `<th scope="col">${escapeHtml(t.from.name)} → ${escapeHtml(t.to.name)}</th>`).join('')}</tr></thead>
    <tbody>${opts.map((o) => `<tr><th scope="row">${escapeHtml(o.name)}</th>${trips.map((t) => `<td data-o="${o.id}" data-t="${t.id}">…</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  for (const o of opts) {
    for (const t of trips) {
      let html;
      try {
        const [a, b] = await Promise.all([tripTime(t, TODAY, gy), tripTime(t, o.id, gy)]);
        const cmp = compare(a, b);
        html = cmp.kind === 'missing' ? '<span class="chip missing">not simulated yet</span>'
          : cmp.kind === 'jammed' ? '<span class="chip jammed">✕ jammed</span>'
          : cmp.kind === 'outside' ? '<span class="chip missing">outside the area</span>'
            : cmp.kind === 'noroute' ? '<span class="chip missing">no route</span>'
              : `${chip(cmp.c, { short: true })}<br><span class="muted">${plainTravelTime(b.seconds)}</span>`;
      } catch (e) { html = '<span class="chip missing">could not load</span>'; }
      if (token !== R.token) return;   // the page changed meanwhile; the next refresh redraws the table
      const td = $(`td[data-o="${o.id}"][data-t="${t.id}"]`, box);
      if (td) td.innerHTML = html;
    }
  }
  renderOptionSummaries();
}

// ------------------------------------------------------------------ looking ahead
function renderAhead() {
  const box = $('#ahead');
  const y = year();
  $('#year').value = String(S.yearIdx);
  $('#year').setAttribute('aria-valuetext', yearLabel(y));
  const trips = R.trips.trips;
  const conds = new Set(trips.map((t) => DAY_TYPES[dayFor(t)].condition));
  if (!trips.length) conds.add('weekday_term');
  const missing = [], jammed = [];
  for (const sc of [TODAY, S.option]) for (const c of conds) {
    for (const p of timelineFor(R.runs, sc, c, S.growth)) {
      if (p.available) continue;
      (isJammed(R.jammed, sc, c, p.year, S.growth) ? jammed : missing).push(`${optionName(sc)}, ${yearShort(p.year)}`);
    }
  }
  const notes = [];
  if (jammed.length) notes.push(`Jammed in the simulation, more traffic than the roads can carry (shown as ✕): ${[...new Set(jammed)].join('; ')}.`);
  if (missing.length) notes.push(`Not simulated yet (shown as open circles): ${[...new Set(missing)].join('; ')}.`);
  $('#year-note').textContent = notes.length ? notes.join(' ') : 'All years are simulated for these choices.';
  if (!trips.length) { box.innerHTML = '<p class="muted">Add a trip to see how it changes over the years.</p>'; return; }
  box.innerHTML = trips.map((t) => `<div class="ahead-trip" data-id="${t.id}"><h3>${escapeHtml(t.from.name)} → ${escapeHtml(t.to.name)}</h3>
    <div class="chart">…</div><p class="ahead-text muted"></p></div>`).join('') +
    `<div class="ahead-legend"><span><i></i>Today's network</span><span><i class="opt"></i>${escapeHtml(optionName(S.option))}</span><span>✕ jammed</span><span>○ not simulated yet</span></div>`;
  const token = R.token;
  for (const t of trips) {
    const el = $(`.ahead-trip[data-id="${t.id}"]`, box);
    Promise.all(YEARS.flatMap((yy) => [tripTime(t, TODAY, yy), tripTime(t, S.option, yy)])).then((res) => {
      if (token !== R.token) return;
      const today = YEARS.map((_, k) => res[2 * k]), opt = YEARS.map((_, k) => res[2 * k + 1]);
      const cmp = compare(today[S.yearIdx], opt[S.yearIdx]);
      if (cmp.kind === 'outside') { $('.chart', el).innerHTML = ''; $('.ahead-text', el).textContent = OUTSIDE; return; }
      $('.chart', el).innerHTML = aheadChart(today, opt);
      const a = today[S.yearIdx], b = opt[S.yearIdx];
      $('.ahead-text', el).innerHTML = cmp.kind === 'missing' ? `${escapeHtml(ucfirst(yearLabel(y)))}: not simulated yet.`
        : cmp.kind === 'jammed' ? escapeHtml(jammedText(cmp, y))
        : cmp.kind === 'noroute' ? NOROUTE
          : `${escapeHtml(ucfirst(yearLabel(y)))}${isLongRange(y) ? ' (longer range, less certain)' : ''}: ${plainTravelTime(a.seconds)} on today's network, ${plainTravelTime(b.seconds)} with ${escapeHtml(optionName(S.option))} ${compareHtml(cmp, y)}`;
    }).catch((e) => { console.error(e); $('.ahead-text', el).textContent = `Could not work this out: ${e.message}`; $('.chart', el).innerHTML = ''; });
  }
}

function aheadChart(today, opt) {
  const w = 320, h = 110, padL = 34, padR = 10, padT = 18, padB = 22;
  const vals = today.concat(opt).filter((r) => !r.missing && Number.isFinite(r.seconds)).map((r) => r.seconds / 60);
  const top = Math.max(1, ...vals) * 1.15;
  const x = (k) => padL + (k * (w - padL - padR)) / (YEARS.length - 1);
  const y = (m) => h - padB - (m / top) * (h - padT - padB);
  const farK = YEARS.findIndex(isLongRange);   // first longer-range year: drawn lighter ("less certain")
  const line = (series, colour, dash) => {
    // the line is drawn in two parts: up to the first longer-range year at full strength, beyond it lighter
    const path = (from, to, opacity) => {
      let d = '', pen = false;
      series.forEach((r, k) => {
        if (k < from || k > to) return;
        if (r.missing || !Number.isFinite(r.seconds)) { pen = false; return; }
        d += `${pen ? 'L' : 'M'}${x(k).toFixed(1)},${y(r.seconds / 60).toFixed(1)}`; pen = true;
      });
      return d ? `<path d="${d}" fill="none" stroke="${colour}" stroke-width="2.5" opacity="${opacity}"${dash ? ' stroke-dasharray="5 4"' : ''}/>` : '';
    };
    const dots = series.map((r, k) => { const o = isLongRange(YEARS[k]) ? 0.5 : 1; return (r.jammed
      ? `<g stroke="#b3261e" stroke-width="2.5" stroke-linecap="round" opacity="${o}"><line x1="${x(k) - 5}" y1="${h - padB - 9}" x2="${x(k) + 5}" y2="${h - padB + 1}"/><line x1="${x(k) - 5}" y1="${h - padB + 1}" x2="${x(k) + 5}" y2="${h - padB - 9}"/><title>${yearLong(YEARS[k])}: jammed (more traffic than the roads can carry)</title></g>`
      : r.missing || !Number.isFinite(r.seconds)
      ? `<circle cx="${x(k)}" cy="${h - padB - 4}" r="4" fill="#fff" stroke="#9a9993" stroke-width="1.5" opacity="${o}"><title>${yearLong(YEARS[k])}: ${r.missing ? 'not simulated yet' : 'no route'}</title></circle>`
      : `<circle cx="${x(k)}" cy="${y(r.seconds / 60)}" r="${k === S.yearIdx ? 5.5 : 4}" fill="${colour}" opacity="${o}"><title>${yearLong(YEARS[k])}: ${plainTravelTime(r.seconds)}${isLongRange(YEARS[k]) ? ' (longer range, less certain)' : ''}</title></circle>`); }).join('');
    return `${path(0, farK - 1, 1)}${path(farK - 1, YEARS.length - 1, 0.45)}${dots}`;
  };
  const ticks = [0, top / 2, top].map((m) => `<text x="${padL - 6}" y="${y(m) + 4}" text-anchor="end" font-size="11" fill="#5f5e59">${Math.round(m)}</text>`).join('');
  const xl = YEARS.map((yy, k) => `<text x="${x(k)}" y="${h - 6}" text-anchor="middle" font-size="12" fill="#4a4945"${isLongRange(yy) ? ' opacity="0.6"' : ''}${k === S.yearIdx ? ' font-weight="700"' : ''}>${yearShort(yy)}</text>`).join('');
  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Trip time in minutes over the years">
    <rect x="${(x(farK - 1) + x(farK)) / 2}" y="${padT - 6}" width="${w - padR - (x(farK - 1) + x(farK)) / 2 + 4}" height="${h - padB - padT + 6}" fill="#f1efe8" opacity="0.7"/>
    <line x1="${padL}" x2="${w - padR}" y1="${h - padB}" y2="${h - padB}" stroke="#c9c6bb"/>
    <line x1="${x(S.yearIdx)}" x2="${x(S.yearIdx)}" y1="${padT}" y2="${h - padB}" stroke="#e4e1d8" stroke-width="8"/>
    <text x="2" y="9" font-size="11" fill="#5f5e59">minutes</text>${ticks}${xl}
    ${line(today, '#6b6a65', true)}${line(opt, '#0b6a8f', false)}
    <text x="${w - padR}" y="${padT - 8}" text-anchor="end" font-size="10" fill="#5f5e59">longer range, less certain</text></svg>`;
}

// ------------------------------------------------------------------ map
function clearMap(net, caption) {
  const view = R.view;
  view.setValues('edges', nanEdges(net));
  view.setEmphasis('edges', null);
  view.setRoute(net, null); setTodayRoute(null, null);
  $('#map-legend').innerHTML = '';
  $('#map-caption').textContent = caption;
  R.heatValues = null;
}

async function drawMap() {
  const my = ++R.drawToken;                 // a later draw supersedes this one
  await R.mapReady;
  if (my !== R.drawToken) return;
  if (S.mapMode === 'heat') return drawHeat(my);
  const view = R.view;
  const t = R.trips.trips.find((x) => x.id === S.selected);
  view.setMarker('target', null);
  if (!t) {
    await view.setNetwork(R.baseNet);
    if (my !== R.drawToken) return;
    view.setMarker('from', null); view.setMarker('to', null);
    clearMap(R.baseNet, 'Add a trip to see its route here.');
    return;
  }
  const [a, b] = await Promise.all([tripTime(t, TODAY), tripTime(t, S.option)]);
  if (my !== R.drawToken) return;
  view.setMarker('from', [t.from.lon, t.from.lat]);
  view.setMarker('to', [t.to.lon, t.to.lat]);
  const cmp = compare(a, b);
  if (cmp.kind !== 'ok') {
    clearMap(view.net || R.baseNet, `${t.from.name} → ${t.to.name}: ${cmp.kind === 'outside' ? 'starts or ends outside the simulated area'
      : cmp.kind === 'noroute' ? 'no route on today\'s simulated roads' : `not simulated yet for ${yearLabel(year())}`}.`);
    fitTo([t.from, t.to]);
    return;
  }
  const net = b.run.net;
  await view.setNetwork(net);
  if (my !== R.drawToken) return;
  view.setValues('edges', nanEdges(net));
  view.setEmphasis('edges', null);
  // colour each road on the option's route by its own change, at the time the car gets there
  const classes = routeClasses(b.edges, b.run, a.run, t.time);
  view.setRoute(net, b.edges, classes.map((k) => (k === 'same' ? ROUTE_SAME : CLASS_COLOURS[k])));
  setTodayRoute(a.run.net, a.edges);
  fitTo([t.from, t.to]);
  const startNote = b.snapFrom.m > SHOW_SNAP_M || b.snapTo.m > SHOW_SNAP_M
    ? `<br><span class="muted">Times are from the nearest simulated road${b.snapFrom.m > SHOW_SNAP_M ? `, about ${Math.round(b.snapFrom.m / 10) * 10} m from the start` : ''}${b.snapTo.m > SHOW_SNAP_M ? `${b.snapFrom.m > SHOW_SNAP_M ? ' and' : ','} about ${Math.round(b.snapTo.m / 10) * 10} m from the end` : ''}.</span>` : '';
  $('#map-caption').innerHTML = `<strong>${escapeHtml(t.from.name)} → ${escapeHtml(t.to.name)}</strong>, leaving ${clock(t.time)}, ${escapeHtml(yearLabel(year()))}.<br>
    Today's network ${plainTravelTime(a.seconds)}; ${escapeHtml(optionName(S.option))} ${plainTravelTime(b.seconds)} ${compareHtml(cmp, year())}${startNote}`;
  $('#map-legend').innerHTML = `
    <div class="legend-row"><span class="legend-swatch dashed" style="color:#6b6a65"></span>Route on today's network</div>
    <div class="legend-row"><span class="legend-swatch" style="color:${CLASS_COLOURS.better}"></span>Route with the option: road faster</div>
    <div class="legend-row"><span class="legend-swatch" style="color:${ROUTE_SAME}"></span>about the same</div>
    <div class="legend-row"><span class="legend-swatch" style="color:${CLASS_COLOURS.worse}"></span>slower</div>
    <div class="legend-row"><span class="legend-swatch" style="color:${CLASS_COLOURS.new}"></span>road not open to cars today</div>`;
}

function setTodayRoute(net, edges) {
  const src = R.view.map.getSource('route-today');
  if (!src) return;
  const feats = (edges || []).map((e) => ({ type: 'Feature', properties: { slot: net.edges.slot[e] },
    geometry: { type: 'LineString', coordinates: pairs(net.edges.shape[e]) } }));
  src.setData({ type: 'FeatureCollection', features: feats });
}
const pairs = (flat) => { const c = []; for (let i = 0; i < flat.length; i += 2) c.push([flat[i], flat[i + 1]]); return c; };

function fitTo(points) {
  const lons = points.map((p) => p.lon), lats = points.map((p) => p.lat);
  const pad = 0.004;
  R.view.map.fitBounds([[Math.min(...lons) - pad, Math.min(...lats) - pad], [Math.max(...lons) + pad, Math.max(...lats) + pad]],
    { padding: { top: 90, bottom: 140, left: 30, right: 60 }, duration: 0, maxZoom: 16, bearing: R.view.map.getBearing(), pitch: R.view.map.getPitch() });
}

const HEAT_WORDS = { [HEAT_CODE.better]: 'faster with the option', [HEAT_CODE.same]: 'about the same',
  [HEAT_CODE.worse]: 'slower with the option', [HEAT_CODE.unknown]: "can't compare: not on today's roads, or no route there today" };
const HEAT_COLOURS = { [HEAT_CODE.better]: CLASS_COLOURS.better, [HEAT_CODE.same]: MAP_SAME, [HEAT_CODE.worse]: CLASS_COLOURS.worse,
  [HEAT_CODE.unknown]: CLASS_COLOURS.unknown };

/** Plain words for the change heat map: how much of town is about the same, and how many streets change by a
 * minute or more (their names are in the legend's "Biggest changes" list). */
function heatChangeText(sum) {
  if (!sum.total) return '';
  const share = sum.same / sum.total;
  const pct = share > 0.99 && share < 1 ? 'over 99%' : `${Math.round(100 * share)}%`;
  const part = (n, word) => (n ? `${word} by a minute or more from ${n} street${n === 1 ? '' : 's'}` : '');
  const parts = [part(sum.upStreets, 'slower'), part(sum.downStreets, 'faster')].filter(Boolean);
  return `About the same from ${pct} of the roads; ${parts.length ? parts.join(', ') : 'no street is a minute or more slower or faster'}.`;
}

async function drawHeat(my) {
  const view = R.view;
  const [lon, lat] = (S.heat.place || '').split(',').map(Number);
  if (!S.heat.place || !Number.isFinite(lon) || !Number.isFinite(lat)) return;
  const name = $('#heat-place').selectedOptions[0]?.textContent || 'the place';
  const cond = DAY_TYPES[S.heat.day].condition;
  const idA = findRun(R.runs, TODAY, cond, year(), S.growth), idB = findRun(R.runs, S.option, cond, year(), S.growth);
  view.setMarker('from', null); view.setMarker('to', null);
  view.setMarker('target', [lon, lat]);
  if (!idA || (S.heat.show !== 'today' && !idB)) {
    clearMap(view.net || R.baseNet, '');
    const day = DAY_TYPES[S.heat.day].label.toLowerCase();
    const jA = !idA && isJammed(R.jammed, TODAY, cond, year(), S.growth);
    const jB = !idB && isJammed(R.jammed, S.option, cond, year(), S.growth);
    const why = jA || (idA && jB)
      ? `In the simulation the roads jammed for ${jA ? "today's network" : `"${escapeHtml(optionName(S.option))}"`} on ${escapeHtml(day)} in ${escapeHtml(yearLabel(year()))}: more traffic than they can carry.`
      : !idA
      ? `There's no simulation yet of ${escapeHtml(day)} in ${escapeHtml(yearLabel(year()))}.`
      : `"${escapeHtml(optionName(S.option))}" has no simulation of ${escapeHtml(day)} in ${escapeHtml(yearLabel(year()))}.`;
    const fixes = [];
    if (year() !== NOW_YEAR && findRun(R.runs, TODAY, cond, 2025, S.growth)) fixes.push('<button type="button" class="btn small" data-heatfix="today-year">Show now instead</button>');
    if (idA && S.heat.show !== 'today') fixes.push('<button type="button" class="btn small" data-heatfix="today-net">Show today&rsquo;s roads only</button>');
    $('#map-caption').innerHTML = `${why}${year() !== NOW_YEAR ? ' (The year comes from the "Looking ahead" slider.)' : ''}${fixes.length ? `<br>${fixes.join(' ')}` : ''}`;
    for (const btn of $$('[data-heatfix]', $('#map-caption'))) btn.onclick = () => {
      if (btn.dataset.heatfix === 'today-year') S.yearIdx = 0;
      else { S.heat.show = 'today'; for (const r of $$('input[name="heat-show"]')) r.checked = r.value === 'today'; }
      refresh();
    };
    return;
  }
  const [A, B] = await Promise.all([R.store.routing(idA), idB ? R.store.routing(idB) : null]);
  if (my !== R.drawToken) return;
  const minutesOn = (run) => {
    const n = snap(run.net, { lon, lat }, false).node;
    const r = travelTimesTo(run.net.graph, run.times, n, S.heat.time);
    return Float64Array.from(r.fromMid, (v, e) => (run.net.edges.routable[e] ? v / 60 : NaN));
  };
  const mA = minutesOn(A);
  const domain = [0, niceMax(Math.max(2, quantile(mA, 0.95)))];
  let net, vals, scale, legend, em = null, delta = null, change = '';
  if (S.heat.show === 'diff') {
    net = B.net;
    const band = bandFor(A.entry.seed, B.entry.seed);
    const hd = heatDiff(mA, A.net, minutesOn(B), B.net, band);
    vals = hd.codes; delta = hd.delta;
    // "about the same" thin and faint, real changes thicker the bigger they are (full width at 2 minutes)
    em = emphasis(delta, 0, 2);
    for (let e = 0; e < em.length; e++) if (vals[e] === HEAT_CODE.unknown) em[e] = FAINT;   // as in the engineer viewer
    const sum = summariseChanges({ values: delta, names: net.edges.name, shapes: net.edges.shape, deadband: 0, notable: 1, limit: 6 });
    change = heatChangeText(sum);
    R.heatBoxes = sum.streets.map((g) => g.bbox);
    const codes = [HEAT_CODE.better, HEAT_CODE.same, HEAT_CODE.worse, HEAT_CODE.unknown];
    scale = { domain: [codes[0], codes[3]], stops: codes.map((c) => HEAT_COLOURS[c]) };
    legend = codes.map((c) => `<div class="legend-row"><span class="legend-swatch${c === HEAT_CODE.same ? ' thin' : ''}" style="color:${HEAT_COLOURS[c]}"></span>${escapeHtml(HEAT_WORDS[c])}</div>`).join('')
      + '<div class="muted">Thicker lines: bigger changes.</div>'
      + (band.single ? '<div class="muted">From a single simulation run: less certain.</div>' : '')
      + (sum.streets.length ? `<details class="heat-changes"><summary>Biggest changes</summary><ul>${sum.streets.map((g, k) => `<li><button type="button" class="linkish" data-heatbox="${k}">${escapeHtml(g.name)}</button>
          <span style="color:${g.value > 0 ? CLASS_COLOURS.worse : CLASS_COLOURS.better}">${CLASS_SYMBOL[g.value > 0 ? 'worse' : 'better']} ${g.value === Infinity ? 'no route' : `${escapeHtml(plainDuration(g.value * 60))} ${g.value > 0 ? 'slower' : 'faster'}`}</span></li>`).join('')}</ul></details>` : '');
  } else {
    const run = S.heat.show === 'option' ? B : A;
    net = run.net;
    vals = S.heat.show === 'option' ? minutesOn(B) : mA;
    scale = scaleFor('time', 'light', domain);
    const st = legendStops('time', 'light', domain);
    legend = `<div>Minutes to drive there</div><div class="legend-bar" style="background:${st.gradient}"></div>
      <div class="legend-ticks">${st.ticks.map((t) => `<span>${escapeHtml(t.label)}</span>`).join('')}</div>`;
  }
  await view.setNetwork(net);
  if (my !== R.drawToken) return;
  if (R.lastHeatPlace !== S.heat.place) {   // a new place: show the whole town around it
    R.lastHeatPlace = S.heat.place;
    view.map.fitBounds([[Math.min(138.59, lon - 0.01), Math.min(-35.575, lat - 0.01)], [Math.max(138.65, lon + 0.01), Math.max(-35.535, lat + 0.01)]],
      { padding: { top: 90, bottom: 110, left: 20, right: 60 }, duration: 0, bearing: view.map.getBearing(), pitch: view.map.getPitch() });
  }
  view.setRoute(net, null); setTodayRoute(null, null);
  view.setScale(scale);
  view.setValues('edges', vals);
  view.setEmphasis('edges', em);
  R.heatValues = { net, vals, delta, diff: S.heat.show === 'diff' };
  const what = S.heat.show === 'today' ? "on today's network" : S.heat.show === 'option' ? `with ${optionName(S.option)}` : `: change with ${optionName(S.option)}`;
  $('#map-caption').innerHTML = `<strong>Driving time to ${escapeHtml(name)}</strong> ${escapeHtml(what)}, leaving ${clock(S.heat.time)}, ${escapeHtml(DAY_TYPES[S.heat.day].label.toLowerCase())}, ${escapeHtml(yearLabel(year()))}.${change ? ` ${escapeHtml(change)}` : ''} Tap a street for its time.`;
  $('#map-legend').innerHTML = legend;
  for (const b of $$('[data-heatbox]', $('#map-legend'))) b.onclick = () => R.view.zoomToBox(R.heatBoxes[+b.dataset.heatbox], { top: 90, bottom: 120, left: 30, right: 60 });
}

async function setupMap() {
  R.view = new MapView($('#map'), { theme: 'light', onHover: null, onClick: onMapClick, basemap: '../basemap/' });
  R.mapReady = R.view.ready.then(async () => {
    const m = R.view.map;
    m.addSource('route-today', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    m.addLayer({ id: 'route-today', type: 'line', source: 'route-today', layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#6b6a65', 'line-width': 3, 'line-dasharray': [2, 1.5] } }, 'route-casing');
    m.setPaintProperty('route', 'line-width', 5);
    R.view.setPoisVisible(false);
    await R.view.setNetwork(R.baseNet, { fit: true });
  });
  return R.mapReady;
}

function onMapClick(c) {
  if (S.pick) {
    const street = streetNear(R.baseNet, c.lngLat.lng, c.lngLat.lat);
    const place = { name: `Point near ${street || 'the map'}`, lon: +c.lngLat.lng.toFixed(6), lat: +c.lngLat.lat.toFixed(6) };
    R.picked[S.pick] = place;
    $(`#${S.pick}`).value = place.name;
    showAddressNote(S.pick);
    R.view.setMarker(S.pick, [place.lon, place.lat]);
    const field = S.pick;
    setPick(null);
    $(field === 'from' ? '#to' : '#time').focus();
    return;
  }
  if (S.mapMode === 'heat' && R.heatValues && c.layer === 'edges' && c.id !== null) {
    const { net, vals, delta, diff } = R.heatValues;
    const v = vals[c.id], d = delta?.[c.id];
    const street = net.edges.name[c.id] || 'this street';
    const size = diff && d === Infinity ? ' (no route with the option)'
      : diff && Number.isFinite(d) && d !== 0 ? ` (${plainDuration(d * 60)} ${d > 0 ? 'slower' : 'faster'})` : '';
    const msg = !Number.isFinite(v) ? 'no route' : diff ? `${HEAT_WORDS[v]}${size}` : plainTravelTime(v * 60);
    $('#map-caption').innerHTML = `<strong>From ${escapeHtml(street)}:</strong> ${escapeHtml(msg)}. <span class="muted">Tap another street, or choose a place in “How long from anywhere?”.</span>`;
  }
}

// ------------------------------------------------------------------ about
async function renderAbout() {
  const years = [...new Set(R.runs.map((r) => r.year))].sort();
  const days = [...new Set(R.runs.map((r) => r.condition))].map((c) => Object.values(DAY_TYPES).find((d) => d.condition === c)?.label ?? c);
  let methods = '<p>The full method and results are written up in the project\'s Simulation Results note.</p>';
  const link = `<p><a href="${METHODS_URL}" target="_blank" rel="noopener">Read the full method and the results note</a>.</p>`;
  if (/^https?:/.test(METHODS_URL)) methods = link; // published address: can't probe it cross-origin
  else {
    try {
      const r = await fetch(METHODS_URL, { method: 'HEAD' });
      if (r.ok) methods = link;
    } catch { /* not reachable from here: keep the plain text */ }
  }
  $('#about').innerHTML = `
    <p>These times come from a computer simulation of every car trip on a typical day in Victor Harbor, made with
    <abbr title="Simulation of Urban Mobility">SUMO</abbr>, free traffic-simulation software. Each option is the same day's trips on a changed road network,
    so the differences show what the change itself does.</p>
    <h3>How sure are we?</h3>
    <ul>
      <li><strong>Read the results as comparisons, not exact times.</strong> The model is partly calibrated: its traffic matches the
        Department for Infrastructure and Transport's daily counts on the main roads only roughly. Victoria Street carries more traffic
        in the model than in reality, Adelaide Road less, and the town centre carries about 80% of the traffic counted there
        (2017 counts brought forward to 2025 data), so delays in the town centre are more likely understated than overstated.</li>
      <li>Most results are the average of three simulation runs. Differences smaller than ${SAME_ABS_S} seconds or ${Math.round(SAME_REL * 100)}% of the trip
        are shown as "about the same" (wider for results from a single run): with a model this approximate we don't treat smaller differences as meaningful.
        Some future years come from a single run so far; there the band is ${SINGLE_ABS_S / 60} minute or ${SINGLE_REL * 100}%, and the result says so.</li>
      <li>Trip times are from the nearest simulated road at each end. They don't include parking, walking, or waiting at the shops.</li>
      <li>Not included yet: drivers changing when or where they travel because of the changes, road closures for events, and parking search in the town centre.</li>
      <li>"Now" means today's roads with traffic built from 2025 data (see "Data used" below). "In about 5 years" is 2031 and "in about 10 years" 2036; 2041 and 2051 are longer range and less certain.</li>
      <li>Growth: "moderate" is about 8,000 more people and "high" about 19,000 more, following the two growth scenarios in the Council's Urban Growth Management Strategy.
        Summer holidays add visitor traffic so that Victor Harbor Road carries over 11,000 vehicles a day into town, as counted in summer.</li>
    </ul>
    <h3>Data used</h3>
    <ul class="data-used">
      <li><strong>Who lives where:</strong> <a href="https://www.abs.gov.au/census/guide-census-data/mesh-block-counts/2021/Mesh%20Block%20Counts%2C%202021.xlsx" target="_blank" rel="noopener">2021 Census mesh block counts</a> (Australian Bureau of Statistics): dwellings and people in each small block of the town, used to place households. Scaled to the
        <a href="https://dhud.sa.gov.au/__data/assets/pdf_file/0009/1442385/estimated-resident-population_2025.pdf" target="_blank" rel="noopener">estimated resident population at 30 June 2025</a> (17,457 people; ABS, published by the SA Government). This is the "2025 data" in "now".</li>
      <li><strong>Where people go:</strong> shops, schools, medical, services, beaches and work places from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>, with trip rates from the NSW Government's guide to traffic generating developments.</li>
      <li><strong>The roads:</strong> lanes, speed limits, roundabouts and give-ways from OpenStreetMap, checked against the State's road register and speed limits.</li>
      <li><strong>Traffic counts used to check the model:</strong> the Department for Infrastructure and Transport's <a href="https://data.sa.gov.au/data/dataset/e5d6588a-f163-4f6a-bc57-25e95c87b5bd" target="_blank" rel="noopener">traffic volume estimates</a> (vehicles a day on main roads, 2016–2026 releases), and the council's 2017 Torrens Street turning counts (Tonkin, 26 April 2017), brought forward to 2025 using the State's count history.</li>
      <li><strong>Summer and visitors:</strong> visitor traffic is scaled to the summer count of over 11,000 vehicles a day on Victor Harbor Road reported by the Department in October 2024.</li>
      <li><strong>Growth:</strong> new homes per year from the council's <a href="https://www.victor.sa.gov.au/__data/assets/pdf_file/0035/1874735/Victor-Harbor-Urban-Growth-Management-Strategy-2025_Final.pdf" target="_blank" rel="noopener">Urban Growth Management Strategy 2050</a> (moderate and high scenarios), placed in its growth areas.</li>
      <li><strong>Addresses:</strong> G-NAF, the national address file (Geoscape Australia, open licence), searched on your device.</li>
    </ul>
    <p class="muted">Every source, with its date, archived copy and checksum, is listed in the project's Sources Register${/^https?:/.test(METHODS_URL) ? ` (<a href="${METHODS_URL}" target="_blank" rel="noopener">evidence and method</a>)` : ''}.</p>
    <p>Simulated so far: ${R.runs.length} runs, years ${years.join(', ')}; days: ${days.map(escapeHtml).join(', ')}. Options or years that have not been simulated yet are greyed out.</p>
    ${methods}
    <h3>Your privacy</h3>
    <p>Your trips and places are kept in this browser's storage on this device only. Nothing about them is sent anywhere: all the
    calculations happen on your device, using the published results. You can remove them at any time with the button under "My trips".</p>
    <p>Address search works the same way. The first time you click in a "From" or "To" box, this page downloads one list of the
    addresses in the area (about 15,000 addresses, a single file of about a third of a megabyte), and then searches it on your device as you type.
    What you type is never sent anywhere, and no address search service is used. The list is derived from G-NAF © Geoscape Australia, licensed under the Open G-NAF End User Licence Agreement (Creative Commons Attribution 4.0 based),
    reduced to this area and simplified.</p>`;
}

// ------------------------------------------------------------------ main
function refresh() {
  fillPlaceList();
  updateOptions();
  renderTrips();
  renderAhead();
  if (R.glanceDone) renderGlance().catch((e) => console.error(e));   // keep the table in step with the choices
  drawMap().catch((e) => console.error(e));
}

async function init() {
  Object.assign(window.__residents, { S, R });   // keep the object: `ready` is assigned to it below
  const storage = safeStorage();
  R.trips = new TripStore(storage);
  R.storageOk = storage.set('vh-residents-probe', '1');
  storage.remove('vh-residents-probe');
  noteStorage();
  if (typeof maplibregl === 'undefined') {
    $('#notice').hidden = false;
    $('#notice').textContent = 'The map could not be loaded (it needs internet access to cdnjs.cloudflare.com).';
    return;
  }
  const { base, index } = await findData(location.search, ['../data/', '../data/sample/']);
  R.store = new Store(base, index);
  R.runs = index.runs;
  R.jammed = index.jammed || [];
  R.options = optionList(R.runs);
  S.option = (R.options.find((o) => o.id === 'cp' && o.available) || R.options.find((o) => o.available && o.id !== TODAY) || R.options[0]).id;
  const todayRun = findRun(R.runs, TODAY, 'weekday_term', 2025, 'base') || R.runs[0].id;
  const tr = await R.store.routing(todayRun);
  R.baseNet = tr.net;
  R.pois = (tr.net.pois || []).filter((p) => p.name).sort((a, b) => a.name.localeCompare(b.name));
  if (tr.meta.synthetic) { $('#notice').hidden = false; $('#notice').textContent = tr.meta.notes || 'Sample data, not results.'; }
  const net = performance.getEntriesByType?.('resource').find((e) => /networks\/.*\.json$/.test(e.name) && e.encodedBodySize);
  if (net) $('#glance-size').textContent = Math.max(0.1, net.encodedBodySize / 1e6).toFixed(1);
  wireForm();
  buildOptions();
  for (const r of $$('input[name="growth"]')) r.addEventListener('change', () => { S.growth = r.value; refresh(); });
  $('#season').addEventListener('change', (e) => { S.season = e.target.value; refresh(); });
  $('#year').addEventListener('input', (e) => { S.yearIdx = +e.target.value; refresh(); });
  let timer = null;
  $('#year-play').addEventListener('click', () => {
    if (timer) { clearInterval(timer); timer = null; $('#year-play').textContent = 'Play'; return; }
    $('#year-play').textContent = 'Pause';
    timer = setInterval(() => {
      S.yearIdx = (S.yearIdx + 1) % YEARS.length; refresh();
      if (S.yearIdx === YEARS.length - 1) { clearInterval(timer); timer = null; $('#year-play').textContent = 'Play'; }
    }, 1500);
  });
  for (const rd of $$('input[name="glance-when"]')) rd.addEventListener('change', () => { S.glanceWhen = rd.value; if (R.glanceDone) renderGlance().catch((e) => console.error(e)); });
  $('#glance-go').addEventListener('click', () => renderGlance().catch((e) => console.error(e)));
  const heatGo = () => {
    S.heat = { place: $('#heat-place').value, time: +$('#heat-time').value, day: $('#heat-day').value,
      show: $('input[name="heat-show"]:checked').value };
    S.mapMode = 'heat';
    drawMap().catch((e) => console.error(e));
  };
  $('#heat-go').addEventListener('click', heatGo);
  $('#heat-place').addEventListener('change', () => { R.heatChosen = true; });
  for (const r of $$('input[name="heat-show"]')) r.addEventListener('change', () => { if (S.mapMode === 'heat') heatGo(); });
  renderAbout();
  await setupMap();
  refresh();
  // a link ending in #heat-card opens straight on the heat map
  // (heatGo sets the map mode to the heat map, so later redraws keep showing it)
  // #heat (no element has that id, so the browser doesn't jump there mid-load) opens on the heat map
  if (location.hash === '#heat' || location.hash === '#heat-card') { $('#heat-card').scrollIntoView(); heatGo(); }
}

window.__residents = { ready: null };
window.__residents.ready = init().catch((e) => {
  console.error(e);
  $('#notice').hidden = false;
  $('#notice').textContent = `Could not start: ${e.message}`;
});
