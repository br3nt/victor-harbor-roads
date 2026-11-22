import test from 'node:test';
import assert from 'node:assert/strict';
import { emphasis, summariseChanges, summaryText, FAINT } from '../js/changes.js';

test('emphasis: no data stays NaN, inside the dead band is faint (0), real changes grow with size up to 1', () => {
  const e = emphasis([NaN, 0, 0.2, -0.25, 0.3, 1.1, -2, 9, Infinity], 0.25, 2);
  assert.ok(Number.isNaN(e[0]));
  assert.equal(e[1], FAINT); assert.equal(e[2], FAINT); assert.equal(e[3], FAINT);
  assert.ok(e[4] > FAINT && e[4] < e[5], 'just over the band is visible but small');
  assert.ok(e[5] < e[6]);
  assert.equal(e[6], 1); assert.equal(e[7], 1); assert.equal(e[8], 1);
  assert.ok(Math.abs(e[5] - emphasis([-1.1], 0.25, 2)[0]) < 1e-6, 'symmetric');
});

// four sections: two on Hindmarsh Road (both much slower), one small change on Bay Road, one faster unnamed road
const shapes = [[138.60, -35.55, 138.61, -35.55], [138.61, -35.55, 138.62, -35.54], [138.63, -35.56, 138.64, -35.56], [138.65, -35.57, 138.66, -35.57], [138.6, -35.5, 138.61, -35.5]];
const names = ['Hindmarsh Road', 'Hindmarsh Road', 'Bay Road', '', 'Ocean Street'];

test('summariseChanges counts sections by direction and lists the streets with big changes, biggest first, with a bbox', () => {
  const s = summariseChanges({ values: [1.5, 1.9, 0.5, -1.2, 0.1], names, shapes, deadband: 0.25, notable: 1 });
  assert.equal(s.total, 5);
  assert.equal(s.same, 1);
  assert.equal(s.up, 3);
  assert.equal(s.down, 1);
  assert.equal(s.notableUp, 2);
  assert.equal(s.notableDown, 1);
  assert.deepEqual(s.streets.map((x) => x.name), ['Hindmarsh Road', 'unnamed road']);
  const h = s.streets[0];
  assert.equal(h.value, 1.9);
  assert.equal(h.sections, 2);
  assert.deepEqual(h.bbox, [138.6, -35.55, 138.62, -35.54]);
  assert.equal(s.upStreets, 1);
  assert.equal(s.downStreets, 0, 'unnamed road sections are not counted as streets');
  assert.deepEqual(s.unnamed, { up: 0, down: 1 });
});

test('summariseChanges skips sections with no data and keeps unnamed roads apart (not one map-wide group)', () => {
  const s = summariseChanges({ values: [NaN, null, 0, -1.5, -1.5], names: ['a', 'b', 'c', '', ''],
    shapes: [[0, 0, 1, 1], [0, 0, 1, 1], [0, 0, 1, 1], [10, 10, 11, 11], [50, 50, 51, 51]], deadband: 0.25, notable: 1 });
  assert.equal(s.total, 3);
  assert.equal(s.streets.length, 2);
  assert.deepEqual(s.streets[0].bbox, [10, 10, 11, 11]);
});

test('summariseChanges can read sections through a map (e.g. lanes -> their road) and caps the list', () => {
  const vals = Array.from({ length: 30 }, (_, i) => i + 2);
  const s = summariseChanges({ values: vals, names: vals.map((_, i) => `Street ${i}`), shapes: vals.map(() => [0, 0, 1, 1]),
    section: (i) => i, deadband: 0.5, notable: 1, limit: 5 });
  assert.equal(s.streets.length, 5);
  assert.equal(s.streets[0].name, 'Street 29');
  assert.equal(s.upStreets, 30);
});

// travel time: the value is the trip time *from* each road to the target, so the words say "trips from"
const SAY = { up: 'Trips from {n} are at least 1 minute slower in B', down: 'trips from {n} are at least 1 minute faster in B',
  none: 'No trip from a named street changes by 1 minute or more', quiet: '{p} of road sections change by less than 15 seconds' };

test('summaryText says how many streets changed a lot, which ones, and how much of the network barely changed', () => {
  const s = summariseChanges({ values: [1.5, 1.9, 0.5, -1.2, 0.1], names, shapes, deadband: 0.25, notable: 1 });
  const t = summaryText(s, SAY);
  assert.match(t, /^Trips from 1 street are at least 1 minute slower in B \(Hindmarsh Road\); plus 1 unnamed road section\./);
  assert.match(t, /20% of road sections change by less than 15 seconds\.$/);
  const t2 = summaryText(summariseChanges({ values: [2, 1.5, -1.2, -1.4], names: ['A St', 'B St', 'C St', 'D St'], shapes, deadband: 0.25, notable: 1 }), SAY);
  assert.match(t2, /^Trips from 2 streets are at least 1 minute slower in B \(biggest: A St, B St\); trips from 2 streets are at least 1 minute faster in B \(biggest: D St, C St\)\./);
  const t3 = summaryText(summariseChanges({ values: [-2], names: ['A St'], shapes, deadband: 0.25, notable: 1 }), SAY);
  assert.match(t3, /^Trips from 1 street are at least 1 minute faster in B \(A St\)\./, 'a sentence starts with a capital');
});

test('summaryText says so plainly when nothing changed by the notable amount, without contradicting itself', () => {
  const s = summariseChanges({ values: [0.1, 0.3, -0.4], names: ['a', 'b', 'c'], shapes: [[0, 0, 1, 1], [0, 0, 1, 1], [0, 0, 1, 1]], deadband: 0.25, notable: 1 });
  assert.match(summaryText(s, SAY), /^No trip from a named street changes by 1 minute or more\. 33% of road sections/);
  const u = summariseChanges({ values: [2, 0], names: ['', 'a'], shapes: [[0, 0, 1, 1], [0, 0, 1, 1]], deadband: 0.25, notable: 1 });
  assert.match(summaryText(u, SAY), /^No trip from a named street changes by 1 minute or more; 1 unnamed road section does\./);
});

test('summaryText never rounds "almost all" up to 100%', () => {
  const vals = Array.from({ length: 1000 }, (_, i) => (i < 996 ? 0 : 2));
  const s = summariseChanges({ values: vals, names: vals.map(() => 'X St'), shapes: vals.map(() => [0, 0, 1, 1]), deadband: 0.25, notable: 1 });
  assert.match(summaryText(s, SAY), /Over 99% of road sections/);
});
