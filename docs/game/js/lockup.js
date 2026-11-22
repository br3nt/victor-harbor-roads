// The lock-up on the hill: the grand old house north of the town centre, dressed up as a storybook police lock-up
// (turrets, a flag, a sweeping searchlight, a gatehouse), the paddy-wagon ride when you're busted, and Kev's
// custody deliveries. The in-game name is made up; nothing here refers to the real building or its owners.
'use strict';
(function (VH) {
  const U = VH.U, W = VH.World, SP = VH.Sprites, FX = VH.FX;
  const sfx = (n, o) => window.SFX && SFX.play(n, o);
  const G = () => VH.Game;
  const LK = VH.Lockup = { NAME: 'THE BIG HOUSE ON THE HILL', SHORT: 'LOCK-UP', b: null, gateOpen: 0, gateWant: 0, ride: null };
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  LK.init = function () {
    // only the footprint is used: the big old house on the rise behind the town (falls back to the nearest building)
    const c0 = { x: 4698, y: 1816 };
    LK.b = W.buildings.find(b => b.n === 'Mount Breckan') || W.buildings.slice().sort((a, b) => dist({ x: a.cx, y: a.cy }, c0) - dist({ x: b.cx, y: b.cy }, c0))[0];
    const b = LK.b; const p = b.p;
    LK.centre = { x: b.cx, y: b.cy };
    LK.off = Math.max(0.75, b.h * 0.3); LK.lift = 2.6; // extra storey of stone above the baked roof
    // turrets on the four outermost corners
    let ix = [0, 0, 0, 0];
    for (let i = 0; i < p.length; i += 2) { if (p[i] < p[ix[0]]) ix[0] = i; if (p[i] > p[ix[1]]) ix[1] = i; if (p[i + 1] < p[ix[2] + 1]) ix[2] = i; if (p[i + 1] > p[ix[3] + 1]) ix[3] = i; }
    LK.turrets = [...new Set(ix)].map(i => ({ x: p[i], y: p[i + 1] }));
    // the keep (flag and searchlight) sits on the vertex nearest the middle, so it reads as part of the house
    let best = 0, bd = 1e9; for (let i = 0; i < p.length; i += 2) { const d = Math.hypot(p[i] - b.cx, p[i + 1] - b.cy); if (d < bd) { bd = d; best = i; } }
    LK.keep = { x: U.lerp(p[best], b.cx, 0.5), y: U.lerp(p[best + 1], b.cy, 0.5) };
    const road = (x, y) => { const n = W.nearestEdge(x, y, 80); return n ? { x: n.x, y: n.y, a: n.ang, w: n.e.w } : { x, y, a: 0, w: 5 }; };
    LK.gate = road(4758, 1750);     // where the driveway leaves the street
    LK.door = road(4672, 1822);     // the end of the driveway by the front steps
    LK.release = road(4792, 1747);  // just outside the gate
  };

  // ---------- drawing ----------
  function poly(ctx, p, left, top, S, dy) {
    ctx.beginPath(); for (let i = 0; i < p.length; i += 2) { const x = (p[i] - left) * S, y = (p[i + 1] - top + dy) * S; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); } ctx.closePath();
  }
  function tower(ctx, x, y, r, h, left, top, S, cols, conical) {
    const sx = (x - left) * S, sy = (y - top) * S, R = r * S;
    for (let k = 0; k <= h * S; k += 1) { ctx.fillStyle = U.shade(cols[0], 0.6 + 0.4 * k / (h * S)); ctx.beginPath(); ctx.ellipse(sx, sy - k, R, R * 0.8, 0, 0, U.TAU); ctx.fill(); }
    const ty = sy - h * S;
    if (conical) {
      ctx.fillStyle = cols[2]; ctx.beginPath(); ctx.ellipse(sx, ty, R + 1, R * 0.8 + 1, 0, 0, U.TAU); ctx.fill();
      ctx.fillStyle = U.shade(cols[2], 1.3); ctx.beginPath(); ctx.moveTo(sx - R, ty); ctx.lineTo(sx, ty - R * 1.6); ctx.lineTo(sx + 1, ty); ctx.closePath(); ctx.fill();
      ctx.fillStyle = U.shade(cols[2], 0.8); ctx.beginPath(); ctx.moveTo(sx + 1, ty); ctx.lineTo(sx, ty - R * 1.6); ctx.lineTo(sx + R, ty); ctx.closePath(); ctx.fill();
    } else {
      ctx.fillStyle = cols[1]; ctx.beginPath(); ctx.ellipse(sx, ty, R, R * 0.8, 0, 0, U.TAU); ctx.fill();
      ctx.fillStyle = cols[0]; for (let a = 0; a < U.TAU; a += U.TAU / 8) ctx.fillRect(Math.round(sx + Math.cos(a) * (R - 2)) - 2, Math.round(ty + Math.sin(a) * (R - 2) * 0.8) - 3, 4, 3);
    }
    return ty;
  }
  const STONE = ['#a39d8f', '#7c776c', '#4a4f66'];
  LK.draw = function (ctx, left, top, S, t) {
    const b = LK.b; if (!b) return; const vw = ctx.canvas.width / S, vh = ctx.canvas.height / S;
    if (b.bb[2] < left - 30 || b.bb[0] > left + vw + 30 || b.bb[3] < top - 10 || b.bb[1] > top + vh + 40) { if (dist(LK.gate, { x: left + vw / 2, y: top + vh / 2 }) > Math.max(vw, vh)) return; }
    const off = LK.off, lift = LK.lift;
    // an extra storey of dressed stone above the baked walls, then a slate roof and battlements
    for (let k = 0; k <= lift * S; k++) { ctx.fillStyle = U.shade(STONE[0], 0.62 + 0.38 * k / (lift * S)); poly(ctx, b.p, left, top, S, -off - k / S); ctx.fill(); }
    // arrow-slit windows on the new storey, lit at night
    const p = b.p, n = p.length; const night = VH.Light.lightsOn(G().hour) > 0.3;
    for (let i = 0; i < n; i += 2) {
      const j = (i + 2) % n; const L = Math.hypot(p[j] - p[i], p[j + 1] - p[i + 1]); if (L < 3) continue;
      for (let s = 1.5; s < L - 1; s += 3) { const x = p[i] + (p[j] - p[i]) * s / L, y = p[i + 1] + (p[j + 1] - p[i + 1]) * s / L; ctx.fillStyle = night && (i + s | 0) % 3 ? '#ffd890' : '#2a2a38'; ctx.fillRect(Math.round((x - left) * S) - 1, Math.round((y - top - off - lift * 0.6) * S), 2, 4); }
    }
    ctx.fillStyle = STONE[2]; poly(ctx, b.p, left, top, S, -off - lift); ctx.fill();
    ctx.strokeStyle = '#3a3e52'; ctx.lineWidth = 1; poly(ctx, b.p, left, top, S, -off - lift); ctx.stroke();
    ctx.fillStyle = STONE[0];
    for (let i = 0; i < n; i += 2) {
      const j = (i + 2) % n; const L = Math.hypot(p[j] - p[i], p[j + 1] - p[i + 1]);
      for (let s = 0.4; s < L; s += 1.6) { const x = p[i] + (p[j] - p[i]) * s / L, y = p[i + 1] + (p[j + 1] - p[i + 1]) * s / L; ctx.fillRect(Math.round((x - left) * S) - 2, Math.round((y - top - off - lift) * S) - 3, 4, 3); }
    }
    // corner turrets with pointy slate caps, and the keep with the flag
    const sorted = LK.turrets.slice().sort((a, c) => a.y - c.y);
    for (const tu of sorted) tower(ctx, tu.x, tu.y, 2.6, off + lift + 2.5, left, top, S, STONE, true);
    const ky = tower(ctx, LK.keep.x, LK.keep.y, 3.6, off + lift + 5, left, top, S, STONE, false);
    const kx = (LK.keep.x - left) * S;
    ctx.fillStyle = '#ddd'; ctx.fillRect(Math.round(kx), Math.round(ky - 22), 1, 22); // flagpole
    for (let i = 0; i < 12; i++) { const wv = Math.sin(t * 6 - i * 0.6) * 1.5; ctx.fillStyle = i < 6 ? '#1d3f8a' : '#ffd23a'; ctx.fillRect(Math.round(kx + 1 + i), Math.round(ky - 22 + wv), 1, 7); }
    ctx.fillStyle = '#c9ccd8'; ctx.fillRect(Math.round(kx) - 3, Math.round(ky) - 4, 6, 4); // searchlight housing
    // the gatehouse over the driveway, with a portcullis that rises when the wagon arrives
    const g = LK.gate; const ga = g.a + Math.PI / 2; const half = g.w / 2 + 1.6;
    const gx = (g.x - left) * S, gy = (g.y - top) * S;
    if (gx > -80 && gx < ctx.canvas.width + 80 && gy > -80 && gy < ctx.canvas.height + 80) {
      // short walls running off either side
      for (const sgn of [-1, 1]) {
        const ex = g.x + Math.cos(ga) * sgn * (half + 9), ey = g.y + Math.sin(ga) * sgn * (half + 9), sx0 = g.x + Math.cos(ga) * sgn * half, sy0 = g.y + Math.sin(ga) * sgn * half;
        for (let k = 0; k < 2.2 * S; k++) { ctx.strokeStyle = U.shade(STONE[0], 0.6 + 0.4 * k / (2.2 * S)); ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo((sx0 - left) * S, (sy0 - top) * S - k); ctx.lineTo((ex - left) * S, (ey - top) * S - k); ctx.stroke(); }
      }
      const towers = [-1, 1].map(sgn => ({ x: g.x + Math.cos(ga) * sgn * half, y: g.y + Math.sin(ga) * sgn * half }));
      towers.sort((a, c) => a.y - c.y);
      // portcullis bars across the road (shorter as it rises)
      const open = LK.gateOpen; const barH = (1 - open) * 3.2 * S;
      const ax = (towers[0].x - left) * S, ay = (towers[0].y - top) * S, bx = (towers[1].x - left) * S, by = (towers[1].y - top) * S;
      ctx.fillStyle = '#2a2a30';
      for (let i = 1; i < 10; i++) { const x = U.lerp(ax, bx, i / 10), y = U.lerp(ay, by, i / 10); ctx.fillRect(Math.round(x), Math.round(y - 3.2 * S), 1, Math.max(1, Math.round(barH))); }
      ctx.strokeStyle = STONE[1]; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(ax, ay - 3.6 * S); ctx.lineTo(bx, by - 3.6 * S); ctx.stroke(); // arch
      for (const tw of towers) tower(ctx, tw.x, tw.y, 1.8, 4.2, left, top, S, STONE, false);
      U.text(ctx, LK.SHORT, (ax + bx) / 2, Math.min(ay, by) - 3.6 * S - 12, { align: 'center', color: '#ffd23a' });
    }
  };
  // searchlight sweeping the grounds, lamps on the gate, warm windows
  LK.lights = function (sources, glows, t) {
    if (!LK.b) return; const k = LK.keep, g = LK.gate;
    const a = t * 0.55; LK.beamAng = a;
    sources.push({ x: k.x, y: k.y, r: 0, col: '#eef4ff', a: 1, cone: { ang: a, len: 70 } });
    glows.push({ x: k.x, y: k.y - LK.off - LK.lift - 5, r: 1.6, col: '#ffffff', a: 1 });
    const ga = g.a + Math.PI / 2, half = g.w / 2 + 1.6;
    for (const s of [-1, 1]) { const x = g.x + Math.cos(ga) * s * half, y = g.y + Math.sin(ga) * s * half; sources.push({ x, y, r: 10, col: '#ffcf80', a: 0.9 }); glows.push({ x, y: y - 4.4, r: 1, col: '#fff1c8', a: 1 }); }
    sources.push({ x: LK.centre.x, y: LK.centre.y, r: 26, col: '#ffd890', a: 0.35 });
  };
  // a faint visible beam drawn on top, so the sweep reads even in lit streets
  LK.drawBeam = function (ctx, left, top, S, hour) {
    if (!LK.b || VH.Light.lightsOn(hour) < 0.3) return; const k = LK.keep; const sx = (k.x - left) * S, sy = (k.y - top - LK.off - LK.lift - 5) * S;
    if (sx < -400 || sy < -400 || sx > ctx.canvas.width + 400 || sy > ctx.canvas.height + 400) return;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.22; ctx.translate(sx, sy); ctx.rotate(LK.beamAng || 0);
    const len = 70 * S; ctx.drawImage(SP.cone('#dfe8ff', 128), 0, -len * 0.18, len, len * 0.36); ctx.restore();
  };

  // ---------- the paddy-wagon ride ----------
  LK.startRide = function (from) {
    const g = G(), pl = g.player;
    const n = W.nearestEdge(from.x, from.y, 80) || { x: from.x, y: from.y, ang: 0 };
    const path = VH.AI.route(n.x, n.y, LK.door.x, LK.door.y) || [];
    const pts = [n.x, n.y]; for (const q of path) { const lx = pts[pts.length - 2], ly = pts[pts.length - 1]; if (Math.hypot(q[0] - lx, q[1] - ly) > 0.5) pts.push(q[0], q[1]); }
    if (pts.length < 4) pts.push(LK.door.x, LK.door.y + 0.1);
    const p = new Float32Array(pts); const cum = U.cumLen(p); const L = cum[cum.length - 1];
    const [, , a0] = U.alongPoly(p, cum, 0);
    const v = new VH.Vehicle('paddy', n.x, n.y, a0, { colour: '#fff' }); v.scripted = true; v.siren = true; g.vehicles.push(v);
    const owned = pl.vehicle && pl.vehicle.owned ? pl.vehicle : null;
    if (pl.vehicle) { pl.vehicle.driver = null; pl.vehicle.throttle = 0; pl.vehicle.brake = 1; pl.vehicle.handbrake = 1; }
    pl.vehicle = null; pl.onFoot = true; pl.hidden = true; pl.stunT = 0;
    LK.ride = { v, route: { p, cum }, L, s: 0, sp: 0, t: 0, phase: 'load', owned, from: { x: from.x, y: from.y }, cut: L > 420 ? { at: 150, to: L - 230 } : null, fade: 0, gateSfx: false };
    g.state = 'ride'; g.stateT = 0;
    window.SFX && SFX.siren(true);
  };
  LK.skipRide = function () { const r = LK.ride; if (!r || r.phase === 'arrive') return; r.phase = 'drive'; r.cut = null; r.s = r.L; r.fade = 0; LK.gateOpen = 1; };
  LK.updateRide = function (dt) {
    const r = LK.ride; if (!r) return; const g = G(), pl = g.player, v = r.v; r.t += dt;
    if (r.phase === 'load') { if (r.t > 1.6) { r.phase = 'drive'; r.t = 0; sfx('door'); } }
    else if (r.phase === 'drive') {
      const remain = r.L - r.s; const want = remain < 30 ? Math.max(2.5, remain * 0.5) : 21;
      r.sp += U.clamp(want - r.sp, -16 * dt, 8 * dt);
      if (r.cut && !r.cut.done && r.s >= r.cut.at) { r.fade = Math.min(1, r.fade + dt * 2.5); if (r.fade >= 1) { r.cut.done = true; r.s = r.cut.to; const [x, y] = U.alongPoly(r.route.p, r.route.cum, r.s); VH.MapRender.prefetch(x, y, 90); g.cam.x = x; g.cam.y = y; } }
      else { r.s = Math.min(r.L, r.s + r.sp * dt); if (r.fade > 0) r.fade = Math.max(0, r.fade - dt * 2); }
      if (dist(v, LK.gate) < 40) { LK.gateWant = 1; if (!r.gateSfx) { r.gateSfx = true; sfx('gate'); } }
      if (r.s >= r.L - 0.3) { r.phase = 'arrive'; r.t = 0; r.sp = 0; v.siren = false; sfx('door'); }
    } else if (r.phase === 'arrive') { if (r.t > 1.4) { g.state = 'lockedUp'; g.stateT = 0; LK.gateWant = 0; window.SFX && SFX.siren(false); } }
    const [x, y, a] = U.alongPoly(r.route.p, r.route.cum, r.s);
    v.ang += U.angDiff(v.ang, a) * Math.min(1, dt * 8); v.vx = Math.cos(v.ang) * r.sp; v.vy = Math.sin(v.ang) * r.sp; v.x = x; v.y = y; v.brake = r.sp < 3 ? 1 : 0;
    pl.x = v.x; pl.y = v.y; pl.vx = v.vx; pl.vy = v.vy;
  };
  // let out at the gate after a short stay: fine paid, gossip wiped, the current job starts again
  LK.releasePlayer = function () {
    const g = G(), pl = g.player, r = LK.ride; const rp = LK.releasePt();
    if (r) { r.v.removed = true; }
    pl.hidden = false; pl.onFoot = true; pl.vehicle = null; pl.x = rp.x; pl.y = rp.y; pl.vx = pl.vy = 0; pl.ang = rp.a || 0;
    if (r && r.owned && !r.owned.removed && !r.owned.sinking) { const o = r.owned; const a = (rp.a || 0) + Math.PI / 2; o.x = rp.x + Math.cos(a) * 3; o.y = rp.y + Math.sin(a) * 3; o.vx = o.vy = 0; o.ang = rp.a || 0; o.damage = Math.min(o.damage, 0.5); o.dead = false; o.flat = false; g.toast('YOUR GOPHER WAS TOWED UP TO THE GATE', '#9fd4ec'); }
    LK.ride = null; g.cam.x = pl.x; g.cam.y = pl.y; VH.MapRender.prefetch(pl.x, pl.y, 110);
  };
  LK.releasePt = () => LK.release || LK.gate;

  // ---------- Kev: custody and deliveries ----------
  LK.capacity = v => !v ? 0 : v.type === 'paddy' ? 6 : v.type === 'police' ? 2 : 0;
  LK.kevCar = function () { const g = G(), pl = g.player; if (pl.vehicle && LK.capacity(pl.vehicle)) return pl.vehicle; return g.vehicles.find(v => v.owned && LK.capacity(v) && !v.removed && !v.sinking) || null; };
  // put a culprit in the back; returns false (and writes a ticket instead) when the car is full
  LK.arrest = function (who, x, y) {
    const g = G(); g.custody = g.custody || [];
    const car = LK.kevCar(); const cap = Math.max(LK.capacity(car), g.custody.length ? LK.capacity(car) : 2);
    if (g.custody.length >= cap) { g.cash += 5; FX.text(x, y - 4, 'NO ROOM IN THE BACK. TICKETED +$5', '#ffd23a'); return false; }
    g.custody.push(who); FX.text(x, y - 4, 'IN THE BACK (' + g.custody.length + '/' + cap + ')', '#9fd4ec'); sfx('door');
    if (g.custody.length === 1) g.toast('TAKE THEM UP THE HILL TO THE LOCK-UP FOR A BONUS', '#9fd4ec');
    return true;
  };
  LK.update = function (dt) {
    LK.gateOpen += U.clamp(LK.gateWant - LK.gateOpen, -dt * 0.8, dt * 0.8);
    const g = G(), pl = g.player; if (g.char !== 'cop' || !g.custody || !g.custody.length) return;
    const v = pl.vehicle; if (!v || !LK.capacity(v)) return;
    const near = dist(v, LK.door) < 22 || dist(v, LK.gate) < 18;
    if (near) LK.gateWant = 1;
    if (near && v.speed < 3) {
      const n = g.custody.length, pay = n * 15 + (v.type === 'paddy' ? n * 5 : 0); g.cash += pay; sfx('cash'); FX.confetti(v.x, v.y, 20);
      g.toast(`DELIVERED ${n} TO THE LOCK-UP +$${pay}`, '#9be15d'); const list = g.custody; g.custody = []; g.stats.delivered = (g.stats.delivered || 0) + n;
      VH.Missions.event('deliver', list);
    }
  };
  LK.target = () => ({ x: LK.door.x, y: LK.door.y, label: 'LOCK-UP', r: 10 });
})(window.VH);
