// The police. For Jaz and Merv: a response that grows with the gossip meter (more patrol cars that ram and box
// you in, roadblocks at chokepoints, a boat off the foreshore, a chopper spotlight), officers who taser you on foot
// and, at high gossip, fire at your vehicle (sparks, dents, blown tyres; never at people). Lose them by breaking
// line of sight and lying low. For Constable Kev: backup (two junior constables) and spike strips. Kev has no gun.
'use strict';
(function (VH) {
  const U = VH.U, W = VH.World, SP = VH.Sprites, FX = VH.FX, GC = W.GC;
  const sfx = (n, o) => window.SFX && SFX.play(n, o);
  const G = () => VH.Game;
  const P = VH.Police = { patrols: [], units: [], blocks: [], officers: [], shots: [], darts: [], spikes: [], backup: [], boat: null, heli: null,
    seenT: 99, last: null, hidden: false, spawnT: 0, blockT: 6, bustT: 0, backupT: 0, spikesLeft: 3, hadChase: false, peak: 0 };
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const JUNIORS = ['CONSTABLE TEGAN', 'CONSTABLE BAZZA'];
  P.wantUnits = m => m < 1.5 ? 0 : m < 2.5 ? 1 : m < 3.5 ? 2 : m < 4.5 ? 3 : 4;

  // chokepoints for roadblocks: roundabouts, bridges, and the landward end of the causeway
  P.init = function () {
    const pts = [];
    for (const e of W.edges) if (e.rb) { const [x, y] = U.alongPoly(e.p, e.cum, e.len / 2); if (!pts.some(q => Math.hypot(q.x - x, q.y - y) < 30)) pts.push({ x, y, kind: 'ROUNDABOUT' }); }
    for (const r of W.roads) if (r.br && r.d) { const c = U.cumLen(r.p); const [x, y] = U.alongPoly(r.p, c, c[c.length - 1] / 2); pts.push({ x, y, kind: 'BRIDGE' }); }
    const tr = W.railRoutes.tram; const [cx, cy] = U.alongPoly(tr.p, tr.cum, 10); pts.push({ x: cx, y: cy, kind: 'CAUSEWAY' });
    P.chokes = pts;
    P.hideAreas = W.areas.filter(a => a.k === 'paved' || a.k === 'golf' || a.k === 'fairway' || a.k === 'wood' || a.k === 'scrub');
  };
  P.reset = function () {
    for (const v of [...P.units, ...P.backup, ...P.patrols]) v.removed = true;
    for (const b of P.blocks) for (const v of b.cars) v.removed = true;
    Object.assign(P, { tackleCool: 0, arrest: null, patrols: [], witnessT: 0, units: [], blocks: [], officers: [], shots: [], darts: [], spikes: [], backup: [], boat: null, heli: null, seenT: 99, last: null, hidden: false, spawnT: 0, blockT: 6, bustT: 0, backupT: 0, spikesLeft: 3, hadChase: false, peak: 0 });
  };
  const target = () => { const pl = G().player; return pl.onFoot ? pl : pl.vehicle; };
  const pSpeed = () => { const pl = G().player; return pl.onFoot ? Math.hypot(pl.vx, pl.vy) : pl.vehicle.speed; };
  // somewhere to lie low: scrub, bush, the golf course, a car park, or under a tree on foot; and keep it slow
  P.isHidden = function () {
    const pl = G().player; if (pSpeed() > 6 || (!pl.onFoot && pl.vehicle.z > 1)) return false;
    const g = W.groundAt(pl.x, pl.y); if (g === GC.SCRUB || g === GC.WOOD || g === GC.GOLF || g === GC.WETLAND) return true;
    if (VH.Street && VH.Street.hidingSpot(pl.x, pl.y)) return true;
    if (g === GC.PAVED && P.hideAreas.some(a => a.k === 'paved' && pl.x > a.bb[0] && pl.x < a.bb[2] && pl.y > a.bb[1] && pl.y < a.bb[3] && U.pointInPoly(pl.x, pl.y, a.p))) return true;
    let tree = false; if (pl.onFoot) VH.Props.trees.query(pl.x - 3, pl.y - 3, pl.x + 3, pl.y + 3, t => { if (Math.hypot(t.x - pl.x, t.y - pl.y) < 2.6) tree = true; });
    return tree;
  };
  // is anyone standing near the line between two points? (police never fire past a bystander)
  P.clearLine = function (x0, y0, x1, y1) {
    const near = q => Math.abs(q.x - (x0 + x1) / 2) <= Math.abs(x1 - x0) / 2 + 4 && Math.abs(q.y - (y0 + y1) / 2) <= Math.abs(y1 - y0) / 2 + 4 && U.segPointDist(q.x, q.y, x0, y0, x1, y1)[0] < 3;
    for (const o of P.officers) if (near(o)) return false;
    const pv = G().player.vehicle; for (const v of G().vehicles) if (!v.removed && v !== pv && (v.def.gopher || v.def.bike || v.watch) && (v.driver || v.ai || v.watch) && near(v)) return false;
    for (const p of G().peds) { if (Math.abs(p.x - (x0 + x1) / 2) > Math.abs(x1 - x0) / 2 + 4 || Math.abs(p.y - (y0 + y1) / 2) > Math.abs(y1 - y0) / 2 + 4) continue; if (U.segPointDist(p.x, p.y, x0, y0, x1, y1)[0] < 3) return false; }
    return true;
  };

  function spawnCar(near, rMin, rMax, filter) {
    const g = G(); const view = g.viewHalf || [90, 60];
    for (let k = 0; k < 6; k++) {
      const n = W.randomRoadPoint(near.x, near.y, rMin, rMax, filter || (e => e.w >= 5)); if (!n) continue;
      if (Math.abs(n.x - g.cam.x) < view[0] + 10 && Math.abs(n.y - g.cam.y) < view[1] + 10) continue;
      const v = new VH.Vehicle('police', n.x, n.y, n.ang, { colour: '#fff' }); v.siren = true; g.vehicles.push(v); return v;
    }
    return null;
  }

  // ================= patrols: police about town who notice what you get up to =================
  P.updatePatrols = function (dt) {
    const g = G(), pl = g.player, tg = target();
    P.patrols = P.patrols.filter(v => !v.removed && !v.dead && !v.sinking && v.patrol && dist(v, pl) < 480 || (v.patrol = false));
    if (P.patrols.length < 2 && Math.random() < dt * 0.6) {
      const n = W.randomRoadPoint(pl.x, pl.y, 140, 300, e => e.w >= 5 && e.speed > 8); const view = g.viewHalf || [90, 60];
      if (n && (Math.abs(n.x - g.cam.x) > view[0] + 10 || Math.abs(n.y - g.cam.y) > view[1] + 10)) { const v = new VH.Vehicle('police', n.x, n.y, n.ang, { colour: '#fff' }); VH.AI.attach(v, n, n.e.ow === -1 ? -1 : 1); v.patrol = true; g.vehicles.push(v); P.patrols.push(v); }
    }
    // speeding past a patrol car, or tearing along the footpath in view of one, gets noticed
    P.witnessT = Math.max(0, (P.witnessT || 0) - dt);
    if (!pl.onFoot && pl.vehicle && !pl.vehicle.rail) {
      const v = pl.vehicle;
      if (v.speed > 22 && !v.def.gopher) for (const c of P.patrols) if (dist(c, v) < 35) { P.witness(0.6, 'SPEEDING PAST THE POLICE!'); break; }
      const gnd = W.groundAt(v.x, v.y); if (v.speed > 6 && (gnd === GC.PAVED || gnd === GC.LAWN || gnd === GC.GRASS) && W.roadDist(v.x, v.y) > 3 && !v.def.bike) { P.footT = (P.footT || 0) + dt; if (P.footT > 1.2) { P.footT = 0; g.addMeter(0.15); P.witness(0.3, 'OFF THE ROAD!'); } }
    }
  };
  // a patrol car that can see you when you do something: it joins in, and the gossip jumps
  P.sees = (c, x, y, r = 60) => dist(c, { x, y }) < r && VH.AI.los(c.x, c.y, x, y);
  P.witness = function (amount, label) {
    const g = G(); if (g.char === 'cop') return false; const pl = g.player; if (P.witnessT > 0) return false;
    const c = P.patrols.find(c => P.sees(c, pl.x, pl.y)) || P.units.find(c => P.sees(c, pl.x, pl.y));
    if (!c) return false;
    P.witnessT = 2.5; g.meter = Math.max(g.meter, 1.6); g.addMeter(amount, label);
    if (c.patrol) { c.patrol = false; c.police = true; c.siren = true; c.ai = null; c.role = P.units.length; P.patrols = P.patrols.filter(x => x !== c); P.units.push(c); P.hadChase = true; sfx('radio'); g.toast('A PATROL CAR SAW THAT! THEY\'RE AFTER YOU', '#ff6a5a'); }
    P.seenT = 0; P.last = { x: pl.x, y: pl.y };
    return true;
  };

  // ================= the chase (Jaz, Merv, free roam) =================
  P.update = function (dt) {
    const g = G(), pl = g.player, m = g.meter, tg = target();
    P.updatePatrols(dt);
    P.hidden = P.isHidden();
    // who can see you?
    let seen = false; const sightR = P.hidden ? 12 : 75;
    for (const v of P.units) if (dist(v, tg) < sightR && VH.AI.los(v.x, v.y, tg.x, tg.y)) { seen = true; break; }
    if (!seen) for (const o of P.officers) if (dist(o, tg) < (P.hidden ? 8 : 40) && VH.AI.los(o.x, o.y, tg.x, tg.y)) { seen = true; break; }
    if (!seen) for (const b of P.blocks) if (dist(b, tg) < (P.hidden ? 12 : 50)) { seen = true; break; }
    if (!seen && P.boat && !P.hidden && dist(P.boat, tg) < 90 && VH.AI.los(P.boat.x, P.boat.y, tg.x, tg.y)) seen = true;
    if (!seen && P.heli && !P.hidden && Math.hypot(P.heli.sx - tg.x, P.heli.sy - tg.y) < 10) seen = true;
    if (VH.Street && VH.Street.popperT > 0) seen = false; // party popper: they're all looking the wrong way
    if (seen) { P.seenT = 0; P.last = { x: tg.x, y: tg.y }; P.desc = pl.onFoot ? 'foot' : pl.vehicle; } else P.seenT += dt;
    // swapped cars (or got out) where they couldn't see: they're still looking for the old one
    const now = pl.onFoot ? 'foot' : pl.vehicle;
    if (!seen && P.desc && now !== P.desc && P.seenT > 1.5 && P.units.length) { P.desc = null; P.seenT = Math.max(P.seenT, 8); g.meter = Math.max(0, g.meter - 0.6); g.toast("SWAPPED OUT OF SIGHT. THEY'RE STILL LOOKING FOR THE OLD ONE", '#9be15d'); }
    g.copSees = P.seenT < 0.5;
    // cars come and go with the gossip
    const want = P.wantUnits(m);
    P.units = P.units.filter(v => {
      if (v.removed || v.sinking) return false;
      if (v.dead) { v.police = false; v.siren = false; g.toast('A PATROL CAR IS OUT OF ACTION', '#ff9a30'); g.addMeter(0.4); return false; }
      return true;
    });
    if (P.units.length < want) {
      P.spawnT -= dt;
      if (P.spawnT <= 0) {
        P.spawnT = 2.2; const v = spawnCar(pl, 110, 210); if (v && !U.store.get('tip:respray', false)) { U.store.set('tip:respray', true); g.tipNow = { str: 'LOSE THEM AT A RESPRAY SHOP: LOOK FOR THE SPRAY CAN ON THE MAP', t: 10, icon: 'can' }; }
        if (v) { v.police = true; v.role = P.units.length; P.units.push(v); P.hadChase = true; sfx('radio'); g.toast(P.units.length === 1 ? 'A PATROL CAR IS RESPONDING' : `PATROL CAR ${P.units.length} IS JOINING IN`, '#7fa6ff'); }
      }
    } else if (P.units.length > want) {
      // the farthest one stands down
      const v = P.units.slice().sort((a, b) => dist(b, pl) - dist(a, pl))[0]; P.standDown(v);
      if (!P.units.length) { g.toast(P.hadChase ? 'THE POLICE HAVE LOST YOU' : 'THE POLICE HAVE LOST INTEREST', '#9be15d'); if (P.hadChase && P.peak >= 3) VH.Acts && VH.Acts.onGetaway(P.peak); P.hadChase = false; P.peak = 0; }
    }
    if (P.units.length) P.peak = Math.max(P.peak, m);
    P.units.forEach((v, i) => P.drive(v, i, dt));
    P.updateBust(dt);
    P.updateBlocks(dt); P.updateBoat(dt); P.updateHeli(dt); P.updateOfficers(dt); P.updateShots(dt); P.updateSpikes(dt);
  };
  P.standDown = function (v) {
    v.siren = false; v.police = false; v.ai = null; const n = W.nearestEdge(v.x, v.y, 40); if (n) VH.AI.attach(v, n, 1);
    P.units = P.units.filter(u => u !== v); P.officers = P.officers.filter(o => o.car !== v);
  };
  P.drive = function (v, i, dt) {
    v.def.maxV = 42 + G().meter * 2.5; // quick, but a fast car driven well can still pull away
    const g = G(), pl = g.player, tg = target();
    const chasing = P.seenT < 7 && P.last;
    if (chasing) {
      let aim = P.seenT < 0.4 ? { x: tg.x, y: tg.y, vx: tg.vx || 0, vy: tg.vy || 0 } : { x: P.last.x, y: P.last.y, vx: 0, vy: 0 };
      const role = i % 4;
      if (role === 1) aim = { x: aim.x + aim.vx * 1.6, y: aim.y + aim.vy * 1.6, vx: 0, vy: 0 }; // cut them off
      else if (role === 2) { const a = Math.atan2(aim.vy, aim.vx) + Math.PI / 2, s = i % 2 ? 1 : -1; aim = { x: aim.x + aim.vx * 0.8 + Math.cos(a) * 6 * s, y: aim.y + aim.vy * 0.8 + Math.sin(a) * 6 * s, vx: 0, vy: 0 }; } // come alongside
      VH.AI.pursue(v, dt, aim, { ram: role === 0 && g.meter >= 3 && !pl.onFoot });
      v.search = null;
      // pulling up next to someone on foot: an officer gets out
      if ((pl.onFoot || (pSpeed() < 4 && !(pl.vehicle.z > 1))) && dist(v, tg) < 26 && v.speed < 7 && !v.officerOut && P.officers.length < 4 && P.seenT < 1) P.addOfficer(v);
      if (v.officerOut) { v.throttle = 0; v.brake = 1; }
      P.maybeFire(v, dt);
    } else {
      // search: head to the last sighting, then poke around nearby streets
      if (!v.search || dist(v, v.search) < 14) { const c = P.last || pl; const n = W.randomRoadPoint(c.x, c.y, 10, 70); v.search = n ? { x: n.x, y: n.y } : { x: c.x, y: c.y }; }
      VH.AI.pursue(v, dt, v.search); v.throttle *= 0.65;
    }
    v.siren = true;
    // left far behind and out of sight: bring them round the block instead
    if (dist(v, pl) > 380 && P.seenT > 2) { const n = W.randomRoadPoint(pl.x, pl.y, 150, 230, e => e.w >= 5); const view = g.viewHalf || [90, 60]; if (n && (Math.abs(n.x - g.cam.x) > view[0] + 10 || Math.abs(n.y - g.cam.y) > view[1] + 10)) { v.x = n.x; v.y = n.y; v.ang = n.ang; v.vx = v.vy = 0; v.ai = null; } }
  };
  // busted the old-fashioned way: officers get out, run at you, and if one reaches you while you're stopped or slow,
  // it's hands up and cuffs. Drive off, shove through (they jump out of the way) or outrun them on foot to get away.
  P.updateBust = function (dt) {
    const g = G(), pl = g.player; if (g.state !== 'play') return;
    if (P.arrest) { P.arrest.t += dt; if (P.arrest.t > 0.6 && !P.arrest.click) { P.arrest.click = true; sfx('clang', { pitch: 2.2, vol: 0.6 }); FX.text(pl.x, pl.y - 6, 'CLICK!', '#c9ccd8'); } if (P.arrest.t > 1.4) { P.arrest = null; g.busted(); } return; }
    const tg = target(); const slow = pSpeed() < 3;
    let near = 0; for (const v of P.units) if (dist(v, tg) < 9) near++;
    const boxed = !pl.onFoot && near >= 2 && pSpeed() < 4;
    if (boxed && !P.boxedSaid) { P.boxedSaid = true; g.callout('BOXED IN!', '#ff6a5a'); }
    if (!boxed) P.boxedSaid = false;
    if (!pl.onFoot && pl.vehicle.z > 1) return; // nobody can reach you up there
    if (VH.Tackle.on || (P.tackleCool || 0) > 0) { P.tackleCool = Math.max(0, (P.tackleCool || 0) - dt); return; }
    const reach = pl.onFoot ? 2.3 : (pl.vehicle.def.W / 2 + 1.2);
    if (pl.inShop) return;
    for (const o of P.officers) if (o.state === 'chase' && !o.dive && !(o.downT > 0) && VH.AI.los(o.x, o.y, tg.x, tg.y) && dist(o, tg) < reach + (pl.onFoot ? 0 : pl.vehicle.def.L * 0.3) && (slow || pl.stunT > 0 || (pl.onFoot && pSpeed() < 12))) {
      // out of the car first if you're in one, then a flying tackle and a struggle on the ground
      if (!pl.onFoot && pl.vehicle) { g.callout('OUT OF THE CAR!', '#ff6a5a'); g.exit(true); if (!pl.onFoot) return; }
      o.state = 'tackle'; o.x = pl.x - Math.cos(o.ang) * 0.6; o.y = pl.y - Math.sin(o.ang) * 0.6; sfx('megaphone');
      VH.Tackle.start({ mode: 'escape', rank: o.rank || 'senior', who: o, startCuff: pl.stunT > 0 ? 0.35 : 0,
        onWin: () => { o.state = 'chase'; o.downT = 2.5; P.tackleCool = 2.5; g.callout('BROKE FREE!', '#9be15d'); g.addMeter(0.4); },
        onLose: () => { o.state = 'cuff'; P.arrest = { t: 0.3, o }; } });
      return;
    }
  };

  // ---------- roadblocks ----------
  P.updateBlocks = function (dt) {
    const g = G(), pl = g.player, m = g.meter;
    const view = g.viewHalf || [90, 60]; const offscreen = q => Math.abs(q.x - g.cam.x) > view[0] + 12 || Math.abs(q.y - g.cam.y) > view[1] + 12;
    P.blocks = P.blocks.filter(b => {
      b.t += dt;
      if ((dist(b, pl) > 320 || b.t > 80 || m < 2) && offscreen(b)) { for (const v of b.cars) v.removed = true; return false; }
      return true;
    });
    P.blockT -= dt;
    const maxBlocks = m >= 4.5 ? 2 : 1;
    if (m < 3 || P.blocks.length >= maxBlocks || P.blockT > 0 || pl.onFoot || pl.vehicle.speed < 6) return;
    P.blockT = 16;
    const v = pl.vehicle; const dx = v.vx / v.speed, dy = v.vy / v.speed;
    const ahead = c => { const ex = c.x - pl.x, ey = c.y - pl.y, d = Math.hypot(ex, ey); return d > 70 && d < 260 && (ex * dx + ey * dy) / d > 0.6; };
    let c = P.chokes.filter(ahead).sort((a, b) => dist(a, pl) - dist(b, pl))[0];
    let at;
    if (c) { const d = dist(c, pl); at = W.nearestEdge(c.x - (c.x - pl.x) / d * 22, c.y - (c.y - pl.y) / d * 22, 30); }
    else { at = W.nearestEdge(pl.x + dx * 150, pl.y + dy * 150, 40); c = { kind: '' }; }
    if (!at || at.e.w < 4 || !offscreen(at)) return;
    const a = at.ang, nx = -Math.sin(a), ny = Math.cos(a); const w = at.e.w;
    // two cars across the road, nudged to one side: there's always a gap (or the footpath) for a brave driver
    const gs = Math.random() < 0.5 ? 1 : -1;
    const cars = [-1, 1].map(s => { const o = s * (w / 4 + 0.2) - gs * 1.4; const car = new VH.Vehicle('police', at.x + nx * o, at.y + ny * o, a + Math.PI / 2 + s * 0.35, { colour: '#fff' }); car.block = true; car.siren = true; car.handbrake = 1; car.def.mass = 2600; g.vehicles.push(car); return car; });
    // cones either side, and a spike strip on the approach at high gossip
    VH.Props.add(VH.Sprites.PK.cone, at.x - nx * gs * (w / 2 + 0.6), at.y - ny * gs * (w / 2 + 0.6), 0);
    const toward = (pl.x - at.x) * Math.cos(a) + (pl.y - at.y) * Math.sin(a) > 0 ? 1 : -1;
    if (m >= 4) P.spikes.push({ x: at.x + Math.cos(a) * toward * 14, y: at.y + Math.sin(a) * toward * 14, a: a + Math.PI / 2, len: Math.min(w * 0.7, 7), t: 0, owner: 'police' });
    P.blocks.push({ x: at.x, y: at.y, cars, t: 0, kind: c.kind });
    const street = at.e.n ? at.e.n.toUpperCase() : c.kind || 'THE ROAD AHEAD';
    g.toast('ROADBLOCK: ' + (c.kind && c.kind !== 'ROUNDABOUT' ? 'THE ' + c.kind : street), '#ff6a5a'); sfx('radio');
  };

  // ---------- the boat off the foreshore ----------
  P.updateBoat = function (dt) {
    const g = G(), pl = g.player, m = g.meter;
    const want = m >= 3 && W.seaDist(pl.x, pl.y) < 200 && G().char !== 'cop';
    if (want && !P.boat) {
      for (let k = 0; k < 30; k++) { const a = Math.random() * U.TAU, r = U.rand(120, 220); const x = pl.x + Math.cos(a) * r, y = pl.y + Math.sin(a) * r; if (W.seaDist(x, y) < -15) { P.boat = { x, y, ang: a + Math.PI, t: 0, leave: false }; g.toast('THE POLICE BOAT IS OUT', '#7fa6ff'); break; } }
    }
    const b = P.boat; if (!b) return; b.t += dt;
    if (!want) b.leave = true;
    const aim = b.leave ? { x: b.x + Math.cos(b.ang) * 100, y: b.y + Math.sin(b.ang) * 100 } : pl;
    const want0 = Math.atan2(aim.y - b.y, aim.x - b.x); const spd = dist(b, aim) < 28 && !b.leave ? 0 : 11;
    let chosen = null;
    for (const da of [0, 0.5, -0.5, 1, -1, 1.6, -1.6, 2.3, -2.3]) { const a = want0 + da, nx = b.x + Math.cos(a) * 9, ny = b.y + Math.sin(a) * 9; if (W.seaDist(nx, ny) < -8) { chosen = a; break; } }
    if (chosen != null && spd) { b.ang += U.angDiff(b.ang, chosen) * Math.min(1, dt * 2); b.x += Math.cos(b.ang) * spd * dt; b.y += Math.sin(b.ang) * spd * dt; if (Math.random() < 0.5) FX.add({ type: 'ring', x: b.x - Math.cos(b.ang) * 4, y: b.y - Math.sin(b.ang) * 4, vx: 0, vy: 0, life: 0.9, col: '#e8f6ff', size: 1.4 }); }
    b.beam = Math.atan2(pl.y - b.y, pl.x - b.x);
    if (b.leave && dist(b, pl) > 400) P.boat = null;
  };
  // ---------- the chopper and its spotlight ----------
  P.updateHeli = function (dt) {
    const g = G(), pl = g.player, m = g.meter, tg = target();
    if (!P.heli && m >= 4.5) { P.heli = { sx: pl.x - 120, sy: pl.y - 120, x: pl.x - 260, y: pl.y - 300, vx: 0, vy: 0, rot: 0, sweep: 0, chop: 0, leave: false }; g.toast('THE CHOPPER IS UP', '#ff6a5a'); sfx('radio'); }
    const h = P.heli; if (!h) return;
    if (m < 3.5) h.leave = true;
    h.sweep += dt;
    let ax, ay;
    if (h.leave) { ax = h.x + 400; ay = h.y - 400; }
    else if (P.seenT < 2.5) { ax = tg.x; ay = tg.y; }
    else { const c = P.last || pl; ax = c.x + Math.cos(h.sweep * 0.8) * 28; ay = c.y + Math.sin(h.sweep * 1.1) * 22; }
    // the spotlight chases with a top speed a fast car can beat
    const dx = ax - h.sx, dy = ay - h.sy, d = Math.hypot(dx, dy), max = 17;
    const k = Math.min(1, dt * 2.2); h.vx += ((d > 0.1 ? dx / d * Math.min(max, d * 1.5) : 0) - h.vx) * k; h.vy += ((d > 0.1 ? dy / d * Math.min(max, d * 1.5) : 0) - h.vy) * k;
    h.sx += h.vx * dt; h.sy += h.vy * dt;
    h.x += (h.sx - 16 - h.x) * Math.min(1, dt * 1.2); h.y += (h.sy - 30 - h.y) * Math.min(1, dt * 1.2);
    h.rot += dt * 28; h.chop -= dt;
    const dd = Math.hypot(h.x - pl.x, h.y - pl.y);
    if (h.chop <= 0) { h.chop = 0.5; if (dd < 260) sfx('rotor', { vol: U.clamp(1 - dd / 260, 0.1, 0.7) }); }
    if (h.leave && dd > 500) P.heli = null;
  };

  // ---------- officers on foot (and their tasers) ----------
  P.addOfficer = function (v) {
    const a = v.ang + Math.PI / 2; const m = G().meter;
    const rank = m >= 4.5 && !P.officers.some(o => o.rank === 'sergeant') ? 'sergeant' : m >= 3 ? 'senior' : 'rookie';
    const o = { x: v.x + Math.cos(a) * 1.6, y: v.y + Math.sin(a) * 1.6, ang: a, anim: 0, state: 'chase', car: v, zapT: 1.2, t: 0, rank };
    v.officerOut = true; P.officers.push(o); FX.text(o.x, o.y - 3, U.pick(["'ELLO 'ELLO!", 'OI! STOP RIGHT THERE!', 'STAY WHERE YOU ARE!']), '#9fd4ec');
  };
  P.updateOfficers = function (dt) {
    const g = G(), pl = g.player;
    for (const o of P.officers) { VH.stride(o, dt);
      o.t += dt; o.zapT -= dt;
      const car = o.car; const tv = !pl.onFoot && pl.vehicle;
      if (o.state === 'cuff' || o.state === 'tackle') { o.ang = Math.atan2(pl.y - o.y, pl.x - o.x); continue; }
      if (o.downT > 0) { o.downT -= dt; continue; }
      // a car coming through: jump out of the way (nobody gets hurt)
      if (o.dive > 0) { o.dive -= dt; o.x += o.dvx * dt; o.y += o.dvy * dt; o.dvx *= Math.exp(-3 * dt); o.dvy *= Math.exp(-3 * dt); if (o.dive <= 0) o.dive = 0; continue; }
      for (const v of G().vehicles) { if (v.removed || v.speed < 3 || v === car || Math.abs(v.x - o.x) > 12 || Math.abs(v.y - o.y) > 12) continue; const sp = v.speed, ux = v.vx / sp, uy = v.vy / sp; const dx = o.x - v.x, dy = o.y - v.y; const along = dx * ux + dy * uy, lat = -dx * uy + dy * ux; if (along > -1 && along < 3 + sp * 0.5 && Math.abs(lat) < v.def.W / 2 + 1.2) { const s = lat >= 0 ? 1 : -1; o.dive = 0.6; o.dvx = -uy * s * 9; o.dvy = ux * s * 9; sfx('dive', { vol: 0.5 }); FX.text(o.x, o.y - 3, U.pick(['WHOA!', 'STRUTH!', 'OI!']), '#9fd4ec'); break; } }
      if (o.dive > 0) continue;
      const lost = (tv && pSpeed() > 8) || dist(o, pl) > 55 || car.removed || pl.hidden || (P.hidden && dist(o, pl) > 8 && P.seenT > 1.5);
      if (o.state === 'chase' && lost) o.state = 'return';
      const tx = o.state === 'chase' ? pl.x : car.x, ty = o.state === 'chase' ? pl.y : car.y;
      const dx = tx - o.x, dy = ty - o.y, d = Math.hypot(dx, dy); const sp = o.state === 'chase' ? 10.5 : 8;
      // run at the target; if a wall has us stuck, slide along it for a moment
      let mx = dx / (d || 1), my = dy / (d || 1);
      if (o.side > 0) { o.side -= dt; const s = o.sideDir; mx = -dy / (d || 1) * s * 0.9 + mx * 0.3; my = dx / (d || 1) * s * 0.9 + my * 0.3; }
      const bx = o.x, by = o.y;
      if (d > 0.9) { const st = Math.min(d - 0.8, sp * dt); o.x += mx * st; o.y += my * st; o.ang = Math.atan2(my, mx); o.anim += st * 1.4; }
      W.wallGrid.query(o.x - 0.6, o.y - 0.6, o.x + 0.6, o.y + 0.6, s => { const [dd, qx, qy] = U.segPointDist(o.x, o.y, s.ax, s.ay, s.bx, s.by); if (dd < 0.5 && dd > 1e-6) { o.x = qx + (o.x - qx) / dd * 0.5; o.y = qy + (o.y - qy) / dd * 0.5; } });
      if (d > 2 && Math.hypot(o.x - bx, o.y - by) < sp * dt * 0.25) { o.stuckT = (o.stuckT || 0) + dt; if (o.stuckT > 0.3 && !(o.side > 0)) { o.side = 0.9; o.sideDir = o.sideDir ? -o.sideDir : (Math.random() < 0.5 ? 1 : -1); o.stuckT = 0; } } else o.stuckT = 0;
      // taser, once the gossip is high: a visible, dodgeable dart (never fired past a bystander)
      if (o.state === 'chase' && g.meter >= 3 && d < 11 && d > 2.2 && o.zapT <= 0 && pl.stunT <= 0 && VH.AI.los(o.x, o.y, pl.x, pl.y) && P.clearLine(o.x, o.y, pl.x, pl.y)) {
        o.zapT = 3.2; const lead = d / 24; const ax = pl.x + pl.vx * lead, ay = pl.y + pl.vy * lead; const a = Math.atan2(ay - o.y, ax - o.x);
        P.darts.push({ x: o.x, y: o.y, ox: o.x, oy: o.y, vx: Math.cos(a) * 24, vy: Math.sin(a) * 24, life: (d + 1.5) / 24, o }); sfx('zap', { vol: 0.35, pitch: 1.4 });
      }
      if (o.state === 'return' && d < 2) { o.gone = true; car.officerOut = false; }
    }
    P.officers = P.officers.filter(o => !o.gone && !o.car.removed);
    for (const o of P.officers) if (o.state === 'return' && dist(o, o.car) < 2.5) { o.gone = true; o.car.officerOut = false; }
    for (const dt0 of P.darts) {
      dt0.x += dt0.vx * dt; dt0.y += dt0.vy * dt; dt0.life -= dt;
      if (pl.onFoot && !pl.hidden && Math.hypot(dt0.x - pl.x, dt0.y - pl.y) < 0.9) { dt0.life = 0; pl.stunT = 1.6; sfx('zap'); FX.sparks(pl.x, pl.y, 12); FX.text(pl.x, pl.y - 4, 'ZZZT!', '#ffe94a'); FX.kick(0.25); }
    }
    P.darts = P.darts.filter(d => d.life > 0);
  };

  // ---------- shots at your vehicle (high gossip only; tracers, sparks, dents, tyres) ----------
  P.maybeFire = function (v, dt) {
    // never at anyone you can see on board: no bikes, scooters or gophers (open riders), and never the tram or train
    const g = G(), pl = g.player; if (g.meter < 3.5 || pl.onFoot || !pl.vehicle || pl.vehicle.rail || pl.vehicle.def.bike || pl.vehicle.def.gopher) { v.burst = 0; return; }
    const tg = pl.vehicle; const d = dist(v, tg);
    v.fireT = (v.fireT == null ? U.rand(0.5, 1.5) : v.fireT) - dt; v.burstT = (v.burstT || 0) - dt;
    if (d > 55 || d < 6 || !VH.AI.los(v.x, v.y, tg.x, tg.y)) return;
    const shooting = P.units.filter(u => u.burst > 0).length;
    if (v.fireT <= 0 && shooting < 2) { v.burst = 3; v.fireT = U.rand(2.4, 3.6); }
    if (v.burst > 0 && v.burstT <= 0) {
      if (!P.clearLine(v.x, v.y, tg.x, tg.y)) { v.burst = 0; return; }
      const lead = d / 90; const ax = tg.x + tg.vx * lead + U.rand(-1.8, 1.8), ay = tg.y + tg.vy * lead + U.rand(-1.8, 1.8); const a = Math.atan2(ay - v.y, ax - v.x);
      const sx = v.x + Math.cos(a) * 2.2, sy = v.y + Math.sin(a) * 2.2;
      P.shots.push({ x: sx, y: sy, vx: Math.cos(a) * 90, vy: Math.sin(a) * 90, life: (d + 3) / 90 }); // stops just past the target
      FX.add({ type: 'spark', x: sx, y: sy, vx: Math.cos(a) * 6, vy: Math.sin(a) * 6, life: 0.1, col: '#fff6b0', drag: 3 });
      sfx('shot', { vol: U.clamp(0.6 - dist(v, pl) / 200, 0.15, 0.6) }); v.burst--; v.burstT = 0.13;
    }
  };
  P.updateShots = function (dt) {
    const pl = G().player; const tv = !pl.onFoot && pl.vehicle;
    for (const s of P.shots) {
      for (let k = 0; k < 3 && s.life > 0; k++) {
        s.x += s.vx * dt / 3; s.y += s.vy * dt / 3;
        if (tv) { let hit = false; tv.eachCircle((cx, cy, r) => { if (!hit && Math.hypot(s.x - cx, s.y - cy) < r + 0.15) hit = true; }); if (hit) { s.life = 0; P.hitVehicle(tv, s.x, s.y); break; } }
        if (W.groundAt(s.x, s.y) === GC.BUILDING) { s.life = 0; FX.sparks(s.x, s.y, 3); }
      }
      s.life -= dt;
    }
    P.shots = P.shots.filter(s => s.life > 0);
  };
  P.hitVehicle = function (v, x, y) {
    sfx('ping', { vol: 0.6 }); FX.sparks(x, y, 6);
    v.damage = Math.min(1, v.damage + 0.035 / Math.max(0.6, v.def.hp));
    if (v.sprite === v.base) v.sprite = SP.damaged(v.base);
    const fx = Math.cos(v.ang), fy = Math.sin(v.ang), dx = x - v.x, dy = y - v.y; SP.dent(v.sprite, v.sprite.width / 2 + (dx * fx + dy * fy) * 4, v.sprite.height / 2 + (-dx * fy + dy * fx) * 4, false);
    if (!v.flat && Math.random() < 0.12) { v.flat = true; sfx('tyre'); FX.debris(x, y, ['#1b1b20', '#333'], 5, 4); G().toast("TYRE'S GONE!", '#ff9a30'); }
    if (v.damage >= 1 && !v.dead) { v.dead = true; sfx('puff'); FX.smoke(v.x, v.y, '#333', 12, 1.8, 2.5); G().onWreck && G().onWreck(v); }
  };

  // ---------- spike strips (police roadblocks and Kev's) ----------
  P.updateSpikes = function (dt) {
    const g = G();
    for (const s of P.spikes) {
      s.t += dt; const ca = Math.cos(s.a), sa = Math.sin(s.a); const ax = s.x - ca * s.len / 2, ay = s.y - sa * s.len / 2, bx = s.x + ca * s.len / 2, by = s.y + sa * s.len / 2;
      for (const v of g.vehicles) {
        if (v.removed || v.rail || v.flat || v.z > 0.3 || Math.abs(v.x - s.x) > s.len + 4 || Math.abs(v.y - s.y) > s.len + 4) continue;
        if (s.owner === 'police' && (v.police || v.block)) continue;
        if (s.owner === 'kev' && (v.owned || v.backup || v.driver === 'player')) continue;
        if (U.segPointDist(v.x, v.y, ax, ay, bx, by)[0] < v.def.W / 2 + 0.3 && v.speed > 1.5) {
          v.flat = true; sfx('tyre'); FX.debris(v.x, v.y, ['#1b1b20', '#333'], 6, 4); FX.text(v.x, v.y - 3, 'SPIKED!', '#ffd23a'); s.hits = (s.hits || 0) + 1;
          if (v === g.player.vehicle) g.toast("TYRES SHREDDED. SHE'LL BE SLOW NOW.", '#ff9a30');
        }
      }
    }
    P.spikes = P.spikes.filter(s => s.t < (s.owner === 'kev' ? 45 : 70) && !(s.owner === 'kev' && s.hits));
  };

  // ================= Constable Kev's kit =================
  P.kevUpdate = function (dt) {
    const g = G(), pl = g.player, I = VH.Input;
    P.backupT = Math.max(0, P.backupT - dt);
    if (I.consume('spikes')) {
      const v = pl.vehicle;
      if (!v) g.toast('SPIKES ARE IN THE BOOT: GET IN A CAR FIRST', '#ffd23a');
      else if (P.spikesLeft <= 0) g.toast('NO SPIKE STRIPS LEFT TONIGHT', '#ff9a30');
      else { const back = v.def.L / 2 + 3; P.spikes.push({ x: v.x - Math.cos(v.ang) * back, y: v.y - Math.sin(v.ang) * back, a: v.ang + Math.PI / 2, len: 5.5, t: 0, owner: 'kev' }); P.spikesLeft--; sfx('spikes'); g.toast(`SPIKES DOWN (${P.spikesLeft} LEFT TONIGHT)`, '#9fd4ec'); }
    }
    if (I.consume('backup')) {
      if (P.backupT > 0) g.toast(`BACKUP IS BUSY. READY IN ${Math.ceil(P.backupT)}S`, '#ffd23a');
      else {
        P.backupT = 60; let n = 0;
        for (let i = 0; i < 2; i++) { const v = spawnCar(pl, 70, 150); if (v) { v.backup = true; v.owner = JUNIORS[i]; v.life = 50; v.role = i; P.backup.push(v); n++; } }
        sfx('radio'); g.toast(n ? "SARGE: 'SENDING TEGAN AND BAZZA. DON'T SCRATCH THE CARS.'" : 'SARGE: NOBODY CAN GET THERE, KEV', '#7fa6ff');
      }
    }
    const tgt = VH.Missions.chaseTarget && VH.Missions.chaseTarget();
    P.backup = P.backup.filter(v => {
      v.life -= dt; if (v.removed || v.sinking) return false;
      if (v.life <= 0 || v.dead) { v.backup = false; v.siren = false; v.ai = null; const n = W.nearestEdge(v.x, v.y, 40); if (n) VH.AI.attach(v, n, 1); if (v.life <= 0) FX.text(v.x, v.y - 3, 'BACK TO THE STATION', '#9fd4ec'); return false; }
      if (tgt && !tgt.removed) {
        // box the target in: one aims ahead of it, the other alongside
        const a = Math.atan2(tgt.vy || 0, tgt.vx || 1); const ahead = v.role === 0 ? 9 : 2, side = v.role === 0 ? 0 : 4;
        VH.AI.pursue(v, dt, { x: tgt.x + Math.cos(a) * ahead - Math.sin(a) * side, y: tgt.y + Math.sin(a) * ahead + Math.cos(a) * side, vx: 0, vy: 0 }, { ram: !tgt.rail });
      } else {
        const a = pl.ang + (v.role ? -2.5 : 2.5); const aim = { x: pl.x + Math.cos(a) * 10, y: pl.y + Math.sin(a) * 10, vx: 0, vy: 0 };
        VH.AI.pursue(v, dt, aim); if (dist(v, pl) < 14) { v.throttle = 0; v.brake = 1; }
      }
      v.siren = true; return true;
    });
    P.updateSpikes(dt);
  };
  // megaphone (Kev on foot): anyone running nearby stops in their tracks for a moment
  P.megaphone = function () {
    const g = G(), pl = g.player; sfx('megaphone'); FX.text(pl.x, pl.y - 4, 'STOP! POLICE!', '#9fd4ec'); FX.ring(pl.x, pl.y, '#9fd4ec', 8, 0.8);
    let n = 0; for (const p of g.peds) if (dist(p, pl) < 30 && (p.state === 'flee' || p.fleeing || p.tag === 'ditcher')) { p.frozen = 2.5; p.say(U.pick(['ERM...', 'BUSTED.', 'FAIR ENOUGH!', 'WASNT ME!']), 2); n++; }
    return n;
  };

  // ================= drawing =================
  P.drawGround = function (ctx, left, top, S) {
    for (const s of P.spikes) { const sx = (s.x - left) * S, sy = (s.y - top) * S; if (sx < -60 || sy < -60 || sx > ctx.canvas.width + 60 || sy > ctx.canvas.height + 60) continue; const spr = SP.spikes(); ctx.save(); ctx.translate(Math.round(sx), Math.round(sy)); ctx.rotate(s.a); ctx.drawImage(spr, -s.len * S / 2, -2, s.len * S, 4); ctx.restore(); }
    const b = P.boat; if (b) { VH.drawRot(ctx, SP.boat(), (b.x - left) * S, (b.y - top) * S + Math.sin(G().t * 2) * 1, b.ang, 1, true); }
  };
  P.drawPeople = function (ctx, left, top, S) {
    for (const o of P.officers) { const fr = o.dive > 0 || o.downT > 0 || o.state === 'tackle' ? 0 : VH.walkFrame(o); const lying = o.downT > 0 || o.state === 'tackle'; ctx.fillStyle = 'rgba(20,20,45,0.35)'; ctx.fillRect(Math.round((o.x - left) * S) - 2, Math.round((o.y - top) * S) - 2, 7, 7); VH.drawRot(ctx, SP.person(o.rank === 'sergeant' ? '#5a7ab8' : '#7fa6d8', '#1a2236', fr, { hat: 'cop' }), (o.x - left) * S, (o.y - top) * S, o.ang + (lying ? Math.PI / 2 : 0)); if (o.rank === 'sergeant') { U.text(ctx, 'SARGE', (o.x - left) * S, (o.y - top) * S - 14, { align: 'center', color: '#9fd4ec' }); } }
    for (const d of P.darts) { ctx.strokeStyle = 'rgba(255,233,74,0.85)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo((d.o.x - left) * S, (d.o.y - top) * S); ctx.lineTo((d.x - left) * S, (d.y - top) * S); ctx.stroke(); ctx.fillStyle = '#fff'; ctx.fillRect(Math.round((d.x - left) * S) - 1, Math.round((d.y - top) * S) - 1, 2, 2); }
    const pl = G().player; if (pl.stunT > 0 && pl.onFoot) for (let i = 0; i < 3; i++) { const a = G().t * 8 + i * 2.1; ctx.fillStyle = '#ffe94a'; ctx.fillRect(Math.round((pl.x - left) * S + Math.cos(a) * 7), Math.round((pl.y - top) * S - 8 + Math.sin(a) * 3), 2, 2); }
  };
  // tracers, the chopper and its spotlight sit on top of the lighting
  P.drawAir = function (ctx, left, top, S, night) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const s of P.shots) { const x0 = (s.x - left) * S, y0 = (s.y - top) * S; ctx.strokeStyle = 'rgba(255,240,170,0.95)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 - s.vx * 0.035 * S, y0 - s.vy * 0.035 * S); ctx.stroke(); }
    const h = P.heli;
    if (h) { const sx = (h.sx - left) * S, sy = (h.sy - top) * S; const r = 10 * S; ctx.globalAlpha = night ? 0.35 : 0.18; ctx.drawImage(SP.light('#f4f8ff', 64), sx - r, sy - r, r * 2, r * 2); ctx.globalAlpha = 1; }
    ctx.restore();
    if (h) {
      const sx = (h.sx - left) * S, sy = (h.sy - top) * S; ctx.strokeStyle = 'rgba(244,248,255,0.55)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(sx, sy, 10 * S, 8 * S, 0, 0, U.TAU); ctx.stroke();
      const hx = (h.x - left) * S, hy = (h.y - top) * S;
      ctx.fillStyle = 'rgba(20,20,45,0.3)'; ctx.beginPath(); ctx.ellipse(hx + 40, hy + 70, 20, 7, 0, 0, U.TAU); ctx.fill(); // shadow far below
      const ang = Math.atan2(h.vy, h.vx || 0.01); VH.drawRot(ctx, SP.heli(), hx, hy, Math.hypot(h.vx, h.vy) > 1 ? ang : 0);
      ctx.strokeStyle = 'rgba(40,40,50,0.7)'; ctx.lineWidth = 1; for (let i = 0; i < 2; i++) { const a = h.rot + i * Math.PI / 2; ctx.beginPath(); ctx.moveTo(hx - Math.cos(a) * 26, hy - Math.sin(a) * 26); ctx.lineTo(hx + Math.cos(a) * 26, hy + Math.sin(a) * 26); ctx.stroke(); }
      if (Math.floor(G().t * 3) % 2) { ctx.fillStyle = '#ff3030'; ctx.fillRect(Math.round(hx) - 1, Math.round(hy) - 1, 2, 2); }
    }
  };
  P.lights = function (sources, glows) {
    const t = G().t; const ph = Math.floor(t * 8) % 2;
    for (const b of P.blocks) for (const v of b.cars) { sources.push({ x: v.x, y: v.y, r: 12, col: ph ? '#ff3030' : '#3070ff', a: 0.9 }); }
    if (P.boat) { const b = P.boat; sources.push({ x: b.x, y: b.y, r: 0, col: '#f4f8ff', a: 1, cone: { ang: b.beam || b.ang, len: 55 } }); glows.push({ x: b.x, y: b.y, r: 1.6, col: ph ? '#ff6060' : '#6090ff', a: 1 }); }
    if (P.heli) sources.push({ x: P.heli.sx, y: P.heli.sy, r: 12, col: '#f4f8ff', a: 1 });
  };
})(window.VH);
