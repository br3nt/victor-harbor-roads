import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AddressIndex, parseQuery, words, fold, loadAddressIndex } from '../residents/js/address.js';

// A tiny index in the file format of data/addresses.json: [name, localityIndex, lon, lat, [[number, dx, dy, flat?]...]]
const DOC = {
  v: 1, attribution: 'test', loc: ['Victor Harbor', 'Encounter Bay'],
  streets: [
    ['Ocean Street', 0, 138.623, -35.554, [['1', 0, 0], ['1', 0, 0, '1'], ['1', 0, 0, '2'], ['5', 10, 10], ['5', 10, 10, '3'], ['5', 10, 10, '4'],
      ['7A', 12, 12], ['7B', 14, 14], ['9-13', 20, 20], ['2', -10, 10]]],
    ['Bay Road', 1, 138.6, -35.563, [['98', 0, 0], ['100', 5, 5], ['102', 9, 9], ['106', 20, 20], ['Lot 4', 30, 30]]],
    ['Bay Road', 0, 138.607, -35.56, [['7', 0, 0], ['15', 4, 4], ['17', 6, 6]]],
    ['St Andrews Parade', 1, 138.61, -35.57, [['3', 0, 0]]],
    ['Encounter Terrace', 1, 138.606, -35.568, [['2', 0, 0]]],
    ['Kent Place', 0, 138.62, -35.55, [['10', 0, 0, 'Shop 3'], ['10', 0, 0, 'Shop 4']]],
  ],
};
const ix = new AddressIndex(DOC);
const labels = (q, o) => ix.search(q, o).map((r) => r.label);

test('words and fold: case, punctuation and abbreviations', () => {
  assert.deepEqual(words("O'Connor St."), ['oconnor', 'st']);
  for (const [a, b] of [['st', 'street'], ['rd', 'road'], ['pde', 'parade'], ['tce', 'terrace'], ['ave', 'avenue'],
    ['cres', 'crescent'], ['ct', 'court'], ['dr', 'drive']]) assert.equal(fold(a), fold(b), `${a} ~ ${b}`);
});

test('parseQuery: numbers, units, ranges, lots, postcodes', () => {
  assert.deepEqual(parseQuery('12 Bay Rd Encounter Bay'), { number: { n: 12, suffix: '', last: null, text: '12' }, flat: null, lot: null, rest: ['bay', 'rd', 'encounter', 'bay'] });
  const unit = (q) => { const p = parseQuery(q); return [p.flat, p.number?.n, p.rest.join(' ')]; };
  assert.deepEqual(unit('unit 3/5 ocean st'), ['3', 5, 'ocean st']);
  assert.deepEqual(unit('3/5 ocean st'), ['3', 5, 'ocean st']);
  assert.deepEqual(unit('u3/5 ocean st'), ['3', 5, 'ocean st']);
  assert.deepEqual(unit('unit 3, 5 ocean st'), ['3', 5, 'ocean st']);
  assert.deepEqual(unit('flat 3 5 ocean st'), ['3', 5, 'ocean st']);
  assert.deepEqual(unit('5 / 3 ocean st'), ['5', 3, 'ocean st']);   // read as unit/number: the resident can correct it
  assert.deepEqual(parseQuery('7a ocean st').number, { n: 7, suffix: 'a', last: null, text: '7a' });
  assert.equal(parseQuery('9-13 ocean st').number.last, 13);
  assert.equal(parseQuery('lot 4 bay rd').lot, '4');
  assert.deepEqual(parseQuery('bay rd 12').number?.n, 12);
  assert.deepEqual(parseQuery('5 ocean st victor harbor SA 5211').rest, ['ocean', 'st', 'victor', 'harbor']);
  assert.equal(parseQuery('bay rd').number, null);
  assert.deepEqual(parseQuery('   ').rest, []);
  assert.deepEqual(parseQuery(null).rest, []);
});

test('exact address, in any case and with abbreviations', () => {
  const a = labels('5 ocean st');
  assert.equal(a[0], '5 Ocean Street, Victor Harbor');
  assert.deepEqual(labels('5 OCEAN STREET'), a);
  assert.deepEqual(labels('  5   Ocean   St,  Victor Harbor '), a);
  assert.equal(labels('98 bay road encounter bay')[0], '98 Bay Road, Encounter Bay');
  assert.equal(labels('3 st andrews pde')[0], '3 St Andrews Parade, Encounter Bay');
  assert.equal(labels('3 saint andrews parade')[0], '3 St Andrews Parade, Encounter Bay');
  assert.equal(labels('2 encounter tce')[0], '2 Encounter Terrace, Encounter Bay');
});

