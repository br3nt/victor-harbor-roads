import test from 'node:test';
import assert from 'node:assert/strict';
import { RAMPS, ramp, sample, oklabL, chroma, colourExpression, legendStops, METRICS, scaleFor } from '../js/colour.js';

const slope = (xs) => xs.slice(1).map((x, i) => x - xs[i]);

for (const name of ['time', 'congestion', 'volume']) {
  for (const theme of ['light', 'dark']) {
    test(`${name} (${theme}) is a monotonic lightness ramp: more = ${theme === 'light' ? 'darker' : 'lighter'}`, () => {
      const L = ramp(name, theme).map(oklabL);
      const d = slope(L);
      if (theme === 'light') assert.ok(d.every((x) => x < 0), `${name} light: ${L.map((x) => x.toFixed(3))}`);
      else assert.ok(d.every((x) => x > 0), `${name} dark: ${L.map((x) => x.toFixed(3))}`);
      // ends are distinguishable (lightness span >= 0.35)
      assert.ok(Math.abs(L[0] - L[L.length - 1]) >= 0.35);
    });
  }
}

for (const theme of ['light', 'dark']) {
  test(`diverging (${theme}) has a neutral grey midpoint and balanced arms`, () => {
    const r = ramp('diff', theme);
    assert.equal(r.length % 2, 1);
    const mid = r[(r.length - 1) / 2];
    assert.ok(chroma(mid) < 0.02, `midpoint chroma ${chroma(mid)}`);
    const L = r.map(oklabL);
    const n = (r.length - 1) / 2;
    for (let k = 1; k <= n; k++) {
      // arms move away from the midpoint in lightness symmetrically (within 0.08)
      assert.ok(Math.abs((L[n - k] - L[n]) - (L[n + k] - L[n])) < 0.08, `step ${k}: ${L}`);
    }
  });
}

test('sample interpolates and clamps', () => {
  assert.equal(sample(['#000000', '#ffffff'], 0), '#000000');
  assert.equal(sample(['#000000', '#ffffff'], 1), '#ffffff');
  assert.equal(sample(['#000000', '#ffffff'], 2), '#ffffff');
  assert.equal(sample(['#000000', '#ffffff'], 0.5), '#808080');
});

test('colourExpression builds a MapLibre interpolate over feature-state with a no-data colour', () => {
  const ex = colourExpression({ domain: [0, 30], stops: ['#000000', '#ffffff'] }, '#999999');
  assert.equal(ex[0], 'case');
  assert.deepEqual(ex[1], ['==', ['typeof', ['feature-state', 'v']], 'number']);
  assert.equal(ex[2][0], 'interpolate');
  assert.deepEqual(ex[2][2], ['feature-state', 'v']);
  assert.equal(ex[3], '#999999');
  const nums = ex[2].slice(3).filter((x) => typeof x === 'number');
  assert.equal(nums[0], 0); assert.equal(nums[nums.length - 1], 30);
});

test('a dead band maps small differences to the neutral midpoint, in both domain directions', () => {
  for (const metric of ['diff_time', 'diff_speed']) {
    const sc = scaleFor(metric, 'light');
    const ex = colourExpression(sc, '#999999');
    const flat = ex[2].slice(3);
    const pairs = [];
    for (let k = 0; k < flat.length; k += 2) pairs.push([flat[k], flat[k + 1]]);
    const inputs = pairs.map((p) => p[0]);
    assert.deepEqual(inputs, [...inputs].sort((a, b) => a - b), 'stops ascending');
    const mid = sc.stops[(sc.stops.length - 1) / 2];
    const db = METRICS[metric].deadband;
    assert.ok(pairs.some(([v, c]) => Math.abs(v + db) < 1e-9 && c === mid), metric);
    assert.ok(pairs.some(([v, c]) => Math.abs(v - db) < 1e-9 && c === mid), metric);
    assert.match(legendStops(metric, 'light').deadband, /smaller than/);
  }
});

test('every metric has units and a legend', () => {
  for (const [key, m] of Object.entries(METRICS)) {
    assert.ok(m.unit && m.title, key);
    const st = legendStops(m, 'light');
    assert.ok(st.ticks.length >= 3 && st.gradient.startsWith('linear-gradient('), key);
    assert.ok(st.ticks.every((t) => /\d/.test(t.label)), key);
  }
});

test('difference scales are fixed to ranges where typical real changes are strongly coloured', () => {
  // measured (summer peak 2025, to Woolworths): the council package changes most roads by 15 s to 2 min, rarely more
  assert.deepEqual(METRICS.diff_time.domain, [-2, 2]);
  assert.deepEqual(METRICS.diff_waiting.domain, [-3, 3]);
  for (const [key, m] of Object.entries(METRICS)) {
    if (!key.startsWith('diff_')) continue;
    assert.ok(m.notable > m.deadband, `${key}: a notable change is bigger than the dead band`);
    assert.ok(m.notable < Math.abs(m.domain[1]), `${key}: and inside the scale`);
    assert.ok(m.say && ['up', 'down', 'none', 'quiet'].every((k) => typeof m.say[k] === 'string'), `${key}: summary phrases`);
    assert.match(m.say.up + m.say.down, /\{n\}.*\{n\}/, key);
    const st = legendStops(m, 'light');
    const up = m.domain[1] > m.domain[0];
    assert.match(st.ticks[0].label, up ? /^≤/ : /^≥/, `${key}: the scale ends are open`);
    assert.match(st.ticks[4].label, up ? /^≥/ : /^≤/, key);
  }
});

test('ramp definitions exist for both themes', () => {
  for (const r of Object.values(RAMPS)) { assert.ok(r.light.length >= 5 && r.dark.length >= 5); }
});
