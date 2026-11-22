// Address search for the residents' site. Runs entirely in the browser over a bundled index
// (data/addresses.json, built from G-NAF by sim/vhsim/viewer/addresses.py): what is typed is never sent anywhere.
//
// Matching, in short: the query is lower-cased and split into words; street-type abbreviations are folded
// onto one form (St/Street/Saint, Rd/Road, Pde/Parade ...), so "5 ocean st" and "5 Ocean Street" are the same.
// A leading house number ("12", "12a", "12-14", "lot 5") or unit form ("3/5", "unit 3 5", "u3/5") is taken
// out first; the remaining words must each match the start of a word in the street's name or its locality.
// Streets are ranked by how well their words are covered; within a street the numbers are matched exactly,
// then with a suffix ("12" finds 12A), then inside a range ("1-13"). With no number the street itself is
// returned, placed on the street; with a number that isn't on file the nearest number is returned.

/** Words folded onto one form so that abbreviations and full words match each other. Used on both sides. */
export const ABBREVIATIONS = {
  st: 'street', str: 'street', street: 'street', saint: 'street',
  rd: 'road', road: 'road', pde: 'parade', parade: 'parade', tce: 'terrace', ter: 'terrace', terr: 'terrace', terrace: 'terrace',
  ave: 'avenue', av: 'avenue', avenue: 'avenue', cres: 'crescent', cr: 'crescent', crescent: 'crescent',
  ct: 'court', crt: 'court', court: 'court', dr: 'drive', drv: 'drive', drive: 'drive',
  hwy: 'highway', highway: 'highway', blvd: 'boulevard', bvd: 'boulevard', boulevard: 'boulevard',
  pl: 'place', place: 'place', ln: 'lane', lane: 'lane', cl: 'close', close: 'close', cct: 'circuit', circuit: 'circuit',
  esp: 'esplanade', esplanade: 'esplanade', gr: 'grove', grove: 'grove', mt: 'mount', mount: 'mount',
  nth: 'north', north: 'north', sth: 'south', south: 'south', gdns: 'gardens', gardens: 'gardens', ctr: 'centre', centre: 'centre',
  wy: 'way', way: 'way', trk: 'track', track: 'track', rdge: 'ridge', ridge: 'ridge', pwy: 'parkway', parkway: 'parkway',
};

/** Words that introduce a unit number. */
const FLAT_WORDS = 'unit|flat|apt|apartment|shop|suite|villa|u';

