// Street furniture, pedestrians, seagulls, whales, and the AI driving (traffic, pursuit, fleeing).
'use strict';
(function (VH) {
  const U = VH.U, W = VH.World, SP = VH.Sprites, FX = VH.FX;
  const sfx = (n, o) => window.SFX && SFX.play(n, o);
  const PK = SP.PK;
  const G = () => VH.Game;

  // ================= PROPS =================
  const PROP_R = { [PK.lamp]: 0.3, [PK.signal]: 0.3, [PK.bin]: 0.35, [PK.letterbox]: 0.3, [PK.fence]: 1.0, [PK.chair]: 0.3, [PK.table]: 0.5, [PK.bench]: 0.8,
    [PK.bollard]: 0.2, [PK.hydrant]: 0.2, [PK.phonebox]: 0.7, [PK.binR]: 0.38, [PK.binY]: 0.38, [PK.binG]: 0.38, [PK.speaker]: 0.9, [PK.flamingo]: 1.4, [PK.esky]: 0.4, [PK.cone]: 0.25, [PK.ball]: 0.25, [PK.crate]: 0.75 };
  const Props = VH.Props = { list: [], grid: new U.Grid(10), trees: new U.Grid(10), smashed: 0 };
  Props.init = function (raw) {
    for (const r of raw) {
      const k = r[0], x = r[1] / 10, y = r[2] / 10, a = r[3];
      if (k === PK.tree) { Props.trees.add({ x, y, r: 0.45 }, x, y); continue; }
      if (k === PK.bush) continue;
      Props.add(k, x, y, a);
    }
  };
  Props.add = function (k, x, y, a = 0, extra) {
    const p = { k, x, y, a, up: true, fa: 0, t: 1, r: PROP_R[k] || 0.3, lit: k === PK.lamp, gx: x, gy: y, ...extra };
    Props.list.push(p); Props.grid.add(p, x, y); return p;
  };
  Props.solidNear = (x, y, r, fn) => Props.trees.query(x - r - 1, y - r - 1, x + r + 1, y + r + 1, t => fn(t.x, t.y, t.r));
  Props.near = (x, y, r, fn) => Props.grid.query(x - r - 2, y - r - 2, x + r + 2, y + r + 2, fn);
  const SMASH = {
    [PK.lamp]: p => { sfx('pole'); FX.sparks(p.x, p.y, 16); FX.glass(p.x + Math.cos(p.fa) * 7.5, p.y + Math.sin(p.fa) * 7.5, 8); FX.kick(0.25); p.lit = false; },
    [PK.signal]: p => { sfx('pole', { pitch: 1.3 }); FX.sparks(p.x, p.y, 10); FX.glass(p.x, p.y, 4); FX.kick(0.2); },
    [PK.letterbox]: p => { sfx('clang', { pitch: 1.4 }); FX.paper(p.x, p.y, 6); },
    [PK.fence]: p => { sfx('crunch'); FX.debris(p.x, p.y, ['#4e5a52', '#6f7d73', '#3a443d'], 5, 4, { stay: Math.random() < 0.5 }); },
    [PK.chair]: p => { sfx('clang', { pitch: 1.8, vol: 0.5 }); }, [PK.table]: p => { sfx('clang', { pitch: 1.6, vol: 0.6 }); },
    [PK.bench]: p => { sfx('crunch', { pitch: 0.8 }); FX.debris(p.x, p.y, ['#7a5434', '#9a6e46'], 4, 3); },
    [PK.hydrant]: p => { sfx('clang', { pitch: 0.7 }); p.gush = 8; },
    [PK.phonebox]: p => { sfx('smash'); FX.glass(p.x, p.y, 14); FX.kick(0.3); },
    [PK.speaker]: p => { sfx('crash', { vol: 0.7 }); FX.sparks(p.x, p.y, 12); FX.kick(0.3); },
    [PK.flamingo]: p => { sfx('whoosh', { pitch: 0.6 }); FX.confetti(p.x, p.y, 20); },
    [PK.esky]: p => { sfx('thud'); FX.debris(p.x, p.y, ['#c9d6e8', '#fff'], 8, 4); },
    [PK.cone]: p => { sfx('thud', { pitch: 1.5, vol: 0.5 }); },
    [PK.crate]: p => { VH.Street && VH.Street.onCrate(p); },
  };
  const binSmash = p => { sfx('clang'); FX.paper(p.x, p.y, 5); FX.debris(p.x, p.y, ['#6a5a40', '#c8c0a8', '#8fa070', '#e0d8c0'], 6, 3.5, { stay: true, life: 1.2 }); };
  // kicked (or blown) things fly in an arc, bounce and roll; a footy just keeps going
  Props.KICKABLE = [PK.bin, PK.binR, PK.binY, PK.binG, PK.cone, PK.esky, PK.chair, PK.ball, PK.crate];
  Props.kick = function (p, dir, power, by) {
    const ball = p.k === PK.ball;
    if (p.up && !ball) Props.topple(p, dir, 6, by); else p.fa = dir;
    const pw = power * (ball ? 1.7 : p.k === PK.cone || p.k === PK.chair ? 1.1 : 0.8);
    p.fly = { vx: Math.cos(dir) * pw, vy: Math.sin(dir) * pw, z: 0.3, vz: pw * (ball ? 0.75 : 0.5), spin: U.rand(-14, 14) };
    sfx(ball ? 'kick' : 'thud', { pitch: ball ? 1.2 : 1.4, vol: 0.7 });
  };
  Props.topple = function (p, dir, speed, by) {
    if (!p.up) { // already down: shove it along a bit
      const push = Math.min(2.5, speed * 0.05); p.x += Math.cos(dir) * push; p.y += Math.sin(dir) * push; p.fa += U.rand(-0.4, 0.4); if (speed > 6 && Math.random() < 0.2) sfx('thud', { vol: 0.3 }); return;
    }
    p.up = false; p.fa = dir + U.rand(-0.5, 0.5); p.t = 0;
    if (p.k === PK.fence) p.fa = p.a + (Math.cos(dir - p.a - Math.PI / 2) > 0 ? 0.1 : -0.1);
    (SMASH[p.k] || binSmash)(p);
    Props.smashed++;
    G() && G().onSmash && G().onSmash(p, by);
  };
  Props.collideVehicle = function (v) {
    if (v.removed || v.sinking || v.scripted || v.z > 0.3) return;
    const spd = v.speed; if (spd < 0.8) return;
    v.eachCircle((cx, cy, r) => Props.near(cx, cy, r, p => {
      const d = Math.hypot(p.x - cx, p.y - cy); if (d > r + p.r) return;
      if (!p.up && spd < 3) return;
      Props.topple(p, Math.atan2(v.vy, v.vx), spd, v);
      if (p.up === false && p.t === 0 && !v.rail) { const slow = p.k === PK.lamp || p.k === PK.phonebox ? 0.82 : p.k === PK.signal ? 0.86 : 0.97; v.vx *= slow; v.vy *= slow; }
    }));
  };
  Props.update = function (dt, cx, cy) {
    Props.near(cx, cy, 120, p => {
      if (p.t < 1) p.t = Math.min(1, p.t + dt * 2.5);
      const f = p.fly;
      if (f) {
        p.x += f.vx * dt; p.y += f.vy * dt; f.vz -= 18 * dt; f.z += f.vz * dt; p.fa += f.spin * dt;
        if (W.groundAt(p.x, p.y) === W.GC.BUILDING && f.z < 3) { f.vx *= -0.5; f.vy *= -0.5; p.x += f.vx * dt * 2; p.y += f.vy * dt * 2; }
        if (f.z <= 0) { f.z = 0; if (f.vz < -2.5) { f.vz = -f.vz * 0.45; f.vx *= 0.75; f.vy *= 0.75; f.spin *= 0.6; sfx('thud', { vol: 0.25, pitch: 1.6 }); } else { f.vz = 0; f.vx *= Math.exp(-3 * dt); f.vy *= Math.exp(-3 * dt); } }
        if (f.z === 0 && Math.hypot(f.vx, f.vy) < 0.3) { p.fly = null; Props.grid.remove(p, p.gx, p.gy); Props.grid.add(p, p.x, p.y); p.gx = p.x; p.gy = p.y; }
      }
      if (p.gush > 0) { p.gush -= dt; for (let i = 0; i < 2; i++) FX.add({ type: 'drop', x: p.x, y: p.y, vx: U.rand(-1.2, 1.2), vy: U.rand(-1.2, 1.2), z: 0.3, vz: U.rand(6, 10), grav: 16, life: 1.3, col: U.pick(['#e8f6ff', '#9fd4ec']), size: 1 }); }
    });
  };
  Props.draw = function (ctx, left, top, S, vw, vh) {
    const x0 = left - 10, y0 = top - 10, x1 = left + vw / S + 10, y1 = top + vh / S + 10;
    Props.grid.query(x0, y0, x1, y1, p => {
      const sx = Math.round((p.x - left) * S), sy = Math.round((p.y - top) * S);
      const fz = p.fly ? p.fly.z : 0;
      if (fz > 0.05) { ctx.fillStyle = 'rgba(20,20,45,0.3)'; ctx.fillRect(sx - 1, sy, 3, 2); }
      if (p.up) {
        const spr = SP.prop(p.k, false);
        ctx.save(); ctx.translate(sx, sy - Math.round(fz * S)); ctx.rotate(p.k === PK.ball ? p.fa : p.a || 0);
        ctx.fillStyle = 'rgba(20,20,45,0.3)'; ctx.fillRect(-spr.width / 2 + 1, -spr.height / 2 + 1, spr.width, spr.height);
        ctx.drawImage(spr, -spr.width / 2, -spr.height / 2); ctx.restore();
        if (p.k === PK.flamingo || p.k === PK.speaker) { const bob = Math.sin(performance.now() / 180 + p.x) * (p.k === PK.speaker ? 0.6 : 1); if (p.k === PK.speaker && Math.random() < 0.02) FX.note(p.x, p.y - 1); ctx.translate(0, 0); }
      } else {
        const spr = SP.prop(p.k, true); const t = p.t;
        const hop = Math.sin(t * Math.PI * 3) * Math.exp(-t * 4) * 4; const sc = t < 1 ? 0.5 + 0.5 * U.smooth(Math.min(1, t * 1.6)) : 1;
        ctx.save(); ctx.translate(sx, sy - Math.max(0, hop) - Math.round(fz * S)); ctx.rotate(p.fa);
        // pivot at the base: long things fall away from their foot
        const long = p.k === PK.lamp || p.k === PK.signal; const ox = long ? 0 : -spr.width / 2;
        ctx.scale(sc, 1);
        ctx.drawImage(spr, ox, -spr.height / 2); ctx.restore();
      }
    });
  };
  Props.lampsNear = (x0, y0, x1, y1, fn) => Props.grid.query(x0, y0, x1, y1, p => { if (p.k === PK.lamp && p.up) fn(p); else if (p.k === PK.signal && p.up) fn(p); });

  // ================= PEOPLE =================
  const LINES = {
    retiree: ['STREWTH!', 'HOONS!', "I'LL RING THE COUNCIL!", 'IN MY DAY...', 'NOT ON MY LAWN!', 'SLOW DOWN, PET!', 'GOOD GRIEF!'],
    schoolie: ['SICK!', 'WOAH!', 'LEGEND!', 'YEWW!', 'OI OI!', 'SEND IT!', 'NO WAY!'],
    local: ['OI!', 'CRIKEY!', 'WATCH IT!', 'MATE!', 'FAIR GO!', 'YOU RIGHT?'],
    cop: ["'ELLO 'ELLO!", 'OI, YOU!'],
  };
  // the walk cycle runs off ground speed: a stride every ~0.8 m walking, ~1.4 m running, and never faster than
  // about 11 frames a second, so a sprint reads as a run rather than a strobe. Frame 0 is standing still.
  VH.stride = function (o, dt) {
    const px = o.spx == null ? o.x : o.spx, py = o.spy == null ? o.y : o.spy; o.spx = o.x; o.spy = o.y;
    const step = Math.hypot(o.x - px, o.y - py); const v = dt > 0 && step < 4 ? Math.min(30, step / dt) : 0; o.gspd = U.lerp(o.gspd || 0, v, Math.min(1, dt * 8));
    const run = o.gspd > 6.5, cycle = run ? 2.8 : 1.6; o.stepPh = ((o.stepPh || 0) + Math.min(11, o.gspd / cycle * 4) * dt) % 4;
    return VH.walkFrame(o);
  };
  VH.walkFrame = o => (o.gspd || 0) < 0.35 ? 0 : (o.gspd > 6.5 ? 5 : 1) + (Math.floor(o.stepPh || 0) % 4);
  class Ped {
    constructor(kind, x, y, opts = {}) {
      this.kind = kind; this.x = x; this.y = y; this.ang = U.rand(0, U.TAU); this.z = 0; this.vz = 0;
      const pal = SP.PEOPLE[kind] || SP.PEOPLE.local; this.shirt = opts.shirt || U.pick(pal.shirts); this.hair = opts.hair || U.pick(pal.hair);
      this.hat = opts.hat || (kind === 'schoolie' && Math.random() < 0.3 ? 'party' : kind === 'retiree' && Math.random() < 0.3 ? 'bucket' : kind === 'cop' ? 'cop' : '');
      this.state = opts.state || 'walk'; this.speed = kind === 'retiree' ? 0.9 : kind === 'schoolie' ? 1.5 : 1.25; this.anim = Math.random() * 10; this.t = 0;
      this.ai = null; this.home = opts.home || null; this.dog = kind === 'local' && Math.random() < 0.2; this.glow = kind === 'schoolie' && Math.random() < 0.5;
      this.tag = opts.tag || null; this.bubbleT = 0; this.bubble = '';
    }
    say(str, t = 1.8) { this.bubble = str; this.bubbleT = t; }
    update(dt, vehicles) { this.step(dt, vehicles); this.frame = this.state === 'sit' || this.state === 'dive' ? 0 : VH.stride(this, dt); }
    step(dt, vehicles) {
      this.t += dt; if (this.bubbleT > 0) this.bubbleT -= dt;

      // dodge check: people always get out of the way
      if (this.state !== 'dive' && this.state !== 'ride') {
        for (const v of vehicles) {
          if (v.removed || v.z > 1) continue; const spd = v.speed; if (spd < 1.5) continue;
          const dx = this.x - v.x, dy = this.y - v.y; const reach = 3 + spd * 0.7; if (Math.abs(dx) > reach + 15 || Math.abs(dy) > reach + 15) continue;
          const vx = v.vx / spd, vy = v.vy / spd; const along = dx * vx + dy * vy; const lat = -dx * vy + dy * vx;
          const halfW = (v.def ? v.def.W : 2.6) / 2 + 1.4;
          if (along > -2 && along < reach + (v.rail ? 25 : v.def.L || 4) && Math.abs(lat) < halfW) {
            const side = lat >= 0 ? 1 : -1; const da = Math.atan2(vx, -vy) * 1; // perpendicular
            this.state = 'dive'; this.t = 0; this.z = 0; this.vz = 4.5;
            this.dvx = -vy * side * 8.5 + vx * 1.5; this.dvy = vx * side * 8.5 + vy * 1.5; this.ang = Math.atan2(this.dvy, this.dvx);
            sfx('dive', { vol: 0.5, pitch: U.rand(0.9, 1.3) });
            G() && G().onDive && G().onDive(this, v);
            break;
          }
        }
      }
      if (this.state === 'dive') {
        this.x += this.dvx * dt; this.y += this.dvy * dt; this.dvx *= Math.exp(-3 * dt); this.dvy *= Math.exp(-3 * dt);
        this.vz -= 18 * dt; this.z = Math.max(0, this.z + this.vz * dt); this.ang += dt * 12;
        this.pushOut();
        if (this.t > 0.55 && this.z === 0) { this.state = 'sit'; this.t = 0; this.say(U.pick(LINES[this.kind] || LINES.local)); FX.dust(this.x, this.y, '#c8bfa0', 3); }
        return;
      }
      if (this.state === 'ride') return;
      if (this.frozen > 0) { this.frozen -= dt; this.anim = 0; return; } // Kev's megaphone: frozen to the spot (but still jumps clear of cars)
      if (this.state === 'sit') { if (this.t > 1.4) { this.state = this.kind === 'schoolie' && this.home ? 'dance' : 'walk'; this.ai = null; } return; }
      if (this.state === 'dance') {
        if (!this.home) { this.state = 'walk'; return; }
        const hx = this.home.x + Math.cos(this.t * 0.6 + this.anim) * 2.5, hy = this.home.y + Math.sin(this.t * 0.8 + this.anim) * 2.5;
        this.moveTo(hx, hy, 1.2, dt); this.ang += Math.sin(this.t * 6) * 0.2; return;
      }
      if (this.state === 'flee') { this.x += Math.cos(this.ang) * 4.2 * dt; this.y += Math.sin(this.ang) * 4.2 * dt; this.anim += dt * 10; this.pushOut(); if (this.t > 3) { this.state = 'walk'; this.ai = null; } return; }
      if (this.state === 'idle') { this.anim = 0; return; }
      if (this.state === 'goto') { if (this.moveTo(this.gx, this.gy, this.speed * 2.6, dt)) { this.state = 'idle'; } return; }
      // walk along the footpath next to the road graph
      if (!this.ai) {
        const n = W.nearestEdge(this.x, this.y, 40); if (!n) { this.state = 'idle'; return; }
        this.ai = { e: n.e, dir: Math.random() < 0.5 ? 1 : -1, s: 0 }; this.ai.s = this.ai.dir === 1 ? n.s : n.e.len - n.s;
      }
      const ai = this.ai; ai.s += this.speed * dt;
      if (ai.s > ai.e.len) {
        const node = ai.dir === 1 ? ai.e.b : ai.e.a; const opts = (W.gOutAll[node] || []).filter(o => o.e !== ai.e);
        const pick = opts.length ? U.pick(opts) : { e: ai.e, dir: -ai.dir }; ai.e = pick.e; ai.dir = pick.dir; ai.s = 0;
      }
      const [px, py, pa] = edgePt(ai.e, ai.dir, ai.s); const off = ai.e.w / 2 + 1.3;
      const tx = px + Math.sin(pa) * off, ty = py - Math.cos(pa) * off;
      this.moveTo(tx, ty, this.speed * 1.6, dt);
    }
    moveTo(tx, ty, spd, dt) {
      const dx = tx - this.x, dy = ty - this.y, d = Math.hypot(dx, dy); if (d < 0.05) return true;
      const st = Math.min(d, spd * dt); this.x += dx / d * st; this.y += dy / d * st; this.ang = Math.atan2(dy, dx); this.anim += st * 3; return d < 0.3;
    }
    pushOut() {
      W.wallGrid.query(this.x - 0.5, this.y - 0.5, this.x + 0.5, this.y + 0.5, s => { const [d, qx, qy] = U.segPointDist(this.x, this.y, s.ax, s.ay, s.bx, s.by); if (d < 0.4 && d > 1e-6) { this.x = qx + (this.x - qx) / d * 0.4; this.y = qy + (this.y - qy) / d * 0.4; } });
      if (W.isWet(this.x, this.y) && W.seaDist(this.x, this.y) < -0.5) { this.dvx = (this.dvx || 0) * -1; this.dvy = (this.dvy || 0) * -1; }
    }
    draw(ctx, left, top, S, night) {
      const sx = Math.round((this.x - left) * S), sy = Math.round((this.y - top) * S - this.z * S);
      if (sx < -10 || sy < -10 || sx > ctx.canvas.width + 10 || sy > ctx.canvas.height + 10) return;
      const frame = this.state === 'sit' ? 0 : this.frame || 0;
      ctx.fillStyle = 'rgba(20,20,45,0.35)'; ctx.fillRect(sx - 3 + 1, Math.round((this.y - top) * S) - 3 + 1, 7, 7);
      VH.drawRot(ctx, SP.person(this.shirt, this.hair, frame, { hat: this.hat }), sx, sy, this.state === 'sit' ? this.ang + 1.6 : this.ang);
      if (this.dog) { const da = this.ang; VH.drawRot(ctx, SP.dog(frame % 2), sx - Math.cos(da) * 6 + Math.sin(da) * 4, sy - Math.sin(da) * 6 - Math.cos(da) * 4, da); }
      if (this.glow && night) { ctx.fillStyle = U.pick(['#7fff6a', '#ff5fd0', '#5fe8ff']); ctx.fillRect(sx + 2, sy - 1, 1, 2); }
    }
  }
  VH.Ped = Ped;
  function edgePt(e, dir, s) {
    if (dir === 1) return U.alongPoly(e.p, e.cum, s);
    const [x, y, a] = U.alongPoly(e.p, e.cum, e.len - s); return [x, y, a + Math.PI];
  }
  VH.edgePt = edgePt;

  // ================= SEAGULLS =================
  class Gull {
    constructor(x, y) { this.x = x; this.y = y; this.z = 0; this.state = 'sit'; this.vx = 0; this.vy = 0; this.t = Math.random() * 5; this.ang = U.rand(0, U.TAU); this.flap = 0; this.target = null; this.chips = 0; }
    update(dt, threats, chipCarrier) {
      this.t += dt; this.flap += dt * 14;
      if (this.state === 'sit') {
        if (Math.random() < dt * 0.4) this.ang += U.rand(-1, 1);
        if (Math.random() < dt * 0.05) sfx('gull', { vol: 0.25, pitch: U.rand(0.9, 1.2) });
        for (const t of threats) { const d = Math.hypot(t.x - this.x, t.y - this.y); if (d < (t.speed > 2 ? 12 : 6)) { this.takeOff(Math.atan2(this.y - t.y, this.x - t.x)); break; } }
        if (chipCarrier && Math.hypot(chipCarrier.x - this.x, chipCarrier.y - this.y) < 45) { this.state = 'raid'; this.z = 0.5; sfx('gull', { vol: 0.6 }); }
        return;
      }
      if (this.state === 'raid' && chipCarrier) {
        const dx = chipCarrier.x - this.x, dy = chipCarrier.y - this.y, d = Math.hypot(dx, dy);
        const sp = 12.5; this.vx = U.lerp(this.vx, dx / d * sp, dt * 3); this.vy = U.lerp(this.vy, dy / d * sp, dt * 2.5);
        this.z = U.lerp(this.z, 2.5, dt * 2);
        if (d < 1.3) { this.state = 'fly'; this.t = 0; this.chips++; G() && G().onGullSteal && G().onGullSteal(this); sfx('gull', { vol: 0.9, pitch: 1.3 }); FX.debris(this.x, this.y, ['#f2d36a', '#e8b84a'], 3, 2); this.vx = -this.vx; this.vy = -this.vy; }
      } else if (this.state === 'raid') this.state = 'fly';
      if (this.state === 'fly') {
        this.z = U.lerp(this.z, 4, dt); this.vx += Math.cos(this.t * 0.9 + this.x) * dt * 3; this.vy += Math.sin(this.t * 0.7) * dt * 3;
        if (this.t > 6 && W.seaDist(this.x, this.y) > 1 && W.groundAt(this.x, this.y) !== W.GC.BUILDING) { this.z -= dt * 3; if (this.z <= 0) { this.z = 0; this.state = 'sit'; this.vx = this.vy = 0; } }
      }
      this.x += this.vx * dt; this.y += this.vy * dt; if (this.vx || this.vy) this.ang = Math.atan2(this.vy, this.vx);
    }
    takeOff(dir) { this.state = 'fly'; this.t = 0; this.vx = Math.cos(dir) * 6; this.vy = Math.sin(dir) * 6; this.z = 0.3; if (Math.random() < 0.5) sfx('gull', { vol: 0.5, pitch: U.rand(0.9, 1.3) }); }
    draw(ctx, left, top, S) {
      const sx = Math.round((this.x - left) * S), sy = Math.round((this.y - top) * S);
      if (sx < -10 || sy < -30 || sx > ctx.canvas.width + 10 || sy > ctx.canvas.height + 30) return;
      if (this.z > 0.2) { ctx.fillStyle = 'rgba(20,20,45,0.25)'; ctx.fillRect(sx, sy, 3, 2); }
      const fr = this.state === 'sit' ? 0 : 1 + (Math.floor(this.flap) % 2);
      VH.drawRot(ctx, SP.gull(fr), sx, sy - this.z * S, this.ang);
    }
  }
  VH.Gull = Gull;

  // ================= WHALES =================
  class Whale {
    constructor(x, y, ghost = false) { this.x = x; this.y = y; this.ghost = ghost; this.ang = U.rand(0, U.TAU); this.phase = U.rand(0, 20); this.cycle = 26; this.home = { x, y }; this.spoutT = 0; }
    update(dt) {
      this.phase = (this.phase + dt) % this.cycle;
      const sp = this.ghost ? 2.2 : 1.1; this.ang += Math.sin(this.phase * 0.2) * dt * 0.15;
      if (Math.hypot(this.x - this.home.x, this.y - this.home.y) > 90) this.ang = Math.atan2(this.home.y - this.y, this.home.x - this.x);
      this.x += Math.cos(this.ang) * sp * dt; this.y += Math.sin(this.ang) * sp * dt;
      if (!this.ghost && W.seaDist(this.x, this.y) > -25) this.ang += Math.PI * dt;
      const surf = this.surfacing();
      if (surf > 0.6 && this.phase > 2 && this.phase < 2.2 && this.spoutT <= 0) {
        this.spoutT = 1; sfx('spray', { vol: 0.5 }); if (Math.random() < 0.5) sfx('whale', { vol: 0.4 });
        for (let i = 0; i < 24; i++) FX.add({ type: 'drop', x: this.x + Math.cos(this.ang) * 5, y: this.y + Math.sin(this.ang) * 5, vx: U.rand(-0.8, 0.8), vy: U.rand(-0.8, 0.8), z: 0.5, vz: U.rand(6, 11), grav: 9, life: 1.8, col: this.ghost ? '#a0fff0' : '#eef8ff', size: 1, drag: 0.5 });
      }
      if (this.spoutT > 0) this.spoutT -= dt * 0.2;
    }
    surfacing() { const p = this.phase; return p < 1 ? p : p < 9 ? 1 : p < 10 ? 10 - p : 0; }
    draw(ctx, left, top, S) {
      const sx = (this.x - left) * S, sy = (this.y - top) * S; if (sx < -120 || sy < -120 || sx > ctx.canvas.width + 120 || sy > ctx.canvas.height + 120) return;
      const s = this.surfacing();
      if (this.ghost) { ctx.globalAlpha = 0.55 + Math.sin(performance.now() / 300) * 0.2; const bob = Math.sin(performance.now() / 700) * 6; VH.drawRot(ctx, SP.whale(true), sx, sy - 10 + bob, this.ang + Math.sin(performance.now() / 900) * 0.15, 1, false, 2.4); ctx.globalAlpha = 1; return; }
      ctx.globalAlpha = 0.25 + s * 0.75; VH.drawRot(ctx, SP.whale(false), sx, sy, this.ang); ctx.globalAlpha = 1;
      if (this.phase > 9.5 && this.phase < 12) { const t = (this.phase - 9.5) / 2.5; ctx.globalAlpha = Math.sin(t * Math.PI); VH.drawRot(ctx, SP.fluke(false), sx - Math.cos(this.ang) * 34, sy - Math.sin(this.ang) * 34, this.ang + Math.PI / 2); ctx.globalAlpha = 1; }
      if (s > 0.3) { ctx.strokeStyle = 'rgba(230,245,255,0.5)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(sx, sy, 34, 11, this.ang, 0, U.TAU); ctx.stroke(); }
    }
  }
  VH.Whale = Whale;

  // ================= AI DRIVING =================
  const AI = VH.AI = {};
  AI.attach = function (v, near, dir) {
    v.ai = { e: near.e, dir, s: dir === 1 ? near.s : near.e.len - near.s, blocked: 0, honkT: 0, mode: 'cruise', unstick: 0 };
  };
  AI.laneOffset = (e, v) => v.def.gopher ? Math.max(0, e.w / 2 - 0.8) : e.ow !== 0 ? 0 : Math.min(e.w / 4, 1.9);
  AI.nextEdge = function (ai) {
    const node = ai.dir === 1 ? ai.e.b : ai.e.a;
    let opts = (ai.flee ? W.gOutAll : W.gOut)[node].filter(o => o.e !== ai.e);
    opts = opts.filter(o => { const [x, y] = edgePt(o.e, o.dir, Math.min(8, o.e.len)); return W.inBounds(x, y, 30); });
    if (!opts.length) return { e: ai.e, dir: -ai.dir };
    // fleeing: take whichever turn leads furthest from the pursuer (with a little randomness so it isn't a straight line)
    if (ai.flee) { const f = ai.flee; let best = opts[0], bd = -1; for (const o of opts) { const [x, y] = edgePt(o.e, o.dir, Math.min(40, o.e.len)); const d = Math.hypot(x - f.x, y - f.y) * U.rand(0.8, 1.2) * (o.e.w >= 5 ? 1 : 0.6); if (d > bd) { bd = d; best = o; } } return best; }
    // prefer bigger roads a little, avoid tracks
    const wsum = opts.map(o => (o.e.w > 7 ? 2 : 1) * (o.e.speed < 6 ? 0.3 : 1));
    let r = Math.random() * wsum.reduce((a, b) => a + b, 0); for (let i = 0; i < opts.length; i++) { r -= wsum[i]; if (r <= 0) return opts[i]; }
    return opts[0];
  };
  AI.drive = function (v, dt, others) {
    const ai = v.ai; if (!ai || v.dead) { v.throttle = 0; v.brake = 1; return; }
    const spd = v.fwdSpeed;
    const look = 4 + Math.abs(spd) * 0.55;
    // advance cursor to stay `look` metres ahead of the car
    for (let guard = 0; guard < 8; guard++) {
      const [px, py, pa] = edgePt(ai.e, ai.dir, ai.s); const off = AI.laneOffset(ai.e, v);
      const tx = px + Math.sin(pa) * off, ty = py - Math.cos(pa) * off;
      if (Math.hypot(tx - v.x, ty - v.y) > look) { ai.tx = tx; ai.ty = ty; ai.ta = pa; break; }
      ai.s += 1.5;
      if (ai.s > ai.e.len) { const n = AI.nextEdge(ai); ai.s -= ai.e.len; ai.e = n.e; ai.dir = n.dir; }
    }
    if (ai.tx == null) return;
    const want = Math.atan2(ai.ty - v.y, ai.tx - v.x);
    let da = U.angDiff(v.ang, want);
    // target speed: road limit, slow for bends, gophers dawdle
    let vt = v.def.gopher ? 3.2 : ai.flee ? Math.min(ai.e.speed * 1.5 + 8, 30) : Math.min(ai.e.speed * 0.95, 16);
    if (ai.spun > 0) { ai.spun -= dt; v.throttle = 0; v.brake = 0.3; v.handbrake = 1; return; }
    const [, , aheadA] = edgePt(ai.e, ai.dir, Math.min(ai.e.len, ai.s + 10)); const bend = Math.abs(U.angDiff(v.ang, aheadA));
    vt = Math.min(vt, U.lerp(vt, 5, U.clamp(bend / 1.2, 0, 1)));
    if (Math.abs(da) > 1.2) vt = Math.min(vt, 4);
    // obstacles ahead (other vehicles, the player on foot)
    let gap = 99; const fx = Math.cos(v.ang), fy = Math.sin(v.ang);
    for (const o of others) {
      if (o === v || o.removed) continue; const dx = o.x - v.x, dy = o.y - v.y; if (Math.abs(dx) > 30 || Math.abs(dy) > 30) continue;
      const along = dx * fx + dy * fy, lat = Math.abs(-dx * fy + dy * fx); if (along > 0 && along < 22 && lat < 2.4) gap = Math.min(gap, along - (o.def ? o.def.L / 2 : 1));
    }
    const pl = G() && G().player; if (pl && pl.onFoot) { const dx = pl.x - v.x, dy = pl.y - v.y; const along = dx * fx + dy * fy, lat = Math.abs(-dx * fy + dy * fx); if (along > 0 && along < 12 && lat < 1.8) gap = Math.min(gap, along); }
    if (G() && G().sirenPullover && G().sirenPullover(v)) { vt = 0; ai.pullT = 2; }
    if (gap < 99) vt = Math.min(vt, Math.max(ai.flee ? 6 : 0, (gap - (v.def.L / 2 + 2.5)) * 0.9));
    if (gap < 6 && Math.abs(spd) < 0.5) { ai.blocked += dt; } else ai.blocked = Math.max(0, ai.blocked - dt);
    if (ai.blocked > 2.5) { ai.honkT -= dt; if (ai.honkT <= 0) { ai.honkT = U.rand(1.5, 3); const pl2 = G() && G().player; if (pl2 && Math.hypot(pl2.x - v.x, pl2.y - v.y) < 70) sfx(v.def.gopher ? 'horn_gopher' : 'horn', { vol: 0.35, pitch: U.rand(0.9, 1.15) }); } }
    // unstick: reverse briefly if wedged against a wall
    if (ai.unstick > 0) { ai.unstick -= dt; v.throttle = 0; v.brake = 1; v.steer = -Math.sign(da); return; }
    if (vt > 1 && Math.abs(spd) < 0.3 && gap > 8) { ai.stuckT = (ai.stuckT || 0) + dt; if (ai.stuckT > 1.5) { ai.unstick = 1; ai.stuckT = 0; } } else ai.stuckT = 0;
    v.steer = U.clamp(da * 2.2, -1, 1);
    const err = vt - spd;
    if (err > 0.3) { v.throttle = U.clamp(err * 0.4, 0.2, 1); v.brake = 0; } else if (err < -0.8) { v.throttle = 0; v.brake = U.clamp(-err * 0.3, 0.2, 1); } else { v.throttle = 0.1; v.brake = 0; }
    v.handbrake = 0;
  };

  // pursuit: the constable chasing whoever's causing bother
  AI.pursue = function (v, dt, target, opts = {}) {
    const ai = v.ai || (v.ai = { mode: 'pursue', path: null, pathT: 0, idx: 0, unstick: 0 });
    ai.mode = 'pursue';
    const dx = target.x - v.x, dy = target.y - v.y, d = Math.hypot(dx, dy);
    let tx, ty;
    if (d < 55 && AI.los(v.x, v.y, target.x, target.y)) { tx = target.x + (target.vx || 0) * 0.5; ty = target.y + (target.vy || 0) * 0.5; ai.path = null; }
    else {
      ai.pathT -= dt;
      if (!ai.path || ai.pathT <= 0) {
        ai.path = AI.route(v.x, v.y, target.x, target.y); ai.pathT = 1.5; ai.idx = 0;
        if (ai.path) { let bd = 1e9; ai.path.forEach((q, i) => { const d = Math.hypot(q[0] - v.x, q[1] - v.y); if (d < bd) { bd = d; ai.idx = i; } }); ai.idx = Math.min(ai.path.length - 1, ai.idx + 1); }
      }
      if (ai.path && ai.path.length) {
        const behind = q => { const dx = q[0] - v.x, dy = q[1] - v.y, d = Math.hypot(dx, dy); return d < 9 || (d < 22 && Math.abs(U.angDiff(v.ang, Math.atan2(dy, dx))) > 1.7); };
        while (ai.idx < ai.path.length - 1 && behind(ai.path[ai.idx])) ai.idx++;
        [tx, ty] = ai.path[ai.idx];
      } else { tx = target.x; ty = target.y; }
    }
    const want = Math.atan2(ty - v.y, tx - v.x); const da = U.angDiff(v.ang, want); const spd = v.fwdSpeed;
    if (ai.unstick > 0) { ai.unstick -= dt; v.throttle = 0; v.brake = 1; v.steer = -Math.sign(da); return; }
    if (Math.abs(spd) < 0.6 && d > 8) { ai.stuckT = (ai.stuckT || 0) + dt; if (ai.stuckT > 1.2) { ai.unstick = 0.9; ai.stuckT = 0; } } else ai.stuckT = 0;
    v.steer = U.clamp(da * 2.5, -1, 1);
    const close = d < 7 && !opts.ram; const sharp = Math.abs(da) > 0.7 && spd > 9; const tight = Math.abs(da) > 1.2;
    v.throttle = close ? 0.15 : sharp ? 0.1 : tight ? 0.5 : 1; v.brake = sharp || (close && spd > 4) ? 0.8 : 0; v.handbrake = Math.abs(da) > 1.4 && spd > 7 ? 1 : 0;
    v.siren = true;
  };
  AI.los = function (x0, y0, x1, y1) {
    const d = Math.hypot(x1 - x0, y1 - y0), n = Math.ceil(d / 2);
    for (let i = 1; i < n; i++) { const x = x0 + (x1 - x0) * i / n, y = y0 + (y1 - y0) * i / n; if (W.groundAt(x, y) === W.GC.BUILDING) return false; }
    return true;
  };
  // A* over the road graph (both directions; the constable ignores one-way signs)
  AI.route = function (x0, y0, x1, y1) {
    const a = W.nearestEdge(x0, y0, 80), b = W.nearestEdge(x1, y1, 80); if (!a || !b) return null;
    const start = a.s < a.e.len / 2 ? a.e.a : a.e.b, goal = b.s < b.e.len / 2 ? b.e.a : b.e.b;
    const N = W.gNodes; const hx = i => Math.hypot(N[i * 2] - N[goal * 2], N[i * 2 + 1] - N[goal * 2 + 1]);
    const g = new Map([[start, 0]]), came = new Map(), open = [[hx(start), start]], closed = new Set();
    let iter = 0;
    while (open.length && iter++ < 4000) {
      let bi = 0; for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i;
      const [, cur] = open.splice(bi, 1)[0]; if (cur === goal) break; if (closed.has(cur)) continue; closed.add(cur);
      for (const o of W.gOutAll[cur]) {
        const nb = o.dir === 1 ? o.e.b : o.e.a; const ng = g.get(cur) + o.e.len;
        if (ng < (g.get(nb) ?? Infinity)) { g.set(nb, ng); came.set(nb, [cur, o]); open.push([ng + hx(nb), nb]); }
      }
    }
    if (!came.has(goal) && start !== goal) return [[x1, y1]];
    const pts = []; let cur = goal; const segs = [];
    while (cur !== start && came.has(cur)) { const [prev, o] = came.get(cur); segs.push(o); cur = prev; }
    segs.reverse();
    for (const o of segs) { const L = o.e.len; for (let s = 6; s < L; s += 8) { const [x, y] = edgePt(o.e, o.dir, s); pts.push([x, y]); } const [ex, ey] = edgePt(o.e, o.dir, L); pts.push([ex, ey]); }
    pts.push([x1, y1]);
    return pts;
  };
})(window.VH);
