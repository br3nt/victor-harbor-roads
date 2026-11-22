// The options a resident can compare, and which simulated runs exist for each (year, growth, day type).

export const YEARS = [2025, 2031, 2036, 2041];
import { THIS_YEAR, NOW_YEAR, NEAR_YEAR, LONG_RANGE_FROM, yearLong, yearShort, isLongRange } from '../../js/format.js';
export { THIS_YEAR, NOW_YEAR, NEAR_YEAR, LONG_RANGE_FROM, yearLong, yearShort, isLongRange };
export const GROWTH = { moderate: 'moderate growth', high: 'high growth' };

// Plain names and descriptions; no abbreviations (street types spelled out).
export const OPTIONS = [
  { id: 'baseline', group: 'today', name: "Today's network", description: 'The roads as they are now. Every other option is compared with this.' },
  { id: 'cp', group: 'council', name: "Council's town-centre package", description: 'All of the Council\'s proposed town-centre changes together: 30 km/h streets, shared streets, a one-way loop and traffic signals at two roundabouts.' },
  { id: 'c1a', group: 'council', part: 'cp', name: '30 km/h town centre', description: '30 km/h speed limit on the town-centre streets. Torrens Street and Victoria Street keep their current limits.' },
  { id: 'c1b', group: 'council', part: 'cp', name: '30 km/h, including Torrens Street', description: 'As above, with Torrens Street in the town centre also at 30 km/h.' },
  { id: 'c2', group: 'council', part: 'cp', name: '20 km/h shared streets', description: 'Ocean Street, Albert Place and Railway Terrace become 20 km/h shared streets with people on foot given priority.' },
  { id: 'c3', group: 'council', part: 'cp', name: 'One-way loop (clockwise)', description: 'Torrens Street, Eyre Terrace, Flinders Parade and the Esplanade become a one-way loop around the town centre, clockwise.' },
  { id: 'c3b', group: 'council', part: 'cp', name: 'One-way loop (anticlockwise)', description: 'The same one-way loop, running anticlockwise.' },
  { id: 'c4', group: 'council', part: 'cp', name: 'Traffic signals at two roundabouts', description: 'Traffic lights instead of the roundabouts at Torrens Street / Seaview Road and Torrens Street / Crozier Road.' },
  { id: 'c5', group: 'council', name: 'New outer ring road (ring road Option 1)', description: 'The Council\'s ring road Option 1: a new 100 km/h road, which trucks are steered onto, from Inman Valley Road across Swains Crossing, up Greenhills Road and along Hutchinson Road to Victor Harbor Road, with the current ring road (Welch Road and Armstrong Road) lowered to 60 km/h. The Council\'s map is indicative, so the route is our reading of it. Option 2, keeping the current ring road, is today\'s network.' },
  { id: 'c5b', group: 'council', name: 'Outer ring road further west', description: 'The same Option 1 with the new road about half a kilometre west of Greenhills Road, clear of the new housing areas, reaching Victor Harbor Road along Mont Rosa Road.' },
  { id: 'c5s', group: 'council', name: 'Outer ring road, current ring road kept at its speed', description: 'A test of Option 1: the same new outer road, but Welch Road and Armstrong Road keep their current speed limits instead of dropping to 60 km/h. It shows how much of Option 1\'s effect comes from the lower limit.' },
  { id: 'bp', group: 'brent', name: "Brent's package", description: 'An alternative package: a four-lane ring road, a two-lane McCracken roundabout and left-turn slip lanes at two town-centre roundabouts.' },
  { id: 'b3', group: 'brent', part: 'bp', name: 'Four-lane ring road', description: 'Welch Road and Armstrong Road widened to two lanes each way.' },
  { id: 'b4', group: 'brent', part: 'bp', name: 'Two-lane McCracken roundabout', description: 'The Adelaide Road / Hindmarsh Road / Port Elliot Road roundabout with two lanes around it and two-lane entries.' },
  { id: 'b5', group: 'brent', part: 'bp', name: 'Roundabout slip lanes', description: 'Left-turn lanes that bypass the Torrens Street / Seaview Road and Torrens Street / Crozier Road roundabouts.' },
  { id: 'n9', group: 'new', name: 'Crozier Road turn lanes + Grantley roundabout', description: 'Crozier Road gets separate left- and right-turn lanes where it meets Armstrong Road, and a roundabout replaces the Hindmarsh Road / Grantley Avenue junction by the rail crossing. The best tested option at today\'s traffic.' },
  { id: 'n3', group: 'new', part: 'n9', name: 'Crozier Road turn lanes', description: 'Separate left- and right-turn lanes on Crozier Road where it meets Armstrong Road.' },
  { id: 'n4', group: 'new', part: 'n9', name: 'Grantley Avenue roundabout', description: 'A roundabout at Hindmarsh Road / Grantley Avenue, beside the rail crossing.' },
  { id: 'n7', group: 'new', name: 'Three new roundabouts', description: 'Roundabouts at Armstrong Road / Crozier Road, Armstrong Road / Greenhills Road and Hindmarsh Road / Grantley Avenue. The best tested option as the town grows.' },
  { id: 'n2', group: 'new', part: 'n7', name: 'Armstrong / Crozier roundabout', description: 'A single-lane roundabout where Crozier Road meets Armstrong Road.' },
  { id: 'n5', group: 'new', part: 'n7', name: 'Two ring-road roundabouts', description: 'Roundabouts at Armstrong Road / Crozier Road and Armstrong Road / Greenhills Road.' },
  { id: 'n6', group: 'new', name: 'No right turns from three side streets', description: 'No right turn out of Granite Street onto Victoria Street, Coral Street onto Torrens Street, or Wattle Drive onto Hindmarsh Road.' },
  { id: 'n8', group: 'new', name: 'Victoria Street left-turn lanes', description: 'Left-turn lanes on Victoria Street (heading east) into Oval Road and the IGA car park.' },
  { id: 'n1', group: 'other', name: 'Grantley Avenue crossing closed', description: 'The Grantley Avenue railway crossing closed to cars.' },
];