test('the typed locality picks between streets with the same name', () => {
  assert.equal(labels('7 bay rd victor harbor')[0], '7 Bay Road, Victor Harbor');
  assert.ok(!labels('15 bay rd victor harbor').some((l) => /Encounter Bay/.test(l) && /^15 /.test(l)));
  const both = labels('bay rd');
  assert.deepEqual(both.sort(), ['Bay Road, Encounter Bay', 'Bay Road, Victor Harbor']);
});

test('unit forms find the unit; a missing unit falls back to the building', () => {
  for (const q of ['3/5 ocean st', 'unit 3/5 ocean st', 'unit 3 5 ocean street', 'u3/5 ocean st']) {
    assert.equal(labels(q)[0], '3/5 Ocean Street, Victor Harbor', q);
  }
  const miss = ix.search('9/5 ocean st')[0];
  assert.equal(miss.label, '5 Ocean Street, Victor Harbor');
  assert.match(miss.note, /Unit 9 isn't on file/);
  assert.equal(labels('3/10 kent pl')[0], 'Shop 3, 10 Kent Place, Victor Harbor');
});

test('a building with several units is one suggestion unless a unit is typed', () => {
  const r = ix.search('1 ocean st');
  assert.equal(r.filter((x) => /^1 Ocean/.test(x.label)).length, 1);
  assert.match(r[0].note, /2 units at this address/);
  assert.equal(r[0].lon, 138.623);
});

test('suffix and range matching', () => {
  assert.equal(labels('7a ocean st')[0], '7A Ocean Street, Victor Harbor');
  assert.equal(labels('7b ocean st')[0], '7B Ocean Street, Victor Harbor');
  assert.deepEqual(labels('7 ocean st').slice(0, 2), ['7A Ocean Street, Victor Harbor', '7B Ocean Street, Victor Harbor']);
  assert.equal(labels('11 ocean st')[0], '9-13 Ocean Street, Victor Harbor');   // inside a range
  assert.equal(labels('9 ocean st')[0], '9-13 Ocean Street, Victor Harbor');
});

test('a number that is not on file gives the nearest number; a street alone gives a point on the street', () => {
  const n = ix.search('104 bay rd encounter bay')[0];
  assert.equal(n.kind, 'nearby');
  assert.match(n.label, /^(102|106) Bay Road/);
  assert.match(n.note, /No 104 on file/);
  const s = ix.search('encounter terrace')[0];
  assert.equal(s.kind, 'street');
  assert.deepEqual([s.lon, s.lat], [138.606, -35.568]);
  assert.match(s.note, /Move the pin/);
});

test('lot numbers', () => {
  assert.equal(labels('lot 4 bay rd encounter bay')[0], 'Lot 4 Bay Road, Encounter Bay');
});

test('forgiving of prefixes (typing in progress) and junk', () => {
  assert.equal(labels('5 ocea')[0], '5 Ocean Street, Victor Harbor');
  assert.equal(labels('5 oc st')[0], '5 Ocean Street, Victor Harbor');
  assert.deepEqual(ix.search(''), []);
  assert.deepEqual(ix.search('12'), []);
  assert.deepEqual(ix.search('zzzz'), []);
  assert.deepEqual(ix.search('5 st'), []);   // a street type alone names no street
  assert.deepEqual(ix.search('<script>alert(1)</script>'), []);
  assert.ok(ix.search('ocean', { limit: 1 }).length <= 1);
});

test('coordinates are decoded from the offsets', () => {
  const a = ix.search('5 ocean st')[0];
  assert.equal(a.lon, +(138.623 + 10e-5).toFixed(6));
  assert.equal(a.lat, +(-35.554 + 10e-5).toFixed(6));
});

test('loadAddressIndex fetches one static file and reports failures', async () => {
  const calls = [];
  const fetchOk = async (url, opts) => { calls.push([url, opts]); return { ok: true, json: async () => DOC }; };
  const loaded = await loadAddressIndex('data/addresses.json', fetchOk);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'data/addresses.json');
  // plain same-origin GET like the other data files: the published host needs its cookies, and the
  // request carries nothing the resident typed
  assert.equal(calls[0][1]?.credentials, undefined);
  assert.equal(loaded.search('5 ocean st')[0].label, '5 Ocean Street, Victor Harbor');
  await assert.rejects(loadAddressIndex('x', async () => ({ ok: false, status: 404 })), /HTTP 404/);
});

