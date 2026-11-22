// Colour scales. Sequential ramps change lightness monotonically (checked in test/colour.test.mjs with OKLab):
// in light mode "more" is darker, in dark mode "more" is lighter, so the quiet end recedes into the
// background in both. Lightness, not hue, carries the order, which keeps the scales readable with
// colour-vision deficiency. The diverging scale is blue (better in B) <-> grey <-> red (worse in B).

export const RAMPS = {
  // viridis (perceptually uniform, colour-blind safe)
  time: {
    light: ['#dde318', '#addc30', '#5ec962', '#28ae80', '#21918c', '#2c728e', '#3b528b', '#472d7b', '#440154'],
    dark: ['#482173', '#433e85', '#38588c', '#2d708e', '#25858e', '#1e9b8a', '#2ab07f', '#52c569', '#86d549', '#c2df23', '#fde725'],
  },
  // amber -> crimson: free-flowing -> stopped
  congestion: {
    light: ['#f6dba0', '#f3bd72', '#ec9a55', '#e1743f', '#cd4f3a', '#ae3040', '#861c45', '#5c1140'],
    dark: ['#4a3524', '#6e4626', '#955528', '#bd612d', '#df6c39', '#f27a52', '#fb8f74', '#ffaf9f'],
  },
  // single-hue blue: traffic volume
  volume: {
    light: ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'],
    dark: ['#16365f', '#1c5cab', '#2a78d6', '#5598e7', '#86b6ef', '#b7d3f6', '#e1eefd'],
  },
  // blue (B better) <-> neutral grey <-> red (B worse)
  diff: {
    light: ['#1c4f8f', '#3f84d6', '#9cc1ee', '#e6e5e1', '#f2ae96', '#d9603f', '#9a3417'],
    dark: ['#a9cbf3', '#5c97de', '#2f5f99', '#3a3a37', '#9a4a32', '#de6a48', '#f6b09b'],
  },
};

export const NO_DATA = { light: '#c9c8c2', dark: '#4a4a46' };
export const CASING = { light: 'rgba(11,11,11,0.28)', dark: 'rgba(0,0,0,0.55)' };

export function ramp(name, theme) {
  return RAMPS[name][theme === 'dark' ? 'dark' : 'light'];
}

// ---------------------------------------------------------------- colour maths
const hexToRgb = (h) => {
  const s = h.replace('#', '');
  const v = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16));
};
const toHex = (rgb) => '#' + rgb.map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('');

export function sample(stops, x) {
  if (!(x > 0)) return stops[0];
  if (x >= 1) return stops[stops.length - 1];
  const u = x * (stops.length - 1), i = Math.floor(u), f = u - i;
  const a = hexToRgb(stops[i]), b = hexToRgb(stops[i + 1]);
  return toHex(a.map((v, k) => v + f * (b[k] - v)));
}

