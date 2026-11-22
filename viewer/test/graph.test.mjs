import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph, ttAt, travelTimesTo, routeFrom, routeFromNode, zoneMedians, nearestNode } from '../js/graph.js';

// Small network:   0 --a--> 1 --b--> 2      edge c: 0 -> 2 (slow direct)
//                           \--d--> 3 --e--> 2
// a->b allowed, a->d allowed, d->e allowed; b->? none; c ends at 2.
function smallNet() {
  return {
    nodes: { id: ['n0', 'n1', 'n2', 'n3'], lon: [0, 1, 2, 1.5], lat: [0, 0, 0, 1] },
    edges: {
      id: ['a', 'b', 'c', 'd', 'e'],
      from: [0, 1, 0, 1, 3], to: [1, 2, 2, 3, 2],
      routable: [1, 1, 1, 1, 1],
      next: [[1, 3], [], [], [4], []],
      via_s: [[1, 2], [], [], [0], []],
      length: [100, 100, 500, 50, 50], speed_kmh: [36, 36, 36, 36, 36],
    },
  };
}

function constTimes(net, T, vals) {
  const E = net.edges.id.length;
  const tt = new Float32Array(T * E);
  for (let t = 0; t < T; t++) for (let e = 0; e < E; e++) tt[t * E + e] = vals[e];
  return { tt, T, E, begin: 0, dt: 900 };
}

test('constant times: exact shortest times with turn (via) costs', () => {
  const net = smallNet();
  const g = buildGraph(net);
  const times = constTimes(net, 4, [10, 10, 60, 5, 5]);
  const r = travelTimesTo(g, times, 2, 100);
  // from start of a: a(10) + via 1 + b(10) = 21 ; or a + 2 + d(5) + 0 + e(5) = 22
  assert.ok(Math.abs(r.fromStart[0] - 21) < 1e-6, String(r.fromStart[0]));
  assert.ok(Math.abs(r.fromStart[2] - 60) < 1e-6);
  assert.ok(Math.abs(r.fromStart[3] - 10) < 1e-6);
  assert.ok(Math.abs(r.fromMid[0] - 16) < 1e-6);         // half of edge a not driven
  const route = routeFrom(g, times, 0, 2, 100);
  assert.deepEqual(route.edges, [0, 1]);
  assert.ok(Math.abs(route.seconds - 21) < 1e-6);
});

test('edges that cannot reach the target are Infinity; impassable edges are skipped', () => {
  const net = smallNet();
  const g = buildGraph(net);
  const times = constTimes(net, 2, [10, Infinity, 60, 5, 5]);
  const r = travelTimesTo(g, times, 2, 0);
  assert.ok(Math.abs(r.fromStart[0] - 22) < 1e-6);        // forced via d, e
  assert.equal(r.fromStart[1], Infinity);
  const r1 = travelTimesTo(g, times, 3, 0);               // only a->d reach node 3
  assert.equal(r1.fromStart[2], Infinity);
  assert.equal(r1.fromStart[4], Infinity);
});

test('ttAt interpolates between interval centres and clamps at the ends', () => {
  const net = smallNet();
  const times = constTimes(net, 3, [10, 10, 10, 10, 10]);
  times.tt[1 * 5 + 0] = 30;                               // edge a slower in interval 1
  assert.equal(ttAt(times, 0, 0), 10);
  assert.equal(ttAt(times, 0, 450), 10);                  // centre of interval 0
  assert.equal(ttAt(times, 0, 900), 20);                  // halfway between centres
  assert.equal(ttAt(times, 0, 1350), 30);
  assert.equal(ttAt(times, 0, 99999), 10);
});

// grid with random time-dependent edge times
function grid(n, seed = 1) {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const id = (r, c) => r * n + c;
  const nodes = { id: [], lon: [], lat: [] };
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) { nodes.id.push(`n${r}_${c}`); nodes.lon.push(c * 0.002); nodes.lat.push(-r * 0.002); }
  const edges = { id: [], from: [], to: [], routable: [], next: [], via_s: [], length: [], speed_kmh: [] };
  const out = new Map();
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    for (const [dr, dc] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
      const r2 = r + dr, c2 = c + dc;
      if (r2 < 0 || c2 < 0 || r2 >= n || c2 >= n) continue;
      const e = edges.id.length;
      edges.id.push(`e${e}`); edges.from.push(id(r, c)); edges.to.push(id(r2, c2)); edges.routable.push(1);
      edges.length.push(180); edges.speed_kmh.push(50);
      if (!out.has(id(r, c))) out.set(id(r, c), []);
      out.get(id(r, c)).push(e);
    }
  }
  for (let e = 0; e < edges.id.length; e++) {
    const succ = (out.get(edges.to[e]) || []).filter((f) => edges.to[f] !== edges.from[e]);   // no U-turns
    edges.next.push(succ); edges.via_s.push(succ.map(() => 2));
  }
  const E = edges.id.length, T = 96;
  const tt = new Float32Array(T * E);
  for (let e = 0; e < E; e++) {
    const base = 10 + 10 * rnd(), peak = rnd() < 0.2 ? 5 * rnd() : 0;
    for (let t = 0; t < T; t++) {
      const am = Math.exp(-(((t - 34) / 4) ** 2)), pm = Math.exp(-(((t - 68) / 5) ** 2));
      tt[t * E + e] = base * (1 + peak * (am + pm));
    }
  }
  return { net: { nodes, edges }, times: { tt, T, E, begin: 0, dt: 900 } };
}

