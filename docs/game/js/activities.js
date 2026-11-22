// Things to do between jobs: a mayhem combo score and Mayhem Minute challenges, drift scores on roundabouts,
// stunt ramps with airtime, races (gopher grand prix, foreshore bike race, tram and steam-train time trials),
// lost thongs to find, a couple of easter eggs, and clean getaways from the police. Bests live in localStorage.
'use strict';
(function (VH) {
  const U = VH.U, W = VH.World, SP = VH.Sprites, FX = VH.FX, PK = SP.PK;
  const sfx = (n, o) => window.SFX && SFX.play(n, o);
  const G = () => VH.Game;
  const A = VH.Acts = { mayhem: 0, combo: 1, comboT: 0, minute: null, drift: null, race: null, ramps: [], races: [], minutes: [], thongs: [], penguin: null };
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const store = (k, d) => U.store.get('act:' + k, d), save = (k, v) => U.store.set('act:' + k, v);
  const pv = () => { const pl = G().player; return pl.onFoot ? null : pl.vehicle; };

  // ---------- setup: places come from the map, so they sit on real paths, lawns and beaches ----------
  A.init = function () {
    const P = G().places;
    const ok = (x, y) => { const g = W.groundAt(x, y); return g !== W.GC.BUILDING && g !== W.GC.SEA && g !== W.GC.WATER; };
    const spot = (x, y) => { for (let r = 0; r < 60; r += 4) for (let a = 0; a < U.TAU; a += 0.7) { const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r; if (ok(px, py) && W.roadDist(px, py) > 4) return { x: px, y: py }; } return { x, y }; };
    // stunt ramps: Warland Reserve lawn, the golf course, two ovals, and a pair of sand "dunes" on the beach
    const rampAt = [[P.warland.x - 20, P.warland.y + 10, 0.2, 'ramp'], [P.golf.x, P.golf.y, 1.2, 'ramp'], [P.oval.x, P.oval.y, -0.4, 'ramp'], [P.ebOval.x, P.ebOval.y, 2.4, 'ramp']];
    let sand = 0; for (let x = 4300; x < 4700 && sand < 2; x += 23) for (let y = 3000; y < 3200 && sand < 2; y += 7) { if (W.groundAt(x, y) === W.GC.SAND && W.seaDist(x, y) > 6 && W.seaDist(x, y) < 25) { rampAt.push([x, y, -0.3, 'dune']); sand++; x += 120; } }
    A.ramps = rampAt.map(([x, y, a, kind], i) => { const s = kind === 'dune' ? { x, y } : spot(x, y); return { id: i, x: s.x, y: s.y, a, kind, L: 6, Wd: 4.5 }; });
    // Mayhem Minute starts: the Esplanade lawn and the main street
    A.minutes = [{ id: 'esplanade', ...spot(P.warland.x + 30, P.warland.y - 25), label: 'MAYHEM MINUTE' }, { id: 'town', ...spot(4560, 2520), label: 'MAYHEM MINUTE' }];
    // races
    const route = (x0, y0, x1, y1) => { const r = VH.AI.route(x0, y0, x1, y1) || [[x1, y1]]; const out = []; let last = { x: x0, y: y0 }; for (const q of r) { if (Math.hypot(q[0] - last.x, q[1] - last.y) > 90) { out.push({ x: q[0], y: q[1] }); last = { x: q[0], y: q[1] }; } } out.push({ x: x1, y: y1 }); return out; };
    const along = (re, x0, y0) => { const r = W.roads.filter(r => re(r)).sort((a, b) => Math.hypot(a.p[0] - x0, a.p[1] - y0) - Math.hypot(b.p[0] - x0, b.p[1] - y0))[0]; if (!r) return null; const c = U.cumLen(r.p), L = c[c.length - 1]; const cps = []; for (let s = 80; s < L; s += 80) { const [x, y] = U.alongPoly(r.p, c, s); cps.push({ x, y }); } const [ex, ey] = U.alongPoly(r.p, c, L); cps.push({ x: ex, y: ey }); return { start: { x: r.p[0], y: r.p[1] }, cps }; };
    const e0 = W.nearestEdge(4921, 2971, 40), e1 = W.nearestEdge(4305, 3128, 40);
    if (e0 && e1) A.races.push({ id: 'gopher', name: 'GOPHER GRAND PRIX', need: v => v && v.def.gopher, needTxt: 'A GOPHER', start: { x: e0.x, y: e0.y }, cps: route(e0.x, e0.y, e1.x, e1.y), letter: 'G', pay: 40 });
    const fp = along(r => r.c === 'footway' && Math.hypot(r.p[0] - 4622, r.p[1] - 2961) < 20, 4622, 2961);
    if (fp) A.races.push({ id: 'bike', name: 'FORESHORE BIKE RACE', need: v => v && v.def.bike, needTxt: 'A BIKE OR SCOOTER', start: fp.start, cps: fp.cps, letter: 'B', pay: 40 });
    const tr = W.railRoutes.tram, tn = W.railRoutes.train;
    const rp = (r, s) => { const [x, y] = U.alongPoly(r.p, r.cum, s); return { x, y }; };
    A.races.push({ id: 'tram', name: 'TRAM TIME TRIAL', need: v => v && v.rail && v.kind === 'tram', needTxt: 'THE HORSE TRAM', start: rp(tr, 14), cps: [rp(tr, tr.cum[tr.cum.length - 1] - 22)], letter: 'T', pay: 50, rail: true });
    A.races.push({ id: 'train', name: 'STEAM TRAIN TIME TRIAL', need: v => v && v.rail && v.kind === 'train', needTxt: 'THE STEAM TRAIN', start: rp(tn, 62), cps: [rp(tn, Math.min(2200, tn.cum[tn.cum.length - 1] - 30))], letter: 'S', pay: 50, rail: true });
    // twenty lost thongs, always in the same places, near footpaths around town
    const rnd = U.seeded(20251122); const cands = W.edges.filter(e => e.speed < 17 && Math.hypot(e.p[0] - 4500, e.p[1] - 2700) < 1600);
    for (let i = 0; i < 400 && A.thongs.length < 20; i++) {
      const e = cands[Math.floor(rnd() * cands.length)]; const [x, y, a] = U.alongPoly(e.p, e.cum, rnd() * e.len); const off = e.w / 2 + 1.5, s = rnd() < 0.5 ? 1 : -1;
      const t = { id: A.thongs.length, x: x + Math.sin(a) * off * s, y: y - Math.cos(a) * off * s };
      if (ok(t.x, t.y) && A.thongs.every(o => dist(o, t) > 150)) A.thongs.push(t);
    }
    A.got = new Set(store('thongs', []));
    A.penguinHome = { x: P.granite.x + 30, y: P.granite.y + 10 };
  };
  A.newNight = function () { A.mayhem = 0; A.combo = 1; A.comboT = 0; A.minute = null; A.drift = null; A.race = null; A.penguin = { x: A.penguinHome.x, y: A.penguinHome.y, ang: 0, t: 0 }; };

  // ---------- mayhem combo ----------
  A.onSmash = function (p, val) {
    const g = G(); if (g.char === 'cop') return;
    const pts = Math.round((val >= 5 ? 50 : 10 * Math.max(1, val)) * A.combo); A.mayhem += pts; A.lastPts = pts;
    A.combo = Math.min(8, A.combo + 0.5); A.comboT = 2.5;
    if (A.minute) { A.minute.n++; if (A.minute.n === A.minute.goal) { const pay = 40; g.cash += pay; sfx('win'); FX.confetti(g.player.x, g.player.y, 40); g.toast(`MAYHEM MINUTE BEATEN! +$${pay}`, '#9be15d'); } }
    const best = store('mayhemBest', 0); if (A.mayhem > best) save('mayhemBest', A.mayhem);
  };
  // ---------- airtime ----------
  A.onLand = function (v, air) {
    const g = G(); if (v !== g.player.vehicle || air < 0.45) return;
    const pay = Math.round(air * 8); g.cash += pay; const best = store('air', 0);
    FX.text(v.x, v.y - 4, `AIR ${air.toFixed(1)}S +$${pay}`, '#ffd23a', { big: air > 1 });
    if (air > best) { save('air', +air.toFixed(2)); if (best) g.toast(`NEW AIRTIME RECORD: ${air.toFixed(2)}S`, '#9be15d'); }
    g.stats.air = Math.max(g.stats.air || 0, air);
  };
  // ---------- drift scoring (roundabouts keep a top three) ----------
  A.onDriftEnd = function () {};
  A.updateDrift = function (dt) {
    const g = G(), v = pv(); if (!v || v.rail || v.def.gopher || v.def.bike) { A.drift = null; return; }
    const fx = Math.cos(v.ang), fy = Math.sin(v.ang); const vR = Math.abs(-v.vx * fy + v.vy * fx);
    if (vR > 3 && v.speed > 8 && v.z === 0) {
      if (!A.drift) A.drift = { pts: 0, rb: null, t: 0 };
      A.drift.pts += v.speed * dt * 6 * (1 + vR / 10); A.drift.t += dt;
      if (!A.drift.rb) { const c = VH.Police.chokes && VH.Police.chokes.find(c => c.kind === 'ROUNDABOUT' && dist(c, v) < 35); if (c) A.drift.rb = c; }
    } else if (A.drift && vR < 1.5) {
      const d = A.drift; A.drift = null; const pts = Math.round(d.pts); if (pts < 60) return;
      const pay = Math.floor(pts / 80); g.cash += pay;
      FX.text(v.x, v.y - 4, `DRIFT ${pts}${pay ? ' +$' + pay : ''}`, '#38e0c8', { big: pts > 400 });
      if (d.rb) {
        const key = 'rb' + Math.round(d.rb.x) + '_' + Math.round(d.rb.y); const top = store(key, []); top.push(pts); top.sort((a, b) => b - a); const rank = top.indexOf(pts); save(key, top.slice(0, 3));
        if (rank === 0) g.toast(`ROUNDABOUT RECORD: ${pts}`, '#9be15d'); else if (rank < 3) g.toast(`#${rank + 1} ON THIS ROUNDABOUT: ${pts}`, '#38e0c8');
      }
    }
  };
  // ---------- ramps ----------
  A.updateRamps = function () {
    const g = G();
    for (const v of g.vehicles) {
      if (v.removed || v.rail || v.z > 0 || v.speed < (v.def.gopher || v.def.bike ? 3 : 8)) continue;
      for (const r of A.ramps) {
        if (Math.abs(v.x - r.x) > 8 || Math.abs(v.y - r.y) > 8) continue;
        const ca = Math.cos(r.a), sa = Math.sin(r.a); const lx = (v.x - r.x) * ca + (v.y - r.y) * sa, ly = -(v.x - r.x) * sa + (v.y - r.y) * ca;
        // launch off the top lip if heading up the ramp
        if (lx > r.L / 2 - 1.2 && lx < r.L / 2 && Math.abs(ly) < r.Wd / 2 && (v.vx * ca + v.vy * sa) / v.speed > 0.6) {
          v.vz = Math.min(16, v.speed * (r.kind === 'dune' ? 0.26 : 0.34)); v.z = 0.01; v.air = 0;
          if (v === g.player.vehicle) { sfx('whoosh'); FX.text(v.x, v.y - 4, U.pick(['SEND IT!', 'AIRBORNE!', 'WHEEEE!']), '#ffd23a'); }
        }
      }
    }
  };
  // ---------- Mayhem Minute ----------
  A.updateMinute = function (dt) {
    const g = G(), pl = g.player;
    if (A.minute) {
      A.minute.t -= dt;
      if (A.minute.t <= 0) { const m = A.minute; A.minute = null; const best = store('minuteBest', 0); if (m.n > best) save('minuteBest', m.n); g.toast(m.n >= m.goal ? `MAYHEM MINUTE: ${m.n} THINGS. LEGEND.` : `MAYHEM MINUTE OVER: ${m.n}/${m.goal}. HAVE ANOTHER GO.`, m.n >= m.goal ? '#9be15d' : '#ff9a30'); }
      return;
    }
    if (g.char === 'cop') return;
    for (const s of A.minutes) if (dist(pl, s) < 7 && !(A.minuteCool > 0)) { A.minute = { t: 60, n: 0, goal: 30 }; A.minuteCool = 5; sfx('boost'); g.toast('MAYHEM MINUTE! KNOCK OVER 30 THINGS IN 60 SECONDS', '#ff4fa0'); }
    if (A.minuteCool > 0 && !A.minutes.some(s => dist(pl, s) < 10)) A.minuteCool -= dt;
  };
  // ---------- races ----------
  A.updateRace = function (dt) {
    const g = G(), pl = g.player, v = pv();
    const r = A.race;
    if (!r && g.char === 'cop') return;
    if (!r) {
      for (const rc of A.races) if (dist(pl, rc.start) < (rc.rail ? 14 : 9) && rc.need(v) && v.speed < 3) {
        if (A.raceCool > 0) continue;
        A.race = { rc, cd: 3, t: 0, i: 0 }; A.raceCool = 6; sfx('menu'); g.toast(rc.name + ': GET READY', '#38e0c8'); return;
      }
      if (A.raceCool > 0) A.raceCool -= dt;
      return;
    }
    if (r.cd > 0) { const before = Math.ceil(r.cd); r.cd -= dt; if (Math.ceil(r.cd) !== before) sfx(r.cd <= 0 ? 'boost' : 'click'); return; }
    r.t += dt;
    if (!r.rc.need(v)) { A.race = null; g.toast('RACE ABANDONED (YOU NEED ' + r.rc.needTxt + ')', '#ff9a30'); return; }
    const cp = r.rc.cps[r.i];
    if (dist(pl, cp) < (r.rc.rail ? 16 : 11)) {
      r.i++; sfx('pickup');
      if (r.i >= r.rc.cps.length) {
        const best = store('race:' + r.rc.id, 0); const t = +r.t.toFixed(2); const first = !best; const pb = !best || t < best;
        const pay = first ? r.rc.pay : pb ? 15 : 5; g.cash += pay; if (pb) save('race:' + r.rc.id, t);
        sfx('win'); FX.confetti(pl.x, pl.y, 40); g.toast(`${r.rc.name}: ${fmt(t)}${pb && !first ? ' NEW BEST!' : ''} +$${pay}`, '#9be15d'); A.race = null;
      }
    }
    if (r.t > 400) { A.race = null; g.toast('RACE TIMED OUT', '#ff9a30'); }
  };
  const fmt = t => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
  A.fmt = fmt;
  // ---------- collectibles and easter eggs ----------
  A.updateFinds = function (dt) {
    const g = G(), pl = g.player;
    for (const t of A.thongs) if (!A.got.has(t.id) && Math.abs(t.x - pl.x) < 3 && Math.abs(t.y - pl.y) < 3) {
      A.got.add(t.id); save('thongs', [...A.got]); sfx('collect'); const n = A.got.size;
      FX.text(t.x, t.y - 3, `LOST THONG ${n}/${A.thongs.length}`, '#ff4fa0'); g.cash += 5;
      if (n === A.thongs.length) { g.cash += 100; g.toast('EVERY LOST THONG FOUND! +$100. THE TOWN IS GRATEFUL.', '#9be15d'); }
    }
    const h = g.hour; const pg = A.penguin; const night = h >= 20 || h < 5;
    if (pg && night && dist(pl, pg) < 300) {
      pg.t += dt; pg.ang += Math.sin(pg.t * 0.5) * dt; const nx = pg.x + Math.cos(pg.ang) * 0.8 * dt, ny = pg.y + Math.sin(pg.ang) * 0.8 * dt;
      if (W.seaDist(nx, ny) > 3 && dist({ x: nx, y: ny }, A.penguinHome) < 40) { pg.x = nx; pg.y = ny; } else pg.ang += 1.5;
      if (pl.onFoot && dist(pl, pg) < 6) A.egg('penguin', 'THE GIANT PENGUIN NODS AT YOU, SOLEMNLY.');
    }
    const midnight = h >= 23.6 || h < 0.9; const M = VH.Missions;
    if (midnight && dist(pl, g.places.bluff) < 260 && !(M.job && M.job.title === 'MIDNIGHT AT THE BLUFF')) A.egg('whale', 'THE GHOST WHALE, OUT ON ITS OWN. NOBODY WILL BELIEVE YOU.');
  };
  A.egg = function (id, line) { const eggs = store('eggs', []); if (eggs.includes(id)) return; eggs.push(id); save('eggs', eggs); G().cash += 25; sfx('ghost'); G().toast('EASTER EGG: ' + line + ' +$25', '#80fff0'); };
  // ---------- clean getaways ----------
  A.onGetaway = function (peak) { const g = G(); if (g.char === 'cop') return; const pay = Math.round(10 * peak); g.cash += pay; const n = store('getaways', 0) + 1; save('getaways', n); sfx('win'); g.toast(`CLEAN GETAWAY! +$${pay} (GETAWAYS: ${n})`, '#9be15d'); };

  A.update = function (dt) {
    if (A.comboT > 0) { A.comboT -= dt; if (A.comboT <= 0) A.combo = 1; }
    A.updateDrift(dt); A.updateRamps(); A.updateMinute(dt); A.updateRace(dt); A.updateFinds(dt);
  };

  // ---------- drawing ----------
  A.drawGround = function (ctx, left, top, S) {
    const vw = ctx.canvas.width / S, vh = ctx.canvas.height / S; const inView = (q, m = 12) => q.x > left - m && q.y > top - m && q.x < left + vw + m && q.y < top + vh + m;
    for (const r of A.ramps) if (inView(r)) {
      ctx.save(); ctx.translate(Math.round((r.x - left) * S), Math.round((r.y - top) * S)); ctx.rotate(r.a);
      ctx.fillStyle = 'rgba(20,20,45,0.35)'; ctx.fillRect(-r.L * S / 2 + 3, -r.Wd * S / 2 + 3, r.L * S, r.Wd * S);
      if (r.kind === 'dune') { const g = ctx.createLinearGradient(-r.L * S / 2, 0, r.L * S / 2, 0); g.addColorStop(0, '#d8c28a'); g.addColorStop(1, '#f4e2b0'); ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, 0, r.L * S / 2, r.Wd * S / 2, 0, 0, U.TAU); ctx.fill(); }
      else ctx.drawImage(SP.ramp(), -r.L * S / 2, -r.Wd * S / 2, r.L * S, r.Wd * S);
      ctx.restore();
    }
    const t = G().t;
    for (const th of A.thongs) if (!A.got.has(th.id) && inView(th)) { const b = Math.round(Math.sin(t * 4 + th.id) * 1); ctx.drawImage(SP.thong(), Math.round((th.x - left) * S) - 3, Math.round((th.y - top) * S) - 2 + b); }
    const pg = A.penguin, h = G().hour;
    if (pg && (h >= 20 || h < 5) && inView(pg, 20)) VH.drawRot(ctx, SP.penguin(Math.floor(t * 3) % 2), (pg.x - left) * S, (pg.y - top) * S, pg.ang, 1, true, 1.6);
    // start pads for the races and Mayhem Minute
    const pads = [...A.minutes.map(m => ({ ...m, col: '#ff4fa0', letter: 'M' })), ...A.races.map(r => ({ x: r.start.x, y: r.start.y, label: r.name, col: '#38e0c8', letter: r.letter }))];
    if (G().char !== 'cop' && !G().demo) for (const p of pads) if (inView(p, 20)) {
      const sx = Math.round((p.x - left) * S), sy = Math.round((p.y - top) * S); const pulse = 1 + Math.sin(t * 3) * 0.08;
      ctx.strokeStyle = p.col; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(sx, sy, 7 * S * pulse, 5.6 * S * pulse, 0, 0, U.TAU); ctx.stroke();
      U.text(ctx, p.label, sx, sy - 6 * S - 10, { align: 'center', color: p.col });
    }
    // the next race checkpoint
    const r = A.race; if (r && r.cd <= 0) { const cp = r.rc.cps[r.i]; if (cp && inView(cp, 30)) { const sx = (cp.x - left) * S, sy = (cp.y - top) * S; ctx.strokeStyle = '#38e0c8'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(sx, sy, 10 * S, 8 * S, 0, 0, U.TAU); ctx.stroke(); } }
  };
  A.targets = function () {
    const r = A.race; if (!r || r.cd > 0) return []; const cp = r.rc.cps[r.i]; return cp ? [{ x: cp.x, y: cp.y, label: r.i === r.rc.cps.length - 1 ? 'FINISH' : 'CHECKPOINT', r: 10 }] : [];
  };
  // markers for the minimap and full map
  A.markers = function () {
    if (G().char === 'cop') return [];
    return [...A.minutes.map(m => ({ x: m.x, y: m.y, letter: 'M', col: '#ff4fa0' })), ...A.ramps.map(r => ({ x: r.x, y: r.y, letter: 'R', col: '#ff9a30' })), ...A.races.map(r => ({ x: r.start.x, y: r.start.y, letter: r.letter, col: '#38e0c8' }))];
  };
  // HUD widget: combo, Mayhem Minute, race timer
  A.hud = function (ctx, ts, x, y, w) {
    const T = (s, xx, yy, o) => U.text(ctx, s, xx, yy, o); const lines = [];
    if (A.mayhem > 0 && G().char !== 'cop') lines.push([`MAYHEM ${A.mayhem}` + (A.combo > 1 ? `  X${A.combo.toFixed(1)}` : ''), A.combo > 1 ? '#ff4fa0' : '#a99fc8']);
    if (A.minute) lines.push([`MAYHEM MINUTE ${Math.ceil(A.minute.t)}S  ${A.minute.n}/${A.minute.goal}`, '#ffd23a']);
    if (A.race) lines.push([A.race.cd > 0 ? `${A.race.rc.name}: ${Math.ceil(A.race.cd)}` : `${A.race.rc.name} ${fmt(A.race.t)}  CP ${A.race.i + 1}/${A.race.rc.cps.length}`, '#38e0c8']);
    if (A.drift && A.drift.pts > 60) lines.push([`DRIFT ${Math.round(A.drift.pts)}` + (A.drift.rb ? ' (ROUNDABOUT)' : ''), '#38e0c8']);
    if (!lines.length) return 0;
    VH.UI.panel(ctx, x, y, w, (lines.length * 9 + 5) * ts, { accent: '#ff4fa0' });
    lines.forEach(([s, c], i) => T(s.length > 21 ? s.slice(0, 21) : s, x + 5 * ts, y + 4 * ts + i * 9 * ts, { color: c, scale: ts }));
    if (A.comboT > 0 && A.combo > 1) { ctx.fillStyle = '#ff4fa0'; ctx.fillRect(x + 2, y + (lines.length * 9 + 4) * ts - 1, (w - 4) * A.comboT / 2.5, ts); }
    if (A.race && A.race.cd > 0) { const s = ts * 6; T(String(Math.ceil(A.race.cd)), ctx.canvas.width / 2, ctx.canvas.height * 0.3, { align: 'center', color: '#38e0c8', scale: s }); }
    return (lines.length * 9 + 9) * ts;
  };
})(window.VH);
