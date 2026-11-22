import test from 'node:test';
import assert from 'node:assert/strict';
import { groupBookmarks, diffBookmarks, stepBookmark } from '../js/bookmarks.js';

const BEGIN = 5 * 3600, DT = 900;

test('bookmarks in the same interval form one marker, sorted by time', () => {
  const g = groupBookmarks([
    { t: 15 * 3600, label: 'School pick-up (3:00 pm)', kind: 'scenario' },
    { t: 8.5 * 3600, label: 'Delay rising', kind: 'auto' },
    { t: 15 * 3600 + 60, label: 'Peak delay', kind: 'auto' },
  ], BEGIN, DT, 76);
  assert.deepEqual(g.map((x) => x.i), [14, 40]);
  assert.equal(g[1].items.length, 2);
  assert.deepEqual(g[1].kinds, ['auto', 'scenario']);
});

test('bookmarks outside the exported window are dropped', () => {
  const g = groupBookmarks([{ t: 3600, label: 'x', kind: 'auto' }, { t: 99 * 3600, label: 'y', kind: 'auto' }], BEGIN, DT, 76);
  assert.equal(g.length, 0);
});

test('diffBookmarks finds where B is most worse and most better than A', () => {
  const a = [0, 1, 2, 8, 4, 1, 0, 3, 3];
  const b = [0, 1, 2, 12, 5, 1, 0, 1, 3];
  const bm = diffBookmarks(a, b, BEGIN, DT);
  const worse = bm.find((x) => x.detail.type === 'diff_worse');
  const better = bm.find((x) => x.detail.type === 'diff_better');
  assert.equal(worse.t, BEGIN + 3 * DT);
  assert.match(worse.label, /^B has 4\.0 more vehicle-hours of delay than A at 5:45 am$/);
  assert.equal(better.t, BEGIN + 7 * DT);
  assert.match(better.label, /fewer/);
  assert.equal(worse.kind, 'compare');
});

test('diffBookmarks skips times where one run has no data', () => {
  // B starts later than A: its missing early intervals are not "zero delay"
  const bm = diffBookmarks([5, 5, 1, 1], [null, null, 1, 1.05], BEGIN, DT);
  assert.deepEqual(bm, []);
});

test('diffBookmarks ignores tiny differences', () => {
  assert.deepEqual(diffBookmarks([1, 2, 3], [1.01, 2.02, 3.0], BEGIN, DT), []);
});

test('stepBookmark moves to the next / previous marker', () => {
  const g = [{ i: 4 }, { i: 10 }, { i: 30 }];
  assert.equal(stepBookmark(g, 10, 1), 30);
  assert.equal(stepBookmark(g, 11, -1), 10);
  assert.equal(stepBookmark(g, 30, 1), 30);
  assert.equal(stepBookmark(g, 0, -1), 0);
});
