import test from 'node:test';
import assert from 'node:assert/strict';
import { TripStore, safeStorage, STORAGE_KEY, DAY_TYPES, timeOptions } from '../residents/js/trips.js';
import { classify, plainDuration, plainTravelTime, classifyRoad, SAME_ABS_S, SAME_REL } from '../residents/js/change.js';
import { OPTIONS, YEARS, optionList, findRun, timelineFor, missingRuns, isJammed, yearLong, yearShort, isLongRange, NEAR_YEAR } from '../residents/js/outlook.js';

// ---------------------------------------------------------------- storage
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
}
const throwing = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceededError'); }, removeItem() { throw new Error('x'); } };
const home = { name: 'Home', lon: 138.62, lat: -35.55 };
const shop = { name: 'Woolworths', lon: 138.618, lat: -35.552, poi: 'poi_3' };

test('trips survive a reload through localStorage', () => {
  const mem = memoryStorage();
  const s1 = new TripStore(safeStorage(() => mem));
  const t = s1.addTrip({ from: home, to: shop, time: 8.5 * 3600, day: 'weekday' });
  s1.savePlace('Home', home.lon, home.lat);
  assert.equal(s1.persisted, true);
  const s2 = new TripStore(safeStorage(() => mem));
  assert.equal(s2.trips.length, 1);
  assert.deepEqual(s2.trips[0], t);
  assert.equal(s2.places[0].name, 'Home');
  s2.removeTrip(t.id);
  assert.equal(new TripStore(safeStorage(() => mem)).trips.length, 0);
});

test('works without storage (blocked or throwing): trips kept in memory, persisted = false', () => {
  for (const get of [() => throwing, () => { throw new Error('no access'); }, () => undefined]) {
    const s = new TripStore(safeStorage(get));
    s.addTrip({ from: home, to: shop, time: 9 * 3600, day: 'summer' });
    assert.equal(s.trips.length, 1);
    assert.equal(s.persisted, false);
  }
});

test('corrupt or foreign stored data is ignored, invalid trips are rejected', () => {
  const mem = memoryStorage();
  mem.setItem(STORAGE_KEY, '{not json');
  assert.equal(new TripStore(safeStorage(() => mem)).trips.length, 0);
  mem.setItem(STORAGE_KEY, JSON.stringify({ version: 1, trips: [{ from: home }, { from: home, to: shop, time: 3600, day: 'weekday', id: 'a' }], places: [{ name: 'x' }] }));
  const s = new TripStore(safeStorage(() => mem));
  assert.equal(s.trips.length, 1);
  assert.equal(s.places.length, 0);
  assert.throws(() => s.addTrip({ from: home, to: shop, time: 3600, day: 'holiday' }), /day/);
  assert.throws(() => s.addTrip({ from: home, to: { name: 'x', lon: 'a', lat: 1 }, time: 3600, day: 'weekday' }), /place/);
  assert.throws(() => s.addTrip({ from: home, to: shop, time: 99 * 3600, day: 'weekday' }), /time/);
});

test('clear removes everything from storage', () => {
  const mem = memoryStorage();
  const s = new TripStore(safeStorage(() => mem));
  s.addTrip({ from: home, to: shop, time: 3600, day: 'weekday' });
  s.clear();
  assert.equal(mem.getItem(STORAGE_KEY), null);
  assert.equal(s.trips.length, 0);
});

test('day types map to simulated conditions; departure times every 15 minutes', () => {
  assert.equal(DAY_TYPES.weekday.condition, 'weekday_term');
  assert.equal(DAY_TYPES.saturday.condition, 'saturday');
  assert.equal(DAY_TYPES.summer.condition, 'summer_peak');
  const t = timeOptions();
  assert.equal(t.length, 96);
  assert.deepEqual(t[34], { value: 8.5 * 3600, label: '8:30 am' });
});

// ---------------------------------------------------------------- change words
test('classification: green better, grey about the same (noise band), red worse', () => {
  assert.equal(SAME_ABS_S, 30); assert.equal(SAME_REL, 0.05);
  assert.deepEqual(classify(600, 620), { cls: 'same', delta: 20, words: 'about the same' });
  assert.equal(classify(1200, 1255).cls, 'same');                 // 5% of 20 min = 60 s band
  assert.deepEqual(classify(600, 670), { cls: 'worse', delta: 70, words: 'about 1 minute slower' });
  assert.deepEqual(classify(600, 450), { cls: 'better', delta: -150, words: 'about 3 minutes faster' });
  assert.deepEqual(classify(300, 345), { cls: 'worse', delta: 45, words: 'less than a minute slower' });
  assert.equal(classify(600, Infinity).cls, 'worse');
  assert.equal(classify(600, Infinity).words, 'no route with this option');
  assert.equal(classify(NaN, 600).cls, 'unknown');
});

test('plain durations', () => {
  assert.equal(plainDuration(40), 'less than a minute');
  assert.equal(plainDuration(70), 'about 1 minute');
  assert.equal(plainDuration(150), 'about 3 minutes');
  assert.equal(plainDuration(3 * 3600 + 600), 'about 3 hours 10 minutes');
  assert.equal(plainTravelTime(20), 'under a minute');
  assert.equal(plainTravelTime(61), '1 minute');
  assert.equal(plainTravelTime(9.6 * 60), '10 minutes');
});

