// Time-of-day grading, light map (street lights, headlights, porch lights), bloom and sea fog.
'use strict';
(function (VH) {
  const U = VH.U, SP = VH.Sprites, W = VH.World;
  const L = VH.Light = { lightCanvas: null, lightCtx: null };
  const KEYS = [
    [5.0, [0.34, 0.34, 0.5]], [6.0, [0.92, 0.74, 0.70]], [7.5, [1, 0.97, 0.94]], [17.0, [1, 1, 0.97]], [18.6, [1.0, 0.86, 0.68]],
    [19.6, [0.86, 0.6, 0.64]], [20.4, [0.56, 0.5, 0.7]], [21.3, [0.36, 0.38, 0.58]], [23.5, [0.27, 0.29, 0.5]], [24.5, [0.24, 0.26, 0.46]], [27.5, [0.25, 0.27, 0.47]], [29.0, [0.34, 0.34, 0.5]],
  ];
  L.ambient = function (hour) {
    let h = hour; if (h < 5) h += 24;
    for (let i = 0; i < KEYS.length - 1; i++) {
      const [h0, c0] = KEYS[i], [h1, c1] = KEYS[i + 1];
      if (h >= h0 && h <= h1) return U.mix(c0, c1, U.smooth((h - h0) / (h1 - h0)));
    }
    return KEYS[KEYS.length - 1][1];
  };
  L.darkness = hour => { const a = L.ambient(hour); return U.clamp(1 - (a[0] * 0.3 + a[1] * 0.55 + a[2] * 0.15), 0, 1); };
  L.lightsOn = hour => U.clamp((L.darkness(hour) - 0.12) / 0.3, 0, 1);
  L.fogLevel = (hour, special) => { let h = hour < 12 ? hour + 24 : hour; const f = U.clamp((h - 21.5) / 1.5, 0, 1) * U.clamp((29.5 - h) / 1.5, 0, 1); return Math.max(f * 0.75, special || 0); };

  L.ensure = function (w, h) {
    if (!L.lightCanvas || L.lightCanvas.width !== w || L.lightCanvas.height !== h) { [L.lightCanvas, L.lightCtx] = U.canvas(w, h); [L.glowCanvas, L.glowCtx] = U.canvas(w, h); }
  };
  // sources: [{x,y,r,col,a, cone?:{ang,len}}]
  L.apply = function (ctx, left, top, S, hour, sources, glows) {
    const w = ctx.canvas.width, h = ctx.canvas.height; L.ensure(w, h);
    const amb = L.ambient(hour); const on = L.lightsOn(hour);
    if (amb[0] > 0.985 && amb[1] > 0.985 && amb[2] > 0.95 && !on) return;
    const lc = L.lightCtx;
    lc.globalCompositeOperation = 'source-over'; lc.fillStyle = U.rgb(amb[0] * 255, amb[1] * 255, amb[2] * 255); lc.fillRect(0, 0, w, h);
    if (on > 0) {
      lc.globalCompositeOperation = 'lighter';
      for (const s of sources) {
        const sx = (s.x - left) * S, sy = (s.y - top) * S; const r = s.r * S;
        if (sx < -r * 2 || sy < -r * 2 || sx > w + r * 2 || sy > h + r * 2) continue;
        lc.globalAlpha = U.clamp(s.a * on, 0, 1);
        if (s.cone) {
          const spr = SP.cone(s.col, 128); const len = s.cone.len * S;
          lc.save(); lc.translate(sx, sy); lc.rotate(s.cone.ang); lc.drawImage(spr, 0, -len * 0.35, len, len * 0.7); lc.restore();
        } else lc.drawImage(SP.light(s.col), sx - r, sy - r, r * 2, r * 2);
      }
      lc.globalAlpha = 1;
    }
    ctx.globalCompositeOperation = 'multiply'; ctx.drawImage(L.lightCanvas, 0, 0); ctx.globalCompositeOperation = 'source-over';
    // bloom: small additive glows at the bulbs
    if (on > 0 && glows.length) {
      ctx.globalCompositeOperation = 'lighter';
      for (const g of glows) {
        const sx = (g.x - left) * S, sy = (g.y - top) * S; if (sx < -20 || sy < -20 || sx > w + 20 || sy > h + 20) continue;
        const r = g.r * S; ctx.globalAlpha = U.clamp(g.a * on, 0, 1); ctx.drawImage(SP.light(g.col, 32), sx - r, sy - r, r * 2, r * 2);
      }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
  };
  // rolling sea fog: two drifting layers of soft noise
  L.fog = function (ctx, left, top, S, level, t, tint) {
    if (level <= 0.01) return;
    const fog = SP.fog(); const w = ctx.canvas.width, h = ctx.canvas.height;
    // one seamless pattern fill per layer (tiling drawImage calls left faint seams that drifted with the fog)
    const layers = [[3.2, 0.9, 0.62], [5.0, 0.55, 0.42]];
    const pat = L.fogPat || (L.fogPat = ctx.createPattern(fog, 'repeat'));
    const smooth = ctx.imageSmoothingEnabled; ctx.imageSmoothingEnabled = true;
    for (const [scale, speed, alpha] of layers) {
      const ox = Math.round(-(left * S) - t * 6 * speed * S), oy = Math.round(-(top * S) + t * 3.5 * speed * S);
      pat.setTransform(new DOMMatrix([scale, 0, 0, scale, ox, oy]));
      ctx.globalAlpha = level * alpha * 0.55; ctx.fillStyle = pat; ctx.fillRect(0, 0, w, h);
    }
    ctx.imageSmoothingEnabled = smooth;
    ctx.globalAlpha = 1;
    if (tint) { ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = tint; ctx.globalAlpha = level * 0.18; ctx.fillRect(0, 0, w, h); ctx.globalAlpha = 1; }
  };
})(window.VH);
