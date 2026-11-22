// Timeline bookmarks: grouping for markers, comparison (A vs B) bookmarks, keyboard stepping.
// Per-run automatic bookmarks (peak, sharp rises/falls, junction queues) are detected by the exporter
// (vhsim/viewer/bookmarks.py) and arrive in meta.json; the A-vs-B ones depend on the pair chosen here.
import { clock } from './format.js';

/** Group bookmarks by interval index i (0..T-1), dropping those outside the window. */
export function groupBookmarks(bookmarks, begin, dt, T) {
  const by = new Map();
  for (const b of bookmarks || []) {
    const i = Math.floor((b.t - begin) / dt + 1e-9);
    if (i < 0 || i >= T) continue;
    if (!by.has(i)) by.set(i, []);
    by.get(i).push(b);
  }
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([i, items]) => ({
    i, t: begin + i * dt, items, kinds: [...new Set(items.map((x) => x.kind))].sort(),
  }));
}

const num = (x) => Math.abs(x).toFixed(1);

/** Where network delay differs most between runs A and B (vehicle-hours per interval). */
export function diffBookmarks(seriesA, seriesB, begin, dt, { rel = 0.1, abs = 0.5 } = {}) {
  const n = Math.min(seriesA.length, seriesB.length);
  if (!n) return [];
  const d = [];
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const a = seriesA[i], b = seriesB[i];
    if (a === null || a === undefined || b === null || b === undefined) { d.push(0); continue; }   // no data in one run
    d.push(b - a);
    peak = Math.max(peak, a, b);
  }
  const thr = Math.max(abs, rel * peak);
  const out = [];
  let iMax = 0, iMin = 0;
  for (let i = 1; i < n; i++) { if (d[i] > d[iMax]) iMax = i; if (d[i] < d[iMin]) iMin = i; }
  if (d[iMax] >= thr) {
    const t = begin + iMax * dt;
    out.push({ t, kind: 'compare', label: `B has ${num(d[iMax])} more vehicle-hours of delay than A at ${clock(t)}`,
      detail: { type: 'diff_worse', change_veh_h: d[iMax] } });
  }
  if (-d[iMin] >= thr) {
    const t = begin + iMin * dt;
    out.push({ t, kind: 'compare', label: `B has ${num(d[iMin])} fewer vehicle-hours of delay than A at ${clock(t)}`,
      detail: { type: 'diff_better', change_veh_h: d[iMin] } });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Interval index of the next (dir = 1) or previous (dir = -1) bookmark group; stays put at the ends. */
export function stepBookmark(groups, i, dir) {
  if (dir > 0) { for (const g of groups) if (g.i > i) return g.i; }
  else { for (let k = groups.length - 1; k >= 0; k--) if (groups[k].i < i) return groups[k].i; }
  return i;
}
