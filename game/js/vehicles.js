// Vehicles: arcade car physics, collisions, damage, rail-bound tram and steam train.
'use strict';
(function (VH) {
  const U = VH.U, W = VH.World, SP = VH.Sprites, FX = VH.FX;
  const sfx = (n, o) => window.SFX && SFX.play(n, o);

  const VDEF = VH.VDEF = {
    hatch: { name: 'hatchback', L: 3.9, W: 1.75, mass: 1000, accel: 24, maxV: 54, grip: 8, turn: 2.9, brake: 36, hp: 1 },
    sedan: { name: 'sedan', L: 4.6, W: 1.85, mass: 1350, accel: 23, maxV: 58, grip: 8, turn: 2.7, brake: 36, hp: 1.2 },
    ute: { name: 'ute', L: 5.0, W: 1.9, mass: 1600, accel: 21, maxV: 50, grip: 7, turn: 2.6, brake: 32, hp: 1.5 },
    police: { name: 'police car', L: 4.8, W: 1.9, mass: 1500, accel: 27, maxV: 64, grip: 9, turn: 2.9, brake: 38, hp: 1.6 },
    hearse: { name: 'hearse', L: 5.6, W: 1.95, mass: 2100, accel: 17, maxV: 50, grip: 7, turn: 2.3, brake: 28, hp: 1.6 },
    icecream: { name: 'ice-cream van', L: 5.2, W: 2.1, mass: 2200, accel: 13, maxV: 38, grip: 6, turn: 2.3, brake: 24, hp: 1.6 },
    gopher: { name: 'gopher', L: 1.5, W: 0.8, mass: 160, accel: 3.5, maxV: 4.2, grip: 10, turn: 3.4, brake: 10, hp: 0.7, gopher: true },
    paddy: { name: 'paddy wagon', L: 5.4, W: 2.1, mass: 2300, accel: 19, maxV: 50, grip: 8, turn: 2.5, brake: 30, hp: 2.2 },
    bmx: { name: 'BMX', L: 1.7, W: 0.7, mass: 90, accel: 8, maxV: 13, grip: 9, turn: 4.4, brake: 12, hp: 0.5, bike: true },
    cruiser: { name: 'beach cruiser', L: 1.9, W: 0.8, mass: 100, accel: 5.5, maxV: 11, grip: 8, turn: 3.6, brake: 9, hp: 0.5, bike: true },
    escooter: { name: 'e-scooter', L: 1.2, W: 0.6, mass: 70, accel: 7, maxV: 9, grip: 8, turn: 4.6, brake: 10, hp: 0.4, bike: true, electric: true },
    heli: { name: 'helicopter', L: 11, W: 3, mass: 2500, accel: 14, maxV: 42, grip: 3, turn: 2.2, brake: 10, hp: 2.5, heli: true },
    truck: { name: 'B-double', L: 6.5, W: 2.5, mass: 9000, accel: 8, maxV: 34, grip: 7, turn: 1.8, brake: 16, hp: 4, trailers: 2 },
  };
  const CAR_TYPES = ['hatch', 'hatch', 'sedan', 'sedan', 'ute', 'hatch', 'sedan'];
  VH.randomCarType = () => U.pick(CAR_TYPES);

  let nextId = 1;
  class Vehicle {
    constructor(type, x, y, ang, opts = {}) {
      this.id = nextId++; this.type = type; this.def = { ...VDEF[type] }; this.x = x; this.y = y; this.ang = ang;
      this.vx = 0; this.vy = 0; this.av = 0; this.steer = 0; this.throttle = 0; this.brake = 0; this.handbrake = 0;
      this.colour = opts.colour || U.pick(SP.CAR_COLOURS); this.damage = 0; this.dead = false; this.sinking = 0; this.removed = false;
      this.driver = opts.driver || null; this.ai = null; this.parked = !!opts.parked; this.special = opts.special || null;
      this.base = SP.vehicle(type, this.colour); this.sprite = this.base;
      this.z = 0; this.vz = 0; this.air = 0; this.flat = false; this.slip = 1; this.driftT = 0; this.hbWas = 0;
      this.siren = false; this.horn = 0; this.skid = 0; this.lastMark = null; this.smokeT = 0; this.sirenT = 0;
      this.circles = []; const n = Math.max(1, Math.round(this.def.L / this.def.W)); const r = this.def.W / 2;
      for (let i = 0; i < n; i++) this.circles.push({ o: n === 1 ? 0 : (-this.def.L / 2 + r) + i * (this.def.L - 2 * r) / (n - 1), r });
      this.radius = this.def.L / 2 + 0.3;
      this.trailers = [];
      if (this.def.trailers) {
        let px = x, py = y; for (let i = 0; i < this.def.trailers; i++) { px -= Math.cos(ang) * (i === 0 ? 7.5 : 12.4); py -= Math.sin(ang) * (i === 0 ? 7.5 : 12.4); this.trailers.push({ x: px, y: py, ang, L: 12, W: 2.5, sprite: SP.vehicle('trailer', i ? '#d8d2c0' : '#c9b57a') }); }
      }
    }
    get speed() { return Math.hypot(this.vx, this.vy); }
    get fwdSpeed() { return this.vx * Math.cos(this.ang) + this.vy * Math.sin(this.ang); }
    update(dt) {
      if (this.removed) return;
      const d = this.def;
      if (this.sinking) { this.sinking += dt; this.vx *= 0.9; this.vy *= 0.9; if (Math.random() < 0.3) FX.add({ type: 'ring', x: this.x + U.rand(-1, 1), y: this.y + U.rand(-1, 1), vx: 0, vy: 0, life: 0.8, col: '#e8f6ff', size: 1.5 }); if (this.sinking > 2.2) this.removed = true; return; }
      const fx = Math.cos(this.ang), fy = Math.sin(this.ang), rx = -fy, ry = fx;
      let vF = this.vx * fx + this.vy * fy, vR = this.vx * rx + this.vy * ry;
      if (d.heli) return this.flyUpdate(dt);
      const surf = W.surfAt(this.x, this.y);
      // airborne off a ramp or a bunny-hop: no grip, no steering, gravity until we land
      if (this.z > 0 || this.vz > 0) {
        this.air += dt; this.vz -= 22 * dt; this.z = Math.max(0, this.z + this.vz * dt); this.x += this.vx * dt; this.y += this.vy * dt; this.ang += this.av * dt * 0.5;
        if (this.z <= 0) { const air = this.air; this.z = 0; this.vz = 0; this.air = 0; if (air > 0.25) { FX.dust(this.x, this.y, '#c8bfa0', 6); sfx('thud', { vol: Math.min(1, air), pitch: d.bike ? 1.6 : 0.8 }); FX.kick(Math.min(0.4, air * 0.3)); } VH.Game && VH.Game.onLand && VH.Game.onLand(this, air); }
        this.x = U.clamp(this.x, 2, W.width - 2); this.y = U.clamp(this.y, 2, W.height - 2);
        return;
      }
      const dead = this.dead;
      const thr = dead ? 0 : this.throttle, brk = this.brake, hb = d.bike ? 0 : this.handbrake;
      const sandy = surf === W.SURF[W.GC.SAND];
      // bikes fly along footpaths and the foreshore path, and wobble on sand; flat tyres drag and pull
      const surfBoost = d.bike ? (surf.grip > 0.9 ? 1.15 : sandy ? 0.6 : 0.85) : 1;
      if (this.boostT > 0) this.boostT -= dt;
      const boosted = this.boost || this.boostT > 0;
      const maxV = d.maxV * (boosted ? (d.gopher && this.boostT > 0 ? 2.3 : 1.6) : 1) * (1 - this.damage * 0.35) * surfBoost * (this.flat ? 0.55 : 1);
      if (d.gopher && this.boostT > 0 && this.speed > 4) { if (Math.random() < 0.6) FX.sparks(this.x - Math.cos(this.ang) * 0.8, this.y - Math.sin(this.ang) * 0.8, 1, this.ang + Math.PI); this.wheelie = Math.min(1, (this.wheelie || 0) + dt * 4); } else this.wheelie = Math.max(0, (this.wheelie || 0) - dt * 3);
      if (d.bike && sandy && this.speed > 1) this.av += Math.sin(performance.now() / 90 + this.id) * dt * 6;
      if (this.flat && this.speed > 2) { this.av += (this.id % 2 ? 1 : -1) * dt * 0.5; if (surf.grip > 0.9 && Math.random() < 0.25) FX.sparks(this.x - Math.cos(this.ang) * d.L / 2, this.y - Math.sin(this.ang) * d.L / 2, 1); }
      // engine and brakes: punchy off the line, strong brakes
      if (thr > 0 || (d.gopher && this.boostT > 0 && this.driver === 'player' && !(brk > 0))) { if (vF < maxV) vF += d.accel * (thr || 1) * (this.boostT > 0 ? 1.8 : 1) * dt * (1 - Math.max(0, vF) / maxV * 0.8); }
      if (brk > 0) { if (vF > 0.3) vF -= d.brake * brk * dt; else if (!dead && vF > -maxV * 0.3) vF -= d.accel * 0.5 * brk * dt; }
      // rolling drag + surface drag (light on bitumen so the speed holds)
      vF -= vF * (0.04 + surf.drag * (d.gopher ? 0.3 : 0.5)) * dt;
      if (!thr && !brk) vF -= Math.sign(vF) * Math.min(Math.abs(vF), 1.6 * dt);
      if (hb) vF -= Math.sign(vF) * Math.min(Math.abs(vF), (thr > 0 ? 2.5 : 8) * dt);
      // the handbrake kicks the tail out; grip comes back gradually, so a drift can be held with throttle and countersteer
      if (hb && !this.hbWas && Math.abs(vF) > 9 && !d.gopher) { this.av += (this.steer || (Math.random() < 0.5 ? 1 : -1) * 0.5) * 1.7; this.slip = 0.15; }
      this.hbWas = hb;
      this.slip = hb ? Math.min(this.slip, 0.18) : Math.min(1, this.slip + dt * (thr > 0.5 && Math.abs(vR) > 3 ? 0.55 : 1.6));
      const grip = d.grip * surf.grip * this.slip * (this.flat ? 0.65 : 1);
      const before = vR; vR -= vR * Math.min(1, grip * dt);
      this.skid = U.clamp((Math.abs(before) - 2.2) / 6, 0, 1) + (brk > 0 && vF > 8 ? 0.4 : 0) * (surf.grip > 0.9 ? 1 : 0.3);
      // drift bookkeeping: a held drift pays out a little shove of speed when it straightens up
      if (Math.abs(vR) > 3.5 && Math.abs(vF) > 8 && !d.gopher) this.driftT += dt;
      else if (Math.abs(vR) < 2) { if (this.driftT > 0.6) { const kick = Math.min(9, this.driftT * 4); vF += kick * Math.sign(vF); VH.Game && VH.Game.onDriftEnd && VH.Game.onDriftEnd(this, this.driftT, kick); } this.driftT = 0; }
      if (Math.abs(vR) > 3 && surf.grip > 0.9 && Math.random() < 0.7) { const back = -d.L / 2 + 0.5; for (const sd of [-1, 1]) if (Math.random() < 0.5) FX.smoke(this.x + fx * back + rx * sd * d.W / 2, this.y + fy * back + ry * sd * d.W / 2, '#dedee4', 1, 1.1, 1); }
      // steering (sharper while sliding)
      const spd = Math.abs(vF);
      const sliding = this.slip < 0.7;
      const turn = d.turn * this.steer * U.clamp(spd / 5, 0, 1) * Math.sign(vF || 1) * (sliding ? 1.6 : 1) / (1 + spd / 55);
      this.av = U.lerp(this.av, turn, Math.min(1, (sliding ? 5 : 10) * dt));
      this.ang += this.av * dt;
      this.vx = fx * vF + rx * vR; this.vy = fy * vF + ry * vR;
      this.x += this.vx * dt; this.y += this.vy * dt;
      // trailers follow their hitch
      let hx = this.x - fx * this.def.L * 0.3, hy = this.y - fy * this.def.L * 0.3;
      for (const t of this.trailers) {
        const dx = hx - t.x, dy = hy - t.y; const a = Math.atan2(dy, dx); t.ang = a; t.x = hx - Math.cos(a) * t.L / 2; t.y = hy - Math.sin(a) * t.L / 2;
        hx = t.x - Math.cos(a) * t.L / 2; hy = t.y - Math.sin(a) * t.L / 2;
      }
      // marks: tyre tracks on soft ground always, skid marks on hard ground
      const moving = this.speed > 1.2;
      if (moving && (surf.soft || this.skid > 0.25)) {
        const col = surf.soft ? surf.mark : 'rgba(25,25,28,' + (0.25 + this.skid * 0.35).toFixed(2) + ')';
        const tw = d.gopher ? 0.18 : 0.32, half = d.W / 2 - 0.25, back = -d.L / 2 + 0.7;
        const pts = [[back, -half], [back, half]];
        if (surf.soft && !d.gopher) pts.push([d.L / 2 - 0.8, -half], [d.L / 2 - 0.8, half]);
        const cur = pts.map(([o, l]) => [this.x + fx * o + rx * l, this.y + fy * o + ry * l]);
        const moved = this.lastMark && this.lastMark.length === cur.length ? Math.hypot(cur[0][0] - this.lastMark[0][0], cur[0][1] - this.lastMark[0][1]) : 0;
        if (this.lastMark && this.lastMark.length === cur.length && moved < 0.35) { /* wait until the wheels have moved a bit */ }
        else if (this.lastMark && this.lastMark.length === cur.length) {
          for (let i = 0; i < cur.length; i++) {
            const [ax, ay] = this.lastMark[i], [bx, by] = cur[i];
            const L = Math.hypot(bx - ax, by - ay);
            if (L > 0.05 && L < 3) VH.MapRender.addMark(ax, ay, bx, by, tw, col);
          }
          if (surf.soft) VH.Game && VH.Game.onTracks && VH.Game.onTracks(this, moved);
          this.lastMark = cur;
        } else this.lastMark = cur;
        if (surf.soft && Math.random() < 0.25 * Math.min(1, this.speed / 10)) FX.dust(this.x - fx * d.L / 2, this.y - fy * d.L / 2, surf === W.SURF[W.GC.SAND] ? '#e6d4a0' : '#b5a878', 1);
      } else this.lastMark = null;
      if (this.skid > 0.4 && surf.grip > 0.9 && Math.random() < 0.4) FX.smoke(this.x - fx * d.L / 2, this.y - fy * d.L / 2, '#cfcfd4', 1, 0.8, 0.8);
      // exhaust puffs when giving it a boot from low speed
      if (thr > 0.6 && this.speed < 10 && !d.gopher && Math.random() < 0.18) FX.smoke(this.x - fx * (d.L / 2 + 0.3) + rx * d.W * 0.3, this.y - fy * (d.L / 2 + 0.3) + ry * d.W * 0.3, '#9a9aa2', 1, 0.5, 0.7);
      // damage smoke
      if (this.damage > 0.55) { this.smokeT -= dt; if (this.smokeT <= 0) { this.smokeT = 0.12 / this.damage; FX.smoke(this.x + fx * d.L * 0.35, this.y + fy * d.L * 0.35, this.damage > 0.85 ? '#2c2c30' : '#8a8a90', 1, 1.2); } }
      // water
      if (W.isWet(this.x, this.y) && !this.special && !this.boat) {
        const sd = W.seaDist(this.x, this.y); const g = W.groundAt(this.x, this.y);
        if (sd < -1.5 || g === W.GC.WATER) { this.sinking = 0.01; sfx('splash'); FX.splash(this.x, this.y, 40); FX.kick(0.3); VH.Game && VH.Game.onSink && VH.Game.onSink(this); }
      }
      // world bounds
      this.x = U.clamp(this.x, 2, W.width - 2); this.y = U.clamp(this.y, 2, W.height - 2);
    }
    // arcade helicopter: W/S forward and back, A/D turn, Shift climbs, Space descends; flies over everything
    flyUpdate(dt) {
      const d = this.def; const pilot = this.driver === 'player';
      this.rotor = U.clamp((this.rotor || 0) + (pilot ? dt * 0.8 : -dt * 0.3), 0, 1);
      const fx = Math.cos(this.ang), fy = Math.sin(this.ang);
      const g = W.groundAt(this.x, this.y); const minAlt = g === W.GC.BUILDING ? 4 : g === W.GC.SEA || g === W.GC.WATER ? 1.5 : 0;
      const lift = this.dead ? -4 : (this.boost ? 7 : 0) - (this.handbrake ? 6 : 0);
      if (this.rotor > 0.9 || lift < 0) this.vz += (lift - this.vz) * Math.min(1, dt * 3); else this.vz = Math.min(this.vz, 0) - dt * 4;
      if (this.z <= 0 && this.rotor < 0.9) this.vz = 0;
      const was = this.z; this.z = U.clamp(this.z + this.vz * dt, 0, 40);
      if (this.z < minAlt && this.z < was + 0.01 && minAlt > 0 && !this.dead) { this.z = Math.min(minAlt, was); this.vz = Math.max(0, this.vz); }
      const flying = this.z > 0.3;
      if (flying) {
        const thrust = (this.throttle - this.brake * 0.6) * d.accel; this.vx += fx * thrust * dt; this.vy += fy * thrust * dt;
        const drag = Math.exp(-0.9 * dt); this.vx *= drag; this.vy *= drag;
        const sp = this.speed; if (sp > d.maxV) { this.vx *= d.maxV / sp; this.vy *= d.maxV / sp; }
        this.av = U.lerp(this.av, this.steer * d.turn, Math.min(1, dt * 6)); this.ang += this.av * dt;
      } else { this.vx *= Math.exp(-6 * dt); this.vy *= Math.exp(-6 * dt); this.av = 0; this.ang += (this.rotor > 0.95 ? this.steer * 1.2 : 0) * dt; }
      this.x = U.clamp(this.x + this.vx * dt, 2, W.width - 2); this.y = U.clamp(this.y + this.vy * dt, 2, W.height - 2);
      // touchdown: gentle on a helipad, bumpy anywhere else
      if (was > 0.3 && this.z <= 0.3 && this.vz <= 0) {
        this.z = 0; const pad = (VH.Game && VH.Game.helipads || []).some(h => Math.hypot(h.x - this.x, h.y - this.y) < 12);
        const hard = this.dead || this.speed > 6 || -this.vz > 5 || !pad;
        if (hard) { this.damage = Math.min(1, this.damage + (this.dead ? 0 : pad ? 0.05 : 0.12)); FX.kick(0.4); FX.dust(this.x, this.y, '#c8bfa0', 14); FX.smoke(this.x, this.y, '#555', 6, 1.6, 2); sfx('crash', { vol: 0.6, pitch: 0.7 }); if (this.driver === 'player') VH.Game.toast(this.dead ? 'SET DOWN THE HARD WAY. NOBODY HURT.' : 'BUMPY LANDING!', '#ff9a30'); }
        else if (this.driver === 'player') VH.Game.toast('SMOOTH LANDING ON THE HELIPAD', '#9be15d');
        this.vx *= 0.3; this.vy *= 0.3; this.vz = 0; if (this.dead) this.rotor = 0;
      }
      // rotor wash: bins blow over, grass flattens, dust kicks up
      if (this.rotor > 0.5 && this.z < 14) {
        const R = 7 - this.z * 0.3;
        if (Math.random() < 0.5) VH.Props.near(this.x, this.y, R, p => { if ((p.up || !p.fly) && VH.Props.KICKABLE.includes(p.k) && Math.hypot(p.x - this.x, p.y - this.y) < R && Math.random() < 0.08) VH.Props.kick(p, Math.atan2(p.y - this.y, p.x - this.x), 5, pilot ? 'player' : null); });
        const surf = W.surfAt(this.x, this.y); if (Math.random() < 0.4) { const a = Math.random() * U.TAU, r = U.rand(2, R); FX.dust(this.x + Math.cos(a) * r, this.y + Math.sin(a) * r, surf.soft ? '#b5c878' : '#c8c0b0', 1); if (surf.soft && Math.random() < 0.3) VH.MapRender.addMark(this.x + Math.cos(a) * r, this.y + Math.sin(a) * r, this.x + Math.cos(a) * (r + 1.2), this.y + Math.sin(a) * (r + 1.2), 0.35, 'rgba(150,180,90,0.35)'); }
      }
      if (this.damage > 0.6 && Math.random() < 0.3) FX.smoke(this.x, this.y, '#555', 1, 1.4);
      if (this.damage >= 1 && !this.dead) { this.dead = true; this.boost = false; }
      this.skid = 0;
    }
    // world-space positions of the collision circles
    eachCircle(fn) {
      const fx = Math.cos(this.ang), fy = Math.sin(this.ang);
      for (const c of this.circles) fn(this.x + fx * c.o, this.y + fy * c.o, c.r, c.o);
      for (const t of this.trailers) { const tx = Math.cos(t.ang), ty = Math.sin(t.ang); for (let o = -t.L / 2 + 1.25; o <= t.L / 2 - 1.2; o += 2.4) fn(t.x + tx * o, t.y + ty * o, 1.25, null); }
    }
    hit(impact, wx, wy, other) {
      if (impact < 2) return;
      const dmg = impact / 95 / this.def.hp;
      this.damage = Math.min(1, this.damage + dmg);
      // dent the sprite near the impact point
      if (this.sprite === this.base) this.sprite = SP.damaged(this.base);
      const fx = Math.cos(this.ang), fy = Math.sin(this.ang); const dx = wx - this.x, dy = wy - this.y;
      const lo = dx * fx + dy * fy, ll = -dx * fy + dy * fx;
      SP.dent(this.sprite, this.sprite.width / 2 + lo * 4, this.sprite.height / 2 + ll * 4, impact > 8);
      if (impact > 4) { sfx('crash', { vol: Math.min(1, impact / 20), pitch: this.def.gopher ? 1.6 : 1 }); FX.sparks(wx, wy, Math.min(24, impact | 0)); FX.kick(Math.min(0.9, impact / 30), impact > 12 ? 0.06 : 0); }
      if (impact > 15) { FX.debris(wx, wy, [this.colour, '#222', '#999', '#cfe8ff'], 8, impact * 0.3); sfx('crunch', { vol: 0.8 }); }
      else sfx('thud', { vol: 0.5 });
      if (impact > 9) { FX.glass(wx, wy, 6); if (Math.random() < 0.3) sfx('smash', { vol: 0.6 }); }
      if (impact > 6 && Math.random() < 0.25) FX.debris(wx, wy, [this.colour, '#222', '#999'], 3, 4, { stay: true });
      if (this.damage >= 1 && !this.dead) { this.dead = true; sfx('puff'); FX.smoke(this.x, this.y, '#333', 12, 1.8, 2.5); FX.debris(this.x, this.y, ['#bbb', '#888'], 2, 6, { type: 'chip', size: 2, stay: true }); VH.Game && VH.Game.onWreck && VH.Game.onWreck(this); }
      VH.Game && VH.Game.onCrash && VH.Game.onCrash(this, impact, other);
    }
    draw(ctx, left, top, S, night) {
      if (this.removed) return;
      const sx = (this.x - left) * S, sy = (this.y - top) * S;
      if (this.def.heli) {
        // the higher it flies, the further the shadow falls and the bigger it looks
        const z = this.z, k = 1 + z * 0.025; const spr = SP.heli(this.kind || 'police');
        ctx.fillStyle = 'rgba(20,20,45,' + (0.35 - Math.min(0.2, z * 0.006)).toFixed(2) + ')'; ctx.save(); ctx.translate(Math.round(sx + z * 2.2), Math.round(sy + z * 3)); ctx.rotate(this.ang); ctx.fillRect(-spr.width / 2, -spr.height / 4, spr.width, spr.height / 2); ctx.restore();
        drawRot(ctx, spr, sx, sy, this.ang, 1, false, k);
        const rr = 26 * k, rot = (VH.Game ? VH.Game.t : 0) * 30 * (this.rotor || 0);
        ctx.strokeStyle = 'rgba(40,40,50,' + (0.25 + 0.5 * (1 - (this.rotor || 0) * 0.6)).toFixed(2) + ')'; ctx.lineWidth = 1;
        for (let i = 0; i < 2; i++) { const a = rot + i * Math.PI / 2; ctx.beginPath(); ctx.moveTo(sx - Math.cos(a) * rr, sy - Math.sin(a) * rr); ctx.lineTo(sx + Math.cos(a) * rr, sy + Math.sin(a) * rr); ctx.stroke(); }
        if ((this.rotor || 0) > 0.5) { ctx.strokeStyle = 'rgba(220,220,230,0.18)'; ctx.beginPath(); ctx.arc(sx, sy, rr, 0, U.TAU); ctx.stroke(); }
        return;
      }
      if (sx < -80 || sy < -80 || sx > ctx.canvas.width + 80 || sy > ctx.canvas.height + 80) return;
      const sinkA = this.sinking ? Math.max(0, 1 - this.sinking / 2) : 1;
      for (const t of this.trailers) drawRot(ctx, t.sprite, (t.x - left) * S, (t.y - top) * S, t.ang, sinkA, true);
      if (this.z > 0.05) { ctx.fillStyle = 'rgba(20,20,45,0.35)'; ctx.beginPath(); ctx.ellipse(Math.round(sx + this.z * 2), Math.round(sy + this.z * 2), this.def.L * S / 2, this.def.W * S / 2, this.ang, 0, U.TAU); ctx.fill(); }
      const wl = this.wheelie || 0; // a gopher wheelie: front up, nudged and shortened
      drawRot(ctx, this.sprite, sx, sy - this.z * S - wl * 2, this.ang, sinkA, this.z < 0.05, (this.sinking ? 1 - this.sinking * 0.2 : 1) * (1 + this.z * 0.04) * (1 + wl * 0.12));
      if (this.stripe) { ctx.save(); ctx.translate(Math.round(sx), Math.round(sy - wl * 2)); ctx.rotate(this.ang); ctx.fillStyle = '#ffd23a'; ctx.fillRect(-3, -1, 6, 1); ctx.fillStyle = '#ff4fa0'; ctx.fillRect(-3, 0, 6, 1); ctx.restore(); }
      if ((this.type === 'police' || this.type === 'paddy') && this.siren) {
        const ph = Math.floor(performance.now() / 120) % 2; ctx.fillStyle = ph ? '#ff3030' : '#3060ff';
        ctx.fillRect(Math.round(sx) - 1, Math.round(sy) - 1, 2, 2);
      }
    }
  }
  function drawRot(ctx, spr, sx, sy, ang, alpha = 1, shadow = false, scale = 1) {
    ctx.save(); ctx.translate(Math.round(sx), Math.round(sy)); ctx.rotate(ang);
    if (shadow) { ctx.globalAlpha = 0.35 * alpha; ctx.fillStyle = '#141428'; ctx.rotate(-ang); ctx.translate(2, 2); ctx.rotate(ang); ctx.fillRect(-spr.width / 2 * scale, -spr.height / 2 * scale, spr.width * scale, spr.height * scale); ctx.rotate(-ang); ctx.translate(-2, -2); ctx.rotate(ang); }
    ctx.globalAlpha = alpha; ctx.drawImage(spr, -spr.width / 2 * scale, -spr.height / 2 * scale, spr.width * scale, spr.height * scale);
    ctx.restore(); ctx.globalAlpha = 1;
  }
  VH.drawRot = drawRot;
  VH.Vehicle = Vehicle;

  // ---------- rail-bound vehicles ----------
  class RailVehicle {
    constructor(kind, route, s) {
      this.id = nextId++; this.kind = kind; this.route = route; this.s = s; this.v = 0; this.throttle = 0; this.brake = 0; this.driver = null; this.rail = true;
      this.len = route.cum[route.cum.length - 1];
      if (kind === 'tram') { this.maxV = 8; this.accel = 1.8; this.cars = [{ spr: () => SP.tram(), L: 8.5, gap: 0 }]; this.horse = true; this.name = 'horse tram'; }
      else { this.maxV = 22; this.accel = 1.8; this.cars = [{ spr: () => SP.loco(), L: 10, gap: 0 }, { spr: () => SP.tender(), L: 6, gap: 0.6 }, { spr: () => SP.carriage(), L: 14, gap: 0.6 }, { spr: () => SP.carriage(), L: 14, gap: 0.6 }]; this.name = 'steam train'; }
      this.def = { L: kind === 'tram' ? 11 : 10, W: 2.6, gopher: false, maxV: this.maxV };
      this.x = 0; this.y = 0; this.ang = 0; this.vx = 0; this.vy = 0; this.damage = 0; this.dead = false; this.special = kind; this.siren = false; this.chuff = 0; this.frame = 0; this.whistle = 0;
      this.place();
    }
    get speed() { return Math.abs(this.v); }
    get fwdSpeed() { return this.v; }
    place() {
      const [x, y, a] = U.alongPoly(this.route.p, this.route.cum, this.s); this.x = x; this.y = y; this.ang = a;
      this.vx = Math.cos(a) * this.v; this.vy = Math.sin(a) * this.v;
      // car centres behind the lead point (the horse walks in front of the tram)
      let back = this.horse ? 3.5 : 0; this.parts = [];
      if (this.horse) { const [hx, hy, ha] = U.alongPoly(this.route.p, this.route.cum, this.s + 0.5); this.parts.push({ x: hx, y: hy, a: ha, horse: true }); }
      for (const c of this.cars) {
        back += c.gap + c.L / 2; const [cx, cy, ca] = U.alongPoly(this.route.p, this.route.cum, this.s - back); this.parts.push({ x: cx, y: cy, a: ca, c });
        back += c.L / 2;
      }
    }
    update(dt) {
      const thr = this.throttle, brk = this.brake;
      if (thr > 0) this.v = Math.min(this.maxV * (this.boost ? 1.5 : 1), this.v + this.accel * (this.boost ? 1.5 : 1) * thr * dt);
      if (brk > 0) { if (this.v > 0.2) this.v = Math.max(0, this.v - this.accel * 2.5 * dt); else this.v = Math.max(-this.maxV * 0.35, this.v - this.accel * 0.6 * dt); }
      if (!thr && !brk) this.v -= Math.sign(this.v) * Math.min(Math.abs(this.v), 0.25 * dt);
      const minS = this.horse ? 4.5 : 47, maxS = this.len - 1;
      this.s += this.v * dt;
      if (this.s > maxS) { this.s = maxS; if (this.v > 3) { FX.kick(0.4); sfx('crash', { vol: 0.5 }); } this.v = 0; }
      if (this.s < minS) { this.s = minS; this.v = 0; }
      this.place();
      // effects
      if (this.kind === 'train') {
        this.chuff -= dt * (0.6 + Math.abs(this.v) * 0.5);
        if (this.chuff <= 0) { this.chuff = 1; const p = this.parts[0]; FX.smoke(p.x + Math.cos(p.a) * 2.5, p.y + Math.sin(p.a) * 2.5, this.v > 6 ? '#e8e8ea' : '#bdbdc2', 2, 1.6, 2.4); }
      } else { this.frame += Math.abs(this.v) * dt * 1.2; }
      if (this.whistle > 0) this.whistle -= dt;
    }
    eachCircle(fn) {
      for (const p of this.parts) {
        const L = p.horse ? 2.4 : p.c.L; const ca = Math.cos(p.a), sa = Math.sin(p.a);
        for (let o = -L / 2 + 1.2; o <= L / 2 - 1.1; o += 2.2) fn(p.x + ca * o, p.y + sa * o, 1.3, null);
        if (L < 2.5) fn(p.x, p.y, 1.1, null);
      }
    }
    hit() {}
    draw(ctx, left, top, S) {
      for (let i = this.parts.length - 1; i >= 0; i--) {
        const p = this.parts[i]; const sx = (p.x - left) * S, sy = (p.y - top) * S;
        if (sx < -100 || sy < -100 || sx > ctx.canvas.width + 100 || sy > ctx.canvas.height + 100) continue;
        if (p.horse) drawRot(ctx, SP.horse(Math.floor(this.frame) % 2), sx, sy, p.a, 1, true);
        else drawRot(ctx, p.c.spr(), sx, sy, p.a, 1, true);
      }
      // reins from horse to tram
      if (this.horse && this.parts.length > 1) { const a = this.parts[0], b = this.parts[1]; ctx.strokeStyle = '#3a2416'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo((a.x - left) * S, (a.y - top) * S); ctx.lineTo((b.x - left) * S + Math.cos(b.a) * 17, (b.y - top) * S + Math.sin(b.a) * 17); ctx.stroke(); }
    }
  }
  VH.RailVehicle = RailVehicle;

  // ---------- collisions ----------
  const C = VH.Collide = {};
  // vehicle vs building walls and solid props
  C.walls = function (v) {
    if (v.rail || v.removed || v.sinking || v.scripted || v.z > 0.3) return;
    v.eachCircle((cx, cy, r, off) => {
      W.wallGrid.query(cx - r, cy - r, cx + r, cy + r, s => {
        if (s.wall && v.boat) return; // [Round C map] boats pass under bridge and causeway railings
        const [d, qx, qy] = U.segPointDist(cx, cy, s.ax, s.ay, s.bx, s.by);
        if (d < r && d > 1e-6) resolveStatic(v, cx, cy, qx, qy, d, r, off);
      });
      VH.Props.solidNear(cx, cy, r, (px, py, pr) => { const d = Math.hypot(cx - px, cy - py); if (d < r + pr && d > 1e-6) { const nx = (cx - px) / d, ny = (cy - py) / d; resolveStatic(v, cx, cy, px + nx * pr, py + ny * pr, d - pr, r, off); } });
    });
  };
  function resolveStatic(v, cx, cy, qx, qy, d, r, off) {
    const nx = (cx - qx) / (d || 1), ny = (cy - qy) / (d || 1); const pen = r - d;
    v.x += nx * pen; v.y += ny * pen;
    const vn = v.vx * nx + v.vy * ny;
    if (vn < 0) {
      v.vx -= 1.35 * vn * nx; v.vy -= 1.35 * vn * ny; // bounce a little
      v.vx *= 0.92; v.vy *= 0.92;
      if (off != null) { const fx = Math.cos(v.ang), fy = Math.sin(v.ang); const torque = (off * (fx * ny - fy * nx)) * -vn * 0.12; v.av += torque; }
      if (-vn > 2) v.hit(-vn, qx, qy, null);
    }
  }
  // vehicle vs vehicle (including rail vehicles, which always win)
  C.vehicles = function (list) {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j]; if (a.removed || b.removed || a.sinking || b.sinking || a.scripted || b.scripted || a.z > 0.6 || b.z > 0.6) continue;
      if (a.rail && b.rail) continue;
      const rr = (a.rail ? 40 : a.radius + 13) + (b.rail ? 40 : b.radius + 13);
      if (Math.abs(a.x - b.x) > rr || Math.abs(a.y - b.y) > rr) continue;
      a.eachCircle((ax, ay, ar) => b.eachCircle((bx, by, br) => {
        const dx = bx - ax, dy = by - ay, d = Math.hypot(dx, dy); if (d >= ar + br || d < 1e-6) return;
        const nx = dx / d, ny = dy / d, pen = ar + br - d;
        const ma = a.rail ? 1e9 : a.def.mass, mb = b.rail ? 1e9 : b.def.mass; const ta = mb / (ma + mb), tb = ma / (ma + mb);
        if (!a.rail) { a.x -= nx * pen * ta; a.y -= ny * pen * ta; }
        if (!b.rail) { b.x += nx * pen * tb; b.y += ny * pen * tb; }
        const rvx = b.vx - a.vx, rvy = b.vy - a.vy; const vn = rvx * nx + rvy * ny;
        if (vn < 0) {
          const jimp = -(1.3) * vn / (1 / ma + 1 / mb);
          if (!a.rail) { a.vx -= jimp * nx / ma; a.vy -= jimp * ny / ma; a.av += U.rand(-1, 1) * Math.min(2, -vn * 0.08); }
          if (!b.rail) { b.vx += jimp * nx / mb; b.vy += jimp * ny / mb; b.av += U.rand(-1, 1) * Math.min(2, -vn * 0.08); }
          const cx = (ax + bx) / 2, cy = (ay + by) / 2;
          if (-vn > 2) { a.hit(-vn * (b.rail ? 1.5 : 1), cx, cy, b); b.hit(-vn * (a.rail ? 1.5 : 1), cx, cy, a); }
        }
      }));
    }
  };
})(window.VH);
