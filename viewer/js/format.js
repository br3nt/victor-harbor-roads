// Plain-English formatting shared by the UI. Mirrors vhsim/viewer/bookmarks.py (clock, compass).

export function clock(t) {
  t = Math.round(t);
  const day = Math.floor(t / 86400);
  const s = t - day * 86400;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s - h * 3600) / 60);
  let txt;
  if (h === 0 && m === 0) txt = 'midnight';
  else if (h === 12 && m === 0) txt = 'noon';
  else txt = `${(h % 12) || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
  return txt + (day >= 1 ? ' (next day)' : '');
}

export function clockRange(t0, t1) {
  const a = clock(t0), b = clock(t1);
  const suf = (x) => (/ (am|pm)$/.test(x) ? x.slice(-2) : null);
  if (suf(a) && suf(a) === suf(b)) return `${a.slice(0, -3)}–${b}`;
  return `${a}–${b}`;
}

export function minutes(seconds) {
  if (!Number.isFinite(seconds)) return 'no route';
  const m = seconds / 60;
  return m < 10 ? `${m.toFixed(1)} min` : `${Math.round(m)} min`;
}

export function signedMinutes(seconds) {
  if (!Number.isFinite(seconds)) return 'not comparable';
  const m = seconds / 60;
  const txt = Math.abs(m) < 10 ? Math.abs(m).toFixed(1) : String(Math.round(Math.abs(m)));
  if (txt === '0.0' || txt === '0') return 'no change';
  return `${m > 0 ? '+' : '−'}${txt} min`;
}

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

export function compass(bearing) {
  return COMPASS[Math.floor((((bearing % 360) + 360) % 360 + 22.5) / 45) % 8];
}

export function directionLabel(bearing) {
  return `${compass(bearing)}-bound`;
}

// SUMO lane index 0 is the kerb (outermost) lane in both left- and right-hand networks.
export function laneLabel(index, n) {
  if (n <= 1) return 'single lane';
  const side = index === 0 ? ' (kerb side)' : index === n - 1 ? ' (centre side)' : '';
  return `lane ${index + 1} of ${n}${side}`;
}

export function pct(x) {
  return `${Math.round(x * 100)}%`;
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// ---- year wording (this year is 2026; the model's "now" runs are built on 2025 data) ----
export const THIS_YEAR = 2026;
export const NOW_YEAR = 2025;
export const NEAR_YEAR = 2031;   // "about 5 years ahead"
export const LONG_RANGE_FROM = 2041;
const yearsAhead = (y) => Math.round((y - THIS_YEAR) / 5) * 5;
/** "Now (2025 data)" or "2031 (in about 5 years)"; any other year is placed relative to this year. */
export const yearLong = (y) => (y === NOW_YEAR ? 'Now (2025 data)' : `${y} (in about ${yearsAhead(y)} years)`);
/** Tight spaces (axis ticks, chips): "Now" or the year itself; `plus` gives "+5 yrs". */
export const yearShort = (y, { plus = false } = {}) => (y === NOW_YEAR ? 'Now' : plus ? `+${yearsAhead(y)} yrs` : String(y));
/** 2041 and 2051 are longer range and less certain than 2031. */
export const isLongRange = (y) => y >= LONG_RANGE_FROM;
