// Hotspot player: plays one hotspot's scenarios side by side (e.g. today | council | alternative), in sync.
// No dependencies. Data: viewer/hotspots/data/<hotspot>/<set>/<scenario>.json, written by
// `python -m vhsim.integration.hotspot_anim run` (format in that module's docstring).
//
//   import { createPlayer } from './player.js';
//   const p = await createPlayer(document.querySelector('#stage'), ['data/x/s/baseline.json', ...]);
//
// Vehicles: rectangles to scale, drawn back from their front bumper (SUMO's position), heading from their
// motion; trucks and caravans drawn half as big again with an outline. Colour by speed; stopped = red.

export const STOP = 99999;
export const KINDS = [
  { name: 'car', length: 4.6, width: 1.8, scale: 1 },
  { name: 'truck', length: 12, width: 2.5, scale: 1.5 },
  { name: 'caravan', length: 11.5, width: 2.3, scale: 1.5 },
  { name: 'bus', length: 12, width: 2.5, scale: 1.5 },
];
// km/h class edges -> colours (red = stopped; blues for moving, readable for red-green colour blindness)
export const SPEED_CLASSES = [
  { max: 2, label: 'stopped', light: '#c8102e', dark: '#ff4d5e' },
  { max: 10, label: 'crawling (under 10 km/h)', light: '#f28e2b', dark: '#ffa94d' },
  { max: 30, label: '10–30 km/h', light: '#6aaed6', dark: '#7cc0ec' },
  { max: Infinity, label: 'over 30 km/h', light: '#1f4e8c', dark: '#b8d8ff' },
];

/** Decode a delta-encoded track into flat [x0, y0, x1, y1, ...] (quantised units). */
export function decodeTrack(enc) {
  if (!enc || enc.length < 2) return new Int32Array(0);
  let n = 1;
  for (let i = 2; i < enc.length; i += 2) n += enc[i] === STOP ? enc[i + 1] : 1;
  const out = new Int32Array(n * 2);
  let x = enc[0], y = enc[1], k = 0;
  out[k++] = x; out[k++] = y;
  for (let i = 2; i < enc.length; i += 2) {
    if (enc[i] === STOP) {
      for (let r = 0; r < enc[i + 1]; r++) { out[k++] = x; out[k++] = y; }
    } else {
      x += enc[i]; y += enc[i + 1];
      out[k++] = x; out[k++] = y;
    }
  }
  return out;
}

/** Headings (degrees clockwise from north) and speeds (m/s) per sample, from the motion. */
export function motion(xy, h0, quantum, dt = 1) {
  const n = xy.length / 2;
  const head = new Float32Array(n), speed = new Float32Array(n);
  let h = h0;
  for (let i = 0; i < n; i++) {
    const j = i + 1 < n ? i + 1 : i, p = i + 1 < n ? i : Math.max(i - 1, 0);
    const dx = xy[2 * j] - xy[2 * p], dy = xy[2 * j + 1] - xy[2 * p + 1];
    const d = Math.hypot(dx, dy) * quantum;
    if (d > 0.6) h = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;  // ignore quantisation jitter
    head[i] = h;
    // speed over the step into this frame (the first frame uses the step out of it)
    const a = i > 0 ? i - 1 : 0, b = i > 0 ? i : Math.min(1, n - 1);
    speed[i] = Math.hypot(xy[2 * b] - xy[2 * a], xy[2 * b + 1] - xy[2 * a + 1]) * quantum / dt;
  }
  return { head, speed };
}

export function speedClass(ms) {
  const kmh = ms * 3.6;
  return SPEED_CLASSES.findIndex((c) => kmh < c.max);
}

/** Prepare an animation file for drawing: decode every track once. */
export function prepare(doc) {
  const tracks = doc.tracks.map((t) => {
    const xy = decodeTrack(t.p);
    const { head, speed } = motion(xy, t.h, doc.quantum, doc.dt || 1);
    return { k: t.k, f: t.f, n: xy.length / 2, xy, head, speed };
  });
  return { ...doc, tracks };
}