test('exact matches on any street come before a nearest-number guess', () => {
  const r = ix.search('9 ocean st');
  const two = new AddressIndex({ ...DOC, streets: [...DOC.streets, ['Ocean Street', 1, 138.6, -35.56, [['50', 0, 0]]]] });
  const out = two.search('9 ocean st');
  assert.equal(out[0].kind, 'address');
  assert.equal(out[0].label, '9-13 Ocean Street, Victor Harbor');
  assert.ok(r.length);
  const guess = new AddressIndex({ ...DOC, streets: [['Ocean Street', 1, 138.6, -35.56, [['50', 0, 0]]], DOC.streets[0]] }).search('11 ocean st');
  assert.deepEqual(guess.map((g) => g.kind), ['address', 'nearby']);
});

test('a missing unit labels the building, not another unit; unit counts are per building', () => {
  const d = new AddressIndex({ ...DOC, streets: [['Hill Road', 0, 138.6, -35.5, [['35', 0, 0], ['35-53', 5, 5, '1'], ['35-53', 5, 5, '2'], ['35-53', 5, 5, '3']]]], loc: ['Victor Harbor'] });
  const miss = d.search('99/35-53 hill rd')[0];
  assert.equal(miss.label, '35-53 Hill Road, Victor Harbor');
  const r = d.search('35 hill rd');
  assert.equal(r.find((x) => x.label.startsWith('35 ')).note, null);
  assert.match(r.find((x) => x.label.startsWith('35-53')).note, /3 units.*3\/35-53/);
});

test('abbreviation prefixes, lots and nearest number', () => {
  const d = new AddressIndex({ v: 1, loc: ['Victor Harbor'], streets: [['Crozier Road', 0, 138.6, -35.5, [['2', 0, 0], ['4', 1, 1], ['7', 2, 2], ['10', 3, 3]]]] });
  assert.equal(d.search('cr')[0].label, 'Crozier Road, Victor Harbor');
  assert.equal(d.search('lot 999 crozier rd')[0].kind, 'street');
  assert.equal(d.search('6 crozier rd')[0].label, '4 Crozier Road, Victor Harbor');   // same side of the road first
});

test('real index: size, counts and some known streets', () => {
  const path = fileURLToPath(new URL('../residents/data/addresses.json', import.meta.url));
  const raw = readFileSync(path);
  assert.ok(raw.length < 2e6, `${raw.length} bytes`);
  const doc = JSON.parse(raw);
  assert.match(doc.attribution, /Geoscape/);
  const real = new AddressIndex(doc);
  assert.ok(real.streets.length > 400 && real.streets.reduce((n, s) => n + s.addresses.length, 0) > 10000);
  assert.deepEqual(real.localities.map((l) => l.name).sort().slice(0, 3), ['Back Valley', 'Encounter Bay', 'Hayborough']);
  const bbox = { w: 138.2, e: 138.75, s: -35.65, n: -35.35 };
  for (const q of ['Bay Rd Encounter Bay', 'ocean st', 'victor harbor rd', 'Waitpinga Rd', 'hindmarsh valley rd', 'Adelaide Rd', 'Torrens St']) {
    const r = real.search(q);
    assert.ok(r.length, `no result for ${q}`);
    for (const x of r) assert.ok(x.lon > bbox.w && x.lon < bbox.e && x.lat > bbox.s && x.lat < bbox.n, `${q}: ${x.label} outside the area`);
  }
  // every address in the file decodes to a point in the area
  for (const s of real.streets) for (const a of s.addresses) assert.ok(a.lon > bbox.w && a.lon < bbox.e && a.lat > bbox.s && a.lat < bbox.n, `${s.name} ${a.num}`);
  assert.equal(real.search('12 bay rd')[0].kind, 'address');   // 1-15 Bay Road, not a guess on another Bay Road
  assert.match(real.search('99/35 bay rd')[0].label, /^35 Bay Road/);
  assert.equal(real.search('cr')[0].label.split(' ')[0], 'Crozier');
  const t = performance.now();
  for (let k = 0; k < 20; k++) real.search('12 bay rd encounter bay');
  assert.ok((performance.now() - t) / 20 < 50, 'a search takes well under 50 ms');
});
