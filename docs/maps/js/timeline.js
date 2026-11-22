// Timeline: scrubber over the day (one step per data interval), play/pause, speed, network-delay chart,
// bookmark markers and a bookmark list.
import { clock, clockRange, escapeHtml } from './format.js';
import { stepBookmark } from './bookmarks.js';

export class Timeline {
  constructor(el, { onChange }) {
    this.el = el;
    this.onChange = onChange;
    this.i = 0;
    this.T = 1;
    this.groups = [];
    this.timer = null;
    el.innerHTML = `
      <div class="tl-row">
        <button class="btn tl-play" aria-label="Play">Play</button>
        <label class="sr-only" for="tl-speed">Playback speed</label>
        <select id="tl-speed" class="btn tl-speed" title="Playback speed">
          <option value="1">1 step/s</option><option value="2" selected>2 steps/s</option><option value="4">4 steps/s</option>
        </select>
        <button class="btn tl-prev" aria-label="Previous bookmark" title="Previous bookmark ([)">&#8676;</button>
        <button class="btn tl-next" aria-label="Next bookmark" title="Next bookmark (])">&#8677;</button>
        <div class="tl-time"></div>
        <div class="tl-legend"></div>
      </div>
      <div class="tl-chart">
        <svg aria-hidden="true" preserveAspectRatio="none"></svg>
        <div class="tl-markers"></div>
        <input class="tl-range" type="range" min="0" max="1" step="1" value="0" aria-label="Time of day">
      </div>
      <div class="tl-caption">Network delay (vehicle-hours lost per 15 minutes). Markers are bookmarks: circle = detected automatically, square = scenario event, diamond = largest difference between A and B.</div>
      <div class="tl-bookmarks" role="list" aria-label="Bookmarks"></div>`;
    this.$ = (s) => el.querySelector(s);
    this.$('.tl-range').addEventListener('input', (e) => this.set(+e.target.value, true));
    this.$('.tl-play').addEventListener('click', () => this.toggle());
    this.$('.tl-speed').addEventListener('change', () => { if (this.timer) { this.stop(); this.play(); } });
    this.$('.tl-prev').addEventListener('click', () => this.set(stepBookmark(this.groups, this.i, -1), true));
    this.$('.tl-next').addEventListener('click', () => this.set(stepBookmark(this.groups, this.i, 1), true));
    new ResizeObserver(() => this.drawChart()).observe(this.$('.tl-chart'));
  }

  setData({ T, begin, dt, seriesA, seriesB, groups, labelA = 'A', labelB = 'B' }) {
    Object.assign(this, { T, begin, dt, seriesA, seriesB, groups });
    const r = this.$('.tl-range');
    r.max = String(T - 1);
    this.i = Math.min(this.i, T - 1);
    this.$('.tl-legend').innerHTML = seriesB
      ? `<span><i></i>${escapeHtml(labelA)}</span><span><i class="b"></i>${escapeHtml(labelB)}</span>` : '';
    this.drawChart();
    this.drawBookmarks();
    this.show();
  }

  drawChart() {
    if (!this.seriesA) return;
    const svg = this.$('.tl-chart svg');
    const w = svg.clientWidth || 600, h = svg.clientHeight || 70;
    const pad = 8, T = this.T;
    const max = Math.max(0.1, ...this.seriesA.map((x) => x ?? 0), ...(this.seriesB || []).map((x) => x ?? 0));
    const x = (i) => ((i + 0.5) / T) * w;
    const y = (v) => h - pad - ((v ?? 0) / max) * (h - 2 * pad - 6);
    const path = (s) => s.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
    const hours = [];
    for (let t = Math.ceil(this.begin / 10800) * 10800; t < this.begin + T * this.dt; t += 10800) {
      const i = (t - this.begin) / this.dt;
      hours.push(`<line x1="${x(i - 0.5)}" x2="${x(i - 0.5)}" y1="0" y2="${h - pad}" stroke="var(--line)"/>` +
        `<text x="${x(i - 0.5) + 3}" y="10" font-size="10" fill="var(--muted)">${clock(t).replace(':00', '')}</text>`);
    }
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.innerHTML = `${hours.join('')}
      <line x1="0" x2="${w}" y1="${h - pad}" y2="${h - pad}" stroke="var(--axis)"/>
      <path d="${path(this.seriesA)}L${x(T - 1)},${h - pad}L${x(0)},${h - pad}Z" fill="var(--a)" opacity="0.12"/>
      <path d="${path(this.seriesA)}" fill="none" stroke="var(--a)" stroke-width="2"/>
      ${this.seriesB ? `<path d="${path(this.seriesB)}" fill="none" stroke="var(--b)" stroke-width="2" stroke-dasharray="5 3"/>` : ''}
      <line class="tl-now" x1="${x(this.i)}" x2="${x(this.i)}" y1="0" y2="${h - pad}" stroke="var(--ink)" stroke-width="1.5"/>`;
    this.xOf = x;
    this.positionMarkers();
  }