/** Vehicles visible at a frame: [{k, x, y, h, v}] in metres (local frame). */
export function vehiclesAt(prep, frame) {
  const out = [];
  const q = prep.quantum;
  for (const t of prep.tracks) {
    const i = frame - t.f;
    if (i < 0 || i >= t.n) continue;
    out.push({ k: t.k, x: t.xy[2 * i] * q, y: t.xy[2 * i + 1] * q, h: t.head[i], v: t.speed[i] });
  }
  return out;
}

export function clock(t0, frame) {
  const s = Math.floor(t0 + frame) % 86400;
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

/** Queue counts per approach at a frame. */
export function queuesAt(prep, frame) {
  return (prep.approaches || []).map((a, i) => ({ label: a.label, n: (prep.queues[i] || [])[frame] || 0 }));
}

// ---------------------------------------------------------------- drawing
function css(name, fallback) {
  if (typeof getComputedStyle === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}
const isDark = () => typeof matchMedia !== 'undefined' && (document.documentElement.dataset.theme === 'dark' ||
  (document.documentElement.dataset.theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches));

function drawPanel(ctx, prep, frame, size, dpr) {
  const g = prep.geometry, q = prep.quantum, half = prep.view.half;
  const s = (size / (2 * half)) * dpr;               // px per metre
  const W = size * dpr;
  const X = (x) => W / 2 + x * s, Y = (y) => W / 2 - y * s;
  const dark = isDark();
  ctx.fillStyle = css('--hs-ground', dark ? '#1d1f1c' : '#eef0ea');
  ctx.fillRect(0, 0, W, W);
  // junction areas, then lanes (internal lanes lighter so turns read as paths)
  ctx.fillStyle = css('--hs-road', dark ? '#4a4c4f' : '#c9cbcf');
  for (const p of g.junctions) {
    ctx.beginPath();
    for (let i = 0; i < p.length; i += 2) (i ? ctx.lineTo : ctx.moveTo).call(ctx, X(p[i] * q), Y(p[i + 1] * q));
    ctx.closePath(); ctx.fill();
  }
  ctx.lineCap = 'butt'; ctx.lineJoin = 'round';
  for (const internal of [1, 0]) {
    ctx.strokeStyle = css('--hs-road', dark ? '#4a4c4f' : '#c9cbcf');
    for (const ln of g.lanes) {
      if (ln[1] !== internal) continue;
      ctx.lineWidth = Math.max(ln[0] * s * (internal ? 0.9 : 1), 1.5 * dpr);
      ctx.beginPath();
      for (let i = 2; i < ln.length; i += 2) (i > 2 ? ctx.lineTo : ctx.moveTo).call(ctx, X(ln[i] * q), Y(ln[i + 1] * q));
      ctx.stroke();
    }
  }
  // lane centre dashes for direction separation at larger scales
  if (s > 2.2 * dpr) {
    ctx.strokeStyle = css('--hs-lane-mark', dark ? '#6b6e72' : '#f7f7f5');
    ctx.lineWidth = Math.max(0.15 * s, dpr * 0.6);
    ctx.setLineDash([3 * s, 6 * s]);
    for (const ln of g.lanes) {
      if (ln[1]) continue;
      ctx.beginPath();
      for (let i = 2; i < ln.length; i += 2) (i > 2 ? ctx.lineTo : ctx.moveTo).call(ctx, X(ln[i] * q), Y(ln[i + 1] * q));
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
  // vehicles
  const vs = vehiclesAt(prep, Math.floor(frame));
  vs.sort((a, b) => a.k - b.k);
  for (const v of vs) {
    const kind = KINDS[v.k] || KINDS[0];
    const c = SPEED_CLASSES[speedClass(v.v)];
    // to scale, but never thinner than 3 px or shorter than 5 px so single cars stay visible at overview zoom
    const L = Math.max(kind.length * s * kind.scale, (v.k ? 9 : 5) * dpr), Wd = Math.max(kind.width * s * kind.scale, (v.k ? 4 : 3) * dpr);
    ctx.save();
    ctx.translate(X(v.x), Y(v.y));
    ctx.rotate(((v.h - 90) * Math.PI) / 180);
    ctx.fillStyle = dark ? c.dark : c.light;
    ctx.fillRect(-L, -Wd / 2, L, Wd);
    if (v.k) {
      ctx.lineWidth = 1.2 * dpr;
      ctx.strokeStyle = dark ? '#f0efec' : '#111';
      ctx.strokeRect(-L, -Wd / 2, L, Wd);
    }
    ctx.restore();
  }
  // queue bubbles, then labels placed clear of the bubbles and of each other (places first), then bubbles drawn
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const ink = css('--ink', dark ? '#f0efec' : '#0b0b0b'), halo = css('--hs-ground', dark ? '#1d1f1c' : '#eef0ea');
  const r = 10 * dpr;
  const bubbles = (prep.approaches || []).map((a) => ({ x: X(a.xy[0] * q), y: Y(a.xy[1] * q) }));
  const taken = bubbles.map((b) => [b.x - r, b.y - r, b.x + r, b.y + r]);
  const hits = (bx) => taken.some((t) => bx[0] < t[2] && bx[2] > t[0] && bx[1] < t[3] && bx[3] > t[1]);
  ctx.font = `600 ${11 * dpr}px system-ui, sans-serif`;
  for (const [t, lx, ly] of [...(g.labels || [])].reverse()) {
    const w = ctx.measureText(t).width / 2 + 3 * dpr, h = 8 * dpr;
    for (const dy of [0, -16 * dpr, 16 * dpr]) {
      const x = X(lx * q), y = Y(ly * q) + dy, bx = [x - w, y - h, x + w, y + h];
      if (hits(bx)) continue;
      taken.push(bx);
      ctx.lineWidth = 3 * dpr; ctx.strokeStyle = halo; ctx.strokeText(t, x, y);
      ctx.fillStyle = ink; ctx.fillText(t, x, y);
      break;
    }
  }
  const qs = queuesAt(prep, Math.floor(frame));
  bubbles.forEach(({ x, y }, i) => {
    const n = qs[i].n;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI);
    ctx.fillStyle = n > 0 ? (dark ? '#ff4d5e' : '#c8102e') : (dark ? '#3a3c3f' : '#ffffff');
    ctx.fill(); ctx.lineWidth = 1.5 * dpr; ctx.strokeStyle = dark ? '#f0efec' : '#111'; ctx.stroke();
    ctx.font = `700 ${11 * dpr}px system-ui, sans-serif`;
    ctx.fillStyle = n > 0 ? '#fff' : ink; ctx.fillText(String(n), x, y + 0.5 * dpr);
  });
  // scale bar (50 m)
  const bar = 50 * s;
  ctx.fillStyle = ink; ctx.fillRect(10 * dpr, W - 14 * dpr, bar, 2 * dpr);
  ctx.font = `${10 * dpr}px system-ui, sans-serif`; ctx.textAlign = 'left';
  ctx.fillText('50 m', 10 * dpr + bar + 4 * dpr, W - 13 * dpr);
}

/**
 * Build the player inside `root` for the given animation files (same hotspot and window).
 * Returns { play, pause, setSpeed, seek, state }.
 */
export async function createPlayer(root, files, { fetchJSON = (u) => fetch(u).then((r) => r.json()) } = {}) {
  const docs = await Promise.all(files.map(fetchJSON));
  const preps = docs.map(prepare);
  const t0 = preps[0].t0;
  // panels must show the same simulated minutes (files regenerated separately could drift apart)
  const off = preps.find((p) => p.t0 !== t0 || p.frames !== preps[0].frames);
  if (off) throw new Error(`animation files are not for the same window: ${off.scenario} starts at ${off.t0}, ${preps[0].scenario} at ${t0}`);
  const frames = preps[0].frames;
  root.classList.add('hs-player');
  root.innerHTML = `
    <div class="hs-controls" role="group" aria-label="Playback">
      <button type="button" class="hs-play" aria-label="Play">▶ Play</button>
      <span class="hs-speeds" role="radiogroup" aria-label="Speed">
        ${[1, 4, 16].map((m) => `<button type="button" role="radio" data-speed="${m}" aria-checked="${m === 4}">${m}×</button>`).join('')}
      </span>
      <output class="hs-clock" aria-live="off">${clock(t0, 0)}</output>
      <input class="hs-scrub" type="range" min="0" max="${frames - 1}" value="0" step="1" aria-label="Time in the 15 minutes shown">
      <span class="hs-period"></span>
    </div>
    <div class="hs-panels"></div>
    <div class="hs-legend"></div>`;
  root.querySelector('.hs-period').textContent = `${preps[0].period_label}, ${preps[0].window.start}–${preps[0].window.end}, seed ${preps[0].seed}`;
  const panels = root.querySelector('.hs-panels');
  const views = preps.map((p) => {
    const el = document.createElement('figure');
    el.className = 'hs-panel';
    el.innerHTML = `<figcaption><strong></strong><span class="hs-day"></span></figcaption><canvas></canvas><ul class="hs-queues" aria-label="Vehicles queued per approach"></ul>`;
    el.querySelector('strong').textContent = p.label;
    el.querySelector('.hs-day').textContent = p.day && p.day.stopped_veh_h != null
      ? ` · whole day here: ${p.day.stopped_veh_h.toFixed(1)} vehicle-hours stopped${p.day.seeds > 1 ? ` (mean of ${p.day.seeds} runs)` : ''}` : '';
    el.title = p.description;
    panels.appendChild(el);
    return { el, canvas: el.querySelector('canvas'), list: el.querySelector('.hs-queues'), prep: p };
  });
  root.querySelector('.hs-legend').innerHTML =
    SPEED_CLASSES.map((c) => `<span><i style="background:${isDark() ? c.dark : c.light}"></i>${c.label}</span>`).join('') +
    '<span><i class="hs-big"></i>truck or caravan (drawn 1.5× size)</span><span><b class="hs-bubble">3</b>vehicles standing still on that approach now (within the picture)</span>';

  const state = { frame: 0, speed: 4, playing: false };
  const playBtn = root.querySelector('.hs-play'), clk = root.querySelector('.hs-clock'), scrub = root.querySelector('.hs-scrub');
  let size = 300;
  function layout() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = panels.clientWidth, gap = 12;
    const cols = w >= 640 ? views.length : 1;
    panels.style.display = 'grid';
    panels.style.gap = `${gap}px`;
    panels.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
    size = Math.max(160, Math.floor(Math.min((w - gap * (cols - 1)) / cols, 560)));
    for (const v of views) {
      v.canvas.width = size * dpr; v.canvas.height = size * dpr;
      v.canvas.style.width = `${size}px`; v.canvas.style.height = `${size}px`;
    }
    draw();
  }
  function draw() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const f = Math.min(Math.floor(state.frame), frames - 1);
    for (const v of views) {
      drawPanel(v.canvas.getContext('2d'), v.prep, f, size, dpr);
      v.list.innerHTML = queuesAt(v.prep, f).map((q) => `<li><b>${q.n}</b> ${q.label}</li>`).join('');
    }
    clk.textContent = clock(t0, f);
    scrub.value = String(f);
  }
  let last = null;
  function tick(ts) {
    if (!state.playing) { last = null; return; }
    if (last !== null) state.frame += ((ts - last) / 1000) * state.speed;
    last = ts;
    if (state.frame >= frames - 1) { state.frame = frames - 1; pause(); }
    draw();
    if (state.playing) requestAnimationFrame(tick);
  }
  function play() {
    if (state.frame >= frames - 1) state.frame = 0;
    state.playing = true; playBtn.textContent = '❚❚ Pause'; playBtn.setAttribute('aria-label', 'Pause');
    requestAnimationFrame(tick);
  }
  function pause() { state.playing = false; playBtn.textContent = '▶ Play'; playBtn.setAttribute('aria-label', 'Play'); }
  function setSpeed(m) {
    state.speed = m;
    root.querySelectorAll('[data-speed]').forEach((b) => b.setAttribute('aria-checked', String(+b.dataset.speed === m)));
  }
  function seek(f) { state.frame = Math.max(0, Math.min(frames - 1, f)); draw(); }
  playBtn.addEventListener('click', () => (state.playing ? pause() : play()));
  root.querySelectorAll('[data-speed]').forEach((b) => b.addEventListener('click', () => setSpeed(+b.dataset.speed)));
  scrub.addEventListener('input', () => seek(+scrub.value));
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(layout).observe(panels);
  if (typeof matchMedia !== 'undefined') matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', draw);
  layout();
  return { play, pause, setSpeed, seek, state, frames, docs: preps };
}
