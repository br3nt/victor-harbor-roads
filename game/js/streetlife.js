// Street life: loot crates and their (harmless) pickups, ways to shake the police (the panel beater's respray,
// the car wash and the jetty as hiding spots, swapping cars out of sight), doorbell cameras, the made-up
// community page and its comment feed, notoriety, and citizen's arrests you can wriggle out of.
'use strict';
(function (VH) {
  const U = VH.U, W = VH.World, SP = VH.Sprites, FX = VH.FX, PK = SP.PK;
  const sfx = (n, o) => window.SFX && SFX.play(n, o);
  const G = () => VH.Game;
  const SL = VH.Street = { crates: [], pickups: [], feed: null, notoriety: 0, scannerT: 0, popperT: 0, snagT: 0, spray: 0, grab: null, spots: [] };
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  SL.PAGE = 'VICTOR HARBOR LOCALS TALK'; // invented; not a real group or platform

  // ---------- setup ----------
  SL.init = function () {
    const P = G().places; const rnd = U.seeded(77123);
    const ok = (x, y) => { const g = W.groundAt(x, y); return g !== W.GC.BUILDING && g !== W.GC.SEA && g !== W.GC.WATER && W.roadDist(x, y) >= 2; };
    // crates: the industrial estate, car parks, alleys (service lanes) and the foreshore
    const near = (cx, cy, r, n) => { for (let i = 0, k = 0; i < 200 && k < n; i++) { const a = rnd() * U.TAU, d = rnd() * r; const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d; if (ok(x, y) && SL.crates.every(c => dist(c, { x, y }) > 25)) { SL.crates.push(VH.Props.add(PK.crate, x, y, rnd() * 0.6, { crate: true })); k++; } } };
    near(P.industrial.x, P.industrial.y, 200, 6); near(P.warland.x, P.warland.y, 220, 5); near(4600, 2600, 300, 6);
    for (const a of W.areas) if (a.k === 'paved' && SL.crates.length < 40 && Math.abs(a.bb[2] - a.bb[0]) > 25 && Math.hypot(a.bb[0] - 4500, a.bb[1] - 2700) < 1800 && rnd() < 0.5) near((a.bb[0] + a.bb[2]) / 2, (a.bb[1] + a.bb[3]) / 2, 10, 1);
    for (const e of W.edges) if (SL.crates.length < 48 && e.w <= 4.5 && Math.hypot(e.p[0] - 4500, e.p[1] - 2700) < 1500 && rnd() < 0.08) { const [x, y, a] = U.alongPoly(e.p, e.cum, e.len / 2); near(x + Math.sin(a) * 3, y - Math.cos(a) * 3, 3, 1); }
    // places to shake the police
    const roadAt = (x, y) => { const n = W.nearestEdge(x, y, 80); return n ? { x: n.x, y: n.y, a: n.ang } : { x, y, a: 0 }; };
    // respray shops live in shops.js (VH.Shops.resprays)
    SL.wash = { ...roadAt(4602, 2650), label: 'CAR WASH' };
    SL.jetty = { x: 5027, y: 3058, label: 'UNDER THE JETTY' };
    SL.spots = [SL.wash, SL.jetty];
    // batteries along footpaths near the foreshore and town, boost pads on the race routes
    SL.batteries = []; const rb = U.seeded(4242);
    const paths = W.roads.filter(r => (r.c === 'footway' || r.c === 'path' || r.c === 'cycleway') && Math.hypot(r.p[0] - 4600, r.p[1] - 2800) < 1400);
    for (let i = 0; i < 400 && SL.batteries.length < 18; i++) { const r = paths[Math.floor(rb() * paths.length)]; if (!r) break; const c = U.cumLen(r.p); const [x, y] = U.alongPoly(r.p, c, rb() * c[c.length - 1]); if (SL.batteries.every(b => dist(b, { x, y }) > 90)) SL.batteries.push({ x, y, respawn: 0 }); }
    SL.pads = [];
    for (const rc of VH.Acts.races.filter(r => r.id === 'gopher' || r.id === 'bike')) rc.cps.forEach((c, i) => { const n = rc.cps[i + 1]; if (n && i % 2 === 0) SL.pads.push({ x: c.x, y: c.y, a: Math.atan2(n.y - c.y, n.x - c.x) }); });
    // doorbell cameras on some houses (a blinking light by the door)
    for (const d of W.doors) d.cam = U.hash(Math.round(d.x * 3), Math.round(d.y * 3), 9) < 0.16;
  };
  SL.newNight = function () { SL.pickups = []; SL.feed = null; SL.scannerT = 0; SL.popperT = 0; SL.snagT = 0; SL.grab = null; for (const c of SL.crates) { c.up = true; c.t = 1; c.respawn = 0; } };
  SL.hidingSpot = function (x, y) { return SL.spots.some(s => dist(s, { x, y }) < 9); };

  // ---------- crates and pickups ----------
  const PICKUPS = [
    ['cash', 30, 'CASH'], ['boost', 14, 'BOOST'], ['tyres', 12, 'TYRE REPAIR'], ['voucher', 8, 'PANEL BEATER VOUCHER'],
    ['scanner', 10, 'POLICE SCANNER'], ['spray', 10, 'SPRAY PAINT'], ['popper', 9, 'PARTY POPPER'], ['snag', 9, 'SAUSAGE-SIZZLE SNAG'],
  ];
  SL.onCrate = function (p) {
    let r = Math.random() * PICKUPS.reduce((a, b) => a + b[1], 0); let pick = PICKUPS[0];
    for (const q of PICKUPS) { r -= q[1]; if (r <= 0) { pick = q; break; } }
    SL.pickups.push({ x: p.x, y: p.y, kind: pick[0], label: pick[2], t: 0 }); p.respawn = 120;
    FX.debris(p.x, p.y, ['#9a6e46', '#7a5434', '#c99a5a'], 10, 6); sfx('crunch');
  };
  SL.collect = function (k) {
    const g = G(), pl = g.player, v = pl.vehicle, P = VH.Police; let msg = '';
    if (k.kind === 'cash') { const c = 15 + Math.floor(Math.random() * 30); g.cash += c; msg = 'CASH +$' + c; sfx('cash'); }
    else if (k.kind === 'boost') { if (v) v.boostT = 6; else pl.boostT = 8; msg = 'BOOST!'; sfx('boost'); }
    else if (k.kind === 'tyres') { if (v && !v.rail) { v.flat = false; v.damage = Math.max(0, v.damage - 0.4); v.dead = false; msg = 'TYRES AND PANELS PATCHED UP'; } else { g.kitSaved = true; msg = 'TYRE REPAIR KIT: FIXES THE NEXT CAR YOU GET IN'; } sfx('pickup'); }
    else if (k.kind === 'voucher') { if (v && !v.rail && !v.def.heli && !v.def.bike && !v.def.gopher) { SL.respray(v, true); msg = 'INSTANT RESPRAY!'; } else { g.voucher = true; const r = VH.Shops.nearestRespray(pl.x, pl.y); msg = r ? `RESPRAY VOUCHER: ${r.name} · ${Math.round(dist(r, pl))}M (SPRAY CAN ON THE MAP)` : 'RESPRAY VOUCHER'; if (r) g.markRespray = { x: r.x, y: r.y, label: r.name, until: g.t + 90 }; } sfx('pickup'); }
    else if (k.kind === 'scanner') { SL.scannerT = 60; msg = 'POLICE SCANNER: PATROLS ON YOUR MAP FOR A MINUTE'; sfx('radio'); }
    else if (k.kind === 'spray') { SL.spray += 1; msg = 'SPRAY PAINT: SPACE BY A WALL TO TAG IT'; sfx('pickup'); }
    else if (k.kind === 'popper') { SL.popperT = 8; FX.confetti(pl.x, pl.y, 50); sfx('whoosh'); msg = 'POP! THE POLICE ARE LOOKING THE WRONG WAY'; }
    else if (k.kind === 'snag') { SL.snagT = 45; msg = 'SAUSAGE SIZZLE! NEIGHBOURHOOD WATCH STOPS FOR A SNAG'; sfx('pickup'); for (const w of g.watch) { w.ai = null; w.throttle = 0; FX.text(w.x, w.y - 3, 'OOH, A SNAG!', '#ffd23a'); } }
    g.toast(msg, '#ffd23a'); FX.text(pl.x, pl.y - 5, k.label, '#ffd23a');
  };
  // a fresh coat of paint: the police are looking for a different-coloured car now
  SL.respray = function (v, free) {
    const g = G(), P = VH.Police;
    const cols = SP.CAR_COLOURS.filter(c => c !== v.colour); v.colour = U.pick(cols); v.base = SP.vehicle(v.type, v.colour); v.sprite = v.base; v.damage = 0; v.flat = false; v.dead = false;
    g.meter = Math.max(0, g.meter - 2); P.desc = null; P.seenT = Math.max(P.seenT, 30); P.last = null;
    FX.add({ type: 'ring', x: v.x, y: v.y, vx: 0, vy: 0, life: 0.8, col: '#9be15d', size: 4 }); FX.smoke(v.x, v.y, '#e0e0e8', 8, 1.6, 1.5);
    g.toast(free ? 'VOUCHER RESPRAY: NOBODY WILL RECOGNISE IT' : 'FRESH COAT OF PAINT. NOBODY WILL RECOGNISE IT.', '#9be15d');
  };
  // Tags go where you can see them from above: the south-facing wall strip of a building, a shed roof, a fence, or
  // (failing all that) chalk on the footpath. Cheerful pictures only: a smiley, a star, a heart, a wave, a crown.
  const DESIGNS = [
    '.#####.|#.#.#.#|#.....#|#.###.#|.#####.', '...#...|..###..|#######|..#.#..|.#...#.', '.##.##.|#######|#######|.#####.|...#...',
    '.......|.##..##|#..##..|.......|##..##.', '#.#.#.#|#######|#.#.#.#|#######|.......',
  ].map(d => d.split('|').map(r => [...r].map(c => c === '#')));
  SL.tags = U.store.get('tags', []);
  SL.tag = function () {
    const g = G(), pl = g.player; if (!SL.spray) return false;
    let best = null, bd = 2.4;
    W.wallGrid.query(pl.x - 3, pl.y - 3, pl.x + 3, pl.y + 3, s => {
      const b = s.b; if (!b) return; const [d, qx, qy] = U.segPointDist(pl.x, pl.y, s.ax, s.ay, s.bx, s.by); if (d > bd) return;
      let nx = -(s.by - s.ay), ny = s.bx - s.ax; const L = Math.hypot(nx, ny) || 1; nx /= L; ny /= L; if (nx * (qx - b.cx) + ny * (qy - b.cy) < 0) { nx = -nx; ny = -ny; }
      const small = (b.bb[2] - b.bb[0]) * (b.bb[3] - b.bb[1]) < 60 || b.k === 'shed' || b.k === 'garage' || b.k === 'storage_tank';
      if (ny > 0.45) { bd = d; best = { kind: 'wall', x: qx, y: qy, h: Math.max(0.75, b.h * 0.3) }; }
      else if (small) { bd = d; best = { kind: 'roof', x: b.cx, y: b.cy - Math.max(0.75, b.h * 0.3) }; }
    });
    if (!best) { let f = null; VH.Props.near(pl.x, pl.y, 1.8, p => { if (p.k === PK.fence && p.up && dist(p, pl) < 1.8) f = p; }); if (f) best = { kind: 'fence', x: f.x, y: f.y - 0.4 }; }
    if (!best) { const gnd = W.groundAt(pl.x, pl.y); if (gnd === W.GC.PAVED || gnd === W.GC.ROAD) best = { kind: 'chalk', x: pl.x + Math.cos(pl.ang) * 1.2, y: pl.y + Math.sin(pl.ang) * 1.2 }; }
    if (!best) { g.toast('FIND A WALL FACING YOU, A SHED ROOF, A FENCE OR SOME FOOTPATH', '#ff9a30'); return true; }
    SL.spray--; best.d = Math.floor(Math.random() * DESIGNS.length); best.col = U.pick(best.kind === 'chalk' ? ['#f4c8e0', '#c8f0e8', '#fff2a8', '#d8c8ff'] : ['#ff4fa0', '#38e0c8', '#ffd23a', '#7c5cff', '#9be15d']);
    SL.tags.push(best); if (SL.tags.length > 60) SL.tags.shift(); U.store.set('tags', SL.tags);
    sfx('spray'); FX.add({ type: 'ring', x: best.x, y: best.y, vx: 0, vy: 0, life: 0.6, col: best.col, size: 2 });
    g.cash += 20; g.addMeter(best.kind === 'chalk' ? 0.1 : 0.3, best.kind === 'chalk' ? 'CHALK ART! +$20' : 'TAGGED! +$20'); VH.Missions.event('tag');
    return true;
  };
  SL.drawTags = function (ctx, left, top, S) {
    const vw = ctx.canvas.width / S, vh = ctx.canvas.height / S;
    for (const t of SL.tags) {
      if (t.x < left - 5 || t.y < top - 5 || t.x > left + vw + 5 || t.y > top + vh + 8) continue;
      const m = DESIGNS[t.d % DESIGNS.length]; const cell = t.kind === 'wall' ? Math.max(2, Math.round(t.h * S / 6)) : t.kind === 'chalk' ? 3 : 2;
      const w = 7 * cell, h = 5 * cell; const x0 = Math.round((t.x - left) * S - w / 2), y0 = Math.round((t.y - top - (t.kind === 'wall' ? t.h * 0.85 : 0)) * S - (t.kind === 'wall' ? 0 : h / 2));
      ctx.globalAlpha = t.kind === 'chalk' ? 0.75 : 1; ctx.fillStyle = t.col;
      for (let r = 0; r < 5; r++) for (let c = 0; c < 7; c++) if (m[r][c]) ctx.fillRect(x0 + c * cell, y0 + r * cell, cell, cell);
      ctx.globalAlpha = 1;
    }
  };

  // ---------- doorbell cameras and the community page ----------
  const COMMENTS = [
    // early: a mixed bag
    ['CALL THE POLICE!', 'BRUCE, IT\'S A DOORBELL, MATE.', 'HARMLESS FUN. WE ALL DID IT.', 'IS THAT THE KID FROM THE BAKERY?', 'MY DOG BARKED AT 9:14 TOO!!', 'SCHOOLIES. EVERY YEAR. STREWTH.', 'LOVELY HYDRANGEAS THOUGH, BEV', 'GO BACK TO BED, GARY'],
    // building: more grumbling
    ['THIS IS THE THIRD ONE TONIGHT', 'SOMEONE RING THE COUNCIL', 'RIGHT, I\'M GETTING MY TORCH', 'DRONGO. ABSOLUTE DRONGO.', 'NOT SO HARMLESS NOW IS IT', 'I\'VE SEEN THAT SHIRT ON THE ESPLANADE', 'KEEP YOUR EYES PEELED, PEOPLE'],
    // notorious: the whole town is on the lookout
    ['THAT\'S THEM! THE ONE FROM ALL THE VIDEOS!', 'NEIGHBOURHOOD WATCH, ASSEMBLE', 'IF YOU SEE THEM, GRAB THEM. POLITELY.', 'I\'M PRINTING A POSTER', 'FAMOUS NOW. FAMOUS FOR THE WRONG REASONS.', 'MUM IF YOU\'RE READING THIS IT WASN\'T ME'],
  ];
  const POSTS = ['ANYONE KNOW THIS KID? RANG MY BELL AT {T}', 'CAUGHT ON THE DOORBELL CAM AGAIN. SCHOOLIES?', 'WHO IS THIS?? SHARE PLEASE', 'DOORBELL CAM CAUGHT SOMEONE CREEPING ABOUT. THOUGHTS?'];
  SL.caughtOnCam = function (d) {
    const g = G(); if (g.char === 'cop') return; d.camUntil = g.t + 30;
    SL.notoriety = Math.min(6, SL.notoriety + 1); g.addMeter(0.4);
    const hh = Math.floor(g.hour), mm = Math.floor((g.hour % 1) * 60); const t = `${hh % 12 || 12}:${String(mm).padStart(2, '0')}${hh >= 12 ? 'PM' : 'AM'}`;
    const tier = SL.notoriety <= 1 ? 0 : SL.notoriety <= 3 ? 1 : 2;
    const pool = [...COMMENTS[tier], ...(tier ? COMMENTS[tier - 1].slice(0, 3) : [])].sort(() => Math.random() - 0.5).slice(0, 5);
    SL.feed = { t: 0, post: U.pick(POSTS).replace('{T}', t), comments: pool, likes: 3 + Math.floor(Math.random() * 20) * SL.notoriety };
    sfx('sms'); FX.text(d.x, d.y - 4, 'DOORBELL CAMERA!', '#7fa6ff');
    g.toast(`CAUGHT ON A DOORBELL CAMERA. NOTORIETY ${SL.notoriety}`, '#7fa6ff');
  };

  // ---------- citizen's arrest: a resident grabs your collar; wriggle free if you're not too notorious ----------
  SL.grabbed = function (who) {
    const g = G(); if (SL.grab || VH.Tackle.on || g.state !== 'play') return;
    SL.grab = { who }; who.say && who.say(U.pick(["GOTCHA, YOU LITTLE RASCAL!", "CITIZEN'S ARREST!", 'NOT SO FAST!']), 3); sfx('megaphone');
    VH.Tackle.start({ mode: 'escape', rank: 'watch', who, startCuff: Math.min(0.4, SL.notoriety * 0.07),
      onWin: () => { SL.grab = null; FX.text(g.player.x, g.player.y - 4, 'WRIGGLED FREE!', '#9be15d'); g.addMeter(0.5); if (who.state != null) { who.state = 'sit'; who.t = 0; } },
      onLose: () => { SL.grab = null; g.toast("THEY'VE GOT YOU BY THE COLLAR. HERE COMES THE PADDY WAGON.", '#ff6a5a'); g.busted(); } });
  };
  // notorious: bystanders recognise you, retirees have a go
  SL.updateRecognise = function (dt) {
    const g = G(), pl = g.player; if (g.char === 'cop' || !pl.onFoot || SL.notoriety < 2) return;
    SL.recT = (SL.recT || 0) - dt; if (SL.recT > 0) return;
    for (const p of g.peds) {
      if (p.tag || p.state === 'dive' || dist(p, pl) > 7) continue;
      if (Math.random() < 0.004 * SL.notoriety) {
        SL.recT = 6; p.say("IT'S THAT KID FROM THE COMMUNITY PAGE!", 2.5); g.addMeter(0.3);
        if (p.kind === 'retiree' && SL.notoriety >= 3 && dist(p, pl) < 3) SL.grabbed(p);
        break;
      }
    }
  };

  SL.update = function (dt) {
    const g = G(), pl = g.player, P = VH.Police;
    SL.scannerT = Math.max(0, SL.scannerT - dt); SL.popperT = Math.max(0, SL.popperT - dt); SL.snagT = Math.max(0, SL.snagT - dt);
    if (pl.boostT > 0) pl.boostT -= dt; // vehicle boosts count down in Vehicle.update
    // crates come back slowly, when nobody's looking
    for (const c of SL.crates) if (!c.up && c.respawn > 0) { c.respawn -= dt; if (c.respawn <= 0 && dist(c, pl) > 120) { c.up = true; c.t = 1; c.fly = null; } else if (c.respawn <= 0) c.respawn = 5; }
    // pickups
    for (const k of SL.pickups) { k.t += dt; if (dist(k, pl) < (pl.onFoot ? 1.6 : 3)) { k.got = true; SL.collect(k); } }
    SL.pickups = SL.pickups.filter(k => !k.got && k.t < 90);
    const v = pl.vehicle;
    // respray shops: drive in and stop
    for (const r of VH.Shops.resprays) {
      const near = v && dist(v, r) < 9;
      if (near && !v.rail && !v.def.heli && !v.def.bike && !v.def.gopher && v.speed < 3 && !(r.cool > 0)) {
        r.cool = 8;
        if (g.voucher) { g.voucher = false; SL.respray(v, true); }
        else if (g.cash >= r.cost) { g.cash -= r.cost; SL.respray(v); sfx('cash'); }
        else g.toast(r.name + ': A RESPRAY IS $25. COME BACK WITH CASH.', '#ff9a30');
      }
      if (r.cool > 0 && !near) r.cool -= dt;
    }
    // gopher batteries on the footpaths, boost pads on the foreshore path and the grand prix route
    const gv = v && v.def.gopher ? v : null;
    for (const b of SL.batteries) {
      if (b.respawn > 0) { b.respawn -= dt; continue; }
      if (gv && dist(gv, b) < 2.4) { b.respawn = 60; gv.boostT = 4 * (g.upgrades.doubleBattery ? 1.6 : 1); sfx('boost'); g.callout('BATTERY BOOST!', '#9be15d'); }
    }
    for (const p of SL.pads) if (v && (v.def.gopher || v.def.bike) && dist(v, p) < 2.6 && !(p.cool > 0)) { p.cool = 1.5; v.boostT = Math.max(v.boostT || 0, 2.5 * (g.upgrades.doubleBattery && v.def.gopher ? 1.4 : 1)); sfx('boost', { pitch: 1.4 }); }
    for (const p of SL.pads) if (p.cool > 0) p.cool -= dt;
    if (g.markRespray && g.t > g.markRespray.until) g.markRespray = null;
    // doorbell cameras catch anyone loitering at the front door
    if (g.char !== 'cop') W.doorGrid.query(pl.x - 4, pl.y - 4, pl.x + 4, pl.y + 4, d => { if (d.cam && dist(d, pl) < 3 && pl.onFoot && !(g.t < (d.camUntil || 0))) SL.caughtOnCam(d); });
    if (SL.feed) { SL.feed.t += dt; if (SL.feed.t > 9) SL.feed = null; }
    SL.updateRecognise(dt);
  };

  // ---------- drawing ----------
  SL.drawGround = function (ctx, left, top, S) {
    const t = G().t; SL.drawTags(ctx, left, top, S); const vw = ctx.canvas.width / S, vh = ctx.canvas.height / S; const inView = (q, m = 15) => q.x > left - m && q.y > top - m && q.x < left + vw + m && q.y < top + vh + m;
    for (const k of SL.pickups) if (inView(k)) {
      const sx = Math.round((k.x - left) * S), sy = Math.round((k.y - top) * S - 4 - Math.abs(Math.sin(t * 3 + k.x)) * 3);
      ctx.fillStyle = 'rgba(20,20,45,0.35)'; ctx.fillRect(sx - 3, Math.round((k.y - top) * S), 7, 3);
      ctx.fillStyle = '#120c24'; ctx.fillRect(sx - 5, sy - 5, 11, 11); ctx.fillStyle = { cash: '#9be15d', boost: '#7c5cff', tyres: '#c9ccd8', voucher: '#38e0c8', scanner: '#3070ff', spray: '#ff4fa0', popper: '#ffd23a', snag: '#c8701e' }[k.kind] || '#fff'; ctx.fillRect(sx - 4, sy - 4, 9, 9);
      U.text(ctx, { cash: '$', boost: '>', tyres: 'O', voucher: 'V', scanner: 'S', spray: '*', popper: '!', snag: '=' }[k.kind] || '?', sx - 2, sy - 3, { color: '#120c24', shadow: false });
    }
    for (const b of SL.batteries) if (b.respawn <= 0 && inView(b)) { const sx = Math.round((b.x - left) * S), sy = Math.round((b.y - top) * S - 3 - Math.abs(Math.sin(t * 4 + b.x)) * 2); ctx.fillStyle = '#120c24'; ctx.fillRect(sx - 3, sy - 5, 7, 10); ctx.fillStyle = '#9be15d'; ctx.fillRect(sx - 2, sy - 4, 5, 8); ctx.fillStyle = '#fff'; ctx.fillRect(sx - 1, sy - 6, 3, 1); ctx.fillStyle = '#120c24'; ctx.fillRect(sx, sy - 2, 1, 4); ctx.fillRect(sx - 1, sy - 1, 3, 1); }
    for (const p of SL.pads) if (inView(p)) { ctx.save(); ctx.translate(Math.round((p.x - left) * S), Math.round((p.y - top) * S)); ctx.rotate(p.a); for (let i = 0; i < 3; i++) { const ph = ((t * 3 + i) % 3) / 3; ctx.strokeStyle = `rgba(56,224,200,${0.4 + ph * 0.6})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo((-1.5 + i * 1.2) * S, -1.2 * S); ctx.lineTo((-0.6 + i * 1.2) * S, 0); ctx.lineTo((-1.5 + i * 1.2) * S, 1.2 * S); ctx.stroke(); } ctx.restore(); }
    for (const s of [SL.wash, SL.jetty]) if (s && inView(s, 30)) {
      const sx = Math.round((s.x - left) * S), sy = Math.round((s.y - top) * S);
      if (s === SL.wash) { ctx.fillStyle = 'rgba(80,140,200,0.35)'; ctx.fillRect(sx - 4 * S, sy - 3 * S, 8 * S, 6 * S); ctx.strokeStyle = '#9fd4ec'; ctx.strokeRect(sx - 4 * S, sy - 3 * S, 8 * S, 6 * S); }
      U.text(ctx, s.label, sx, sy - 5 * S - 10, { align: 'center', color: '#9fd4ec' });
    }
  };
  // blinking lights on doorbell cameras (after the lighting, so they read at night)
  SL.drawCams = function (ctx, left, top, S) {
    const on = Math.floor(G().t * 2) % 2; if (!on) return; const vw = ctx.canvas.width / S, vh = ctx.canvas.height / S;
    W.doorGrid.query(left, top, left + vw, top + vh, d => { if (d.cam) { ctx.fillStyle = '#5fb0ff'; ctx.fillRect(Math.round((d.x - left) * S) + 2, Math.round((d.y - top) * S) - 2, 2, 2); } });
  };
  // the community-page post and its comments rolling in
  SL.drawFeed = function (ctx, ts) {
    const f = SL.feed; if (!f) return; const w = ctx.canvas.width, h = ctx.canvas.height;
    const pw = Math.min(200 * ts, w * 0.45); const x = w - pw - 4 * ts; const n = Math.min(f.comments.length, Math.floor(f.t / 1.2));
    const lines = U.wrap('"' + f.post + '"', Math.floor((pw - 10 * ts) / (6 * ts)));
    const ph = (22 + lines.length * 9 + n * 10) * ts; const y = Math.round(h * 0.42 - ph / 2);
    const a = f.t > 8 ? Math.max(0, 9 - f.t) : 1; ctx.globalAlpha = a;
    VH.UI.panel(ctx, x, y, pw, ph, { accent: '#3070ff', fill: 'rgba(14,20,40,0.92)' });
    U.text(ctx, SL.PAGE, x + 5 * ts, y + 4 * ts, { color: '#7fa6ff', scale: ts });
    lines.forEach((l, i) => U.text(ctx, l, x + 5 * ts, y + 14 * ts + i * 9 * ts, { color: '#f4f0ff', scale: ts }));
    for (let i = 0; i < n; i++) { const c = f.comments[i]; U.text(ctx, '> ' + (c.length * 6 * ts > pw - 12 * ts ? c.slice(0, Math.floor((pw - 18 * ts) / (6 * ts))) + '.' : c), x + 5 * ts, y + (16 + lines.length * 9 + i * 10) * ts, { color: '#c9d4f0', scale: ts }); }
    ctx.globalAlpha = 1;
  };

})(window.VH);
