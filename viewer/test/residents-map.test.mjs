import test from 'node:test';
import assert from 'node:assert/strict';
import { routeClasses, heatDiff, HEAT_CODE, bandFor, classify } from '../residents/js/change.js';
import { buildGraph, nearestNode } from '../js/graph.js';

function line(ids, times) {
  // a chain of edges n0 -> n1 -> ... with constant times
  const n = ids.length;
  const k = [...Array(n).keys()];
  const net = { nodes: { id: [...Array(n + 1).keys()].map(String), lon: [...Array(n + 1).keys()], lat: Array(n + 1).fill(0) },
    edges: { id: ids, from: k, to: k.map((i) => i + 1), routable: Array(n).fill(1),
      next: k.map((i) => (i + 1 < n ? [i + 1] : [])), via_s: k.map((i) => (i + 1 < n ? [0] : [])),
      length: Array(n).fill(100), speed_kmh: Array(n).fill(36) } };
  net.edgeIndex = new Map(ids.map((id, i) => [id, i]));
  return { net, times: { tt: Float32Array.from(times), T: 1, E: n, begin: 0, dt: 900 } };
}

test('route sections are classed against the same road today, at the time the car reaches them', () => {
  const today = line(['a', 'b', 'c'], [20, 20, 20]);
  const opt = line(['a', 'b', 'x'], [20, 40, 10]);           // b slower, x does not exist today
  assert.deepEqual(routeClasses([0, 1, 2], opt, today, 0), ['same', 'worse', 'new']);
});

test('heat difference: better / same / worse / not comparable get distinct codes', () => {
  const mk = (ids) => { const n = { edges: { id: ids } }; n.edgeIndex = new Map(ids.map((id, i) => [id, i])); return n; };
  const today = Float64Array.from([10, 10, 10, Infinity]);       // minutes
  const opt = Float64Array.from([5, 10.2, 13, 4, 3]);
  const { codes } = heatDiff(today, mk(["a", "b", "c", "d"]), opt, mk(["a", "b", "c", "d", "new"]));
  assert.deepEqual(Array.from(codes), [HEAT_CODE.better, HEAT_CODE.same, HEAT_CODE.worse, HEAT_CODE.unknown, HEAT_CODE.unknown]);
  assert.equal(new Set(Object.values(HEAT_CODE)).size, 4);
});

test('heat difference also gives the size of each change, zero where it is "about the same"', () => {
  const mk = (ids) => { const n = { edges: { id: ids } }; n.edgeIndex = new Map(ids.map((id, i) => [id, i])); return n; };
  const today = Float64Array.from([10, 10, 10, Infinity, 10]);
  const opt = Float64Array.from([5, 10.2, 13, 4, NaN, 3]);
  const { codes, delta } = heatDiff(today, mk(['a', 'b', 'c', 'd', 'e']), opt, mk(['a', 'b', 'c', 'd', 'e', 'new']));
  assert.deepEqual(Array.from(codes).slice(0, 4), [HEAT_CODE.better, HEAT_CODE.same, HEAT_CODE.worse, HEAT_CODE.unknown]);
  assert.ok(Number.isNaN(codes[4]));
  assert.deepEqual(Array.from(delta).slice(0, 3), [-5, 0, 3]);
  assert.ok(Number.isNaN(delta[3]) && Number.isNaN(delta[4]) && Number.isNaN(delta[5]), 'not comparable: no size');
});

test('heat difference: a road that loses its route with the option is the biggest possible change, not "no size"', () => {
  const mk = (ids) => { const n = { edges: { id: ids } }; n.edgeIndex = new Map(ids.map((id, i) => [id, i])); return n; };
  const { codes, delta } = heatDiff(Float64Array.from([10]), mk(['a']), Float64Array.from([Infinity]), mk(['a']));
  assert.equal(codes[0], HEAT_CODE.worse);
  assert.equal(delta[0], Infinity);
});

test('single-seed runs get a wider "about the same" band', () => {
  assert.deepEqual(bandFor('mean', 'mean'), { abs: 30, rel: 0.05, single: false });
  assert.deepEqual(bandFor('mean', '1'), { abs: 60, rel: 0.1, single: true });
  assert.equal(classify(600, 650, bandFor('mean', 'mean')).cls, 'worse');
  assert.equal(classify(600, 650, bandFor('1', 'mean')).cls, 'same');
});

test('a trip can start only where a car can drive out', () => {
  // node 0 has a road in only (a sink at the edge of the network); node 1 has roads out
  const net = { nodes: { id: ['s', 'o', 't'], lon: [0, 0.01, 0.02], lat: [0, 0, 0] },
    edges: { id: ['in', 'out'], from: [1, 1], to: [0, 2], routable: [1, 1], next: [[], []], via_s: [[], []], length: [10, 10], speed_kmh: [36, 36] } };
  const g = buildGraph(net);
  assert.equal(nearestNode(net, g, 0, 0), 0);                     // fine as a destination
  assert.equal(nearestNode(net, g, 0, 0, { leaving: true }), 1);  // not as a start
});