const pretty = (id) => id.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** OPTIONS in order (plus any other simulated scenario), each with `available` (has at least one run). */
export function optionList(runs) {
  const have = new Set(runs.map((r) => r.scenario));
  const known = OPTIONS.map((o) => ({ ...o, available: have.has(o.id) }));
  const extra = [...have].filter((s) => !OPTIONS.some((o) => o.id === s)).sort()
    .map((s) => ({ id: s, group: 'other', name: pretty(s), description: 'Another simulated option.', available: true }));
  return known.concat(extra);
}

/** Run id for (scenario, condition, year, growth); 2025 is now (growth "base"). Prefers the seed mean. */
export function findRun(runs, scenario, condition, year, growth) {
  const g = year === 2025 ? 'base' : growth;
  const m = runs.filter((r) => r.scenario === scenario && r.condition === condition && +r.year === year && r.growth === g);
  return (m.find((r) => r.seed === 'mean') || m[0] || null)?.id ?? null;
}

/** True when every simulation of this combination jammed (more traffic than the roads could carry; A-INT-05). */
export function isJammed(jammed, scenario, condition, year, growth) {
  const g = year === 2025 ? 'base' : growth;
  return (jammed || []).some((j) => j.scenario === scenario && j.condition === condition && +j.year === year && j.growth === g);
}

/** One point per year for a scenario, day type and growth; `available` false where nothing was simulated. */
export function timelineFor(runs, scenario, condition, growth) {
  return YEARS.map((year) => {
    const runId = findRun(runs, scenario, condition, year, growth);
    return { year, growth: year === 2025 ? 'base' : growth, runId, available: !!runId };
  });
}

/** Human-readable list of (scenario · condition · year growth) combinations with no run. */
export function missingRuns(runs, scenarios, conditions, growths = ['moderate', 'high']) {
  const out = [];
  for (const s of scenarios) for (const c of conditions) for (const y of YEARS) {
    for (const g of y === 2025 ? ['base'] : growths) {
      if (!findRun(runs, s, c, y, g)) out.push(y === 2025 ? `${s} · ${c} · 2025` : `${s} · ${c} · ${y} ${g}`);
    }
  }
  return out;
}
