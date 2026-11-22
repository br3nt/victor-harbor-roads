// Story and jobs for the three characters across three nights of Schoolies week.
'use strict';
(function (VH) {
  const U = VH.U, W = VH.World, FX = VH.FX, SP = VH.Sprites, PK = SP.PK;
  const sfx = (n, o) => window.SFX && SFX.play(n, o);
  const M = VH.Missions = { char: null, night: 1, idx: 0, job: null, done: [] };
  const G = () => VH.Game;
  const pl = () => G().player;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const inVeh = () => !pl().onFoot && pl().vehicle;

  M.NIGHTS = ['THURSDAY', 'FRIDAY', 'SATURDAY'];

  // pick n doors near a centre, spread out
  function pickDoors(cx, cy, n, radius = 300, spacing = 45) {
    const out = []; const cand = W.doors.filter(d => Math.hypot(d.x - cx, d.y - cy) < radius).sort(() => Math.random() - 0.5);
    for (const d of cand) { if (out.every(o => Math.hypot(o.x - d.x, o.y - d.y) > spacing)) out.push(d); if (out.length >= n) break; }
    return out;
  }
  function pickProps(kind, cx, cy, n, radius, spacing = 50) {
    const out = []; const cand = VH.Props.list.filter(p => kinds(kind).includes(p.k) && p.up && Math.hypot(p.x - cx, p.y - cy) < radius).sort(() => Math.random() - 0.5);
    for (const p of cand) { if (out.every(o => Math.hypot(o.x - p.x, o.y - p.y) > spacing)) out.push(p); if (out.length >= n) break; }
    return out;
  }
  const kinds = k => Array.isArray(k) ? k : [k];
  function roadNear(x, y, r = 120) { const n = W.nearestEdge(x, y, r); return n ? { x: n.x, y: n.y, a: n.ang, n } : { x, y, a: 0 }; }

  // ================= JOB FACTORIES =================
  const J = {};
  J.chipRun = () => ({
    title: 'CHIP RUN', from: 'THE CREW', pay: 15,
    brief: "STARVING. GRAB CHIPS FROM THE FISH SHOP ON THE FORESHORE AND BRING EM TO WARLAND RESERVE. WATCH THE GULLS, THEY'RE ORGANISED.",
    init() { this.stage = 0; this.time = 150; },
    targets() { return this.stage === 0 ? [{ ...G().places.fishShop, label: 'FISH SHOP' }] : [{ ...G().places.warland, label: 'THE CREW', r: 16 }]; },
    objective() { return this.stage === 0 ? 'GET THE CHIPS FROM THE FISH SHOP' : `DELIVER THE CHIPS (${pl().chips} LEFT, NEED 4)`; },
    update(dt) {
      this.time -= dt; if (this.time <= 0) return this.fail("THE CREW ATE SOMEONE ELSE'S CHIPS");
      if (this.stage === 0 && dist(pl(), G().places.fishShop) < 9) { this.stage = 1; pl().chips = 12; sfx('pickup'); FX.text(pl().x, pl().y - 3, 'CHIPS! (12)', '#f2c94a'); G().toast('THE GULLS HAVE NOTICED', '#ff9a30'); }
      if (this.stage === 1) {
        if (pl().chips < 4) return this.fail('THE GULLS GOT THE CHIPS');
        if (dist(pl(), G().places.warland) < 18) { this.bonus = pl().chips * 2; pl().chips = 0; FX.confetti(pl().x, pl().y, 30); return 'done'; }
      }
    },
  });
  // hiding next to cover while standing still: bushes and trees, fences, bins, letterboxes, benches, parked cars
  M.inCover = function () {
    const p = pl(); if (!p.onFoot || Math.hypot(p.vx, p.vy) > 0.6) return false;
    let c = false; VH.Props.trees.query(p.x - 3, p.y - 3, p.x + 3, p.y + 3, t => { if (Math.hypot(t.x - p.x, t.y - p.y) < 2.6) c = true; });
    if (!c) VH.Props.near(p.x, p.y, 2, q => { if (q.up && [PK.fence, PK.binR, PK.binY, PK.binG, PK.bin, PK.letterbox, PK.bench, PK.crate].includes(q.k) && Math.hypot(q.x - p.x, q.y - p.y) < 1.8) c = true; });
    if (!c) for (const v of G().vehicles) if (!v.removed && !v.ai && !v.rail && Math.hypot(v.x - p.x, v.y - p.y) < 3.2) { c = true; break; }
    return c;
  };
  const GRUMBLES = ['WHO\'S THERE?!', 'BLOODY KIDS...', 'I KNOW YOU\'RE OUT THERE!', 'COME OUT, I WON\'T BITE!', 'NOT AGAIN...', 'I\'VE GOT A TORCH AND I\'M NOT AFRAID TO USE IT'];
  J.dingDong = (n = 4, centre = { x: 4380, y: 2250 }) => ({
    title: 'DING DONG DITCH', from: 'THE CREW', pay: 40,
    brief: `CLASSIC. RING ${n} DOORBELLS (SPACE AT THE DOOR), THEN HIDE: DUCK BEHIND A BUSH, FENCE, BIN OR PARKED CAR AND KEEP STILL. DON'T GET CAUGHT IN THE TORCH. MIND THE DOORBELL CAMERAS (BLINKING BLUE LIGHTS).`,
    init() { this.doors = pickDoors(centre.x, centre.y, n + 4, 380, 40).filter(d => !d.cam || Math.random() < 0.3); this.left = this.doors.slice(0, n); this.spare = this.doors.slice(n); this.done = 0; this.ring = null; this.res = null; this.time = 300; },
    targets() { return this.ring || this.res ? [] : this.left.map(d => ({ x: d.x, y: d.y, label: 'DOOR', r: 2.5 })); },
    objective() {
      if (this.res) return M.inCover() ? 'HIDDEN. KEEP STILL...' : 'HIDE! STAND STILL BEHIND COVER, OUT OF THE TORCH';
      return this.ring ? 'HIDE BEFORE THEY OPEN THE DOOR!' : `RING DOORBELLS: ${this.done}/${n}`;
    },
    update(dt) {
      this.time -= dt; if (this.time <= 0) return this.fail('EVERYONE WENT TO BED');
      if (!this.ring && !this.res && this.left.length < n - this.done) return this.fail('THE WHOLE STREET IS AWAKE');
      if (this.ring) {
        this.ring.t -= dt;
        if (this.ring.t <= 0) {
          // out they come, in a dressing gown, with a torch. Some are quick, some thorough, some bring the dog.
          const d = this.ring.d; d.lit = 30; this.ring = null;
          const type = U.pick(['quick', 'thorough', 'dog']); const p = new VH.Ped('retiree', d.x, d.y, { shirt: U.pick(['#b07aa8', '#7a8ab0', '#c08a6a']), tag: 'resident' });
          p.state = 'idle'; p.dog = type === 'dog'; p.say(U.pick(GRUMBLES), 2.5); G().peds.push(p);
          const pts = []; const k = type === 'thorough' ? 6 : 4; const R = type === 'thorough' ? 15 : 11;
          for (let i = 0; i < k; i++) { const a = Math.random() * U.TAU, r = U.rand(4, R); const x = d.x + Math.cos(a) * r, y = d.y + Math.sin(a) * r; if (W.groundAt(x, y) !== W.GC.BUILDING) pts.push({ x, y }); }
          pts.push({ x: d.x, y: d.y });
          this.res = { p, d, type, pts, i: 0, t: 0, dur: type === 'quick' ? 7 : type === 'thorough' ? 14 : 10, sp: type === 'quick' ? 3.4 : type === 'thorough' ? 1.8 : 2.4, ang: Math.atan2(pl().y - d.y, pl().x - d.x), seenT: 0, sniffT: 0 };
          sfx('door');
        }
        return;
      }
      if (this.res) {
        const r = this.res, p = r.p; r.t += dt;
        if (VH.Street.grab) return; // mid citizen's arrest
        const tgt = r.pts[Math.min(r.i, r.pts.length - 1)]; const dx = tgt.x - p.x, dy = tgt.y - p.y, d = Math.hypot(dx, dy);
        if (d > 0.4) { const st = Math.min(d, r.sp * dt); p.x += dx / d * st; p.y += dy / d * st; p.anim += st * 3; r.ang += U.angDiff(r.ang, Math.atan2(dy, dx)) * Math.min(1, dt * 3); }
        else if (r.i < r.pts.length - 1) { r.i++; if (Math.random() < 0.4) p.say(U.pick(GRUMBLES), 2); }
        p.ang = r.ang; r.torch = r.ang + Math.sin(r.t * 2.4) * 0.6;
        // caught in the torch beam (or sniffed out by the dog)?
        const px = pl().x - p.x, py = pl().y - p.y, pd = Math.hypot(px, py);
        const inBeam = pd < 11 && Math.abs(U.angDiff(r.torch, Math.atan2(py, px))) < 0.42 && VH.AI.los(p.x, p.y, pl().x, pl().y);
        const hidden = M.inCover();
        r.seenT = inBeam && (!hidden || pd < 2.5) ? r.seenT + dt : Math.max(0, r.seenT - dt);
        if (r.type === 'dog' && pd < 5) { r.sniffT += dt; if (r.sniffT > 1.4 && !r.barked) { r.barked = true; p.say('WOOF! WOOF!', 1.5); } } else r.sniffT = Math.max(0, r.sniffT - dt);
        if ((r.seenT > 0.35 || r.sniffT > 2) && !pl().onFoot) { r.seenT = 0; r.sniffT = 0; G().addMeter(0.6, 'SPOTTED FROM THE PORCH!'); }
        else if (r.seenT > 0.35 || r.sniffT > 2) {
          FX.text(p.x, p.y - 4, r.sniffT > 2 ? 'THE DOG FOUND YOU!' : 'GOT YOU!', '#ff6a5a'); G().addMeter(1, 'SPOTTED!');
          p.x = pl().x - 1; p.y = pl().y; VH.Street.grabbed(p);
          this.left = this.left.filter(x => x !== r.d); if (this.spare.length) this.left.push(this.spare.shift());
          this.res = null; p.tag = null; p.state = 'walk'; return;
        }
        if (r.t > r.dur || pd > 45) {
          // back inside, none the wiser
          this.done++; G().cash += 5; FX.text(r.d.x, r.d.y - 3, pd > 45 ? 'MUST HAVE BEEN THE WIND' : 'HMPH. BLOODY POSSUMS.', '#fff'); sfx('cash');
          this.left = this.left.filter(x => x !== r.d); p.removedTag = true; G().peds = G().peds.filter(q => q !== p); this.res = null;
          if (this.done >= n) return 'done';
        }
      }
    },
    on(ev) {
      if (ev !== 'use' || this.ring || this.res || !pl().onFoot) return false;
      const d = this.left.find(d => dist(pl(), d) < 3); if (!d) return false;
      sfx('doorbell'); FX.text(d.x, d.y - 3, 'DING DONG!', '#ffd23a'); this.ring = { d, t: 3.2 }; return true;
    },
    cleanup() { if (this.res) { this.res.p.tag = null; this.res = null; } },
    torch() { return this.res ? this.res : null; },
  });
  J.doughnuts = (metres = 250) => ({
    title: 'DOUGHNUTS ON THE GREEN', from: 'BRODIE', pay: 50,
    brief: `LEGEND STATUS REQUIRES DOUGHNUTS ON THE GOLF COURSE. BORROW A CAR, GET TO THE VICTOR HARBOR GOLF CLUB AND CHEW UP ${metres}M OF FAIRWAY.`,
    init() { this.m = 0; this.time = 240; },
    targets() { return this.m > 0 ? [] : [{ ...G().places.golf, label: 'GOLF CLUB', r: 30 }]; },
    objective() { return !inVeh() ? 'BORROW A CAR (E NEAR ONE)' : `TYRE MARKS ON THE GOLF COURSE: ${Math.floor(this.m)}/${metres}M`; },
    update(dt) { this.time -= dt; if (this.time <= 0) return this.fail('THE GREENKEEPER WOKE UP'); if (this.m >= metres) return 'done'; },
    on(ev, d) {
      if (ev === 'tracks' && G().golfArea && U.pointInPoly(d.v.x, d.v.y, G().golfArea.p)) {
        const before = Math.floor(this.m / 50); this.m += d.len; if (Math.floor(this.m / 50) > before) { FX.text(pl().x, pl().y - 3, Math.floor(this.m) + 'M!', '#9be15d'); G().addMeter(0.15); }
      }
      return false;
    },
  });
  J.railRide = (kind, opts) => ({
    title: opts.title, from: opts.from, pay: opts.pay, brief: opts.brief,
    init() { this.time = opts.time; this.v = G().specials[kind]; this.v.s = Math.min(this.v.s, 60); this.v.place(); },
    targets() { const v = this.v; if (pl().vehicle !== v) return [{ x: v.x, y: v.y, label: kind === 'tram' ? 'HORSE TRAM' : 'STEAM TRAIN', r: 4 }]; const [x, y] = U.alongPoly(v.route.p, v.route.cum, v.len - 8); return [{ x, y, label: opts.dest, r: 12 }]; },
    objective() { return pl().vehicle === this.v ? `${opts.verb} (${Math.max(0, Math.floor(this.v.len - 20 - this.v.s))}M TO GO)` : `GET ON THE ${kind === 'tram' ? 'HORSE TRAM' : 'STEAM TRAIN'} (E)`; },
    update(dt) { this.time -= dt; if (this.time <= 0) return this.fail(opts.failMsg); if (pl().vehicle === this.v && this.v.s >= this.v.len - 20) { FX.confetti(pl().x, pl().y, 40); sfx(kind === 'tram' ? 'bell_tram' : 'whistle_train'); return 'done'; } },
  });
  J.bluff = (finale) => ({
    title: 'MIDNIGHT AT THE BLUFF', from: finale.from, pay: finale.pay, brief: finale.brief,
    init() { this.stage = 0; this.t = 0; },
    targets() { return this.stage ? [] : [{ ...G().places.bluffTop, label: 'THE BLUFF', r: 30 }]; },
    objective() { return this.stage ? '...' : 'GET TO THE TOP OF THE BLUFF (ROSETTA HEAD)'; },
    update(dt) {
      if (this.stage === 0 && dist(pl(), G().places.bluffTop) < 45) {
        this.stage = 1; const h = G().hour; if (!(h >= 23.8 || h < 1)) { G().hour = 23.95; G().toast('YOU WAIT FOR MIDNIGHT. THE FOG ROLLS IN...', '#80fff0'); }
        const gw = G().ghostWhale; gw.x = pl().x + 40; gw.y = pl().y - 30; gw.home = { x: pl().x, y: pl().y - 20 }; G().forceGhost = true; sfx('ghost'); sfx('whale');
      }
      if (this.stage === 1) { this.t += dt; if (Math.random() < dt * 0.5) sfx('ghost', { vol: 0.4 }); if (this.t > 7) { G().forceGhost = false; return 'done'; } }
    },
  });
  // ---- grump ----
  J.letters = (n = 5) => ({
    title: 'STRONGLY WORDED LETTERS', from: 'MERV (TO HIMSELF)', pay: 15,
    brief: `FIVE LETTERS OF COMPLAINT. FIVE LETTERBOXES. PULL UP NEXT TO EACH ONE AND PRESS SPACE. NEATLY.`,
    init() { this.boxes = pickProps(PK.letterbox, 4300, 2500, n, 420, 60); this.done = 0; this.time = 300; },
    targets() { return this.boxes.map(b => ({ x: b.x, y: b.y, label: 'LETTERBOX', r: 3 })); },
    objective() { return `LETTERS DELIVERED: ${this.done}/${n}`; },
    update(dt) {
      this.time -= dt; if (this.time <= 0) return this.fail('THE POST HAS GONE');
      const b = this.boxes.find(b => dist(pl(), b) < 4 && (pl().onFoot || pl().vehicle.speed < 2.5));
      if (b && (this.auto || !pl().onFoot)) this.deliver(b);
      if (this.done >= n) return 'done';
    },
    deliver(b) { this.boxes = this.boxes.filter(x => x !== b); this.done++; sfx('pickup'); FX.paper(b.x, b.y, 3); FX.text(b.x, b.y - 3, b.up ? U.pick(['DEAR SIR OR MADAM...', 'TO WHOM IT MAY CONCERN', 'I AM WRITING TO COMPLAIN', 'FURTHERMORE...', 'P.S. TURN IT DOWN']) : 'POSTED... SORT OF', '#fff'); },
    on(ev) { if (ev === 'use') { const b = this.boxes.find(b => dist(pl(), b) < 4); if (b) { this.deliver(b); return true; } } return false; },
  });
  J.unplug = (n = 3) => ({
    title: 'TURN THAT DOWN', from: 'MERV (TO HIMSELF)', pay: 30,
    brief: `THREE BACKYARD DOOF-DOOFS. GET CLOSE AND SHOUT (H) TO SCATTER THE KIDS, THEN KNOCK THE SPEAKER OVER.`,
    init() {
      this.spots = []; const doors = pickDoors(4100, 3000, n, 700, 150);
      for (const d of doors) {
        const sp = VH.Props.add(PK.speaker, U.lerp(d.x, d.lx, 0.45), U.lerp(d.y, d.ly, 0.45), 0, { mission: true });
        const kids = []; for (let i = 0; i < 5; i++) { const p = new VH.Ped('schoolie', sp.x + U.rand(-4, 4), sp.y + U.rand(-4, 4), { state: 'dance', tag: 'doof', home: { x: sp.x, y: sp.y } }); kids.push(p); G().peds.push(p); }
        this.spots.push({ sp, kids, scattered: false });
      }
      this.time = 300;
    },
    targets() { return this.spots.filter(s => s.sp.up).map(s => ({ x: s.sp.x, y: s.sp.y, label: 'DOOF-DOOF', r: 8 })); },
    objective() { const left = this.spots.filter(s => s.sp.up).length; return `SPEAKERS SILENCED: ${this.spots.length - left}/${this.spots.length}`; },
    update(dt) {
      this.time -= dt; if (this.time <= 0) return this.fail('THE DOOF GOES ON');
      for (const s of this.spots) if (s.sp.up && Math.random() < dt * 2 && dist(pl(), s.sp) < 120) FX.note(s.sp.x, s.sp.y);
      if (this.spots.every(s => !s.sp.up)) { this.cleanup(); return 'done'; }
    },
    cleanup() { for (const s of this.spots) { for (const k of s.kids) { k.tag = null; k.home = null; if (k.state === 'dance') k.state = 'walk'; } if (s.sp.up) { s.sp.up = false; s.sp.t = 1; s.sp.x = -999; s.sp.y = -999; } } },
    on(ev, p) {
      if (ev === 'shout') for (const s of this.spots) if (!s.scattered && dist(pl(), s.sp) < 14) { s.scattered = true; for (const k of s.kids) { k.state = 'flee'; k.t = -2; k.ang = Math.atan2(k.y - pl().y, k.x - pl().x); k.say(U.pick(['RUN!', 'ITS MERV!', 'SORRY MR!']), 2); } }
      if (ev === 'use') { const s = this.spots.find(s => s.sp.up && dist(pl(), s.sp) < 3); if (s) { VH.Props.topple(s.sp, pl().ang, 4, 'player'); return true; } }
      return false;
    },
  });
  J.bigRig = () => ({
    title: 'THE BIG RIG', from: 'MERV (TO HIMSELF)', pay: 50,
    brief: "THERE'S A B-DOUBLE PARKED AT THE MAUDE STREET INDUSTRIAL ESTATE. 'BORROW' IT AND PARK IT ACROSS THE ESPLANADE BY WARLAND RESERVE. NOTHING GETS IN, NOTHING GETS OUT.",
    init() { let t = G().specials.truck; if (!t || t.removed || t.sinking || t.dead) { t = G().park('truck', G().places.industrial, { colour: '#c9372e' }); G().specials.truck = t; } this.truck = t; this.time = 360; this.goal = roadNear(G().places.warland.x, G().places.warland.y - 40, 120); },
    targets() { if (pl().vehicle !== this.truck) return [{ x: this.truck.x, y: this.truck.y, label: 'B-DOUBLE', r: 6 }]; return [{ ...this.goal, label: 'PARK HERE', r: 14 }]; },
    objective() { return pl().vehicle !== this.truck ? 'GET IN THE B-DOUBLE' : this.truck.speed > 1 ? 'PARK IT BY WARLAND RESERVE' : 'STOP IN THE ZONE'; },
    update(dt) {
      this.time -= dt; if (this.time <= 0) return this.fail('THE PARTY GOT ITS ICE DELIVERY');
      if (!this.truck || this.truck.removed) return this.fail('YOU LOST THE TRUCK');
      if (pl().vehicle === this.truck && dist(this.truck, this.goal) < 16 && this.truck.speed < 1) { FX.text(this.truck.x, this.truck.y - 4, 'BLOCKED!', '#ffd23a'); return 'done'; }
    },
  });
  J.lightsOut = (n = 5) => ({
    title: 'LIGHTS OUT', from: 'MERV (TO HIMSELF)', pay: 40,
    brief: `CAN'T PARTY IN THE DARK. KNOCK OVER ${n} STREET LIGHTS WITHIN 250M OF WARLAND RESERVE.`,
    init() { this.n = 0; this.time = 240; },
    targets() { const out = []; VH.Props.near(G().places.warland.x, G().places.warland.y, 250, p => { if (p.k === PK.lamp && p.up && out.length < 8 && dist(p, G().places.warland) < 250) out.push({ x: p.x, y: p.y, label: '', r: 1, small: true }); }); return out; },
    objective() { return `STREET LIGHTS DOWN: ${this.n}/${n}`; },
    update(dt) { this.time -= dt; if (this.time <= 0) return this.fail('THE PARTY IS STILL LIT'); if (this.n >= n) return 'done'; },
    on(ev, p) { if (ev === 'smash' && p.k === PK.lamp && dist(p, G().places.warland) < 250) this.n++; return false; },
  });
  J.shutdown = () => ({
    title: 'SHUT IT DOWN', from: 'MERV (TO HIMSELF)', pay: 100,
    brief: "SATURDAY. THE BIG ONE. GET TO WARLAND RESERVE, FLATTEN ALL FOUR SPEAKER STACKS AND BOTH INFLATABLE FLAMINGOS. BY GOPHER, BY TRUCK, BY WHATEVER.",
    init() { this.time = 300; },
    targets() { return G().partyProps.filter(p => p.up).map(p => ({ x: p.x, y: p.y, label: p.k === PK.speaker ? 'SPEAKER' : 'FLAMINGO', r: 2 })); },
    objective() { const left = G().partyProps.filter(p => p.up).length; return `PARTY GEAR LEFT: ${left}`; },
    update(dt) {
      this.time -= dt; if (this.time <= 0) return this.fail('THE PARTY ROLLS ON TILL DAWN');
      if (G().partyProps.every(p => !p.up)) { G().partyOn = false; for (const p of G().peds) if (p.tag === 'party') { p.tag = null; p.home = null; p.state = 'flee'; p.t = -3; p.ang = U.rand(0, U.TAU); p.say(U.pick(['AWW MERV!', 'PARTY POOPER!', 'FAIR ENOUGH', 'SORRY MERV!']), 3); } return 'done'; }
    },
    on(ev) { if (ev === 'use') { const p = G().partyProps.find(p => p.up && dist(pl(), p) < 3); if (p) { VH.Props.topple(p, pl().ang, 4, 'player'); return true; } } return false; },
  });
  // ---- cop ----
  J.gopherPatrol = (n = 3) => ({
    title: 'GOPHER PATROL', from: 'SARGE', pay: 30,
    brief: `KEV, COMPLAINTS ABOUT GOPHERS ON THE MAIN ROADS AGAIN. PULL OVER ${n}. SIREN ON (H), SIT BEHIND THEM FOR A BIT.`,
    init() { this.done = 0; this.time = 300; this.marked = []; this.spawn(); },
    spawn() {
      while (this.marked.length < n - this.done) {
        const nn = W.randomRoadPoint(pl().x, pl().y, 120, 380, e => e.w >= 7 && e.speed > 10); if (!nn) break;
        const v = new VH.Vehicle('gopher', nn.x, nn.y, nn.ang, { colour: U.pick(['#c4372e', '#2e5a9a', '#3d7a3a']) }); VH.AI.attach(v, nn, nn.e.ow === -1 ? -1 : 1); v.mission = true; v.rider = true; this.marked.push(v); G().vehicles.push(v); v.pullT = 0;
      }
    },
    targets() { return this.marked.filter(v => !v.removed).map(v => ({ x: v.x, y: v.y, label: 'GOPHER', r: 3 })); },
    cleanup() { for (const v of this.marked) v.mission = false; },
    objective() { return `GOPHERS PULLED OVER: ${this.done}/${n}`; },
    update(dt) {
      this.time -= dt; if (this.time <= 0) return this.fail('THE GOPHERS GOT AWAY (SLOWLY)');
      const pv = pl().vehicle;
      for (const v of this.marked) {
        if (v.removed) continue;
        if (pv && pv.siren && dist(pv, v) < 16) { v.pullT += dt; if (v.pullT > 1.8) { this.done++; v.ai = null; v.mission = false; v.throttle = 0; FX.text(v.x, v.y - 3, U.pick(["I'M DOING 10, OFFICER!", 'IS THIS ABOUT THE ROSES?', 'MY HIP, KEVIN!']), '#fff'); FX.text(v.x, v.y - 6, 'TICKETED +$10', '#ffd23a'); G().cash += 10; sfx('cash'); v.pulled = true; } }
        else v.pullT = Math.max(0, v.pullT - dt);
      }
      this.marked = this.marked.filter(v => !v.pulled && !v.removed);
      if (this.done >= n) return 'done';
      if (this.marked.length < n - this.done) this.spawn();
    },
  });
  J.catchDitchers = (n = 3) => ({
    title: 'DING DONG DITCHERS', from: 'SARGE', pay: 40,
    brief: `PHONE'S RINGING OFF THE HOOK. KIDS RINGING DOORBELLS IN ENCOUNTER BAY. CATCH ${n} OF THEM: GET OUT AND RUN THEM DOWN ON FOOT. THE MEGAPHONE (H) STOPS THEM IN THEIR TRACKS.`,
    init() {
      this.kids = []; const doors = pickDoors(2900, 4300, 18, 450, 25);
      for (let i = 0; i < n; i++) { const p = new VH.Ped('schoolie', doors[i].x, doors[i].y, { tag: 'ditcher' }); p.state = 'goto'; p.route = doors.slice(i * 5, i * 5 + 6); if (p.route.length < 2) p.route = doors.slice(0, 6); p.ri = 1; p.gx = p.route[1 % p.route.length].x; p.gy = p.route[1 % p.route.length].y; p.speed = 1.6; p.caughtT = 0; this.kids.push(p); G().peds.push(p); }
      this.done = 0; this.time = 300;
    },
    targets() { return this.kids.filter(k => !k.caught).map(k => ({ x: k.x, y: k.y, label: 'DITCHER', r: 2 })); },
    cleanup() { for (const k of this.kids) { k.tag = null; if (!k.caught) { k.state = 'walk'; k.ai = null; } else k.t = 0; } },
    objective() { return `DITCHERS CAUGHT: ${this.done}/${n}`; },
    update(dt) {
      this.time -= dt; if (this.time <= 0) return this.fail('THEY ALL GOT HOME TO MUM');
      for (const k of this.kids) {
        if (k.caught) continue;
        if (k.state === 'idle') { const d = k.route[k.ri % k.route.length]; if (d) { sfx('doorbell', { vol: dist(k, pl()) < 80 ? 0.4 : 0 }); d.lit = 5; } k.ri++; const nd = k.route[k.ri % k.route.length]; k.state = 'goto'; k.gx = nd.x; k.gy = nd.y; }
        if (k.state === 'walk') { k.state = 'goto'; const nd = k.route[k.ri % k.route.length]; k.gx = nd.x; k.gy = nd.y; }
        // Kev has to get out and run them down on foot; then it's cuffs
        const near = pl().onFoot && dist(k, pl()) < 1.8;
        if (dist(k, pl()) < 14 && !k.fleeing) { k.fleeing = true; k.say('RUN!'); }
        k.speed = k.fleeing ? 3.4 : 1.6;
        if (near && !k.cuffed && !VH.Tackle.on && !(k.slipT > 0)) {
          VH.Tackle.start({ mode: 'hold', rank: 'kid', who: k, onWin: () => { k.cuffed = true; }, onLose: () => { k.slipT = 2.5; k.fleeing = true; k.state = 'flee'; k.t = -1.5; k.ang = Math.atan2(k.y - pl().y, k.x - pl().x); k.say('SEE YA, KEV!', 2); } });
          k.frozen = 99;
        }
        if (k.slipT > 0) k.slipT -= dt;
        if (!VH.Tackle.on || VH.Tackle.on.who !== k) k.frozen = 0;
        if (k.cuffed) { k.caughtT += dt; if (k.caughtT > 0) { k.caught = true; sfx('clang', { pitch: 2.2, vol: 0.6 }); FX.text(k.x, k.y - 10, 'CLICK!', '#c9ccd8'); k.state = 'sit'; k.t = -100; k.tag = 'caught'; this.done++; k.say(U.pick(["WASN'T ME!", 'MY DAD KNOWS THE MAYOR!', 'FAIR COP.']), 3); FX.text(k.x, k.y - 7, 'NABBED +$10', '#ffd23a'); G().cash += 10; sfx('cash'); VH.Lockup.arrest('A DING DONG DITCHER', k.x, k.y); } }
        else k.caughtT = 0;
      }
      if (this.done >= n) return 'done';
    },
  });
  J.runawayTram = () => ({
    title: 'RUNAWAY TRAM', from: 'SARGE', pay: 50,
    brief: "SCHOOLIES HAVE PINCHED THE HORSE TRAM AND THEY'RE HEADING FOR GRANITE ISLAND. GET ALONGSIDE WITH THE SIREN ON FOR A FEW SECONDS. MIND THE HORSE.",
    init() { const t = G().specials.tram; t.s = 30; t.v = 0; t.place(); t.missionDrive = true; t.throttle = 1; t.brake = 0; this.t = t; this.hold = 0; this.time = null; this.crew = new VH.Ped('schoolie', t.x, t.y, { tag: 'tramkid' }); this.crew.state = 'ride'; G().peds.push(this.crew); },
    targets() { return [{ x: this.t.x, y: this.t.y, label: 'TRAM', r: 6 }]; },
    objective() { return `STOP THE TRAM (${Math.floor(this.hold / 3 * 100)}%)`; },
    update(dt) {
      const t = this.t; t.throttle = 1; t.brake = 0; const cp = t.parts[1] || t; this.crew.x = cp.x; this.crew.y = cp.y; this.crew.ang = cp.a || 0;
      if (t.s >= t.len - 20) { t.missionDrive = false; return this.fail('THEY MADE IT TO GRANITE ISLAND'); }
      const pv = pl().vehicle; const close = dist(pl(), t.parts[1] || t) < 12 && (pl().onFoot || (pv && pv.siren));
      this.hold = close ? this.hold + dt : Math.max(0, this.hold - dt * 0.5);
      if (this.hold > 3) { t.missionDrive = false; t.throttle = 0; t.brake = 1; this.crew.state = 'flee'; this.crew.t = 0; this.crew.tag = null; this.crew.say('WE WERE GONNA BRING IT BACK!', 3); VH.Lockup.arrest('THE TRAM-JACKER', this.crew.x, this.crew.y); return 'done'; }
    },
    cleanup() { this.t.missionDrive = false; this.crew.tag = null; if (this.crew.state === 'ride') { this.crew.state = 'flee'; this.crew.t = 0; } },
  });
  J.hoonChase = () => ({
    title: 'HOON ON THE ESPLANADE', from: 'SARGE', pay: 60,
    brief: "KEV, A HOON IN A RED HATCH IS DOING DOUGHNUTS DOWN ON THE ESPLANADE. STOP THEM: NUDGE A BACK CORNER TO SPIN THEM (PIT), DROP A SPIKE STRIP (X) IN THEIR PATH, OR CALL BACKUP (B) TO BOX THEM IN. THEN DRIVE THEM UP THE HILL TO THE LOCK-UP.",
    init() {
      const n = W.nearestEdge(4760, 2800, 120) || W.randomRoadPoint(pl().x, pl().y, 200, 400);
      const v = new VH.Vehicle('hatch', n.x, n.y, n.ang, { colour: '#d6302a' }); VH.AI.attach(v, n, 1); v.ai.mode = 'hoon'; v.mission = true; v.hoon = true; G().vehicles.push(v);
      this.v = v; this.stage = 0; this.time = 360; this.caughtT = 0; this.delivered = false; this.runner = null;
    },
    chase() { return this.stage === 0 && this.v && this.v.ai && this.v.ai.flee ? this.v : null; },
    targets() { if (this.stage === 0) { const t = this.runner || this.v; return [{ x: t.x, y: t.y, label: 'HOON', r: 4 }]; } return [VH.Lockup.target()]; },
    objective() {
      if (this.stage === 1) return `DRIVE THE HOON UP TO THE LOCK-UP (${Math.round(dist(pl(), VH.Lockup.door))}M)`;
      if (this.runner) return 'THE HOON IS ON FOOT: RUN THEM DOWN (MEGAPHONE: H)';
      return this.v.ai && this.v.ai.flee ? 'STOP THE HOON: PIT (RAM A BACK CORNER), SPIKES (X), BACKUP (B)' : 'FIND THE HOON ON THE ESPLANADE';
    },
    update(dt) {
      this.time -= dt; if (this.time <= 0) return this.fail('THE HOON WENT HOME FOR TEA');
      const v = this.v;
      if (this.stage === 0) {
        if (v.removed || v.sinking) return this.fail('THE HOON ENDED UP IN THE DRINK. NO HARM DONE, LOTS OF PAPERWORK.');
        const ai = v.ai;
        if (this.runner) {
          const r = this.runner; if (r.state === 'walk') { r.state = 'flee'; r.t = -4; r.ang = Math.atan2(r.y - pl().y, r.x - pl().x); }
          r.fleeing = true;
          if (pl().onFoot && dist(r, pl()) < 1.7 && !r.cuffed && !VH.Tackle.on && !(r.slipT > 0)) {
            r.frozen = 99; VH.Tackle.start({ mode: 'hold', rank: 'hoon', who: r, onWin: () => { r.cuffed = true; r.frozen = 0; }, onLose: () => { r.frozen = 0; r.slipT = 2.5; r.state = 'flee'; r.t = -3; r.ang = Math.atan2(r.y - pl().y, r.x - pl().x); r.say('TOO SLIPPERY FOR YOU, KEV!', 2); } });
          }
          if (r.slipT > 0) r.slipT -= dt;
          if (!VH.Tackle.on || VH.Tackle.on.who !== r) r.frozen = 0;
          if (r.cuffed && this.stage === 0) {
            this.stage = 1; r.state = 'sit'; r.t = -100; r.tag = 'caught'; sfx('clang', { pitch: 2.2, vol: 0.6 }); FX.text(r.x, r.y - 10, 'CLICK!', '#c9ccd8');
            r.say(U.pick(['FAIR COP, OFFICER.', 'I WAS JUST WARMING THE TYRES!', "DON'T TELL MUM."]), 3);
            if (!VH.Lockup.arrest('THE HOON', r.x, r.y)) G().custody.push('THE HOON');
            G().toast('CUFFED. BACK IN THE CAR AND UP TO THE LOCK-UP', '#9fd4ec');
          }
          if (dist(pl(), r) > 400) return this.fail('THE HOON GOT AWAY ON FOOT');
        } else if (ai && ai.mode === 'hoon') {
          // doughnuts until Kev turns up
          v.throttle = 1; v.steer = 1; v.handbrake = Math.sin(G().t * 1.5) > -0.3 ? 1 : 0; v.brake = 0;
          if (dist(pl(), v) < 45) { ai.mode = 'cruise'; ai.flee = pl(); v.def.maxV = 33; ai.s = 0; const n = W.nearestEdge(v.x, v.y, 40); if (n) { ai.e = n.e; ai.s = n.s; ai.dir = 1; } G().toast('THE HOON HAS SPOTTED YOU!', '#ff6a5a'); sfx('horn'); }
        } else if (ai) {
          ai.flee = pl();
          const pv = pl().vehicle; const near = dist(pl(), v) < 12;
          const stopped = v.speed < 2.5 || v.dead || (v.flat && v.speed < 5);
          this.caughtT = near && stopped ? this.caughtT + dt : Math.max(0, this.caughtT - dt * 0.5);
          if (this.caughtT > 0.8 && !this.runner) {
            // the hoon bails out and legs it: Kev gets out and runs them down
            v.ai = null; v.mission = false; v.throttle = 0; v.brake = 1; v.handbrake = 1;
            const a = Math.atan2(v.y - pl().y, v.x - pl().x); const r = new VH.Ped('schoolie', v.x + Math.cos(a) * 2, v.y + Math.sin(a) * 2, { tag: 'hoon', shirt: '#d6302a' });
            r.state = 'flee'; r.ang = a; r.t = -6; r.say('NOT TODAY, KEV!', 2); G().peds.push(r); this.runner = r; G().toast('THE HOON HAS BAILED! GET OUT AND CATCH THEM', '#ff6a5a');
          }
          if (dist(pl(), v) > 650) return this.fail('THE HOON GOT AWAY');
        }
      } else if (this.delivered) return 'done';
    },
    on(ev, d) { if (ev === 'deliver' && this.stage === 1 && d.includes('THE HOON')) this.delivered = true; return false; },
    cleanup() { if (this.v) { this.v.mission = false; if (this.v.ai) { this.v.ai.flee = null; this.v.ai.mode = 'cruise'; } } if (this.runner) { this.runner.tag = null; this.runner = null; } },
  });
  J.bins = (n = 8) => ({
    title: 'BIN NIGHT BANDITS', from: 'SARGE', pay: 30,
    brief: `SOME LITTLE DARLINGS KNOCKED OVER EVERY BIN IN THE STREET. COMMUNITY POLICING, KEV. ON FOOT, STAND ${n} BINS BACK UP (SPACE).`,
    init() {
      const c = pl(); this.bins = pickProps([PK.binR, PK.binY, PK.binG], c.x + 200, c.y - 100, n, 500, 6);
      if (this.bins.length < n) this.bins = this.bins.concat(pickProps([PK.binR, PK.binY, PK.binG], 4200, 2400, n - this.bins.length, 600, 6));
      for (const b of this.bins) { b.up = false; b.fa = U.rand(0, U.TAU); b.t = 1; }
      this.done = 0; this.time = 300;
    },
    targets() { return this.bins.filter(b => !b.up).map(b => ({ x: b.x, y: b.y, label: 'BIN', r: 2 })); },
    objective() { return `BINS STOOD UP: ${this.done}/${this.bins.length}` + (pl().onFoot ? '' : ' (GET OUT OF THE CAR)'); },
    update(dt) { this.time -= dt; if (this.time <= 0) return this.fail('THE BIN TRUCK CAME AND WENT'); if (this.done >= this.bins.length) return 'done'; },
    on(ev) { if (ev === 'use' && pl().onFoot) { const b = this.bins.find(b => !b.up && dist(pl(), b) < 2.5); if (b) { b.up = true; b.t = 1; this.done++; sfx('clang', { pitch: 1.2, vol: 0.5 }); FX.text(b.x, b.y - 3, U.pick(['TIDY!', 'COMMUNITY SPIRIT!', 'THERE WE GO.']), '#9be15d'); return true; } } return false; },
  });
  J.midnightExpress = () => ({
    title: 'MIDNIGHT EXPRESS', from: 'SARGE', pay: 60,
    brief: "SOMEONE'S STOLEN THE STEAM TRAIN. YES, THE STEAM TRAIN. IT'S HEADING EAST OUT OF THE STATION. CATCH UP AND RUN THE SIREN NEXT TO THE ENGINE TILL THEY GIVE UP.",
    init() { const t = G().specials.train; t.s = 70; t.v = 0; t.place(); t.missionDrive = true; t.maxV = 11; this.t = t; this.hold = 0; },
    targets() { return [{ x: this.t.x, y: this.t.y, label: 'STEAM TRAIN', r: 6 }]; },
    objective() { return `STOP THE TRAIN (${Math.floor(this.hold / 3 * 100)}%)`; },
    update(dt) {
      const t = this.t; t.throttle = 1; t.brake = 0; if (Math.random() < dt * 0.15) sfx('whistle_train', { vol: 0.5 });
      if (t.s >= t.len - 10) { t.missionDrive = false; return this.fail('IT RAN OUT OF TRACK. AND MAP.'); }
      const pv = pl().vehicle; const close = dist(pl(), t.parts[0]) < 14 && (pl().onFoot || (pv && pv.siren));
      this.hold = close ? this.hold + dt : Math.max(0, this.hold - dt * 0.4);
      if (this.hold > 3) { t.missionDrive = false; t.throttle = 0; t.brake = 1; t.maxV = 22; FX.text(t.x, t.y - 5, 'ALRIGHT, ALRIGHT!', '#fff'); VH.Lockup.arrest('THE TRAIN ROBBERS', t.x, t.y); return 'done'; }
    },
    cleanup() { this.t.missionDrive = false; this.t.maxV = 22; },
  });

  // ================= STORY =================
  M.STORY = {
    schoolie: [
      [J.chipRun(), J.dingDong(4)],
      [J.doughnuts(250), J.railRide('tram', { title: 'TRAM-JACKING', from: 'THE CREW', pay: 60, time: 300, dest: 'GRANITE ISLAND', verb: 'GIDDY UP TO GRANITE ISLAND', failMsg: 'THE HORSE WANTS HIS BED', brief: "THE HORSE TRAM'S PARKED AT THE VICTOR END OF THE CAUSEWAY. TAKE IT ALL THE WAY TO GRANITE ISLAND. HOLD SHIFT TO GIDDY UP." })],
      [J.railRide('train', { title: 'THE LAST TRAIN', from: 'BRODIE', pay: 80, time: 330, dest: 'END OF THE LINE', verb: 'FULL STEAM EAST', failMsg: 'OUT OF STEAM', brief: 'THE STEAM TRAIN IS SITTING AT THE STATION. NOBODY IS WATCHING IT. DRIVE IT EAST PAST HAYBOROUGH TO THE END OF THE LINE. TOOT TOOT (H).' }),
        J.bluff({ from: 'UNKNOWN NUMBER', pay: 100, brief: "THEY SAY IF YOU'RE ON TOP OF THE BLUFF AT MIDNIGHT IN SCHOOLIES WEEK, SOMETHING COMES OUT OF THE FOG. GO SEE. IF YOU DARE." })],
    ],
    grump: [
      [J.letters(5), J.unplug(3)],
      [J.bigRig(), J.lightsOut(5)],
      [J.shutdown()],
    ],
    cop: [
      [J.gopherPatrol(3), J.catchDitchers(3)],
      [J.runawayTram(), J.hoonChase(), J.bins(8)],
      [J.midnightExpress(), J.bluff({ from: 'SARGE', pay: 80, brief: 'KEV. STRANGE LIGHTS REPORTED ON TOP OF THE BLUFF. PROBABLY KIDS. GO HAVE A LOOK AND THEN GO HOME, MATE.' })],
    ],
    roam: [[]],
  };
  M.WIN = {
    schoolie: { title: 'SCHOOLIES LEGEND', text: "THE GHOST WHALE WINKED AT YOU. NOBODY WILL BELIEVE IT. EVERYONE WILL TALK ABOUT IT FOR YEARS." },
    grump: { title: 'PEACE AND QUIET', text: "THE DOOF HAS STOPPED. MERV SLEEPS LIKE A BABY. NEXT YEAR'S SCHOOLIES ARE ALREADY PLANNING THEIR REVENGE." },
    cop: { title: 'CONSTABLE OF THE YEAR (RUNNER-UP)', text: 'KEV FILED HIS REPORT: "WHALE, GHOST, FLYING. NO FURTHER ACTION." THE SARGE HAS ASKED HIM TO TAKE SOME LEAVE.' },
  };

  M.begin = function (char) { M.char = char; M.night = 1; M.idx = 0; M.job = null; M.toNight(1); };
  M.toNight = function (n) {
    M.night = n; M.idx = 0; G().night = n; G().startNight(); if (M.char !== 'roam') U.store.set('save', { char: M.char, night: n, cash: G().cash, upgrades: G().upgrades });
    M.prepJob(); G().state = 'brief'; G().stateT = 0; G().briefNight = true;
  };
  M.jobs = () => (M.STORY[M.char] || [[]])[M.night - 1] || [];
  M.prepJob = function () {
    const proto = M.jobs()[M.idx]; M.job = null;
    if (!proto) return;
    M.job = Object.create(proto); M.job.started = false;
  };
  M.startJob = function () {
    if (G().char === 'cop') { const pv = pl().vehicle; const car = G().vehicles.find(v => v.owned && v.type === 'police' && !v.removed && !v.sinking && !v.dead); if (!car) { const v = G().park('police', G().places.police, { colour: '#fff' }); v.owned = true; v.parked = false; G().toast('THE SARGE LENT YOU A SPARE CAR (AT THE STATION)', '#7fa6ff'); } }
    if (!M.job) return;
    M.job.fail = reason => { M.failReason = reason; return 'fail'; };
    M.job.init(); M.job.started = true; M.job.bonus = 0;
  };
  M.update = function (dt) {
    for (const d of W.doors) if (d.lit > 0) d.lit -= dt;
    if (G().char === 'roam') return;
    const h = G().hour; if (h >= 5.5 && h < 12) { G().state = 'sunrise'; G().stateT = 0; sfx('fail'); return; }
    const j = M.job; if (!j || !j.started) return;
    const r = j.update(dt);
    if (r === 'done') {
      const pay = j.pay + (j.bonus || 0); G().cash += pay; sfx('win'); FX.confetti(pl().x, pl().y, 40); FX.flash = 0.5;
      G().toast(`JOB DONE: ${j.title} +$${pay}`, '#9be15d'); j.cleanup && j.cleanup();
      if (M.char === 'grump' && j.title === 'TURN THAT DOWN') { G().upgrades.turbo = true; VH.Shops.applyGopher(); G().toast('YOUR GRANDSON SOUPED UP THE GOPHER. HOLD SHIFT TO BOOST!', '#38e0c8'); }
      M.idx++;
      if (M.idx >= M.jobs().length) {
        if (M.night >= 3) { G().state = 'win'; G().stateT = 0; U.store.set('save', null); const best = U.store.get('wins', {}); best[M.char] = true; U.store.set('wins', best); }
        else { G().state = 'nightEnd'; G().stateT = 0; }
        M.job = null;
      } else { M.prepJob(); G().pendingBrief = 1.6; }
    } else if (r === 'fail') {
      sfx('fail'); G().toast('JOB FAILED: ' + (M.failReason || ''), '#ff6a5a'); j.cleanup && j.cleanup(); M.prepJob(); G().pendingBrief = 2;
    }
  };
  M.event = function (name, data) { const j = M.job; if (j && j.started && j.on) return j.on(name, data); return false; };
  M.targets = function () {
    const t = (M.job && M.job.started ? M.job.targets() : []).concat(VH.Acts.targets());
    // Kev with someone in the back: the lock-up is always marked
    if (G().char === 'cop' && G().custody && G().custody.length && !t.some(x => x.label === 'LOCK-UP')) t.push(VH.Lockup.target());
    const mr = G().markRespray; if (mr) t.push({ x: mr.x, y: mr.y, label: 'RESPRAY', r: 6 });
    return t;
  };
  M.chaseTarget = () => (M.job && M.job.started && M.job.chase ? M.job.chase() : M.job && M.job.started && M.job.t && M.job.t.missionDrive ? M.job.t : null);
  M.objective = () => G().char === 'roam' ? 'FREE ROAM: T CHANGES THE TIME OF DAY' : M.job && M.job.started ? M.job.objective() : '';
  M.timer = () => M.job && M.job.started && M.job.time != null ? M.job.time : null;

  // the resident's torch: a light in the night, plus a faint visible cone so the sweep reads
  M.torch = () => (M.job && M.job.started && M.job.torch ? M.job.torch() : null);
  M.drawTorch = function (ctx, left, top, S) {
    const r = M.torch(); if (!r) return; const p = r.p; const sx = (p.x - left) * S, sy = (p.y - top) * S;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.28; ctx.fillStyle = '#fff3c0';
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.arc(sx, sy, 11 * S, r.torch - 0.42, r.torch + 0.42); ctx.closePath(); ctx.fill(); ctx.restore();
    if (M.inCover()) { const q = pl(); U.text(ctx, 'HIDDEN', (q.x - left) * S, (q.y - top) * S - 16, { align: 'center', color: '#9be15d' }); }
  };
  // world markers: pulsing rings and bobbing arrows
  M.drawWorld = function (ctx, left, top, S, scale) {
    const t = performance.now() / 1000;
    for (const tg of M.targets()) {
      const sx = (tg.x - left) * S, sy = (tg.y - top) * S; if (sx < -50 || sy < -50 || sx > ctx.canvas.width + 50 || sy > ctx.canvas.height + 50) continue;
      const r = Math.max(3, (tg.r || 3) * S) * (1 + Math.sin(t * 4) * 0.08);
      ctx.strokeStyle = tg.small ? 'rgba(255,210,58,0.7)' : '#ffd23a'; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(sx, sy, r, r * 0.8, 0, 0, U.TAU); ctx.stroke();
      if (!tg.small) {
        const by = sy - r - 8 - Math.abs(Math.sin(t * 3)) * 5;
        ctx.fillStyle = '#1a1030'; ctx.beginPath(); ctx.moveTo(sx - 5, by - 1); ctx.lineTo(sx + 5, by - 1); ctx.lineTo(sx, by + 6); ctx.fill();
        ctx.fillStyle = '#ffd23a'; ctx.beginPath(); ctx.moveTo(sx - 4, by); ctx.lineTo(sx + 4, by); ctx.lineTo(sx, by + 5); ctx.fill();
        if (tg.label) U.text(ctx, tg.label, sx, by - 10, { align: 'center', color: '#ffd23a' });
      }
    }
  };
})(window.VH);
