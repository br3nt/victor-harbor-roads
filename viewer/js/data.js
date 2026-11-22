// Loading of index.json, networks and runs (with caching).
import { maybeGunzip, fromBase64Text, decodeLanes, decodeEdgeTimes } from './decode.js';
import { buildGraph } from './graph.js';

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}
async function fetchBin(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  const buf = url.endsWith('.b64.txt') ? fromBase64Text(await r.text()) : await r.arrayBuffer();
  return maybeGunzip(buf);
}

/** Find the data folder: ?data=<url>, else the first of `fallbacks` with an index.json. */
export async function findData(search = location.search, fallbacks = ['data/', 'data/sample/']) {
  const q = new URLSearchParams(search).get('data');
  const candidates = q ? [q.replace(/\/?$/, '/')] : fallbacks;
  let lastErr;
  for (const base of candidates) {
    try { return { base, index: await fetchJson(`${base}index.json`) }; } catch (e) { lastErr = e; }
  }
  throw new Error(`No viewer data found (tried ${candidates.map((c) => c + 'index.json').join(', ')}): ${lastErr?.message}`);
}

export class Store {
  constructor(base, index) {
    this.base = base;
    this.index = index;
    this.nets = new Map();
    this.runs = new Map();
  }

  network(name) {
    if (!this.nets.has(name)) {
      this.nets.set(name, fetchJson(this.base + this.index.networks[name]).then((net) => {
        net.graph = buildGraph(net);
        net.laneIndex = new Map(net.lanes.id.map((id, i) => [id, i]));
        net.edgeIndex = new Map(net.edges.id.map((id, i) => [id, i]));
        return net;
      }));
    }
    return this.nets.get(name);
  }

  /** Routing-only network (networks/<name>.lite.json, falling back to the full file): edges, nodes, places. */
  routingNetwork(name) {
    const key = `lite:${name}`;
    if (!this.nets.has(key)) {
      const full = this.base + this.index.networks[name];
      const lite = full.replace(/\.json$/, '.lite.json');
      this.nets.set(key, fetchJson(lite).catch(() => fetchJson(full)).then((net) => {
        net.graph = buildGraph(net);
        net.edgeIndex = new Map(net.edges.id.map((id, i) => [id, i]));
        net.nLanes = net.n_lanes ?? net.lanes?.id.length;
        return net;
      }).catch((e) => { this.nets.delete(key); throw e; }));   // a failed download can be retried
    }
    return this.nets.get(key);
  }

  /** A run's edge travel times only (no lane data): { id, entry, meta, net, times }. */
  routing(id) {
    const key = `routing:${id}`;
    if (!this.runs.has(key)) {
      const entry = this.index.runs.find((r) => r.id === id);
      if (!entry) return Promise.reject(new Error(`unknown run ${id}`));
      const dir = this.base + entry.path.replace(/meta\.json$/, '');
      this.runs.set(key, (async () => {
        const meta = await fetchJson(this.base + entry.path);
        const [net, eb] = await Promise.all([this.routingNetwork(meta.network), fetchBin(dir + meta.files.edge_times.path)]);
        if (meta.n_edges !== net.edges.id.length || (meta.network_hash && net.hash && meta.network_hash !== net.hash)) {
          throw new Error(`run ${id} was exported for a different version of network "${meta.network}"; re-export it`);
        }
        const T = meta.n_intervals;
        const tt = decodeEdgeTimes(eb, meta.files.edge_times, T, meta.n_edges);
        return { id, entry, meta, net, times: { tt, T, E: meta.n_edges, begin: meta.begin_s, dt: meta.interval_s } };
      })().catch((e) => { this.runs.delete(key); throw e; }));
    }
    return this.runs.get(key);
  }

  run(id) {
    if (!this.runs.has(id)) {
      const entry = this.index.runs.find((r) => r.id === id);
      if (!entry) return Promise.reject(new Error(`unknown run ${id}`));
      const dir = this.base + entry.path.replace(/meta\.json$/, '');
      this.runs.set(id, (async () => {
        const meta = await fetchJson(this.base + entry.path);
        const [net, lb, eb] = await Promise.all([
          this.network(meta.network), fetchBin(dir + meta.files.lanes.path), fetchBin(dir + meta.files.edge_times.path)]);
        const T = meta.n_intervals;
        if (meta.n_lanes !== net.lanes.id.length || meta.n_edges !== net.edges.id.length
            || (meta.network_hash && net.hash && meta.network_hash !== net.hash)) {
          throw new Error(`run ${id} was exported for a different version of network "${meta.network}"; re-export it`);
        }
        const lanes = decodeLanes(lb, meta.files.lanes, T, meta.n_lanes);
        const tt = decodeEdgeTimes(eb, meta.files.edge_times, T, meta.n_edges);
        return { id, entry, meta, net, lanes, times: { tt, T, E: meta.n_edges, begin: meta.begin_s, dt: meta.interval_s } };
      })());
    }
    return this.runs.get(id);
  }
}

/** Per-lane display values for one interval: Float32Array, NaN = no vehicles. */
export function laneValues(run, metric, t) {
  const { lanes, meta } = run;
  const N = meta.n_lanes, dt = meta.interval_s;
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) out[i] = laneValue(lanes, metric, t, i, dt);
  return out;
}

export function laneValue(lanes, metric, t, i, dt) {
  if (t < 0) return NaN;                       // run has no data at this time
  switch (metric) {
    case 'speed': { const v = lanes.value('speed_ratio', t, i); return v === null ? NaN : v; }
    case 'waiting': return lanes.value('waiting_s', t, i) / dt;
    case 'density': { const v = lanes.value('density', t, i); return v === null ? NaN : v; }
    case 'vehicles': return (lanes.value('vehicles', t, i) * 3600) / dt;
    default: throw new Error(metric);
  }
}

/** Options for the run pickers. */
export function runChoices(index) {
  const runs = index.runs;
  const uniq = (xs) => [...new Set(xs)];
  return {
    scenarios: uniq(runs.map((r) => r.scenario)),
    conditions: uniq(runs.map((r) => r.condition)),
    demands: uniq(runs.map((r) => `${r.year}-${r.growth}`)).sort(),
    find(scenario, condition, demand) {
      const m = runs.filter((r) => r.scenario === scenario && r.condition === condition && `${r.year}-${r.growth}` === demand);
      return m.find((r) => r.seed === 'mean') || m[0] || null;
    },
    has(filter) { return runs.some((r) => Object.entries(filter).every(([k, v]) => (k === 'demand' ? `${r.year}-${r.growth}` : r[k]) === v)); },
  };
}
