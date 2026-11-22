// Plain-words comparison of a trip time with an option against today's network.
import { ttAt } from '../../js/graph.js';
//
// "About the same" (grey) = within the noise band: the larger of 30 seconds or 5% of today's time. Smaller
// differences are treated as noise: the simulation's runs and its 15-minute averaging of road times can move trip
// times by about that much. Not yet measured from the seed spread (see sim/assumptions/S5-viewer.md R2).

export const SAME_ABS_S = 30;
export const SAME_REL = 0.05;
// a single simulation run (not a mean of seeds) is noisier: twice the band
export const SINGLE_ABS_S = 60;
export const SINGLE_REL = 0.1;

/** Noise band for comparing two runs, by their seed ('mean' = average of several runs). */
export function bandFor(seedA, seedB) {
  const single = String(seedA) !== 'mean' || String(seedB) !== 'mean';
  return single ? { abs: SINGLE_ABS_S, rel: SINGLE_REL, single } : { abs: SAME_ABS_S, rel: SAME_REL, single };
}
// per road section on a route: the larger of 3 seconds or 10%
export const ROAD_ABS_S = 3;
export const ROAD_REL = 0.1;

// Okabe-Ito bluish green and vermillion: distinguishable with the common colour-vision deficiencies,
// and always shown with words and an arrow, never by colour alone
export const CLASS_COLOURS = { better: '#009E73', same: '#8d8d87', worse: '#D55E00', unknown: '#56B4E9', new: '#56B4E9' };
export const CLASS_SYMBOL = { better: '▼', same: '=', worse: '▲', unknown: '?', new: '+' };

export function plainDuration(s) {
  s = Math.abs(s);
  if (s < 60) return 'less than a minute';
  const m = Math.round(s / 60);
  if (m < 60) return `about ${m} minute${m === 1 ? '' : 's'}`;
  const h = Math.floor(m / 60), r = m % 60;
  return `about ${h} hour${h === 1 ? '' : 's'}${r ? ` ${r} minute${r === 1 ? '' : 's'}` : ''}`;
}

export function plainTravelTime(s) {
  if (!Number.isFinite(s)) return 'no route';
  if (s < 30) return 'under a minute';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'}`;
  const h = Math.floor(m / 60), r = m % 60;
  return `${h} hour${h === 1 ? '' : 's'}${r ? ` ${r} min` : ''}`;
}

export function classify(todayS, optionS, { abs = SAME_ABS_S, rel = SAME_REL } = {}) {
  if (!Number.isFinite(todayS) || Number.isNaN(optionS) || optionS === undefined || optionS === null) {
    return { cls: 'unknown', delta: NaN, words: 'not known' };
  }
  if (optionS === Infinity) return { cls: 'worse', delta: Infinity, words: 'no route with this option' };
  const delta = optionS - todayS;
  if (Math.abs(delta) <= Math.max(abs, rel * todayS)) return { cls: 'same', delta, words: 'about the same' };
  return { cls: delta > 0 ? 'worse' : 'better', delta, words: `${plainDuration(delta)} ${delta > 0 ? 'slower' : 'faster'}` };
}

/** Change on one road section (seconds to drive it); 'new' when it does not exist today. */
export function classifyRoad(todayS, optionS) {
  if (todayS === undefined || todayS === null || !Number.isFinite(todayS)) return 'new';
  if (!Number.isFinite(optionS)) return 'worse';
  const d = optionS - todayS;
  if (Math.abs(d) <= Math.max(ROAD_ABS_S, ROAD_REL * todayS)) return 'same';
  return d > 0 ? 'worse' : 'better';
}

// ---------------------------------------------------------------- map helpers (pure, unit-tested)

/**
 * Change class of each section on an option's route, against the same road (by id) on today's network, evaluated
 * at the time the car reaches it. `opt`/`today` = { net (with edgeIndex), times }. 'new' = not on today's network.
 */
export function routeClasses(edges, opt, today, tDep) {
  const out = [];
  let t = tDep;
  for (const e of edges) {
    const s = ttAt(opt.times, e, t);
    const j = today.net.edgeIndex.get(opt.net.edges.id[e]);
    out.push(classifyRoad(j === undefined ? undefined : ttAt(today.times, j, t), s));
    t += s;
  }
  return out;
}

export const HEAT_CODE = { better: -1, same: 0, worse: 1, unknown: 2 };

/**
 * Per option edge: `codes` = better / same / worse than today, or unknown (not on today's roads, or no route today);
 * `delta` = option − today in minutes where better or worse (Infinity: no route with the option), 0 where about the
 * same, NaN where not comparable.
 */
export function heatDiff(todayMin, todayNet, optMin, optNet, band = {}) {
  const codes = new Float64Array(optNet.edges.id.length), delta = new Float64Array(codes.length).fill(NaN);
  for (let e = 0; e < codes.length; e++) {
    const j = todayNet.edgeIndex.get(optNet.edges.id[e]);
    if (Number.isNaN(optMin[e])) { codes[e] = NaN; continue; }               // not a car road
    if (j === undefined || !Number.isFinite(todayMin[j])) { codes[e] = HEAT_CODE.unknown; continue; }
    const c = classify(todayMin[j] * 60, optMin[e] * 60, band);
    codes[e] = HEAT_CODE[c.cls] ?? HEAT_CODE.unknown;
    if (c.cls === 'same') delta[e] = 0;
    else if (c.cls === 'better' || c.cls === 'worse') delta[e] = c.delta === Infinity ? Infinity : c.delta / 60;   // Infinity: no route with the option
  }
  return { codes, delta };
}

