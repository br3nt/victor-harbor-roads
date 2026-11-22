// Time-dependent routing on the edge graph (states = edges, transitions = SUMO connections).
//
// Travel time TO a target, departing at time t from everywhere, is computed with arrival-anchored
// reverse searches: for arrival times A_k = t, t + Δ, t + 2Δ, ... (Δ = a quarter of the data interval) a reverse
// time-dependent Dijkstra gives, per edge, the latest time L_k one can enter it and still arrive by A_k
// (exact under FIFO). Departing at t lies between two anchors, L_k <= t <= L_k+1, and the arrival time is
// interpolated linearly between (L_k, A_k) and (L_k+1, A_k+1). Each edge's time-dependent travel time is the
// exporter's per-interval mean, interpolated linearly between interval centres.

export function buildGraph(net) {
  const e = net.edges;
  const E = e.id.length;
  const nNodes = net.nodes.id.length;
  const from = Int32Array.from(e.from), to = Int32Array.from(e.to);
  const routable = Uint8Array.from(e.routable ?? new Array(E).fill(1));
  const succStart = new Int32Array(E + 1);
  for (let i = 0; i < E; i++) succStart[i + 1] = succStart[i] + (e.next[i] ? e.next[i].length : 0);
  const succ = new Int32Array(succStart[E]), succVia = new Float32Array(succStart[E]);
  const predCount = new Int32Array(E + 1);
  for (let i = 0; i < E; i++) {
    const nx = e.next[i] || [], vs = e.via_s?.[i] || [];
    for (let k = 0; k < nx.length; k++) {
      succ[succStart[i] + k] = nx[k];
      succVia[succStart[i] + k] = vs[k] ?? 0;
      predCount[nx[k] + 1]++;
    }
  }
  const predStart = new Int32Array(E + 1);
  for (let i = 0; i < E; i++) predStart[i + 1] = predStart[i] + predCount[i + 1];
  const pred = new Int32Array(predStart[E]), predVia = new Float32Array(predStart[E]);
  const fill = predStart.slice(0, E);
  for (let i = 0; i < E; i++) {
    for (let k = succStart[i]; k < succStart[i + 1]; k++) {
      const j = succ[k];
      pred[fill[j]] = i; predVia[fill[j]] = succVia[k]; fill[j]++;
    }
  }
  const inStart = new Int32Array(nNodes + 1);
  for (let i = 0; i < E; i++) if (routable[i]) inStart[to[i] + 1]++;
  for (let n = 0; n < nNodes; n++) inStart[n + 1] += inStart[n];
  const inEdges = new Int32Array(inStart[nNodes]);
  const fillN = inStart.slice(0, nNodes);
  for (let i = 0; i < E; i++) if (routable[i]) inEdges[fillN[to[i]]++] = i;
  const enterable = new Uint8Array(nNodes), leavable = new Uint8Array(nNodes);
  for (let n = 0; n < nNodes; n++) enterable[n] = inStart[n + 1] > inStart[n] ? 1 : 0;
  for (let i = 0; i < E; i++) if (routable[i]) leavable[from[i]] = 1;
  // free-flow time: values are shown from the middle of a road section, so half its free-flow time is not
  // driven (any queueing at the stop line is still ahead of a vehicle starting mid-section)
  const ff = Float64Array.from(e.length, (len, i) => len / Math.max((e.speed_kmh?.[i] ?? 50) / 3.6, 0.1));
  return { E, nNodes, ff, from, to, routable, succStart, succ, succVia, predStart, pred, predVia, inStart, inEdges, enterable, leavable };
}

/** Travel time (s) of edge e when entered at time t. times = {tt: Float32Array[T*E], T, E, begin, dt}. */
export function ttAt(times, e, t) {
  const { tt, T, E, begin, dt } = times;
  const u = (t - begin) / dt - 0.5;
  if (u <= 0) return tt[e];
  if (u >= T - 1) return tt[(T - 1) * E + e];
  const i = Math.floor(u), f = u - i;
  const a = tt[i * E + e], b = tt[(i + 1) * E + e];
  if (a === Infinity || b === Infinity) return f < 0.5 ? a : b;
  return a + f * (b - a);
}