  drawBookmarks() {
    const box = this.$('.tl-markers');
    box.innerHTML = '';
    const list = this.$('.tl-bookmarks');
    list.innerHTML = '';
    for (const g of this.groups) {
      const label = `${clock(g.t)}: ${g.items.map((b) => b.label).join('; ')}`;
      const kind = g.kinds.includes('compare') ? 'compare' : g.kinds.includes('scenario') ? 'scenario' : 'auto';
      const m = document.createElement('button');
      m.className = `tl-marker ${kind}`;
      m.dataset.i = g.i;
      m.title = label;
      m.setAttribute('aria-label', `Bookmark ${label}`);
      m.addEventListener('click', () => this.set(g.i, true));
      box.appendChild(m);
      for (const b of g.items) {
        const c = document.createElement('button');
        c.className = 'chip';
        c.setAttribute('role', 'listitem');
        c.dataset.i = g.i;
        c.innerHTML = `<span class="k ${b.kind}"></span>${escapeHtml(b.label)}`;
        c.addEventListener('click', () => this.set(g.i, true));
        list.appendChild(c);
      }
    }
    this.positionMarkers();
  }

  positionMarkers() {
    if (!this.xOf) return;
    for (const m of this.$('.tl-markers').children) m.style.left = `${this.xOf(+m.dataset.i)}px`;
  }

  set(i, fromUser = false) {
    i = Math.max(0, Math.min(this.T - 1, i | 0));
    const changed = i !== this.i;
    this.i = i;
    this.show();
    if (fromUser && this.timer && changed) this.stop();
    if (changed || fromUser) this.onChange?.(i);
  }

  show() {
    const t = this.begin + this.i * this.dt;
    this.$('.tl-range').value = String(this.i);
    this.$('.tl-range').setAttribute('aria-valuetext', clockRange(t, t + this.dt));
    this.$('.tl-time').textContent = clockRange(t, t + this.dt);
    const now = this.$('.tl-now');
    if (now && this.xOf) { now.setAttribute('x1', this.xOf(this.i)); now.setAttribute('x2', this.xOf(this.i)); }
    for (const c of this.$('.tl-bookmarks').children) c.setAttribute('aria-current', String(+c.dataset.i === this.i));
  }

  toggle() { if (this.timer) this.stop(); else this.play(); }

  play() {
    const b = this.$('.tl-play');
    b.textContent = 'Pause'; b.setAttribute('aria-label', 'Pause');
    if (this.i >= this.T - 1) this.set(0);
    const rate = +this.$('.tl-speed').value;
    this.timer = setInterval(() => {
      if (this.i >= this.T - 1) { this.stop(); return; }
      this.set(this.i + 1);
    }, 1000 / rate);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    const b = this.$('.tl-play');
    b.textContent = 'Play'; b.setAttribute('aria-label', 'Play');
  }
}

/** Inline SVG sparkline of one or two day series with a marker at interval i. */
export function sparkline(seriesList, i, { width = 260, height = 56, colours = ['var(--a)', 'var(--b)'], max = null } = {}) {
  const T = Math.max(...seriesList.map((s) => s.length));
  const vals = seriesList.flat().filter((v) => Number.isFinite(v));
  const top = max ?? Math.max(1e-9, ...vals);
  const x = (k) => ((k + 0.5) / T) * width;
  const y = (v) => height - 4 - (Math.min(v, top) / top) * (height - 10);
  const paths = seriesList.map((s, n) => {
    let d = '', pen = false;
    s.forEach((v, k) => {
      if (!Number.isFinite(v)) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${x(k).toFixed(1)},${y(v).toFixed(1)}`; pen = true;
    });
    return `<path d="${d}" fill="none" stroke="${colours[n]}" stroke-width="2"${n ? ' stroke-dasharray="4 2"' : ''}/>`;
  });
  return `<svg class="spark" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Values over the day">
    <line x1="0" x2="${width}" y1="${height - 4}" y2="${height - 4}" stroke="var(--axis)"/>
    ${paths.join('')}
    <line x1="${x(i)}" x2="${x(i)}" y1="0" y2="${height - 4}" stroke="var(--ink)" stroke-width="1"/></svg>`;
}