function oklab(hex) {
  const lin = hexToRgb(hex).map((c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  const [r, g, b] = lin;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
export const oklabL = (hex) => oklab(hex)[0];
export const chroma = (hex) => { const [, a, b] = oklab(hex); return Math.hypot(a, b); };

// ---------------------------------------------------------------- metrics
// `domain` runs from the ramp's first colour to its last (it may be descending, e.g. speed ratio 1 -> 0).
export const METRICS = {
  time: { title: 'Travel time to the target', unit: 'minutes', ramp: 'time', domain: [0, 20], fmt: (v) => `${Math.round(v)}`, plus: true },
  // urban SUMO links rarely average the full limit (junction slow-downs), so 80% and above counts as free-flowing
  speed: { title: 'Speed compared with the speed limit', unit: '% of the limit', ramp: 'congestion', domain: [0.8, 0], fmt: (v) => `${Math.round(v * 100)}%`, firstPlus: true },
  waiting: { title: 'Vehicles queued (average over 15 minutes)', unit: 'vehicles halted', ramp: 'congestion', domain: [0, 8], fmt: (v) => `${Math.round(v)}`, plus: true },
  density: { title: 'Density', unit: 'vehicles per km of lane', ramp: 'congestion', domain: [0, 100], fmt: (v) => `${Math.round(v)}`, plus: true },
  vehicles: { title: 'Traffic volume (vehicles entering the lane, incl. lane changes)', unit: 'vehicles per hour', ramp: 'volume', domain: [0, 800], fmt: (v) => `${Math.round(v)}`, plus: true },
  // Difference scales are fixed (not fitted to the data) so maps of different pairs compare, and set where typical
  // real changes are strongly coloured: measured for summer peak 2025 to Woolworths, the council package makes a
  // quarter of the roads 1-2 minutes slower and almost none more than 2 (see sim/VIEWER.md, "Comparison maps").
  // `notable`: a change big enough to name a street in the summary; `open`: values beyond the ends get the end colour.
  diff_time: { title: 'Change in travel time, B − A', unit: 'minutes', ramp: 'diff', domain: [-2, 2], fmt: signed, ends: ['faster in B', 'slower in B'],
    deadband: 0.25, deadbandText: '15 seconds', notable: 1, open: true,
    say: { up: 'trips from {n} are at least 1 minute slower in B', down: 'trips from {n} are at least 1 minute faster in B', none: 'no trip from a named street changes by 1 minute or more', quiet: '{p} of road sections change by less than 15 seconds' } },
  diff_speed: { title: 'Change in speed, B − A', unit: 'percentage points of the limit', ramp: 'diff', domain: [0.3, -0.3], fmt: (v) => signed(v * 100), ends: ['faster in B', 'slower in B'],
    deadband: 0.05, deadbandText: '5 percentage points', notable: 0.15, open: true,
    say: { up: 'traffic is at least 15 percentage points faster in B on {n}', down: 'traffic is at least 15 percentage points slower in B on {n}', none: 'no named street changes speed by 15 percentage points or more', quiet: '{p} of lanes change by less than 5 percentage points' } },
  diff_waiting: { title: 'Change in vehicles queued, B − A', unit: 'vehicles halted', ramp: 'diff', domain: [-3, 3], fmt: signed, ends: ['shorter queue in B', 'longer queue in B'],
    deadband: 0.5, deadbandText: 'half a vehicle', notable: 1, open: true,
    say: { up: 'queues are at least 1 vehicle longer in B on {n}', down: 'queues are at least 1 vehicle shorter in B on {n}', none: 'no queue on a named street changes by 1 vehicle or more', quiet: '{p} of lanes change by less than half a vehicle' } },
  diff_density: { title: 'Change in density, B − A', unit: 'vehicles per km of lane', ramp: 'diff', domain: [-40, 40], fmt: signed, ends: ['less dense in B', 'denser in B'],
    deadband: 3, deadbandText: '3 vehicles per km', notable: 10, open: true,
    say: { up: 'traffic is at least 10 vehicles per km denser in B on {n}', down: 'traffic is at least 10 vehicles per km less dense in B on {n}', none: 'no named street changes density by 10 vehicles per km or more', quiet: '{p} of lanes change by less than 3 vehicles per km' } },
  diff_vehicles: { title: 'Change in traffic volume, B − A', unit: 'vehicles per hour', ramp: 'diff', domain: [-300, 300], fmt: signed, ends: ['fewer vehicles in B', 'more vehicles in B'],
    deadband: 20, deadbandText: '20 vehicles per hour', notable: 100, open: true,
    say: { up: 'at least 100 more vehicles per hour in B on {n}', down: 'at least 100 fewer vehicles per hour in B on {n}', none: 'no named street changes by 100 vehicles per hour or more', quiet: '{p} of lanes change by less than 20 vehicles per hour' } },
};

function signed(v) {
  const r = Math.round(v);
  return r > 0 ? `+${r}` : r < 0 ? `−${-r}` : '0';
}

/**
 * MapLibre paint expression: colour from feature-state `v`, `noData` when it is not a number.
 * A diverging scale with `deadband` shows |v| <= deadband as the neutral midpoint (run-to-run noise).
 */
export function colourExpression(scale, noData, key = 'v') {
  const [d0, d1] = scale.domain;
  const n = scale.stops.length;
  let pairs;
  if (scale.deadband && n % 2 === 1) {
    const mid = (n - 1) / 2, s = Math.sign(d1 - d0), db = scale.deadband;
    pairs = scale.stops.map((c, i) => (i <= mid
      ? [d0 + (-db * s - d0) * (i / mid), c]
      : [db * s + (d1 - db * s) * ((i - mid) / mid), c]));
    pairs.splice(mid + 1, 0, [db * s, scale.stops[mid]]);
  } else {
    pairs = scale.stops.map((c, i) => [d0 + ((d1 - d0) * i) / (n - 1), c]);
  }
  if (d1 < d0) pairs = pairs.reverse();
  return ['case', ['==', ['typeof', ['feature-state', key]], 'number'],
    ['interpolate', ['linear'], ['feature-state', key], ...pairs.flat()], noData];
}

export function scaleFor(metric, theme, domain) {
  const m = METRICS[metric];
  return { domain: domain || m.domain, stops: ramp(m.ramp, theme), deadband: m.deadband || 0 };
}

/** Legend: CSS gradient (left = first ramp colour) and 5 tick labels with numbers. */
export function legendStops(metric, theme, domain) {
  const m = typeof metric === 'string' ? METRICS[metric] : metric;
  const stops = ramp(m.ramp, theme);
  const [d0, d1] = domain || m.domain;
  const gradient = `linear-gradient(to right, ${stops.map((c, i) => `${c} ${((100 * i) / (stops.length - 1)).toFixed(1)}%`).join(', ')})`;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((pos) => {
    const v = d0 + (d1 - d0) * pos;
    let label = m.fmt(v);
    if ((pos === 1 && m.plus) || (pos === 0 && m.firstPlus)) label += '+';
    if (m.open && (pos === 0 || pos === 1)) label = `${(pos === 0) === (d1 > d0) ? '≤' : '≥'}${label}`;
    return { pos, label };
  });
  const deadband = m.deadband ? `Changes smaller than ${m.deadbandText} either way are shown as no change (run-to-run noise).` : null;
  return { gradient, ticks, title: m.title, unit: m.unit, ends: m.ends || null, deadband };
}

/** A "nice" upper bound for a sequential domain (e.g. travel-time legend that fits the data). */
export function niceMax(x, steps = [4, 8, 12, 16, 20, 24, 32, 40, 60, 80, 120]) {   // quarters are whole minutes
  for (const s of steps) if (x <= s) return s;
  return Math.ceil(x / 60) * 60;
}

export function quantile(values, q) {
  const v = Array.from(values).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return 0;
  return v[Math.min(v.length - 1, Math.floor(q * (v.length - 1)))];
}