class Heap {
  constructor(cap = 1024) { this.k = new Float64Array(cap); this.v = new Int32Array(cap); this.n = 0; }
  push(key, val) {
    if (this.n === this.k.length) {
      const k = new Float64Array(this.n * 2); k.set(this.k); this.k = k;
      const v = new Int32Array(this.n * 2); v.set(this.v); this.v = v;
    }
    let i = this.n++;
    const K = this.k, V = this.v;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (K[p] <= key) break;
      K[i] = K[p]; V[i] = V[p]; i = p;
    }
    K[i] = key; V[i] = val;
  }
  pop() { // returns value; key in this.lastKey
    const K = this.k, V = this.v;
    const topV = V[0]; this.lastKey = K[0];
    const key = K[--this.n], val = V[this.n];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.n) break;
      if (c + 1 < this.n && K[c + 1] < K[c]) c++;
      if (K[c] >= key) break;
      K[i] = K[c]; V[i] = V[c]; i = c;
    }
    K[i] = key; V[i] = val;
    return topV;
  }
}

// Latest entry time x into edge e such that x + tt(e, x) = deadline. tt is piecewise linear in x (knots at
// interval centres, constant beyond the first and last), so walk the pieces back from the deadline and solve
// the linear equation on the first piece whose left end still arrives in time. Exact while FIFO holds
// (an edge's time never falls by more than the interval length between two centres).
export function latestEntry(times, e, deadline) {
  const { tt, T, E, begin, dt } = times;
  if (deadline === -Infinity) return -Infinity;
  let k = Math.floor((deadline - begin) / dt - 0.5);      // last knot at or before the deadline
  if (k > T - 1) k = T - 1;
  if (k < -1) k = -1;
  for (; k >= -1; k--) {
    if (k === -1) { const a = tt[e]; return a === Infinity ? -Infinity : deadline - a; }
    const L = begin + (k + 0.5) * dt, a = tt[k * E + e];
    if (k === T - 1) {                                    // constant tail [L, inf)
      if (a !== Infinity && L + a <= deadline) return deadline - a;
      continue;
    }
    const R = L + dt, b = tt[(k + 1) * E + e];
    if (a === Infinity || b === Infinity) {               // step at the midpoint (see ttAt)
      const M = (L + R) / 2;
      if (b !== Infinity && M + b <= deadline) return deadline - b;
      if (a !== Infinity && L + a <= deadline) return Math.min(deadline - a, M);
      continue;
    }
    if (L + a <= deadline) {
      const sl = (b - a) / dt;
      if (1 + sl < 1e-6) return Math.min(deadline - b, R); // FIFO violated: take the piece's end
      return Math.min((deadline - a + sl * L) / (1 + sl), R);
    }
  }
  return -Infinity;
}

// L[e] = latest entry into e that still reaches the target by A; nxt[e] = the next edge on that route
// (-1: e ends at the target), via[e] = the junction time to it.
function reverseSearch(g, times, target, A, L, nxt, via, heap) {
  L.fill(-Infinity);
  nxt.fill(-2);
  heap.n = 0;
  for (let k = g.inStart[target]; k < g.inStart[target + 1]; k++) {
    const e = g.inEdges[k];
    const x = latestEntry(times, e, A);
    if (x > L[e]) { L[e] = x; nxt[e] = -1; via[e] = 0; heap.push(A - x, e); }
  }
  const { pred, predStart, predVia, routable } = g;
  while (heap.n) {
    const e = heap.pop();
    if (heap.lastKey > A - L[e] + 1e-9) continue;   // stale
    const le = L[e];
    for (let k = predStart[e]; k < predStart[e + 1]; k++) {
      const p = pred[k];
      if (!routable[p]) continue;
      const x = latestEntry(times, p, le - predVia[k]);
      if (x > L[p]) { L[p] = x; nxt[p] = e; via[p] = predVia[k]; heap.push(A - x, p); }
    }
  }
}

/**
 * Seconds from each edge to the target node, departing at tDep.
 *
 * Reverse searches anchored at arrival times tDep, tDep + Δ, ... (Δ = interval / anchorsPerInterval) give,
 * per anchor, the latest entry time of every edge and the route (a tree towards the target). For each edge
 * the anchors whose latest entry times bracket tDep are found; the routes of those two trees are driven
 * forward from tDep with the exact time-dependent edge times, and the faster is kept. Each value is
 * therefore the exact time of a real route; it is longer than the true fastest time only when a route that
 * neither bracketing anchor chose would be faster for this exact departure.
 * Returns { fromStart, fromMid: Float64Array (Infinity = no route), anchors, ms }.
 */
