// "My trips": the resident's trips and saved places. Kept ONLY in this browser (localStorage); if storage is
// blocked or full, everything still works for this visit and nothing is saved.
import { clock } from '../../js/format.js';

export const STORAGE_KEY = 'vh-residents-v1';

export const DAY_TYPES = {
  weekday: { label: 'Weekday (school term)', condition: 'weekday_term' },
  saturday: { label: 'Saturday', condition: 'saturday' },
  summer: { label: 'Summer holidays', condition: 'summer_peak' },
};

/** Departure times every 15 minutes: [{value: seconds, label: '8:30 am'}]. */
export function timeOptions() {
  return Array.from({ length: 96 }, (_, k) => ({ value: k * 900, label: clock(k * 900) }));
}

/** localStorage behind try/catch. `getStorage` may throw or return nothing (private mode, blocked cookies). */
export function safeStorage(getStorage = () => globalThis.localStorage) {
  let st = null;
  try { st = getStorage() || null; } catch { st = null; }
  return {
    get(key) { try { return st ? st.getItem(key) : null; } catch { return null; } },
    set(key, value) { try { if (!st) return false; st.setItem(key, value); return true; } catch { return false; } },
    remove(key) { try { if (st) st.removeItem(key); return !!st; } catch { return false; } },
  };
}

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const validPlace = (p) => p && typeof p.name === 'string' && isNum(p.lon) && isNum(p.lat)
  && Math.abs(p.lon) <= 180 && Math.abs(p.lat) <= 90;

export function validTrip(t) {
  if (!t || !validPlace(t.from) || !validPlace(t.to)) return 'place';
  if (!isNum(t.time) || t.time < 0 || t.time >= 86400) return 'time';
  if (!DAY_TYPES[t.day]) return 'day';
  return null;
}

const clean = (p) => ({ name: String(p.name).slice(0, 80), lon: +p.lon, lat: +p.lat, ...(p.poi ? { poi: String(p.poi) } : {}) });
let counter = 0;
const newId = () => `t${Date.now().toString(36)}${(counter++).toString(36)}`;

export class TripStore {
  constructor(storage = safeStorage()) {
    this.storage = storage;
    this.trips = [];
    this.places = [];
    this.persisted = false;
    let doc = null;
    try { doc = JSON.parse(storage.get(STORAGE_KEY) || 'null'); } catch { doc = null; }
    if (doc && doc.version === 1) {
      this.trips = (Array.isArray(doc.trips) ? doc.trips : []).filter((t) => !validTrip(t) && typeof t.id === 'string');
      this.places = (Array.isArray(doc.places) ? doc.places : []).filter(validPlace).map(clean);
    }
  }

  save() {
    this.persisted = this.storage.set(STORAGE_KEY, JSON.stringify({ version: 1, trips: this.trips, places: this.places }));
    return this.persisted;
  }

  addTrip(t) {
    const bad = validTrip(t);
    if (bad) throw new Error(`invalid trip: ${bad}`);
    const trip = { id: newId(), from: clean(t.from), to: clean(t.to), time: Math.round(t.time), day: t.day };
    this.trips.push(trip);
    this.save();
    return trip;
  }

  updateTrip(id, patch) {
    const k = this.trips.findIndex((t) => t.id === id);
    if (k < 0) return null;
    const next = { ...this.trips[k], ...patch, id };
    const bad = validTrip(next);
    if (bad) throw new Error(`invalid trip: ${bad}`);
    this.trips[k] = { ...next, from: clean(next.from), to: clean(next.to) };
    this.save();
    return this.trips[k];
  }

  removeTrip(id) {
    this.trips = this.trips.filter((t) => t.id !== id);
    this.save();
  }

  savePlace(name, lon, lat) {
    const p = clean({ name, lon, lat });
    if (!validPlace(p)) throw new Error('invalid place');
    this.places = this.places.filter((x) => x.name !== p.name).concat([p]);
    this.save();
    return p;
  }

  removePlace(name) {
    this.places = this.places.filter((x) => x.name !== name);
    this.save();
  }

  clear() {
    this.trips = [];
    this.places = [];
    this.storage.remove(STORAGE_KEY);
    this.persisted = false;
  }
}