/** Lower-case words of `text`: apostrophes dropped, other punctuation and "&" are separators. */
export function words(text) {
  return String(text ?? '').toLowerCase().replace(/['’]/g, '').split(/[^a-z0-9]+/).filter(Boolean);
}

/** The folded form of a word (see ABBREVIATIONS). */
export const fold = (w) => ABBREVIATIONS[w] ?? w;

/** Street types and compass words: matching only these says nothing about which street is meant. */
const TYPE_WORDS = new Set(['street', 'road', 'parade', 'terrace', 'avenue', 'crescent', 'court', 'drive', 'highway', 'boulevard',
  'place', 'lane', 'close', 'circuit', 'esplanade', 'grove', 'gardens', 'way', 'track', 'parkway', 'north', 'south']);

const POSTCODE = /^5\d{3}$/;

/** A house number token "12", "12a" or "12-14" -> { n: 12, suffix: 'a', last: 14 } (last null when not a range). */
function numberOf(first, last = null) {
  const m = /^(\d+)([a-z]?)$/.exec(first);
  return { n: +m[1], suffix: m[2], last: last ? +/^\d+/.exec(last)[0] : null, text: last ? `${first}-${last}` : first };
}

/**
 * Split a query into { number, flat, lot, rest }:
 *   "unit 3/5 ocean st"  -> flat '3', number 5, rest ['ocean','st']
 *   "12a bay rd encounter bay 5211" -> number 12 'a', rest ['bay','rd','encounter','bay']
 *   "bay rd" -> number null
 */
export function parseQuery(q) {
  let s = String(q ?? '').toLowerCase().replace(/[,;]/g, ' ').replace(/\s+/g, ' ').trim();
  let number = null, flat = null, lot = null, m;
  if ((m = new RegExp(`^(?:(?:${FLAT_WORDS})\\s*)?(\\d+[a-z]?)\\s*/\\s*(\\d+[a-z]?)(?:\\s*-\\s*(\\d+[a-z]?))?(?=\\s|$)`).exec(s))) {
    flat = m[1]; number = numberOf(m[2], m[3]);
  } else if ((m = new RegExp(`^(?:${FLAT_WORDS})\\s*(\\d+[a-z]?)\\s+(\\d+[a-z]?)(?:\\s*-\\s*(\\d+[a-z]?))?(?=\\s|$)`).exec(s))) {
    flat = m[1]; number = numberOf(m[2], m[3]);
  } else if ((m = /^lot\s*(\d+)(?=\s|$)/.exec(s))) {
    lot = m[1];
  } else if ((m = /^(\d+[a-z]?)(?:\s*-\s*(\d+[a-z]?))?(?=\s|$)/.exec(s))) {
    number = numberOf(m[1], m[2]);
  }
  let rest = m ? s.slice(m[0].length) : s;
  if (!m && (m = /\s(\d+[a-z]?)$/.exec(s)) && !POSTCODE.test(m[1])) {   // "bay rd 12"
    number = numberOf(m[1]);
    rest = s.slice(0, m.index);
  }
  rest = words(rest).filter((w) => !POSTCODE.test(w) && w !== 'sa');
  return { number, flat, lot, rest };
}

/** "3" and "Shop 3" and "unit 3" -> '3': the part of a flat label that identifies it. */
const flatKey = (f) => words(f).filter((w) => !/^(unit|flat|apt|apartment|shop|suite|villa|u)$/.test(w)).join('');

/** Loaded, searchable address index. Build from the parsed addresses.json document. */
export class AddressIndex {
  constructor(doc) {
    this.attribution = doc.attribution || '';
    this.counts = doc.counts || null;
    this.localities = doc.loc.map((name) => ({ name, keys: words(name).map(fold) }));
    this.streets = doc.streets.map(([name, loc, lon, lat, rows]) => ({
      name, loc, lon, lat, keys: words(name).map(fold),
      addresses: rows.map(([num, dx, dy, flat = '']) => {
        const m = /^(\d+)([A-Za-z]?)(?:-(\d+)([A-Za-z]?))?$/.exec(num);
        return { num, flat, lon: +(lon + dx * 1e-5).toFixed(6), lat: +(lat + dy * 1e-5).toFixed(6),
          first: m ? +m[1] : null, suf: m ? m[2].toLowerCase() : '', last: m && m[3] ? +m[3] : null,
          flatKey: flatKey(flat) };
      }),
    }));
  }

  /** Streets whose name (and, if mentioned, locality) cover the words, best first: [{ street, score }]. */
  streetMatches(rest) {
    if (!rest.length) return [];
    const q = rest.map((raw) => [fold(raw), raw]);   // folded form (exact matches) and as typed (prefixes: "cr" for Crozier)
    const out = [];
    for (const street of this.streets) {
      const loc = this.localities[street.loc];
      const usedS = new Set(), usedL = new Set();
      let score = 0, streetHits = 0, ok = true;
      for (const [w, raw] of q) {
        const take = (keys, used) => {
          let best = -1, exact = false;
          keys.forEach((k, i) => { if (used.has(i) || !(k.startsWith(w) || k.startsWith(raw))) return; if (k === w) { if (!exact) { best = i; exact = true; } } else if (best < 0) best = i; });
          if (best >= 0) used.add(best);
          return best >= 0 ? (exact ? 2 : 1) : 0;
        };
        const s = take(street.keys, usedS);
        if (s) { score += s === 2 ? 3 : 1.5; if (!TYPE_WORDS.has(w) || street.keys.some((k) => !TYPE_WORDS.has(k) && k.startsWith(raw))) streetHits++; continue; }
        const l = take(loc.keys, usedL);
        if (l) { score += l === 2 ? 1.2 : 0.6; continue; }
        ok = false; break;
      }
      if (!ok || !streetHits) continue;
      score += (usedS.size / street.keys.length) * 3 - street.keys.length * 0.1 + Math.min(street.addresses.length, 200) / 2000;
      out.push({ street, score });
    }
    return out.sort((a, b) => b.score - a.score);
  }

  /**
   * Suggestions for what has been typed, best first. Each is
   * { kind: 'address' | 'street' | 'nearby', label, name, lon, lat, note? }:
   *  address  an address on file (a building with several units is one suggestion unless a unit was typed);
   *  nearby   the typed number isn't on file; the closest number on that street;
   *  street   the street only (no number typed): a point on the street, to be adjusted.
   */
  search(query, { limit = 8 } = {}) {
    const { number, flat, lot, rest } = parseQuery(query);
    const matches = this.streetMatches(rest);
    const best = matches.length ? matches[0].score : 0;
    const out = [], nearby = [];
    for (const { street, score } of matches.slice(0, 12)) {
      if (out.length >= limit || score < best - 3) break;
      const loc = this.localities[street.loc].name;
      if (!number && !lot) {
        out.push({ kind: 'street', label: `${street.name}, ${loc}`, name: street.name, lon: street.lon, lat: street.lat,
          note: 'A point on the street. Move the pin to your house if you can.' });
        continue;
      }
      const found = lot ? lotMatches(street, lot) : numberMatches(street, number);
      if (!found.length) {
        if (lot) {   // no sensible "nearest" for a lot: a point on the street
          out.push({ kind: 'street', label: `${street.name}, ${loc}`, name: street.name, lon: street.lon, lat: street.lat,
            note: `Lot ${lot} isn't on file; this is a point on the street. Move the pin if it is wrong.` });
          continue;
        }
        const near = score >= best - 1.5 ? nearest(street, number) : null;   // only for the best-matching streets
        if (near) nearby.push(describe(near, street, loc, null, { kind: 'nearby',
          note: `No ${number.text} on file for ${street.name}; this is the nearest number. Move the pin if it is wrong.` }));
        continue;
      }
      let rows = found;
      let note = null, unitMatched = false;
      if (flat) {
        const key = flatKey(flat);
        const withFlat = found.filter((a) => a.flatKey === key);
        if (withFlat.length) { rows = withFlat; unitMatched = true; }
        else {
          rows = collapse(found);
          note = `Unit ${flat} isn't on file here; this is the building.`;
        }
      } else {
        rows = collapse(found);
      }
      for (const a of rows.slice(0, 5)) {
        let n = note;
        if (!flat) {
          const units = found.filter((x) => x.num === a.num && x.flat).length;   // units in this building only
          if (units > 1) n = `${units} units at this address. Type your unit first, like 3/${a.num}.`;
        }
        out.push(describe(a, street, loc, unitMatched ? a.flat : null, { kind: 'address', note: n }));
      }
    }
    return [...out, ...nearby].slice(0, limit);   // exact matches on any street come before a guess
  }
}

/** One suggestion for an address row. */
function describe(a, street, loc, flat, extra) {
  const f = flat ?? '';
  const prefix = f ? (/^\d/.test(f) ? `${f}/` : `${f}, `) : '';
  const name = `${prefix}${a.num ? `${a.num} ` : ''}${street.name}`;
  return { kind: 'address', label: `${name}, ${loc}`, name, lon: a.lon, lat: a.lat, ...extra };
}

/** Addresses on `street` for the typed number: exact, else same number with another suffix, else inside a range. */
function numberMatches(street, number) {
  const tiers = [[], [], []];
  for (const a of street.addresses) {
    if (a.first === null) continue;
    if (a.first === number.n && a.suf === number.suffix && (number.last === null || a.last === number.last)) tiers[0].push(a);
    else if (a.first === number.n) tiers[number.suffix === '' ? 1 : 2].push(a);
    else if (a.last !== null && number.suffix === '' && number.n > a.first && number.n <= a.last) tiers[2].push(a);
  }
  return tiers.find((t) => t.length) || [];
}

function lotMatches(street, lot) {
  return street.addresses.filter((a) => a.num.toLowerCase() === `lot ${lot}`);
}

/** The address on `street` with the number closest to the one typed (same side of the road first). */
function nearest(street, number) {
  const numbered = street.addresses.filter((a) => a.first !== null);
  if (!numbered.length) return null;
  if (!number) return numbered[0];
  const d = (a) => Math.abs(a.first - number.n) + ((a.first - number.n) % 2 ? 1000 : 0);   // same side of the road first
  return numbered.reduce((b, a) => (d(a) < d(b) ? a : b));
}

/** One row per building: the one with no unit if there is one. */
function collapse(rows) {
  const seen = new Map();
  for (const a of rows) {
    const k = a.num;
    if (!seen.has(k) || (!a.flat && seen.get(k).flat)) seen.set(k, a);
  }
  return [...seen.values()];
}

/** Download and parse the index. The only network request address search ever makes: a static file fetch. */
export async function loadAddressIndex(url, fetchFn = (...a) => fetch(...a)) {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`address list: HTTP ${res.status}`);
  return new AddressIndex(await res.json());
}
