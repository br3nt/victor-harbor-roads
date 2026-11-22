// Making real differences stand out on a comparison map (pure; unit-tested in test/changes.test.mjs).
//
// Most roads change by seconds between two scenarios; a few change by minutes. A colour scale alone makes the
// few disappear among the many, so each road also gets an emphasis (0..1, drawn as line width and opacity):
// changes inside the dead band (noise) are drawn faint and thin, bigger changes thicker. A short summary names
// the streets that changed by a notable amount, biggest first, with a box to zoom to.

/** Emphasis of "inside the dead band" (drawn faint). */
export const FAINT = 0;
const MIN_REAL = 0.2;   // a change just past the dead band: visible, but thin

/** Per value: NaN (no data), FAINT (|v| <= deadband), else MIN_REAL..1 rising linearly to 1 at |v| >= full. */
export function emphasis(values, deadband, full) {
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null || v === undefined || Number.isNaN(v)) { out[i] = NaN; continue; }
    const a = Math.abs(v);
    if (a <= deadband) { out[i] = FAINT; continue; }
    out[i] = MIN_REAL + (1 - MIN_REAL) * Math.min(1, (a - deadband) / Math.max(1e-9, full - deadband));
  }
  return out;
}

const growBox = (b, s) => {
  for (let k = 0; k < s.length; k += 2) {
    b[0] = Math.min(b[0], s[k]); b[1] = Math.min(b[1], s[k + 1]);
    b[2] = Math.max(b[2], s[k]); b[3] = Math.max(b[3], s[k + 1]);
  }
  return b;
};

/**
 * Summary of a difference layer.
 * values[i]: B − A per feature (NaN/null = not comparable); names/shapes are per road section (edge) and
 * `section(i)` maps a feature to its section (identity for edges, lane -> edge for lanes).
 * Returns section counts (total, same, up, down, notableUp, notableDown), distinct streets with a notable change
 * (upStreets, downStreets) and `streets`: up to `limit` streets [{ name, value (largest |change|, signed),
 * sections, bbox }], biggest change first. Unnamed roads are listed one section at a time.
 */
export function summariseChanges({ values, names, shapes, section = (i) => i, deadband, notable, limit = 8 }) {
  const s = { total: 0, same: 0, up: 0, down: 0, notableUp: 0, notableDown: 0, upStreets: 0, downStreets: 0, unnamed: { up: 0, down: 0 }, streets: [] };
  const groups = new Map();
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null || v === undefined || Number.isNaN(v)) continue;
    s.total++;
    if (Math.abs(v) <= deadband) { s.same++; continue; }
    if (v > 0) s.up++; else s.down++;
    if (Math.abs(v) < notable) continue;
    if (v > 0) s.notableUp++; else s.notableDown++;
    const e = section(i);
    const name = names[e] || '';
    if (!name) s.unnamed[v > 0 ? 'up' : 'down']++;
    // a street can be slower in one part and faster in another: group by name and direction of change
    const key = `${name || `#${e}`}|${v > 0 ? '+' : '-'}`;
    let g = groups.get(key);
    if (!g) { g = { name: name || 'unnamed road', named: !!name, value: 0, sections: 0, bbox: [Infinity, Infinity, -Infinity, -Infinity], seen: new Set() }; groups.set(key, g); }
    if (Math.abs(v) > Math.abs(g.value)) g.value = v;
    if (!g.seen.has(e)) { g.seen.add(e); g.sections++; growBox(g.bbox, shapes[e]); }
  }
  const all = [...groups.values()].sort((a, b) => Math.abs(b.value) - Math.abs(a.value) || a.name.localeCompare(b.name));
  // streets are counted by name; unnamed road sections (slip lanes, service roads) separately
  s.upStreets = all.filter((g) => g.named && g.value > 0).length;
  s.downStreets = all.filter((g) => g.named && g.value < 0).length;
  s.streets = all.slice(0, limit).map(({ seen, named, ...g }) => g);
  return s;
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const pct = (x) => (x > 0.99 && x < 1 ? "over 99%" : `${Math.round(100 * x)}%`);

const cap = (t) => t.replace(/^./, (c) => c.toUpperCase());

/**
 * One or two sentences about a difference layer, from the measure's phrases (`say` in colour.js METRICS):
 * up/down: "trips from {n} are at least 1 minute slower in B" ({n} = "9 streets"); none: when no named street
 * changes by the notable amount; quiet: "{p} of road sections change by less than 15 seconds".
 */
export function summaryText(s, say, { biggest = 3 } = {}) {
  const namesOf = (sign) => {
    const xs = [...new Set(s.streets.filter((g) => Math.sign(g.value) === sign && g.name !== 'unnamed road').map((g) => g.name))].slice(0, biggest);
    return xs.length ? ` (${xs.length > 1 ? 'biggest: ' : ''}${xs.join(', ')})` : '';
  };
  const fill = (t, n) => t.replace('{n}', plural(n, 'street'));
  const parts = [];
  if (s.upStreets) parts.push(fill(say.up, s.upStreets) + namesOf(1));
  if (s.downStreets) parts.push(fill(say.down, s.downStreets) + namesOf(-1));
  const un = s.unnamed.up + s.unnamed.down;
  const unText = un ? `; ${parts.length ? 'plus ' : ''}${plural(un, 'unnamed road section')}${parts.length ? '' : ` ${un === 1 ? 'does' : 'do'}`}` : '';
  const head = `${cap(parts.length ? parts.join('; ') : say.none)}${unText}.`;
  return s.total ? `${head} ${cap(say.quiet.replace('{p}', pct(s.same / s.total)))}.` : head;
}