test('time-dependent reverse search agrees with forward search from the origin', () => {
  const { net, times } = grid(12, 3);
  const g = buildGraph(net);
  const target = 5 * 12 + 7;
  for (const tDep of [6 * 3600, 8.25 * 3600, 8.5 * 3600, 17 * 3600]) {
    const r = travelTimesTo(g, times, target, tDep);
    for (let k = 0; k < 40; k++) {
      const e = (k * 37) % times.E;
      const fwd = routeFrom(g, times, e, target, tDep);
      const back = r.fromStart[e];
      assert.ok(Math.abs(fwd.seconds - back) <= Math.max(2, 0.01 * fwd.seconds),
        `edge ${e} at ${tDep}: forward ${fwd.seconds} vs reverse ${back}`);
    }
  }
});

test('a single edge whose time jumps (queue onset) is solved exactly', () => {
  // edge a: 0 -> 1 only; time steps from 20 s to `big` between two interval centres
  const net = { nodes: { id: ['x', 'y'], lon: [0, 1], lat: [0, 0] },
    edges: { id: ['a'], from: [0], to: [1], routable: [1], next: [[]], via_s: [[]], length: [200], speed_kmh: [36] } };
  const g = buildGraph(net);
  for (const big of [200, 500, 880]) {
    const tt = new Float32Array([20, 20, big, big]);
    const times = { tt, T: 4, E: 1, begin: 0, dt: 900 };
    for (let tDep = 0; tDep <= 3600; tDep += 37) {
      const fwd = routeFrom(g, times, 0, 1, tDep).seconds;
      const back = travelTimesTo(g, times, 1, tDep).fromStart[0];
      assert.ok(Math.abs(fwd - back) <= Math.max(2, 0.02 * fwd), `big ${big} tDep ${tDep}: forward ${fwd} reverse ${back}`);
    }
  }
});

test('step-like queues on a grid: reverse search within 2% or 5 s of the forward search', () => {
  const { net, times } = grid(12, 11);
  let s = 99;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const { tt, T, E } = times;
  for (let e = 0; e < E; e++) {
    if (rnd() > 0.3) continue;
    const q = 60 + 540 * rnd(), onset = 28 + Math.floor(rnd() * 12);
    for (let t = onset; t < Math.min(T, onset + 3); t++) tt[t * E + e] += q;     // 45-minute queue
  }
  const g = buildGraph(net);
  let worst = 0, n = 0, bad = 0;
  for (const target of [5 * 12 + 7, 3, 130]) {
    for (let tDep = 6.5 * 3600; tDep <= 10 * 3600; tDep += 1350) {
      const r = travelTimesTo(g, times, target, tDep);
      for (let e = 0; e < E; e += 3) {
        const fwd = routeFrom(g, times, e, target, tDep).seconds;
        const err = Math.abs(fwd - r.fromStart[e]);
        worst = Math.max(worst, err); n++;
        if (err > Math.max(5, 0.02 * fwd)) bad++;
      }
    }
  }
  console.log(`  step queues: ${n} origin/target/time checks, worst error ${worst.toFixed(1)} s, ${bad} outside 2%/5 s`);
  assert.ok(bad / n < 0.002, `${bad} of ${n} outside tolerance (worst ${worst} s)`);
  assert.ok(worst <= 15, `worst ${worst} s`);
});

test('travel time to a target on a ~10k-edge network in under 200 ms', () => {
  const { net, times } = grid(50, 5);       // 9800 directed edges
  assert.ok(times.E >= 9800);
  const g = buildGraph(net);
  travelTimesTo(g, times, 1275, 8 * 3600);   // warm-up (JIT)
  const runs = [];
  for (const tDep of [7 * 3600, 8.5 * 3600, 12 * 3600, 17 * 3600]) {
    const t0 = performance.now();
    const r = travelTimesTo(g, times, 1275, tDep);
    runs.push(performance.now() - t0);
    assert.ok(r.fromStart.every((x) => Number.isFinite(x)));
  }
  const worst = Math.max(...runs);
  console.log(`  reverse time-dependent search, 9800 edges: ${runs.map((x) => x.toFixed(1)).join(', ')} ms`);
  assert.ok(worst < 200, `worst ${worst} ms`);
});

test('routeFromNode starts on the best road leaving a place', () => {
  const { net, times } = grid(8, 4);
  const g = buildGraph(net);
  for (const [from, to] of [[0, 63], [10, 45], [27, 27 + 8]]) {
    const r = routeFromNode(g, times, from, to, 8 * 3600);
    let best = Infinity;
    for (let e = 0; e < g.E; e++) if (net.edges.from[e] === from) best = Math.min(best, routeFrom(g, times, e, to, 8 * 3600).seconds);
    assert.ok(Math.abs(r.seconds - best) < 1e-6, `${from}->${to}: ${r.seconds} vs ${best}`);
    assert.equal(net.edges.from[r.edges[0]], from);
    assert.equal(net.edges.to[r.edges[r.edges.length - 1]], to);
  }
  assert.deepEqual(routeFromNode(g, times, 5, 5, 0), { edges: [], seconds: 0 });
});

test('zone medians ignore unreachable edges', () => {
  const vals = new Float64Array([60, 120, Infinity, 180, 30]);
  const m = zoneMedians([{ edges: [0, 1, 2, 3] }, { edges: [2] }, { edges: [] }], vals);
  assert.deepEqual(m, [120, null, null]);
});

test('nearestNode snaps to nodes a car can drive into', () => {
  const net = smallNet();
  const g = buildGraph(net);
  assert.equal(nearestNode(net, g, 0.1, 0), 1);           // node 0 has no incoming edges
  assert.equal(nearestNode(net, g, 1.6, 0.9), 3);
});