test('road-level classification uses a smaller band', () => {
  assert.equal(classifyRoad(20, 22), 'same');
  assert.equal(classifyRoad(20, 30), 'worse');
  assert.equal(classifyRoad(60, 40), 'better');
  assert.equal(classifyRoad(undefined, 20), 'new');            // road does not exist today
});

// ---------------------------------------------------------------- options and timeline
const RUNS = [
  { id: 'baseline__weekday_term__2025-base__mean', scenario: 'baseline', condition: 'weekday_term', year: 2025, growth: 'base', seed: 'mean' },
  { id: 'baseline__weekday_term__2025-base__s1', scenario: 'baseline', condition: 'weekday_term', year: 2025, growth: 'base', seed: '1' },
  { id: 'baseline__weekday_term__2041-high__mean', scenario: 'baseline', condition: 'weekday_term', year: 2041, growth: 'high', seed: 'mean' },
  { id: 'cp__weekday_term__2025-base__mean', scenario: 'cp', condition: 'weekday_term', year: 2025, growth: 'base', seed: 'mean' },
  { id: 'cp__summer_peak__2025-base__mean', scenario: 'cp', condition: 'summer_peak', year: 2025, growth: 'base', seed: 'mean' },
  { id: 'xyz__weekday_term__2025-base__s3', scenario: 'xyz_new', condition: 'weekday_term', year: 2025, growth: 'base', seed: '3' },
];

test('findRun prefers the seed mean and treats 2025 as today (base growth)', () => {
  assert.equal(findRun(RUNS, 'baseline', 'weekday_term', 2025, 'high'), 'baseline__weekday_term__2025-base__mean');
  assert.equal(findRun(RUNS, 'baseline', 'weekday_term', 2041, 'high'), 'baseline__weekday_term__2041-high__mean');
  assert.equal(findRun(RUNS, 'baseline', 'weekday_term', 2041, 'moderate'), null);
  assert.equal(findRun(RUNS, 'cp', 'saturday', 2025, 'high'), null);
});

test('timeline lists every year, greying out what is not simulated', () => {
  const tl = timelineFor(RUNS, 'baseline', 'weekday_term', 'high');
  assert.deepEqual(tl.map((p) => p.year), YEARS);
  assert.deepEqual(tl.map((p) => p.available), [true, false, false, true]);
  assert.equal(tl[0].growth, 'base');
  assert.equal(tl[3].runId, 'baseline__weekday_term__2041-high__mean');
});

test('option list: known options in order with plain names; unknown scenarios appended; availability flagged', () => {
  const list = optionList(RUNS);
  assert.equal(list[0].id, 'baseline');
  assert.equal(list[0].name, "Today's network");
  const cp = list.find((o) => o.id === 'cp');
  assert.ok(cp.available && /30 km\/h/.test(cp.description));
  assert.equal(list.find((o) => o.id === 'c2').available, false);
  const extra = list.find((o) => o.id === 'xyz_new');
  assert.ok(extra && extra.available && extra.name === 'Xyz new');
  for (const o of OPTIONS) assert.ok(!/\b(St|Rd|Tce|Ave|DIT|VHITS|CP|BP)\b/.test(o.name + ' ' + o.description), `abbreviation in ${o.id}`);
});

test('missingRuns lists the combinations still to simulate', () => {
  const miss = missingRuns(RUNS, ['baseline', 'cp'], ['weekday_term', 'summer_peak'], ['high']);
  assert.ok(miss.includes('baseline · summer_peak · 2025'));
  assert.ok(miss.includes('cp · weekday_term · 2041 high'));
  assert.ok(!miss.includes('baseline · weekday_term · 2041 high'));
});

test('isJammed: a combination whose every simulation jammed (2025 always means growth "base")', () => {
  const jammed = [{ scenario: 'cp', condition: 'summer_peak', year: 2051, growth: 'moderate' },
    { scenario: 'baseline', condition: 'weekday_term', year: 2051, growth: 'high' }];
  assert.equal(isJammed(jammed, 'cp', 'summer_peak', 2051, 'moderate'), true);
  assert.equal(isJammed(jammed, 'cp', 'summer_peak', 2051, 'high'), false);
  assert.equal(isJammed(jammed, 'baseline', 'weekday_term', 2051, 'high'), true);
  assert.equal(isJammed(jammed, 'baseline', 'weekday_term', 2025, 'high'), false);
  assert.equal(isJammed(undefined, 'cp', 'summer_peak', 2051, 'moderate'), false);
});

// year labels: this year is 2026; the "now" runs use 2025 data
test('yearLong places each year relative to 2026', () => {
  assert.equal(yearLong(2025), 'Now (2025 data)');
  assert.equal(yearLong(2031), '2031 (in about 5 years)');
  assert.equal(yearLong(2041), '2041 (in about 15 years)');
  assert.equal(yearLong(2051), '2051 (in about 25 years)');
});

test('yearShort: Now / the year / +N yrs (2036 is about 10 years); only 2041 and 2051 are long range', () => {
  assert.deepEqual(YEARS.map((y) => yearShort(y)), ['Now', '2031', '2036', '2041']);
  assert.deepEqual(YEARS.map((y) => yearShort(y, { plus: true })), ['Now', '+5 yrs', '+10 yrs', '+15 yrs']);
  assert.deepEqual(YEARS.map(isLongRange), [false, false, false, true]);
  assert.equal(NEAR_YEAR, 2031);
});