export function travelTimesTo(g, times, target, tDep, { anchorsPerInterval = 4, maxHours = 4 } = {}) {
  const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
  const E = g.E, dt = times.dt / anchorsPerInterval;
  const maxAnchors = Math.ceil((maxHours * 3600) / dt) + 1;
  const L = new Float64Array(E);
  const trees = [];                                  // per anchor: {nxt, via}
  const at = new Int32Array(E).fill(-1);             // first anchor with L >= tDep
  const heap = new Heap(Math.max(1024, E));
  let k = 0;
  for (; k < maxAnchors; k++) {
    const tree = { nxt: new Int32Array(E), via: new Float32Array(E) };
    reverseSearch(g, times, target, tDep + k * dt, L, tree.nxt, tree.via, heap);
    trees.push(tree);
    let unresolved = 0;
    for (let e = 0; e < E; e++) {
      if (at[e] !== -1 || L[e] === -Infinity) continue;
      if (L[e] >= tDep) at[e] = k; else unresolved++;
    }
    if (unresolved === 0) { k++; break; }
  }
  const last = trees.length - 1;
  const drive = (e, tree) => {
    let t = tDep, x = e;
    for (let steps = 0; steps <= E; steps++) {
      t += ttAt(times, x, t);
      const n = tree.nxt[x];
      if (n === -1 || t === Infinity) return t - tDep;
      if (n === -2) return Infinity;
      t += tree.via[x];
      x = n;
    }
    return Infinity;
  };
  const fromStart = new Float64Array(E), fromMid = new Float64Array(E);
  for (let e = 0; e < E; e++) {
    let v = Infinity;
    const a = at[e] === -1 ? (trees[last].nxt[e] === -2 ? -1 : last) : at[e];
    if (a >= 0) {
      v = drive(e, trees[a]);
      if (a > 0 && trees[a - 1].nxt[e] !== -2) v = Math.min(v, drive(e, trees[a - 1]));
    }
    fromStart[e] = v;
    fromMid[e] = v === Infinity ? Infinity : Math.max(0, v - 0.5 * g.ff[e]);
  }
  const ms = (typeof performance !== 'undefined' ? performance : Date).now() - t0;
  return { fromStart, fromMid, anchors: k, ms };
}

/** Forward time-dependent fastest route from the start of `origin` to `target` (node). */
export function routeFrom(g, times, origin, target, tDep) {
  return routeFromEdges(g, times, [origin], target, tDep);
}

/** Fastest route from a node (a place): starts on whichever road leaving it is best. */
export function routeFromNode(g, times, node, target, tDep) {
  if (node === target) return { edges: [], seconds: 0 };
  const starts = [];
  for (let e = 0; e < g.E; e++) if (g.from[e] === node && g.routable[e]) starts.push(e);
  return routeFromEdges(g, times, starts, target, tDep);
}

function routeFromEdges(g, times, origins, target, tDep) {
  const E = g.E;
  const exit = new Float64Array(E).fill(Infinity);
  const back = new Int32Array(E).fill(-1);
  const heap = new Heap(1024);
  for (const origin of origins) {
    exit[origin] = tDep + ttAt(times, origin, tDep);
    if (exit[origin] !== Infinity) heap.push(exit[origin], origin);
  }
  const { succ, succStart, succVia, routable, to } = g;
  while (heap.n) {
    const e = heap.pop();
    if (heap.lastKey > exit[e]) continue;
    if (to[e] === target) {
      const path = [];
      for (let x = e; x !== -1; x = back[x]) path.push(x);
      path.reverse();
      return { edges: path, seconds: exit[e] - tDep };
    }
    for (let k = succStart[e]; k < succStart[e + 1]; k++) {
      const f = succ[k];
      if (!routable[f]) continue;
      const enter = exit[e] + succVia[k];
      const x = enter + ttAt(times, f, enter);
      if (x < exit[f]) { exit[f] = x; back[f] = e; heap.push(x, f); }
    }
  }
  return { edges: [], seconds: Infinity };
}

export function median(values) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export function zoneMedians(zones, values) {
  return zones.map((z) => median(z.edges.map((e) => values[e])));
}

/** Nearest node a car can drive into, or with { leaving: true } out of (the start of a trip). */
export function nearestNode(net, g, lon, lat, { leaving = false } = {}) {
  const { lon: X, lat: Y } = net.nodes;
  const k = Math.cos((lat * Math.PI) / 180);
  let best = -1, bd = Infinity;
  for (let n = 0; n < X.length; n++) {
    if (leaving ? !g.leavable[n] : !g.enterable[n]) continue;   // a start needs a road out, an end a road in
    const dx = (X[n] - lon) * k, dy = Y[n] - lat;
    const d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}
