// The tackle: an officer (or a resident, or Kev) brings someone down, and a short struggle decides it.
// An escape zone drifts along a bar; hold to push your marker right, let go and it slides back. Time in the zone
// fills your meter; time outside fills theirs. Every few seconds they shift their grip: a SLIP window flashes with a
// direction, and pressing that way in time is worth a big chunk (pressing wrong costs you). Your Escape Artist skill
// widens the zone; sunscreen helps; sergeants grip harder and move faster than rookies. Kev plays it in reverse.
'use strict';
(function (VH) {
  const U = VH.U, FX = VH.FX;
  const sfx = (n, o) => window.SFX && SFX.play(n, o);
  const G = () => VH.Game; const In = () => VH.Input;
  const T = VH.Tackle = { on: null };
  T.RANKS = {
    rookie: { label: 'ROOKIE CONSTABLE', speed: 0.22, grip: 0.85, slipEvery: 2.2 },
    senior: { label: 'SENIOR CONSTABLE', speed: 0.34, grip: 1.1, slipEvery: 2.8 },
    sergeant: { label: 'THE SERGEANT', speed: 0.48, grip: 1.35, slipEvery: 3.4 },
    watch: { label: 'NEIGHBOURHOOD WATCH', speed: 0.15, grip: 0.65, slipEvery: 2.0 },
    kid: { label: 'A DING DONG DITCHER', speed: 0.2, grip: 0.8, slipEvery: 2.4 },
    hoon: { label: 'THE HOON', speed: 0.32, grip: 1.0, slipEvery: 2.6 },
  };
  T.skill = () => +U.store.get('escapeSkill', 0) || 0;
  T.kevSkill = () => +U.store.get('kevGrip', 0) || 0;
  // opts: { mode: 'escape' | 'hold', rank, who, head, onWin, onLose }
  T.start = function (opts) {
    if (T.on) return false;
    const r = T.RANKS[opts.rank] || T.RANKS.senior; const g = G();
    const base = opts.mode === 'hold' ? 0.26 + Math.min(10, T.kevSkill()) * 0.012 : 0.2 + Math.min(12, T.skill()) * 0.014 + (g.sunscreen ? 0.06 : 0);
    T.on = { ...opts, r, w: U.clamp(base - (r.grip - 1) * 0.06, 0.1, 0.42), c: 0.5, cv: 0, m: 0.3, mv: 0, mine: 0, theirs: opts.startCuff || 0, t: 0, nextSlip: U.rand(1.2, r.slipEvery), slip: null, done: null, doneT: 0 };
    sfx('thud', { pitch: 0.7 }); FX.kick(0.35); FX.dust(g.player.x, g.player.y, '#c8bfa0', 8);
    g.callout(opts.mode === 'hold' ? 'TACKLED! KEEP HOLD' : 'TACKLED!', opts.mode === 'hold' ? '#9fd4ec' : '#ff6a5a');
    return true;
  };
  T.update = function (dt) {
    const k = T.on; if (!k) return; const I = In(); const g = G();
    if (k.done) { k.doneT += dt; if (k.doneT > 0.7) { const d = k.done; T.on = null; (d === 'win' ? k.onWin : k.onLose) && (d === 'win' ? k.onWin() : k.onLose()); } return; }
    k.t += dt;
    // the zone wanders, faster for tougher opponents
    k.cv = U.clamp(k.cv + U.rand(-1, 1) * dt * 4 * k.r.speed, -k.r.speed, k.r.speed); k.c += k.cv * dt;
    if (k.c < k.w / 2) { k.c = k.w / 2; k.cv = Math.abs(k.cv); } if (k.c > 1 - k.w / 2) { k.c = 1 - k.w / 2; k.cv = -Math.abs(k.cv); }
    // hold to push right, let go to slide back (Space, or the big STRUGGLE button on a phone)
    const hold = I.down('action') || I.held.struggle;
    k.mv += (hold ? 2.4 : -2.0) * dt; k.mv *= Math.exp(-1.6 * dt); k.m += k.mv * dt;
    if (k.m < 0) { k.m = 0; k.mv = Math.max(0, k.mv); } if (k.m > 1) { k.m = 1; k.mv = Math.min(0, k.mv); }
    const inZone = Math.abs(k.m - k.c) < k.w / 2;
    if (inZone) k.mine += 0.3 * dt; else k.theirs += 0.22 * k.r.grip * dt;
    // grip shifts: a short SLIP window with a direction
    k.nextSlip -= dt;
    if (!k.slip && k.nextSlip <= 0) { k.slip = { dir: Math.random() < 0.5 ? -1 : 1, t: 0.6 }; sfx('click'); }
    const L = I.consume('left'), R = I.consume('right'); let tapDir = 0;
    const tp = I.tap(); if (tp && T.panel) { if (tp.y >= T.panel.y && tp.y <= T.panel.y + T.panel.h) tapDir = tp.x < T.panel.x + T.panel.w / 2 ? -1 : 1; }
    const press = L ? -1 : R ? 1 : tapDir;
    if (k.slip) {
      k.slip.t -= dt;
      if (press) { if (press === k.slip.dir) { k.mine += 0.22; FX.text(g.player.x, g.player.y - 5, k.mode === 'hold' ? 'GOOD GRIP!' : 'SLIP!', '#9be15d'); sfx('whoosh'); } else { k.theirs += 0.08; sfx('thud', { vol: 0.4 }); } k.slip = null; k.nextSlip = U.rand(1.4, k.r.slipEvery); }
      else if (k.slip.t <= 0) { k.slip = null; k.nextSlip = U.rand(1.4, k.r.slipEvery); }
    } else if (press) k.theirs += 0.04; // flailing when nothing's on offer
    if (k.mine >= 1) { k.done = 'win'; sfx(k.mode === 'hold' ? 'clang' : 'win', { pitch: k.mode === 'hold' ? 2.2 : 1 }); }
    else if (k.theirs >= 1) { k.done = 'lose'; sfx(k.mode === 'hold' ? 'whoosh' : 'clang', { pitch: 2.2 }); }
    // experience: every scramble teaches you something
    if (k.done && k.mode === 'escape') U.store.set('escapeSkill', +(T.skill() + (k.done === 'win' ? 1 : 0.3)).toFixed(1));
    if (k.done && k.mode === 'hold') U.store.set('kevGrip', +(T.kevSkill() + (k.done === 'win' ? 1 : 0.3)).toFixed(1));
  };
  // the struggle panel and, on phones, one big hold button
  T.draw = function (ctx, ts) {
    const k = T.on; if (!k) { T.panel = null; return; } const w = ctx.canvas.width, h = ctx.canvas.height; const I = In();
    const pw = Math.min(w - 16 * ts, 240 * ts), ph = 62 * ts; const x = Math.round(w / 2 - pw / 2), y = Math.round(h * 0.52);
    T.panel = { x, y, w: pw, h: ph };
    VH.UI.panel(ctx, x, y, pw, ph, { accent: k.mode === 'hold' ? '#7fa6ff' : '#ff6a5a', fill: 'rgba(18,12,36,0.94)' });
    const head = k.mode === 'hold' ? 'KEEP HOLD OF ' + k.r.label : 'STRUGGLE FREE FROM ' + k.r.label;
    U.text(ctx, head, x + pw / 2, y + 4 * ts, { align: 'center', color: '#f4f0ff', scale: ts });
    const bx = x + 8 * ts, bw = pw - 16 * ts, by = y + 15 * ts, bh = 10 * ts;
    ctx.fillStyle = '#2a2040'; ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = k.slip ? '#ffd23a' : '#9be15d'; ctx.fillRect(Math.round(bx + (k.c - k.w / 2) * bw), by, Math.round(k.w * bw), bh);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(Math.round(bx + k.m * bw) - ts, by - 2 * ts, 2 * ts + 1, bh + 4 * ts);
    // the two meters
    const mw = (bw - 6 * ts) / 2; const my = by + bh + 6 * ts;
    ctx.fillStyle = '#2a2040'; ctx.fillRect(bx, my, mw, 5 * ts); ctx.fillRect(bx + mw + 6 * ts, my, mw, 5 * ts);
    ctx.fillStyle = '#9be15d'; ctx.fillRect(bx, my, mw * Math.min(1, k.mine), 5 * ts); ctx.fillStyle = '#ff6a5a'; ctx.fillRect(bx + mw + 6 * ts, my, mw * Math.min(1, k.theirs), 5 * ts);
    U.text(ctx, k.mode === 'hold' ? 'CUFFS ON' : 'ESCAPE', bx, my + 7 * ts, { color: '#9be15d', scale: ts }); U.text(ctx, k.mode === 'hold' ? 'SLIPPING AWAY' : 'CUFFS', bx + bw, my + 7 * ts, { color: '#ff6a5a', scale: ts, align: 'right' });
    const tip = k.slip ? (k.slip.dir < 0 ? (I.touchMode ? '[ TAP LEFT  SLIP!' : '[ LEFT  NOW!') : (I.touchMode ? 'SLIP! TAP RIGHT ]' : 'NOW!  RIGHT ]')) : (I.touchMode ? 'HOLD: KEEP THE MARK IN THE GREEN' : 'HOLD SPACE: KEEP THE MARK IN THE GREEN');
    U.text(ctx, tip, x + pw / 2, y + ph - 10 * ts, { align: 'center', color: k.slip ? '#ffd23a' : '#a99fc8', scale: ts });
    if (k.lv == null) k.lv = Math.floor(k.mode === 'hold' ? T.kevSkill() : T.skill()); const lv = (k.mode === 'hold' ? 'GRIP LV ' : 'ESCAPE ARTIST LV ') + k.lv;
    U.text(ctx, lv, x + pw - 4 * ts, y - 9 * ts, { align: 'right', color: '#7fa6ff', scale: ts });
    if (k.done) U.text(ctx, k.done === 'win' ? (k.mode === 'hold' ? 'CUFFED!' : 'BROKE FREE!') : (k.mode === 'hold' ? 'THEY WRIGGLED OFF!' : 'CUFFED.'), x + pw / 2, y - 22 * ts, { align: 'center', color: k.done === 'win' ? '#9be15d' : '#ff6a5a', scale: ts * 2 });
    if (I.touchMode) {
      // one big hold button
      const r = 26 * ts; let cx = w - r - 10 * ts, cy = Math.min(y + ph + r + 8 * ts, h - r - 6 * ts);
      if (cy - r < y + ph && cx - r < x + pw) { cx = Math.min(w - r - 4 * ts, x + pw + r + 6 * ts); cy = Math.min(y + ph / 2, h - r - 6 * ts); if (cx - r < x + pw) { cx = Math.max(r + 4 * ts, x - r - 6 * ts); } }
      const held = I.held.struggle;
      ctx.globalAlpha = held ? 0.95 : 0.7; ctx.fillStyle = '#120c24'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, U.TAU); ctx.fill(); ctx.strokeStyle = '#ff4fa0'; ctx.lineWidth = 2; ctx.stroke(); ctx.globalAlpha = 1;
      U.text(ctx, 'HOLD', cx, cy - 3 * ts, { align: 'center', color: '#ff4fa0', scale: ts });
      I.setButtons([{ id: 'struggle', x: cx - r, y: cy - r, w: r * 2, h: r * 2 }]);
    }
  };
})(window.VH);
