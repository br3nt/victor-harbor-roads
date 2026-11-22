// Particles, debris, floating text, screen shake, hit-stop.
'use strict';
(function (VH) {
  const U = VH.U, SP = VH.Sprites;
  const FX = VH.FX = { parts: [], texts: [], shake: 0, shakeX: 0, shakeY: 0, hitStop: 0, flash: 0 };
  const MAX = 900;
  // p: {x,y,z,vx,vy,vz,life,max,type,col,size,rot,vr,grav,drag}
  FX.add = function (p) {
    if (FX.parts.length >= MAX) FX.parts.shift();
    p.z = p.z || 0; p.vz = p.vz || 0; p.max = p.life; p.rot = p.rot || 0; p.vr = p.vr || 0; p.drag = p.drag ?? 1.5; p.grav = p.grav ?? 0;
    FX.parts.push(p); return p;
  };
  FX.smoke = (x, y, col = '#6b6b70', n = 1, size = 1.2, life = 1.4) => { for (let i = 0; i < n; i++) FX.add({ type: 'puff', x: x + U.rand(-0.3, 0.3), y: y + U.rand(-0.3, 0.3), vx: U.rand(-0.6, 0.6), vy: U.rand(-0.6, 0.6) - 0.4, life: life * U.rand(0.7, 1.2), col, size: size * U.rand(0.8, 1.3), drag: 0.6 }); };
  FX.dust = (x, y, col, n = 1) => { for (let i = 0; i < n; i++) FX.add({ type: 'puff', x, y, vx: U.rand(-1, 1), vy: U.rand(-1, 1), life: U.rand(0.5, 0.9), col, size: U.rand(0.6, 1.0), drag: 2 }); };
  FX.debris = (x, y, cols, n, speed = 5, opts = {}) => {
    for (let i = 0; i < n; i++) {
      const a = (opts.dir ?? Math.random() * U.TAU) + (opts.dir != null ? U.rand(-0.9, 0.9) : 0), s = speed * U.rand(0.3, 1.1);
      FX.add({ type: opts.type || 'chip', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, z: 0.3, vz: U.rand(2, 6), grav: 18, life: opts.life || U.rand(0.8, 2.2), col: U.pick(cols), size: opts.size || U.rand(1, 2), vr: U.rand(-12, 12), drag: 1.2, stay: opts.stay });
    }
  };
  FX.sparks = (x, y, n = 8, dir) => { for (let i = 0; i < n; i++) { const a = (dir ?? Math.random() * U.TAU) + U.rand(-1.2, 1.2), s = U.rand(4, 12); FX.add({ type: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: U.rand(0.15, 0.4), col: U.pick(['#fff6b0', '#ffd040', '#ff9a30']), drag: 3 }); } };
  FX.glass = (x, y, n = 10) => FX.debris(x, y, ['#cfe8ff', '#9fc8e8', '#ffffff'], n, 4, { size: 1, life: 1.2 });
  FX.splash = (x, y, n = 30) => { for (let i = 0; i < n; i++) { const a = Math.random() * U.TAU, s = U.rand(1, 6); FX.add({ type: 'drop', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, z: 0.2, vz: U.rand(3, 9), grav: 20, life: 1.2, col: U.pick(['#e8f6ff', '#9fd4ec', '#ffffff']), size: U.rand(1, 2) }); } FX.ring(x, y, '#e8f6ff', 6); };
  FX.ring = (x, y, col, r = 4, life = 0.6) => FX.add({ type: 'ring', x, y, vx: 0, vy: 0, life, col, size: r });
  FX.leaves = (x, y, n = 6) => FX.debris(x, y, ['#4d7a3a', '#6a9550', '#83a05f', '#3f6631'], n, 3, { type: 'leaf', life: 2.5, size: 1 });
  FX.paper = (x, y, n = 5) => FX.debris(x, y, ['#f4f2ea', '#e8e2c8', '#cfe0f0'], n, 2.5, { type: 'leaf', life: 3.5, size: 1 });
  FX.confetti = (x, y, n = 60) => FX.debris(x, y, ['#ff4fa0', '#38e0c8', '#ffd23a', '#7c5cff', '#ff7a2f', '#9be15d'], n, 9, { type: 'leaf', life: 3, size: 1 });
  FX.note = (x, y) => FX.add({ type: 'note', x, y, vx: U.rand(-0.5, 0.5), vy: -1.5, life: 1.6, col: U.pick(['#ff4fa0', '#38e0c8', '#ffd23a', '#fff']), drag: 0 });
  FX.text = (x, y, str, col = '#fff', opts = {}) => {
    const same = FX.texts.find(o => o.str === str && Math.abs(o.x - x) < 8 && Math.abs(o.y - y) < 8 && o.life > o.max - 1.2); if (same) { same.life = same.max; return; } for (const o of FX.texts) if (Math.abs(o.x - x) < 8 && Math.abs(o.y - y) < 2.2 && o.life > o.max - 1) y = o.y - 2.4; FX.texts.push({ x, y, str, col, life: opts.life || 1.6, max: opts.life || 1.6, vy: opts.vy ?? -2.2, big: opts.big }); if (FX.texts.length > 40) FX.texts.shift(); };
  FX.kick = (amount, stop = 0) => { FX.shake = Math.min(1.2, FX.shake + amount); if (stop) FX.hitStop = Math.max(FX.hitStop, stop); };

  FX.update = function (dt) {
    for (let i = FX.parts.length - 1; i >= 0; i--) {
      const p = FX.parts[i]; p.life -= dt;
      if (p.life <= 0) { if (p.stay && VH.MapRender) VH.MapRender.addMark(p.x - 0.12, p.y, p.x + 0.12, p.y, 0.25, p.col); FX.parts.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; const d = Math.exp(-p.drag * dt); p.vx *= d; p.vy *= d; p.rot += p.vr * dt;
      if (p.grav) { p.vz -= p.grav * dt; p.z += p.vz * dt; if (p.z < 0) { p.z = 0; p.vz = -p.vz * 0.35; p.vx *= 0.6; p.vy *= 0.6; p.vr *= 0.5; } }
      if (p.type === 'leaf') { p.vx += Math.sin(p.life * 5 + i) * dt * 2; }
    }
    for (let i = FX.texts.length - 1; i >= 0; i--) { const t = FX.texts[i]; t.life -= dt; t.y += t.vy * dt; t.vy *= Math.exp(-2 * dt); if (t.life <= 0) FX.texts.splice(i, 1); }
    FX.shake = Math.max(0, FX.shake - dt * 2.4);
    const s = FX.shake * FX.shake * 6; FX.shakeX = U.rand(-s, s); FX.shakeY = U.rand(-s, s);
    FX.flash = Math.max(0, FX.flash - dt * 3);
  };
  // draw in world space; toS(x,y) converts metres → art px
  FX.draw = function (ctx, left, top, S, layer) {
    for (const p of FX.parts) {
      const sx = (p.x - left) * S, sy = (p.y - top) * S - p.z * S;
      if (sx < -20 || sy < -20 || sx > ctx.canvas.width + 20 || sy > ctx.canvas.height + 20) continue;
      const t = p.life / p.max;
      if (layer === 'low' && p.type !== 'puff') continue;
      if (layer === 'high' && p.type === 'puff') continue;
      switch (p.type) {
        case 'puff': { const sz = p.size * S * (1.8 - t) * 2; ctx.globalAlpha = Math.min(1, t * 1.4) * 0.8; ctx.drawImage(SP.puff(p.col), sx - sz / 2, sy - sz / 2, sz, sz); ctx.globalAlpha = 1; break; }
        case 'ring': { ctx.strokeStyle = p.col; ctx.globalAlpha = t; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(sx, sy, (1 - t) * p.size * S + 1, 0, U.TAU); ctx.stroke(); ctx.globalAlpha = 1; break; }
        case 'note': { ctx.globalAlpha = Math.min(1, t * 2); ctx.fillStyle = p.col; ctx.fillRect(Math.round(sx), Math.round(sy), 2, 2); ctx.fillRect(Math.round(sx) + 1, Math.round(sy) - 4, 1, 4); ctx.fillRect(Math.round(sx) + 2, Math.round(sy) - 4, 2, 1); ctx.globalAlpha = 1; break; }
        case 'spark': ctx.fillStyle = p.col; ctx.fillRect(Math.round(sx), Math.round(sy), 1, 1); ctx.fillRect(Math.round(sx - p.vx * 0.02 * S), Math.round(sy - p.vy * 0.02 * S), 1, 1); break;
        default: {
          if (p.z > 0.05) { ctx.fillStyle = 'rgba(20,20,40,0.3)'; ctx.fillRect(Math.round(sx), Math.round(sy + p.z * S), p.size, p.size); }
          ctx.fillStyle = p.col; const sz = Math.max(1, Math.round(p.size * (p.type === 'leaf' ? (Math.abs(Math.sin(p.rot)) + 0.3) : 1)));
          ctx.globalAlpha = Math.min(1, t * 3); ctx.fillRect(Math.round(sx), Math.round(sy), sz, Math.max(1, Math.round(p.size))); ctx.globalAlpha = 1;
        }
      }
    }
  };
  FX.drawTexts = function (ctx, left, top, S, scale) {
    for (const t of FX.texts) {
      const a = Math.min(1, t.life / t.max * 3); ctx.globalAlpha = a;
      const pop = t.life > t.max - 0.15 ? 1 + (t.life - (t.max - 0.15)) * 4 : 1;
      const sc = (t.big ? 2 : 1) * scale * (pop > 1.2 ? 2 : 1); const hw = U.textWidth(t.str, sc) / 2 + 2; const W = ctx.canvas.width;
      const sx = hw * 2 < W ? Math.min(Math.max((t.x - left) * S, hw), W - hw) : W / 2; // keep it on screen
      U.text(ctx, t.str, sx, (t.y - top) * S, { color: t.col, align: 'center', scale: sc });
      ctx.globalAlpha = 1;
    }
  };
})(window.VH);
