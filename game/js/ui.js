// HUD, menus, minimap, full map and touch buttons, all drawn in the pixel back-buffer.
'use strict';
(function (VH) {
  const U = VH.U, W = VH.World, R = VH.MapRender, SP = VH.Sprites, I = VH.Input, FX = VH.FX;
  const UI = VH.UI = { menuIdx: 0, selIdx: 0 };
  const G = () => VH.Game; const M = () => VH.Missions;
  const sfx = (n, o) => window.SFX && SFX.play(n, o);
  const C = { ink: '#120c24', panel: 'rgba(18,12,36,0.86)', edge: '#3c2f6b', hi: '#ffd23a', pink: '#ff4fa0', teal: '#38e0c8', white: '#f4f0ff', dim: '#a99fc8', red: '#ff6a5a', green: '#9be15d' };
  UI.C = C;
  function panel(ctx, x, y, w, h, opts = {}) {
    x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x + 2, y + 2, w, h);
    ctx.fillStyle = opts.fill || C.panel; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = opts.edge || C.edge; ctx.fillRect(x, y, w, 1); ctx.fillRect(x, y + h - 1, w, 1); ctx.fillRect(x, y, 1, h); ctx.fillRect(x + w - 1, y, 1, h);
    if (opts.accent) { ctx.fillStyle = opts.accent; ctx.fillRect(x, y, w, 2); }
  }
  UI.panel = panel;
  const T = (ctx, s, x, y, o) => U.text(ctx, s, x, y, o);

  // curtain icon for the gossip meter
  function curtain(ctx, x, y, on, flash, s) {
    const w = 9 * s, h = 9 * s;
    ctx.fillStyle = on ? (flash ? '#ff4fa0' : '#ffd23a') : '#3c2f6b'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = on ? '#2a1a3a' : '#1c1530'; ctx.fillRect(x + s, y + s, w - 2 * s, h - 2 * s);
    if (on) { ctx.fillStyle = '#ffe9a0'; ctx.fillRect(x + 3 * s, y + 2 * s, 3 * s, 5 * s); ctx.fillStyle = flash ? '#ff9ccc' : '#e05a3a'; ctx.fillRect(x + s, y + s, 2 * s, h - 2 * s); ctx.fillRect(x + 6 * s, y + s, 2 * s, h - 2 * s); ctx.fillStyle = '#222'; ctx.fillRect(x + 4 * s, y + 3 * s, s, s); }
    else { ctx.fillStyle = '#4a3a70'; ctx.fillRect(x + s, y + s, 3 * s, h - 2 * s); ctx.fillRect(x + 5 * s, y + s, 3 * s, h - 2 * s); }
  }

  // ---------- controls: one table drives the "?" overlay, the controls card and the hints ----------
  const K = (key, touch) => () => (I.touchMode ? touch : key);
  const CONTROLS = {
    foot: { title: 'ON FOOT', get rows() { return [...(G().walkMode === 'screen' ? [[K('WASD / ARROWS', 'LEFT THUMB'), 'WALK (SCREEN DIRECTION)']] : [[K('W / UP', 'THUMB'), 'WALK FORWARD'], [K('S / DOWN', 'THUMB BACK'), 'STEP BACK'], [K('A D / LEFT RIGHT', 'THUMB'), 'TURN']]), ...this.rest]; }, rest: [[K('SHIFT', 'BOOST'), 'SPRINT'], [K('E', 'GET IN'), 'GET IN / BORROW (WALK UP TO IT)'], [K('F', 'KICK'), 'KICK BINS, CONES, BALLS'], [K('SPACE', 'ACT'), 'USE, RING DOORBELLS, STAND BINS UP'], [K('H', 'SHOUT'), 'SHOUT'], ['DOORS', 'WALK INTO A SHOP DOOR TO GO IN; E AT THE COUNTER TO CHAT'], [K('HOLD SPACE', 'HOLD'), 'TACKLED? KEEP THE MARK IN THE GREEN; ARROW (OR TAP) THE WAY IT SAYS WHEN IT FLASHES SLIP']] },
    car: { title: 'DRIVING AND RIDING', rows: [[K('W / UP', 'THUMB'), 'ACCELERATE'], [K('S / DOWN', 'THUMB BACK'), 'BRAKE, REVERSE'], [K('A D / LEFT RIGHT', 'THUMB'), 'STEER'], [K('SPACE', 'SKID'), 'HANDBRAKE (DRIFT); BUNNY-HOP ON A BIKE'], [K('H', 'HORN'), 'HORN'], [K('SHIFT', 'BOOST'), 'TURBO GOPHER'], [K('E', 'GET OUT'), 'GET OUT']] },
    rail: { title: 'TRAM AND TRAIN', rows: [[K('W / UP', 'THUMB'), 'FORWARD'], [K('S / DOWN', 'THUMB BACK'), 'BRAKE, BACK UP'], [K('SHIFT', 'BOOST'), 'GIDDY UP / MORE STEAM'], [K('H', 'HORN'), 'BELL / WHISTLE'], [K('E', 'GET OUT'), 'GET OFF (WHEN STOPPED)']] },
    heli: { title: 'HELICOPTER', rows: [[K('W / S', 'THUMB'), 'FLY FORWARD / BACK'], [K('A D / LEFT RIGHT', 'THUMB'), 'TURN'], [K('SHIFT', 'BOOST'), 'CLIMB'], [K('SPACE', 'SKID'), 'DESCEND AND LAND (HELIPADS ARE GENTLEST)'], [K('E', 'GET OUT'), 'GET OUT (ONCE LANDED)']] },
    kev: { title: 'CONSTABLE KEV', rows: [[K('H', 'SIREN'), 'SIREN (IN A POLICE CAR)'], [K('H', 'SHOUT'), 'MEGAPHONE ON FOOT: RUNNERS FREEZE'], [K('X', 'SPIKES'), 'DROP A SPIKE STRIP BEHIND YOU'], [K('B', 'BACKUP'), 'CALL BACKUP (TWO JUNIOR CONSTABLES)'], ['RAM', 'NUDGE A REAR CORNER TO SPIN THEM (PIT)']] },
    evade: { title: 'LOSING THE POLICE', rows: [['SIGHT', 'BREAK LINE OF SIGHT AND STAY OUT OF VIEW TILL THE HEAT COOLS'], ['HIDE', 'BUSHES, CAR PARKS, THE GOLF COURSE, THE CAR WASH, UNDER THE JETTY (GOSSIP COOLS FASTER)'], ['SWAP', 'CHANGE CARS (OR GET OUT) WHERE THEY CAN\'T SEE YOU'], ['RESPRAY', 'RESPRAY SHOPS (SPRAY-CAN ICON ON THE MAP, $25) WIPE YOUR CAR\'S DESCRIPTION'], ['CLOTHES', 'A NEW SHIRT, HAT OR SUNNIES OUT OF SIGHT (CLOTHES SHOP, OP SHOP) DOES THE SAME FOR YOU'], ['ROADBLOCK', 'THERE\'S ALWAYS A GAP, OR THE FOOTPATH'], ['OFFICERS', 'DRIVE OFF, SHOVE THROUGH (THEY JUMP OUT OF THE WAY) OR OUTRUN THEM']] },
    any: { title: 'ANY TIME', rows: [[K('WHEEL / + -', 'PINCH'), 'ZOOM IN AND OUT (0 RESETS)'], [K('M / TAB', 'MAP'), 'MAP'], [K('J', 'JOB'), 'CURRENT JOB BRIEF'], [K('?', '?'), 'THIS HELP'], [K('P / ESC', 'PAUSE'), 'PAUSE'], [K('N', 'PAUSE MENU'), 'MUTE']] },
  };
  UI.CONTROLS = CONTROLS;
  const keyText = k => typeof k === 'function' ? k() : k;
  UI.context = function () {
    const g = G(), pl = g.player; if (!pl) return 'foot';
    if (pl.onFoot) return 'foot'; if (pl.vehicle && pl.vehicle.rail) return 'rail'; if (pl.vehicle && pl.vehicle.def.heli) return 'heli'; return 'car';
  };
  const keyCol = ts => 17 * 6 * ts + 6 * ts;
  function controlsTable(ctx, ts, sections, x, y, w) {
    let yy = y; const kw = keyCol(ts);
    for (const sc of sections) {
      T(ctx, sc.title, x, yy, { color: C.hi, scale: ts }); yy += 11 * ts;
      for (const [k, what] of sc.rows) {
        const lines = U.wrap(what, Math.max(10, Math.floor((w - kw) / (6 * ts))));
        T(ctx, keyText(k), x, yy, { color: C.teal, scale: ts });
        lines.forEach((l, i) => T(ctx, l, x + kw, yy + i * 9 * ts, { color: C.white, scale: ts }));
        yy += lines.length * 9 * ts + 2 * ts;
      }
      yy += 5 * ts;
    }
    return yy - y;
  }
  UI.measureControls = (ts, sections, w) => { let h = 0; const kw = keyCol(ts); for (const sc of sections) { h += 16 * ts; for (const r of sc.rows) h += U.wrap(r[1], Math.max(10, Math.floor((w - kw) / (6 * ts)))).length * 9 * ts + 2 * ts; } return h; };
  // the "?" overlay: only the keys that matter right now
  UI.helpOverlay = function (ctx, ts) {
    const g = G(), w = ctx.canvas.width, h = ctx.canvas.height; const cx = UI.context();
    const secs = [CONTROLS[cx]]; if (g.char === 'cop') secs.push(CONTROLS.kev); else secs.push(CONTROLS.evade); secs.push(CONTROLS.any);
    const pw = Math.min(w - 16 * ts, 260 * ts); const ph = Math.min(h - 20 * ts, UI.measureControls(ts, secs, pw - 16 * ts) + 26 * ts);
    const x = Math.round(w / 2 - pw / 2), y = Math.round(Math.max(8 * ts, h / 2 - ph / 2));
    panel(ctx, x, y, pw, ph, { accent: C.teal, fill: 'rgba(18,12,36,0.93)' });
    T(ctx, 'CONTROLS', x + 8 * ts, y + 6 * ts, { color: C.white, scale: ts });
    T(ctx, I.touchMode ? 'TAP ? TO CLOSE' : '? OR ESC: CLOSE', x + pw - 8 * ts, y + 6 * ts, { color: C.dim, scale: ts, align: 'right' });
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, pw, ph - 2); ctx.clip();
    controlsTable(ctx, ts, secs, x + 8 * ts, y + 20 * ts, pw - 16 * ts); ctx.restore();
  };

  // ---------- first-time hints: a short sequence that teaches the basics, once per browser ----------
  const HINTS = [
    { txt: () => I.touchMode ? 'DRAG ON THE LEFT HALF TO MOVE' : G().walkMode === 'screen' ? 'WASD OR ARROW KEYS: MOVE' : 'W: WALK  S: BACK  A/D: TURN (LIKE A CAR)', done: g => g.hintMoved > 8, foot: true },
    { txt: () => I.touchMode ? 'HOLD BOOST TO SPRINT' : 'HOLD SHIFT TO SPRINT', done: g => g.hintSprint > 0.8, foot: true },
    { txt: () => I.touchMode ? 'WALK UP TO A CAR, TAP GET IN TO BORROW IT' : 'WALK UP TO A CAR AND PRESS E TO BORROW IT', done: g => !g.player.onFoot, foot: true },
    { txt: () => I.touchMode ? 'SKID: HANDBRAKE  HORN: HORN  GET OUT: GET OUT' : 'SPACE: HANDBRAKE   H: HORN   E: GET OUT', done: g => g.hintT > 9 },
    { txt: () => I.touchMode ? 'MAP, JOB AND ? ARE TOP RIGHT' : 'M: MAP   J: JOB BRIEF   ?: CONTROLS', done: g => g.hintT > 9 },
  ];
  UI.hints = function (ctx, ts, bottomY) {
    const g = G();
    if (g.tipNow && g.tipNow.t > 0) { g.tipNow.t -= g.frameDt || 0.016; const str = g.tipNow.str; const bw = U.textWidth(str, ts) + 33 * ts, bh = 16 * ts; const x = ctx.canvas.width / 2 - bw / 2, y = bottomY - bh - 4 * ts; panel(ctx, x, y, bw, bh, { accent: C.hi, fill: 'rgba(48,40,18,0.92)' }); T(ctx, 'TIP', x + 5 * ts, y + 5 * ts, { color: C.hi, scale: ts }); T(ctx, str, x + 27 * ts, y + 5 * ts, { color: C.white, scale: ts }); if (g.tipNow.icon === 'can') VH.Shops.drawCan(ctx, x + bw - 6 * ts, y + 7 * ts, ts); return; }
    if (g.hintIdx == null || g.hintIdx >= HINTS.length) return;
    const hnt = HINTS[g.hintIdx];
    if (hnt.foot && !g.player.onFoot) { g.hintIdx++; g.hintT = 0; return; }
    g.hintT = (g.hintT || 0) + (g.frameDt || 0.016);
    if (hnt.done(g) || g.hintT > 14) { g.hintIdx++; g.hintT = 0; if (g.hintIdx >= HINTS.length) U.store.set('hints', true); return; }
    const str = hnt.txt(); const bw = U.textWidth(str, ts) + 33 * ts, bh = 16 * ts; const x = ctx.canvas.width / 2 - bw / 2, y = bottomY - bh - 4 * ts;
    panel(ctx, x, y, bw, bh, { accent: C.teal, fill: 'rgba(18,40,48,0.9)' });
    T(ctx, 'TIP', x + 5 * ts, y + 5 * ts, { color: C.teal, scale: ts }); T(ctx, str, x + 27 * ts, y + 5 * ts, { color: C.white, scale: ts });
  };

  UI.hud = function (ctx, ts) {
    const g = G(), pl = g.player, w = ctx.canvas.width, h = ctx.canvas.height; const c = g.CHARS[g.char] || g.CHARS.roam;
    const pad = 4 * ts;
    // --- top-left: who, cash, meter
    const pw = 128 * ts; panel(ctx, pad, pad, pw, 40 * ts, { accent: C.pink });
    T(ctx, c.name, pad + 5 * ts, pad + 5 * ts, { color: C.dim, scale: ts });
    T(ctx, '$' + Math.round(g.cash), pad + pw - 5 * ts, pad + 4 * ts, { color: C.green, scale: ts * 2, align: 'right' });
    const PO = VH.Police; const lvl = g.meter; const flash = PO.units.length && PO.seenT < 0.5 && Math.floor(g.t * 4) % 2;
    for (let i = 0; i < 5; i++) curtain(ctx, pad + 5 * ts + i * 11 * ts, pad + 19 * ts, lvl >= i + 1 || (lvl > i && lvl - i > 0.5 && Math.floor(g.t * 3) % 2), flash, ts);
    const lab = (g.char === 'cop' ? g.COP_LABELS : g.METER_LABELS)[Math.min(5, Math.floor(lvl))];
    T(ctx, c.meter, pad + 62 * ts, pad + 20 * ts, { color: g.char === 'cop' ? C.teal : C.hi, scale: ts });
    T(ctx, lab.length > 20 ? lab.slice(0, 20) : lab, pad + 5 * ts, pad + 31 * ts, { color: C.dim, scale: ts });
    // --- top-centre: night + clock + job timer
    const hh = Math.floor(g.hour), mm = Math.floor((g.hour - hh) * 60);
    const clock = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    const nightTxt = g.char === 'roam' ? 'FREE ROAM' : `NIGHT ${g.night} ${M().NIGHTS[g.night - 1] || ''}`;
    const tw = Math.max(U.textWidth(nightTxt, ts), U.textWidth(clock, ts * 2)) + 12 * ts;
    const narrow = w < 380 * ts; UI.narrow = narrow;
    const cxp = narrow ? pad + tw / 2 : w / 2, cyp = narrow ? pad + 44 * ts : pad;
    panel(ctx, cxp - tw / 2, cyp, tw, 28 * ts, { accent: C.teal });
    T(ctx, nightTxt, cxp, cyp + 4 * ts, { align: 'center', color: C.dim, scale: ts });
    T(ctx, clock, cxp, cyp + 13 * ts, { align: 'center', color: C.white, scale: ts * 2 });
    const tm = M().timer();
    if (tm != null) { const s = Math.max(0, Math.ceil(tm)); const str = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; T(ctx, str, cxp + tw / 2 + 4 * ts, cyp + 13 * ts, { color: s < 30 && Math.floor(g.t * 2) % 2 ? C.red : C.hi, scale: ts * 2 }); }
    // --- police status under the money panel
    let py = pad + 44 * ts; if (narrow) py = pad + 76 * ts;
    const near = g.char !== 'cop' && !PO.units.length && (PO.patrols.some(v => Math.hypot(v.x - pl.x, v.y - pl.y) < 90) || g.meter >= 1);
    if (near) {
      panel(ctx, pad, py, pw, 22 * ts, { accent: C.hi });
      T(ctx, 'POLICE INTERESTED', pad + 5 * ts, py + 4 * ts, { color: C.hi, scale: ts });
      T(ctx, PO.patrols.some(v => Math.hypot(v.x - pl.x, v.y - pl.y) < 90) ? 'PATROL CAR NEARBY. BEHAVE...' : 'MORE GOSSIP AND THEY COME', pad + 5 * ts, py + 13 * ts, { color: C.dim, scale: ts });
    } else if (g.char !== 'cop' && (PO.units.length || PO.heli || PO.boat || PO.blocks.length)) {
      const bits = [PO.units.length + (PO.units.length === 1 ? ' CAR' : ' CARS')]; if (PO.blocks.length) bits.push('BLOCK'); if (PO.boat) bits.push('BOAT'); if (PO.heli) bits.push('CHOPPER');
      const seen = PO.seenT < 0.6, st = seen ? 'THEY CAN SEE YOU!' : PO.hidden ? 'HIDING. LIE LOW...' : 'SEARCHING. STAY OUT OF SIGHT';
      const col = seen ? (Math.floor(g.t * 5) % 2 ? C.red : '#ffb0a8') : PO.hidden ? C.green : C.hi;
      panel(ctx, pad, py, pw, 31 * ts, { accent: seen ? C.red : '#3070ff' });
      T(ctx, 'POLICE CHASING', pad + 5 * ts, py + 4 * ts, { color: C.white, scale: ts }); T(ctx, bits.join(' · '), pad + 5 * ts, py + 13 * ts, { color: C.dim, scale: ts }); T(ctx, st, pad + 5 * ts, py + 22 * ts, { color: col, scale: ts });
    } else if (g.char === 'cop') {
      const car = g.custody && g.custody.length; const lines = [`BACKUP (B): ${PO.backupT > 0 ? Math.ceil(PO.backupT) + 'S' : 'READY'}`, `SPIKES (X): ${PO.spikesLeft} LEFT`];
      if (car) lines.push(`IN THE BACK: ${g.custody.length}`);
      panel(ctx, pad, py, pw, (lines.length * 9 + 5) * ts, { accent: '#3070ff' });
      lines.forEach((l, i) => T(ctx, l, pad + 5 * ts, py + 4 * ts + i * 9 * ts, { color: i === 2 ? C.teal : C.white, scale: ts }));
    }
    const hasPolice = near || (g.char !== 'cop' && (PO.units.length || PO.heli || PO.boat || PO.blocks.length)) || g.char === 'cop';
    const actY = py + (hasPolice ? (g.char !== 'cop' && PO.units.length ? 35 : 26) * ts : 0);
    UI.leftBottom = actY + VH.Acts.hud(ctx, ts, pad, actY, pw);
    // --- toasts: at most three short status lines, wrapped so they never run off the edge
    // on narrow screens the status lines go below the left-hand panels (and the touch buttons), so nothing overlaps
    let ty = narrow ? Math.max(pad + 102 * ts, UI.leftBottom + 4 * ts, I.touchMode ? pad + 168 * ts : 0) : pad + 34 * ts; const tn = Math.max(12, Math.floor((w - 12 * ts) / (6 * ts)));
    for (const m of g.msgs) { const a = Math.min(1, m.t * 2); ctx.globalAlpha = a; for (const l of U.wrap(m.str, tn)) { T(ctx, l, w / 2, ty, { align: 'center', color: m.col, scale: ts }); ty += 10 * ts; } ctx.globalAlpha = 1; }
    // --- the one big callout
    const co = g.nextCallout && g.nextCallout();
    if (co) {
      const str = co.str + (co.n > 1 ? ' X' + co.n : ''); const age = g.t - co.t0; const big = Math.max(ts, Math.min(ts * 2, Math.floor((w - 16 * ts) / (str.length * 6))));
      const lines = U.textWidth(str, big) > w - 16 * ts ? U.wrap(str, Math.floor((w - 16 * ts) / (6 * big))) : [str];
      ctx.globalAlpha = Math.min(1, (1.5 - age) * 3); const cy = Math.max(Math.round(h * 0.37), ty + 6 * ts) - (age < 0.12 ? 2 * ts : 0);
      const bw = Math.max(...lines.map(l => U.textWidth(l, big))) + 10 * ts; ctx.fillStyle = 'rgba(18,12,36,0.55)'; ctx.fillRect(Math.round(w / 2 - bw / 2), cy - 3 * ts, Math.round(bw), lines.length * 9 * big + 4 * ts);
      lines.forEach((l, i) => T(ctx, l, w / 2, cy + i * 9 * big, { align: 'center', color: co.col, scale: big })); ctx.globalAlpha = 1;
    }
    // --- minimap
    UI.minimap(ctx, w - pad - 92 * ts, pad, 92 * ts, 92 * ts, ts);
    // --- bottom: street + objective
    const street = UI.streetCache(pl.x, pl.y);
    if (!(I.touchMode && narrow)) T(ctx, street, pad + 2, I.touchMode ? pad + 44 * ts : h - pad - 9 * ts, { color: C.white, scale: ts });
    const obj = M().objective(); let objTop = h - pad - 22 * ts;
    if (obj) {
      const job = M().job; const head = job && job.started ? job.title + (I.touchMode ? '' : '  (J: BRIEF)') : '';
      const lines = U.wrap(obj, Math.floor((w - 20 * ts) / (6 * ts)));
      const bw = Math.max(U.textWidth(head, ts), ...lines.map(l => U.textWidth(l, ts))) + 14 * ts, bh = lines.length * 9 * ts + 8 * ts + (head ? 9 * ts : 0);
      const by = h - pad - (I.touchMode && narrow ? 96 : 22) * ts - bh; objTop = by; // on phones, sit above the thumb buttons
      const fl = (g.objFlash || 0) > 0 && Math.floor(g.objFlash * 6) % 2;
      panel(ctx, w / 2 - bw / 2, by, bw, bh, { accent: C.hi, fill: fl ? 'rgba(120,80,10,0.92)' : C.panel, edge: fl ? C.hi : C.edge });
      if (head) T(ctx, head, w / 2, by + 4 * ts, { align: 'center', color: C.dim, scale: ts });
      lines.forEach((l, i) => T(ctx, l, w / 2, by + 5 * ts + (head ? 9 * ts : 0) + i * 9 * ts, { align: 'center', color: C.hi, scale: ts }));
    }
    if (g.objFlash > 0) g.objFlash -= g.frameDt || 0.016;
    UI.objTop = objTop;
    if (!I.touchMode) T(ctx, '? HELP', w - pad, h - pad - 9 * ts, { align: 'right', color: C.dim, scale: ts });
    // vehicle readout
    if (!pl.onFoot && pl.vehicle) {
      const v = pl.vehicle; const kmh = Math.round(v.speed * 3.6);
      const vx = w - pad - 92 * ts, vy = pad + 96 * ts;
      panel(ctx, vx, vy, 92 * ts, 24 * ts);
      T(ctx, (v.rail ? v.name : v.def.name).toUpperCase().slice(0, 14), vx + 4 * ts, vy + 4 * ts, { color: C.dim, scale: ts });
      T(ctx, kmh + ' KM/H', vx + 4 * ts, vy + 13 * ts, { color: C.white, scale: ts });
      if (!v.rail) { const bw = 30 * ts; ctx.fillStyle = '#2a2040'; ctx.fillRect(vx + 58 * ts, vy + 14 * ts, bw, 5 * ts); ctx.fillStyle = v.damage > 0.75 ? C.red : v.damage > 0.4 ? C.hi : C.green; ctx.fillRect(vx + 58 * ts, vy + 14 * ts, bw * (1 - v.damage), 5 * ts); }
    }
    // context prompt
    let prompt = '';
    if (pl.inShop) prompt = VH.Shops.prompt();
    else if (pl.onFoot && !VH.Tackle.on) { const v = g.nearestVehicle(pl.x, pl.y, g.ENTER_R); if (v) prompt = UI.enterPrompt(v); }
    else if (pl.vehicle && pl.vehicle.type === 'police' && !pl.vehicle.siren && g.char === 'cop') prompt = 'H: SIREN';
    // the bottom prompt sits just above the objective, and first-time tips above that
    let aboveY = UI.objTop || h - pad - 22 * ts;
    if (prompt) { T(ctx, prompt, w / 2, aboveY - 12 * ts, { align: 'center', color: C.white, scale: ts }); aboveY -= 14 * ts; }
    UI.hints(ctx, ts, aboveY);
    // off-screen target arrows
    const vw = g.view; const offs = M().targets().filter(tg => !tg.small).sort((a, b) => Math.hypot(a.x - pl.x, a.y - pl.y) - Math.hypot(b.x - pl.x, b.y - pl.y)).slice(0, 1);
    if (vw && !VH.Tackle.on) for (const tg of offs) {
      const kz = vw.k || 1; const sx = (tg.x - vw.left) * vw.S * kz, sy = (tg.y - vw.top) * vw.S * kz; const m = 14 * ts, mt = narrow ? Math.max(Math.min(104 * ts, h * 0.3), (UI.leftBottom || 0) + 16 * ts) : Math.min(104 * ts, h * 0.3), mb = Math.max(64 * ts, h - (UI.objTop || h) + 20 * ts);
      if (sx > m && sy > m && sx < w - m && sy < h - m) continue;
      const cx = w / 2, cy = h / 2 + (mt - mb) / 2; const a = Math.atan2(sy - cy, sx - cx);
      const k = Math.min((w / 2 - m - 10 * ts) / Math.abs(Math.cos(a) || 1e-6), ((h - mt - mb) / 2) / Math.abs(Math.sin(a) || 1e-6));
      const ax = cx + Math.cos(a) * k, ay = cy + Math.sin(a) * k;
      ctx.save(); ctx.translate(Math.round(ax), Math.round(ay)); ctx.rotate(a); ctx.fillStyle = C.ink; ctx.beginPath(); ctx.moveTo(8 * ts, 0); ctx.lineTo(-5 * ts, -6 * ts); ctx.lineTo(-5 * ts, 6 * ts); ctx.fill();
      ctx.fillStyle = Math.floor(g.t * 3) % 2 ? C.hi : '#ffe98a'; ctx.beginPath(); ctx.moveTo(6 * ts, 0); ctx.lineTo(-4 * ts, -4 * ts); ctx.lineTo(-4 * ts, 4 * ts); ctx.fill(); ctx.restore();
      const dm = Math.round(Math.hypot(tg.x - pl.x, tg.y - pl.y)); const lab = (tg.label ? tg.label + ' · ' : '') + dm + 'M';
      const lw = U.textWidth(lab, ts); const lx = U.clamp(Math.round(ax - Math.cos(a) * 22 * ts), lw / 2 + 4 * ts, w - lw / 2 - 4 * ts), ly = U.clamp(Math.round(ay - Math.sin(a) * 14 * ts) - 3, mt, h - mb);
      panel(ctx, lx - lw / 2 - 3 * ts, ly - 3 * ts, lw + 6 * ts, 13 * ts, { fill: 'rgba(18,12,36,0.8)' });
      T(ctx, lab, lx, ly, { align: 'center', color: C.hi, scale: ts });
    }
    if (I.touchMode && !VH.Tackle.on) UI.touch(ctx, ts); else if (!I.touchMode) I.setButtons([{ id: 'pause', x: w / 2 + tw / 2 + 40 * ts, y: pad, w: 0, h: 0 }]);
    VH.Street.drawFeed(ctx, ts);
    // notoriety: little blue camera dots after the gossip label (one per clip on the community page)
    if (VH.Street.notoriety > 0 && g.char !== 'cop') for (let k = 0; k < VH.Street.notoriety; k++) { ctx.fillStyle = '#120c24'; ctx.fillRect(pad + 100 * ts + k * 4 * ts, pad + 20 * ts, 3 * ts + 1, 3 * ts + 1); ctx.fillStyle = '#5fb0ff'; ctx.fillRect(pad + 100 * ts + k * 4 * ts, pad + 20 * ts, 3 * ts, 3 * ts); }
    VH.Tackle.draw(ctx, ts);
    if (g.helpOpen) UI.helpOverlay(ctx, ts);
  };
  UI.enterPrompt = function (v) {
    const g = G(); const k = I.touchMode ? 'GET IN' : 'E';
    const name = (v.rail ? v.name : v.def.name).toUpperCase();
    const what = v.rail ? 'BORROW THE ' + name : v.def.bike ? 'HOP ON THE ' + name : v.def.gopher ? (v.owned ? 'CLIMB ON YOUR GOPHER' : 'CLIMB ON THE GOPHER') : v.owned ? 'YOUR ' + name :
      v.ai ? 'BORROW THE ' + name + ' (DRIVER WILL BE MIFFED)' : (v.type === 'police' || v.type === 'paddy') && g.char !== 'cop' ? 'NICK THE ' + name + '?!' : 'BORROW THE ' + name;
    return k + ' · ' + what;
  };
  let stCache = { t: 0, s: '' };
  UI.streetCache = (x, y) => { const now = performance.now(); if (now - stCache.t > 400) { const st = W.streetName(x, y); stCache = { t: now, s: (st ? st + ', ' : '') + W.suburb(x, y) }; } return stCache.s.toUpperCase(); };

  UI.minimap = function (ctx, x, y, w, h, ts) {
    const g = G(), pl = g.player; const ov = R.overview; if (!ov) return;
    const sc = R.overviewScale; const zoom = 1.6 / ts; // metres per minimap px
    panel(ctx, x - 2, y - 2, w + 4, h + 4, { accent: C.teal });
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    const mpp = 4.5; // metres per px
    const sw = w * mpp / sc, sh = h * mpp / sc; const sx = pl.x / sc - sw / 2, sy = pl.y / sc - sh / 2;
    ctx.imageSmoothingEnabled = false; ctx.drawImage(ov, sx, sy, sw, sh, x, y, w, h);
    const toM = (wx, wy) => [x + (wx / sc - sx) / sw * w, y + (wy / sc - sy) / sh * h];
    for (const tg of M().targets()) { if (tg.small) continue; let [mx, my] = toM(tg.x, tg.y); mx = U.clamp(mx, x + 2, x + w - 3); my = U.clamp(my, y + 2, y + h - 3); ctx.fillStyle = Math.floor(g.t * 4) % 2 ? C.hi : C.ink; ctx.fillRect(Math.round(mx) - 2, Math.round(my) - 2, 4, 4); ctx.fillStyle = C.hi; ctx.fillRect(Math.round(mx) - 1, Math.round(my) - 1, 2, 2); }
    const PO = VH.Police, LK = VH.Lockup; const blink = Math.floor(g.t * 6) % 2;
    for (const r of VH.Shops.resprays) { const [mx, my] = toM(r.x, r.y); if (mx < x || my < y || mx > x + w || my > y + h) continue; VH.Shops.drawCan(ctx, Math.round(mx), Math.round(my), 1); }
    for (const m of [...VH.Acts.markers(), ...(g.helipads || []).map(h => ({ x: h.x, y: h.y, letter: 'H', col: '#ffffff' }))]) { const [mx, my] = toM(m.x, m.y); if (mx < x || my < y || mx > x + w || my > y + h) continue; ctx.fillStyle = 'rgba(18,12,36,0.8)'; ctx.fillRect(Math.round(mx) - 3, Math.round(my) - 4, 7, 9); U.text(ctx, m.letter, Math.round(mx) - 2, Math.round(my) - 3, { color: m.col, shadow: false }); }
    if (LK.b) { const [mx, my] = toM(LK.centre.x, LK.centre.y); ctx.fillStyle = '#4a4f66'; ctx.fillRect(Math.round(mx) - 3, Math.round(my) - 2, 7, 5); ctx.fillStyle = '#c9ccd8'; ctx.fillRect(Math.round(mx) - 3, Math.round(my) - 4, 2, 2); ctx.fillRect(Math.round(mx) + 2, Math.round(my) - 4, 2, 2); }
    if (VH.Street.scannerT > 0) for (const v of PO.patrols) { const [mx, my] = toM(v.x, v.y); ctx.fillStyle = '#7fa6ff'; ctx.fillRect(Math.round(mx) - 1, Math.round(my) - 1, 3, 3); }
    for (const v of [...PO.units, ...PO.backup]) { const [mx, my] = toM(v.x, v.y); ctx.fillStyle = blink ? '#ff3030' : '#3070ff'; ctx.fillRect(Math.round(mx) - 2, Math.round(my) - 2, 4, 4); }
    for (const b of PO.blocks) { const [mx, my] = toM(b.x, b.y); ctx.fillStyle = '#ff3030'; ctx.fillRect(Math.round(mx) - 3, Math.round(my) - 1, 7, 3); }
    if (PO.boat) { const [mx, my] = toM(PO.boat.x, PO.boat.y); ctx.fillStyle = '#fff'; ctx.fillRect(Math.round(mx) - 2, Math.round(my) - 1, 5, 3); }
    if (PO.heli) { const [mx, my] = toM(PO.heli.sx, PO.heli.sy); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(mx, my, 4, 0, U.TAU); ctx.stroke(); }
    for (const v of g.watch) { const [mx, my] = toM(v.x, v.y); ctx.fillStyle = '#e8c33a'; ctx.fillRect(Math.round(mx) - 1, Math.round(my) - 1, 3, 3); }
    // player arrow
    const [px, py] = toM(pl.x, pl.y); ctx.save(); ctx.translate(Math.round(px), Math.round(py)); ctx.rotate(pl.ang);
    ctx.fillStyle = C.ink; ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-4, -4); ctx.lineTo(-4, 4); ctx.fill(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(5, 0); ctx.lineTo(-3, -3); ctx.lineTo(-3, 3); ctx.fill(); ctx.restore();
    ctx.restore();
    T(ctx, 'N', x + w - 7, y + 2, { color: C.white });
  };

  UI.fullMap = function (ctx, ts) {
    const g = G(), pl = g.player, w = ctx.canvas.width, h = ctx.canvas.height; const ov = R.overview; const sc = R.overviewScale;
    ctx.fillStyle = 'rgba(10,8,24,0.85)'; ctx.fillRect(0, 0, w, h);
    // zoom (wheel, +/-, pinch) and pan (arrows / WASD / drag) the full map; 0 recentres
    const mz = UI.mapZ || (UI.mapZ = { z: 1, cx: pl.x, cy: pl.y });
    if (I.consume('zoomIn')) mz.z = Math.min(8, mz.z * 1.5); if (I.consume('zoomOut')) mz.z = Math.max(1, mz.z / 1.5); if (I.consume('zoomReset')) { mz.z = 1; mz.cx = pl.x; mz.cy = pl.y; }
    const k0 = Math.min((w - 20) / ov.width, (h - 40 * ts) / ov.height); const k = k0 * mz.z;
    const pan = 400 / mz.z * (g.frameDt || 0.016); mz.cx += ((I.down('right') ? 1 : 0) - (I.down('left') ? 1 : 0)) * pan; mz.cy += ((I.down('down') ? 1 : 0) - (I.down('up') ? 1 : 0)) * pan;
    for (const q of I.pointers.values()) { if (q.lx != null) { mz.cx -= (q.x - q.lx) / k * sc; mz.cy -= (q.y - q.ly) / k * sc; } q.lx = q.x; q.ly = q.y; }
    if (mz.z === 1) { mz.cx = W.width / 2; mz.cy = W.height / 2; }
    const mw = ov.width * k, mh = ov.height * k; const vx0 = 10, vy0 = 22 * ts, vw0 = w - 20, vh0 = h - 40 * ts;
    let mx = vx0 + vw0 / 2 - mz.cx / sc * k, my = vy0 + vh0 / 2 - mz.cy / sc * k;
    if (mz.z === 1) { mx = (w - mw) / 2; my = 22 * ts; }
    ctx.save(); ctx.beginPath(); ctx.rect(vx0 - 4, vy0 - 4, vw0 + 8, vh0 + 8); ctx.clip();
    panel(ctx, mx - 3, my - 3, mw + 6, mh + 6, { accent: C.teal });
    ctx.imageSmoothingEnabled = true; ctx.drawImage(ov, mx, my, mw, mh); ctx.imageSmoothingEnabled = false;
    const toM = (x, y) => [mx + x / sc * k, my + y / sc * k];
    // landmark labels
    const P = g.places; const labels = [['WARLAND RESERVE', P.warland], ['GRANITE ISLAND', P.granite], ['THE BLUFF', P.bluff], ['GOLF CLUB', P.golf], ['POLICE', P.police], ['STATION', P.station], ['INDUSTRIAL ESTATE', P.industrial], ['CEMETERY', P.cemetery], ['LOCK-UP', VH.Lockup.centre]];
    for (const [s, p] of labels) { if (!p) continue; const [x, y] = toM(p.x, p.y); ctx.fillStyle = C.white; ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 2, 2); T(ctx, s, x + 3, y - 3, { color: C.white, scale: 1 }); }
    if (R.drawMapLabels) R.drawMapLabels(ctx, toM, k / sc, ts, [vx0, vy0, vw0, vh0]); // [Round C map] street, suburb and park names
    for (const r of VH.Shops.resprays) { const [x, y] = toM(r.x, r.y); VH.Shops.drawCan(ctx, Math.round(x), Math.round(y), 2); T(ctx, r.name, x + 8, y - 4, { color: '#9be15d', scale: 1 }); }
    for (const s of VH.Shops.list) { const [x, y] = toM(s.door.x, s.door.y); ctx.fillStyle = '#38e0c8'; ctx.fillRect(Math.round(x) - 2, Math.round(y) - 2, 4, 4); }
    for (const m of [...VH.Acts.markers(), ...(g.helipads || []).map(h => ({ x: h.x, y: h.y, letter: 'H', col: '#ffffff' }))]) { const [x, y] = toM(m.x, m.y); ctx.fillStyle = 'rgba(18,12,36,0.85)'; ctx.fillRect(Math.round(x) - 4, Math.round(y) - 5, 9, 11); U.text(ctx, m.letter, Math.round(x) - 2, Math.round(y) - 3, { color: m.col, shadow: false }); }
    for (const tg of M().targets()) { if (tg.small) continue; const [x, y] = toM(tg.x, tg.y); ctx.fillStyle = Math.floor(g.t * 4) % 2 ? C.hi : C.pink; ctx.fillRect(Math.round(x) - 3, Math.round(y) - 3, 6, 6); }
    const [px, py] = toM(pl.x, pl.y); ctx.fillStyle = Math.floor(g.t * 5) % 2 ? '#fff' : C.pink; ctx.fillRect(Math.round(px) - 3, Math.round(py) - 3, 6, 6);
    ctx.restore();
    if (g.char !== 'cop') T(ctx, 'M MAYHEM MINUTE  R RAMP  G/B/T/S RACES  H HELIPAD  CAN: RESPRAY  BLUE: SHOPS', w / 2, h - 30 * ts, { align: 'center', color: C.white, scale: ts });
    T(ctx, 'MAP OF VICTOR HARBOR', w / 2, 6 * ts, { align: 'center', color: C.hi, scale: ts * 1.5 | 0 || 1 });
    T(ctx, I.touchMode ? 'PINCH: ZOOM  DRAG: PAN  TAP MAP: CLOSE' : 'WHEEL / + -: ZOOM   ARROWS: PAN   0: RESET   M: CLOSE', w / 2, h - 20 * ts, { align: 'center', color: C.dim, scale: ts });
    T(ctx, 'MAP DATA (C) OPENSTREETMAP CONTRIBUTORS (ODBL)', w / 2, h - 10 * ts, { align: 'center', color: C.dim, scale: ts });
  };

  // ---------- touch controls ----------
  UI.touch = function (ctx, ts) {
    const w = ctx.canvas.width, h = ctx.canvas.height; const g = G(); const pl = g.player;
    const r = 15 * ts; const bx = w - r - 8 * ts, by = h - r - 12 * ts;
    const v = pl.vehicle; const heli = v && v.def && v.def.heli, bike = v && v.def && v.def.bike;
    const btns = [
      { id: 'action', x: bx - r, y: by - r, label: pl.onFoot ? 'ACT' : heli ? 'DOWN' : bike ? 'HOP' : 'SKID', col: C.pink },
      { id: 'enter', x: bx - r * 3.4, y: by - r * 0.3, label: pl.onFoot ? 'GET IN' : 'GET OUT', col: C.teal },
      { id: 'horn', x: bx - r * 1.2, y: by - r * 3.4, label: pl.onFoot ? (g.char === 'cop' ? 'MEGA' : 'SHOUT') : (v && (v.type === 'police' || v.type === 'paddy')) ? 'SIREN' : 'HORN', col: C.hi },
      { id: 'run', x: bx - r * 3.4, y: by - r * 2.8, label: heli ? 'UP' : 'BOOST', col: '#7c5cff' },
    ];
    if (pl.onFoot) btns.push({ id: 'kick', x: bx - r, y: by - r * 5.6, label: 'KICK', col: '#ff9a30' });
    if (g.char === 'cop' && v && !v.rail && !heli) btns.push({ id: 'spikes', x: bx - r, y: by - r * 5.6, label: 'SPIKES', col: '#ff9a30' }, { id: 'backup', x: bx - r * 3.4, y: by - r * 5.2, label: 'BACKUP', col: '#7fa6ff' });
    const rects = btns.map(b => ({ id: b.id, x: b.x, y: b.y, w: r * 2, h: r * 2 }));
    const ux = w - 4 * ts - 92 * ts, uy = 4 * ts + 124 * ts;
    rects.push({ id: 'pause', x: ux + 50 * ts, y: uy, w: 42 * ts, h: 16 * ts }, { id: 'map', x: ux, y: uy, w: 42 * ts, h: 16 * ts }, { id: 'job', x: ux, y: uy + 20 * ts, w: 42 * ts, h: 16 * ts }, { id: 'help', x: ux + 50 * ts, y: uy + 20 * ts, w: 42 * ts, h: 16 * ts });
    I.setButtons(rects); I.stickZone = w * 0.5; I.stickR = 26 * ts;
    for (const b of btns) {
      const cx = b.x + r, cy = b.y + r; const held = I.held[b.id];
      ctx.globalAlpha = held ? 0.9 : 0.55; ctx.fillStyle = C.ink; ctx.beginPath(); ctx.arc(cx, cy, r, 0, U.TAU); ctx.fill();
      ctx.strokeStyle = b.col; ctx.lineWidth = Math.max(1, ts); ctx.beginPath(); ctx.arc(cx, cy, r - 1, 0, U.TAU); ctx.stroke(); ctx.globalAlpha = 1;
      T(ctx, b.label, cx, cy - 3 * ts, { align: 'center', color: b.col, scale: ts });
    }
    panel(ctx, ux + 50 * ts, uy, 42 * ts, 16 * ts); T(ctx, 'PAUSE', ux + 71 * ts, uy + 5 * ts, { align: 'center', scale: ts });
    panel(ctx, ux, uy, 42 * ts, 16 * ts); T(ctx, 'MAP', ux + 21 * ts, uy + 5 * ts, { align: 'center', scale: ts });
    panel(ctx, ux, uy + 20 * ts, 42 * ts, 16 * ts); T(ctx, 'JOB', ux + 21 * ts, uy + 25 * ts, { align: 'center', scale: ts });
    panel(ctx, ux + 50 * ts, uy + 20 * ts, 42 * ts, 16 * ts, { edge: G().helpOpen ? C.teal : C.edge }); T(ctx, '?', ux + 71 * ts, uy + 25 * ts, { align: 'center', scale: ts, color: C.teal });
    if (I.stick.active) {
      ctx.globalAlpha = 0.5; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(I.stick.ox, I.stick.oy, I.stickR, 0, U.TAU); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(I.stick.ox + I.stick.x * I.stickR, I.stick.oy + I.stick.y * I.stickR, 8 * ts, 0, U.TAU); ctx.fill(); ctx.globalAlpha = 1;
    } else { ctx.globalAlpha = 0.25; T(ctx, 'DRAG HERE TO MOVE', w * 0.2, h - 20 * ts, { align: 'center', scale: ts }); ctx.globalAlpha = 1; }
  };

  // ---------- menus ----------
  function logo(ctx, x, y, s, t) {
    const words = ['SCHOOLIES', 'MAYHEM'];
    const cols = ['#ff4fa0', '#ffd23a', '#38e0c8', '#7c5cff'];
    words.forEach((wd, wi) => {
      const ws = s * (wi ? 1.25 : 1); let px = x - U.textWidth(wd, ws) / 2;
      for (let i = 0; i < wd.length; i++) {
        const bob = Math.round(Math.sin(t * 3 + i * 0.6 + wi) * s * 0.6);
        U.text(ctx, wd[i], px, y + wi * 10 * s + bob, { scale: ws, color: cols[(i + wi * 2) % cols.length], shadow: '#120c24' });
        U.text(ctx, wd[i], px - Math.max(1, s / 2 | 0), y + wi * 10 * s + bob - Math.max(1, s / 2 | 0), { scale: ws, color: '#fff', shadow: false });
        U.text(ctx, wd[i], px, y + wi * 10 * s + bob, { scale: ws, color: cols[(i + wi * 2) % cols.length], shadow: false });
        px += 6 * ws;
      }
    });
  }
  function menuList(ctx, items, x, y, ts, idx) {
    const taps = [];
    items.forEach((it, i) => {
      const sel = i === idx; const s = ts * (sel ? 2 : 2); const yy = y + i * 18 * ts; const wdt = U.textWidth(it, s) + 16 * ts;
      if (sel) { panel(ctx, x - wdt / 2, yy - 4 * ts, wdt, 22 * ts, { fill: 'rgba(255,79,160,0.25)', edge: C.pink }); }
      T(ctx, (sel ? '> ' : '') + it + (sel ? ' <' : ''), x, yy, { align: 'center', color: sel ? C.hi : C.white, scale: s });
      taps.push({ x: x - wdt / 2, y: yy - 4 * ts, w: wdt, h: 18 * ts });
    });
    return taps;
  }
  function navigate(n, idxKey) {
    if (I.consume('up')) { UI[idxKey] = (UI[idxKey] + n - 1) % n; sfx('click'); }
    if (I.consume('down')) { UI[idxKey] = (UI[idxKey] + 1) % n; sfx('click'); }
  }
  function tappedIndex(rects) { const t = I.tap(); if (!t) return -1; return rects.findIndex(r => t.x >= r.x && t.y >= r.y && t.x <= r.x + r.w && t.y <= r.y + r.h); }
  const confirm = () => I.consume('confirm') || I.consume('enter') || I.consume('action');

  UI.title = function (ctx, ts) {
    const w = ctx.canvas.width, h = ctx.canvas.height; const g = G(); const t = g.t;
    const grad = ctx.createLinearGradient(0, 0, 0, h); grad.addColorStop(0, 'rgba(18,12,36,0.75)'); grad.addColorStop(0.5, 'rgba(18,12,36,0.25)'); grad.addColorStop(1, 'rgba(18,12,36,0.8)'); ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);
    const s = Math.max(2, Math.floor(Math.min(w / 100, h / 60)));
    const ly = Math.round(h * 0.07);
    logo(ctx, w / 2, ly, s, t);
    T(ctx, 'A VICTOR HARBOR SCHOOLIES WEEK CAPER', w / 2, ly + 20 * s, { align: 'center', color: C.teal, scale: ts });
    const save = U.store.get('save', null);
    const items = ['NEW GAME', ...(save ? ['CONTINUE NIGHT ' + save.night] : []), 'FREE ROAM', 'SOUND: ' + (window.SFX && SFX.isMuted() ? 'OFF' : 'ON'), 'CONTROLS'];
    UI.menuIdx = Math.min(UI.menuIdx, items.length - 1);
    navigate(items.length, 'menuIdx');
    const rects = menuList(ctx, items, w / 2, Math.max(ly + 20 * s + 22 * ts, h * 0.5), ts, UI.menuIdx);
    const ti = tappedIndex(rects); if (ti >= 0) UI.menuIdx = ti;
    if (ti >= 0 || confirm()) {
      sfx('menu'); const it = items[UI.menuIdx];
      if (it === 'NEW GAME') { g.state = 'select'; UI.selIdx = 0; }
      else if (it.startsWith('CONTINUE')) { g.continueRun(save); }
      else if (it === 'FREE ROAM') g.beginRun('roam');
      else if (it.startsWith('SOUND')) { SFX.setMuted(!SFX.isMuted()); U.store.set('muted', SFX.isMuted()); }
      else if (it === 'CONTROLS') { g.state = 'help'; }
    }
    T(ctx, 'MAP DATA (C) OPENSTREETMAP CONTRIBUTORS. AN ORIGINAL GAME. NO REAL PEOPLE WERE HARMED.', w / 2, h - 12 * ts, { align: 'center', color: C.dim, scale: ts });
  };
  // the controls card (title screen and pause menu): every section, two columns when there's room
  UI.help = function (ctx, ts) {
    const w = ctx.canvas.width, h = ctx.canvas.height; ctx.fillStyle = 'rgba(18,12,36,0.9)'; ctx.fillRect(0, 0, w, h);
    T(ctx, 'CONTROLS', w / 2, 8 * ts, { align: 'center', color: C.hi, scale: ts * 2 });
    const all = [CONTROLS.foot, CONTROLS.car, CONTROLS.rail, CONTROLS.heli, CONTROLS.kev, CONTROLS.evade, CONTROLS.any];
    const two = w >= 420 * ts; const colW = two ? Math.min(250 * ts, (w - 30 * ts) / 2) : Math.min(w - 16 * ts, 300 * ts);
    const left = two ? [all[0], all[1], all[2], all[3]] : all, right = two ? [all[4], all[5], all[6]] : [];
    const hL = UI.measureControls(ts, left, colW), hR = UI.measureControls(ts, right, colW);
    const extra = ['GOSSIP: MAYHEM FILLS THE CURTAINS. MORE CURTAINS, MORE POLICE.', 'BREAK THEIR LINE OF SIGHT AND LIE LOW TO LOSE THEM.', 'BUSTED? THE PADDY WAGON TAKES YOU UP THE HILL TO THE LOCK-UP.', 'NOBODY GETS HURT: PEOPLE ALWAYS JUMP OUT OF THE WAY.'];
    const x0 = two ? w / 2 - colW - 5 * ts : w / 2 - colW / 2; const y0 = 26 * ts;
    // scroll with up/down when it doesn't fit (small phones)
    const total = Math.max(hL, two ? hR : 0) + extra.length * 9 * ts + 10 * ts; const view = h - 48 * ts;
    UI.helpScroll = U.clamp((UI.helpScroll || 0) + ((I.down('down') ? 1 : 0) - (I.down('up') ? 1 : 0)) * 4 * ts, 0, Math.max(0, total - view));
    ctx.save(); ctx.beginPath(); ctx.rect(0, 22 * ts, w, view + 4 * ts); ctx.clip(); ctx.translate(0, -Math.round(UI.helpScroll));
    controlsTable(ctx, ts, left, x0, y0, colW); if (two) controlsTable(ctx, ts, right, w / 2 + 5 * ts, y0, colW);
    const ey = y0 + Math.max(hL, two ? hR : 0) + 2 * ts; extra.forEach((l, i) => T(ctx, l, w / 2, ey + i * 9 * ts, { align: 'center', color: C.dim, scale: ts }));
    ctx.restore();
    T(ctx, (total > view ? (I.touchMode ? '' : 'UP/DOWN: SCROLL   ') : '') + (I.touchMode ? 'TAP TO GO BACK' : 'ENTER / ESC: BACK'), w / 2, h - 14 * ts, { align: 'center', color: C.pink, scale: ts });
    if (confirm() || I.tap() || I.consume('back') || I.consume('pause')) { G().state = G().prevState || 'title'; G().prevState = null; UI.helpScroll = 0; sfx('click'); }
  };
  // character select: cards sized to their content and centred as a group; side by side when there's room,
  // stacked rows otherwise, each row as tall as its wrapped text (with shorter blurbs when space is tight)
  const SEL = {
    schoolie: { plays: 'PLAYS LIKE: ON FOOT AND IN BORROWED CARS. STEALTH, STUNTS, MAYHEM.', veh: 'hatch', col: '#38e0c8', short: 'YEAR 12 IS DONE. BECOME A SCHOOLIES LEGEND.' },
    grump: { plays: 'PLAYS LIKE: A MOBILITY SCOOTER (TURBO LATER). LETTERBOXES, SPEAKERS, A B-DOUBLE.', veh: 'gopher', col: '#c4372e', short: 'MERV, 81, ONE GOPHER. SHUT DOWN THE PARTY.' },
    cop: { plays: 'PLAYS LIKE: POLICE CAR AND PADDY WAGON. SIREN, SPIKES, BACKUP. NO GUN.', veh: 'police', col: '#fff', short: 'SENIOR CONSTABLE KEV. HOUND THEM ALL EQUALLY.' },
  };
  function portrait(ctx, k, cx, cy, ps, t) {
    const c = VH.Shops.look(k); const spr = SP.person(c.shirt, c.hair, 1 + Math.floor(t * 5) % 4, { hat: c.hat, sunnies: c.sunnies });
    ctx.save(); ctx.translate(Math.round(cx), Math.round(cy)); ctx.rotate(-Math.PI / 2); ctx.drawImage(spr, -6 * ps, -6 * ps, 12 * ps, 12 * ps); ctx.restore();
  }
  function vehicleIcon(ctx, k, cx, cy, ps) {
    const sd = SEL[k]; const spr = SP.vehicle(sd.veh, sd.col); const sc = Math.max(1, Math.floor(ps / 2));
    ctx.drawImage(spr, Math.round(cx - spr.width * sc / 2), Math.round(cy - spr.height * sc / 2), spr.width * sc, spr.height * sc);
  }
  UI.select = function (ctx, ts) {
    const w = ctx.canvas.width, h = ctx.canvas.height; const g = G();
    ctx.fillStyle = 'rgba(18,12,36,0.72)'; ctx.fillRect(0, 0, w, h);
    const keys = ['schoolie', 'grump', 'cop'];
    if (I.consume('left') || I.consume('up')) { UI.selIdx = (UI.selIdx + 2) % 3; sfx('click'); } if (I.consume('right') || I.consume('down')) { UI.selIdx = (UI.selIdx + 1) % 3; sfx('click'); }
    const rects = []; const wins = U.store.get('wins', {});
    const jobsOf = k => (M().STORY[k] || []).map((n, i) => `${i + 1}: ` + n.map(j => j.title).join(' · '));
    const L = 9 * ts; const titleY = 8 * ts; const footY = h - 12 * ts; const top0 = titleY + 18 * ts, avail = footY - 6 * ts - top0;
    const cols = w >= 420 * ts;
    if (cols) {
      const cw = Math.min(175 * ts, (w - 28 * ts) / 3); const n = Math.floor((cw - 12 * ts) / (6 * ts));
      const build = (k, lvl) => { const c = g.CHARS[k]; return { blurb: U.wrap(lvl > 2 ? SEL[k].short : c.blurb, n), plays: lvl > 1 ? [] : U.wrap(SEL[k].plays, n), jobs: lvl > 0 ? [] : jobsOf(k).flatMap(j => U.wrap(j, n)) }; };
      const heightOf = b => 62 * ts + (b.blurb.length) * L + (b.plays.length ? b.plays.length * L + 5 * ts : 0) + (b.jobs.length ? (b.jobs.length + 1) * L + 5 * ts : 0) + 8 * ts;
      let lvl = 0, blocks, ch; for (; lvl <= 3; lvl++) { blocks = keys.map(k => build(k, lvl)); ch = Math.max(...blocks.map(heightOf)); if (ch <= avail) break; }
      ch = Math.min(ch, avail); const y = Math.round(top0 + Math.max(0, (avail - ch) / 2));
      const ps = Math.max(2, Math.min(4 * ts, Math.floor(cw / 40)));
      keys.forEach((k, i) => {
        const c = g.CHARS[k], b = blocks[i]; const x = Math.round(w / 2 - (cw * 3 + 12 * ts) / 2 + i * (cw + 6 * ts)); const sel = i === UI.selIdx;
        panel(ctx, x, y, cw, ch, { accent: sel ? C.pink : C.edge, edge: sel ? C.pink : C.edge, fill: sel ? 'rgba(40,20,70,0.94)' : C.panel }); rects.push({ x, y, w: cw, h: ch });
        portrait(ctx, k, x + cw / 2 - 16 * ts, y + 24 * ts, ps, g.t); vehicleIcon(ctx, k, x + cw / 2 + 20 * ts, y + 24 * ts, ps);
        let yy = y + 44 * ts;
        T(ctx, c.title, x + cw / 2, yy, { align: 'center', color: sel ? C.hi : C.white, scale: ts }); yy += 10 * ts;
        T(ctx, c.name + (wins[k] ? ' (BEATEN)' : ''), x + cw / 2, yy, { align: 'center', color: C.teal, scale: ts }); yy += 12 * ts;
        ctx.save(); ctx.beginPath(); ctx.rect(x, y, cw, ch - 3 * ts); ctx.clip();
        for (const l of b.blurb) { T(ctx, l, x + 6 * ts, yy, { color: C.dim, scale: ts }); yy += L; }
        if (b.plays.length) { yy += 5 * ts; for (const l of b.plays) { T(ctx, l, x + 6 * ts, yy, { color: C.teal, scale: ts }); yy += L; } }
        if (b.jobs.length) { yy += 5 * ts; T(ctx, 'NIGHTS:', x + 6 * ts, yy, { color: C.hi, scale: ts }); yy += L; for (const l of b.jobs) { T(ctx, l, x + 6 * ts, yy, { color: C.white, scale: ts }); yy += L; } }
        ctx.restore();
      });
    } else {
      const rw = w - 12 * ts; const tx = 50 * ts; const n = Math.floor((rw - tx - 6 * ts) / (6 * ts));
      const build = (k, lvl) => ({ blurb: U.wrap(lvl > 1 ? SEL[k].short : g.CHARS[k].blurb, n), plays: lvl > 0 ? [] : U.wrap(SEL[k].plays, n) });
      const heightOf = b => Math.max(46 * ts, 18 * ts + (b.blurb.length + b.plays.length) * L + (b.plays.length ? 3 * ts : 0) + 4 * ts);
      let lvl = 0, blocks, hs; for (; lvl <= 2; lvl++) { blocks = keys.map(k => build(k, lvl)); hs = blocks.map(heightOf); if (hs.reduce((a, b) => a + b, 0) + 8 * ts <= avail) break; }
      const total = hs.reduce((a, b) => a + b, 0) + 8 * ts; let y = Math.round(top0 + Math.max(0, (avail - total) / 2));
      const ps = Math.max(2, Math.min(3 * ts, Math.floor((Math.min(...hs) - 8 * ts) / 14)));
      keys.forEach((k, i) => {
        const c = g.CHARS[k], b = blocks[i], rh = hs[i]; const x = 6 * ts; const sel = i === UI.selIdx;
        panel(ctx, x, y, rw, rh, { accent: sel ? C.pink : C.edge, edge: sel ? C.pink : C.edge, fill: sel ? 'rgba(40,20,70,0.94)' : C.panel }); rects.push({ x, y, w: rw, h: rh });
        portrait(ctx, k, x + 22 * ts, y + rh / 2, ps, g.t);
        let yy = y + 5 * ts;
        T(ctx, c.name + ' · ' + c.title + (wins[k] ? ' (BEATEN)' : ''), x + tx, yy, { color: sel ? C.hi : C.white, scale: ts }); yy += 12 * ts;
        ctx.save(); ctx.beginPath(); ctx.rect(x, y, rw, rh - 2); ctx.clip();
        for (const l of b.blurb) { T(ctx, l, x + tx, yy, { color: C.dim, scale: ts }); yy += L; }
        if (b.plays.length) { yy += 3 * ts; for (const l of b.plays) { T(ctx, l, x + tx, yy, { color: C.teal, scale: ts }); yy += L; } }
        ctx.restore();
        y += rh + 4 * ts;
      });
    }
    T(ctx, 'PICK YOUR PLAYER', w / 2, titleY, { align: 'center', color: C.hi, scale: ts * 2 });
    const ti = tappedIndex(rects);
    if (ti >= 0 && ti === UI.selIdx || confirm()) { sfx('menu'); g.beginRun(keys[UI.selIdx]); }
    else if (ti >= 0) { UI.selIdx = ti; sfx('click'); }
    if (I.consume('back') || I.consume('pause')) { g.state = 'title'; }
    T(ctx, I.touchMode ? 'TAP A CARD, TAP AGAIN TO PLAY' : 'ARROWS / WASD TO CHOOSE, ENTER TO PLAY', w / 2, footY, { align: 'center', color: C.dim, scale: ts });
  };
  // the phone-style job brief
  UI.brief = function (ctx, ts) {
    const w = ctx.canvas.width, h = ctx.canvas.height; const g = G(); const j = M().job;
    ctx.fillStyle = 'rgba(18,12,36,0.55)'; ctx.fillRect(0, 0, w, h);
    const pw = Math.min(w - 16 * ts, 230 * ts);
    const txt = j ? (I.touchMode ? j.brief.replace(/SPACE/g, 'ACT').replace(/\(H\)/g, '(HORN)').replace(/SHIFT/g, 'BOOST') : j.brief) : '';
    const lines = j ? U.wrap(txt, Math.floor((pw - 24 * ts) / (6 * ts))) : [];
    const ph = 60 * ts + lines.length * 10 * ts + (g.briefNight ? 26 * ts : 0); const x = w / 2 - pw / 2, y = Math.max(6 * ts, h / 2 - ph / 2);
    if (g.briefNight) { T(ctx, g.char === 'roam' ? 'FREE ROAM' : `NIGHT ${g.night}: ${M().NIGHTS[g.night - 1]}`, w / 2, y, { align: 'center', color: C.hi, scale: ts * 2 }); }
    const py = y + (g.briefNight ? 26 * ts : 0);
    // phone
    panel(ctx, x, py, pw, ph - (g.briefNight ? 26 * ts : 0), { fill: '#1d2a22', edge: '#6a8a70', accent: '#9be15d' });
    ctx.fillStyle = '#9bbc6a'; ctx.fillRect(x + 6 * ts, py + 6 * ts, pw - 12 * ts, ph - (g.briefNight ? 26 * ts : 0) - 22 * ts);
    const ink = '#1d2a12';
    if (j) {
      T(ctx, (g.reviewBrief ? 'CURRENT JOB · ' : 'NEW MSG · ') + 'FROM: ' + j.from, x + 10 * ts, py + 10 * ts, { color: ink, scale: ts, shadow: false });
      T(ctx, j.title + '  (+$' + j.pay + ')', x + 10 * ts, py + 22 * ts, { color: '#3a1a5a', scale: ts, shadow: false });
      lines.forEach((l, i) => T(ctx, l, x + 10 * ts, py + 36 * ts + i * 10 * ts, { color: ink, scale: ts, shadow: false }));
    } else T(ctx, 'NO JOBS TONIGHT. GO NUTS.', x + 10 * ts, py + 20 * ts, { color: ink, scale: ts, shadow: false });
    if (Math.floor(g.t * 2) % 2 || g.reviewBrief) T(ctx, g.reviewBrief ? (I.touchMode ? 'TAP TO CARRY ON' : 'ENTER OR J: CARRY ON') : I.touchMode ? 'TAP TO GO' : 'PRESS ENTER', w / 2, py + ph - (g.briefNight ? 26 * ts : 0) - 13 * ts, { align: 'center', color: '#9be15d', scale: ts });
    // only Enter, a tap or J closes it, after a short beat, so a key held while driving can't skip a new job
    const close = I.consume('confirm') || I.consume('job') || I.tap();
    I.consume('enter'); I.consume('action');
    if ((g.stateT || 0) > 0.8 && close) {
      sfx('sms'); g.briefNight = false; g.state = 'play';
      if (g.reviewBrief) g.reviewBrief = false; else { M().startJob(); g.objFlash = 3; }
    }
  };
  UI.pause = function (ctx, ts) {
    const w = ctx.canvas.width, h = ctx.canvas.height; const g = G();
    ctx.fillStyle = 'rgba(18,12,36,0.7)'; ctx.fillRect(0, 0, w, h);
    T(ctx, 'PAUSED', w / 2, h * 0.18, { align: 'center', color: C.hi, scale: ts * 3 });
    const items = ['RESUME', 'CONTROLS', 'WALKING: ' + (g.walkMode === 'screen' ? 'SCREEN DIRECTION' : 'LIKE A CAR'), 'SOUND: ' + (window.SFX && SFX.isMuted() ? 'OFF' : 'ON'), 'QUIT TO TITLE'];
    const job = M().job; if (job && job.started) { const wrapN = Math.floor((w - 20 * ts) / (6 * ts)); T(ctx, 'JOB: ' + job.title, w / 2, h * 0.18 + 28 * ts, { align: 'center', color: C.white, scale: ts }); U.wrap(M().objective(), wrapN).forEach((l, i) => T(ctx, l, w / 2, h * 0.18 + 39 * ts + i * 9 * ts, { align: 'center', color: C.hi, scale: ts })); }
    navigate(items.length, 'menuIdx'); UI.menuIdx = Math.min(UI.menuIdx, items.length - 1);
    const rects = menuList(ctx, items, w / 2, Math.max(h * 0.4, h * 0.18 + 70 * ts), ts, UI.menuIdx); const ti = tappedIndex(rects); if (ti >= 0) UI.menuIdx = ti;
    if (I.consume('pause')) { g.state = 'play'; return; }
    if (ti >= 0 || confirm()) {
      sfx('menu'); const it = items[UI.menuIdx];
      if (it === 'RESUME') g.state = 'play'; else if (it === 'CONTROLS') { g.prevState = 'pause'; g.state = 'help'; }
      else if (it.startsWith('WALKING')) { g.walkMode = g.walkMode === 'screen' ? 'car' : 'screen'; U.store.set('walk', g.walkMode); }
      else if (it.startsWith('SOUND')) { SFX.setMuted(!SFX.isMuted()); U.store.set('muted', SFX.isMuted()); } else if (it === 'QUIT TO TITLE') g.toTitle();
    }
  };
  function card(ctx, ts, title, col, lines, foot) {
    const w = ctx.canvas.width, h = ctx.canvas.height; ctx.fillStyle = 'rgba(18,12,36,0.78)'; ctx.fillRect(0, 0, w, h);
    const tsz = Math.max(ts * 2, Math.min(ts * 3, Math.floor((w - 10) / (title.length * 6))));
    T(ctx, title, w / 2, h * 0.16, { align: 'center', color: col, scale: tsz });
    lines.forEach((l, i) => T(ctx, l, w / 2, h * 0.16 + 32 * ts + i * 11 * ts, { align: 'center', color: i === 0 ? C.white : C.dim, scale: ts }));
    if (Math.floor(G().t * 2) % 2) T(ctx, foot, w / 2, h - 22 * ts, { align: 'center', color: C.pink, scale: ts });
  }
  const statLines = () => { const s = G().stats; return [`STUFF KNOCKED OVER: ${s.smashed}`, `PEOPLE WHO JUMPED OUT OF THE WAY: ${s.dives}`, `VEHICLES BORROWED: ${s.stolen}`, `TYRE MARKS: ${Math.round(s.tracks)}M`, `DISTANCE: ${(s.distance / 1000).toFixed(1)}KM`, `TRIPS UP THE HILL: ${s.busted}`, `CASH: $${Math.round(G().cash)}`]; };
  // in the back of the paddy wagon: letterbox bars, a caption, and a skip
  UI.ride = function (ctx, ts) {
    const w = ctx.canvas.width, h = ctx.canvas.height; const r = VH.Lockup.ride; if (!r) return;
    const bar = Math.round(h * 0.11); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, bar); ctx.fillRect(0, h - bar, w, bar);
    if (r.fade > 0) { ctx.fillStyle = `rgba(0,0,0,${r.fade})`; ctx.fillRect(0, bar, w, h - bar * 2); }
    if (r.phase === 'load') { const s = Math.max(ts * 3, Math.min(ts * 5, Math.floor(w / 60))); T(ctx, 'BUSTED!', w / 2, h * 0.38, { align: 'center', color: '#ff6a5a', scale: s }); T(ctx, 'INTO THE BACK OF THE PADDY WAGON WITH YOU', w / 2, h * 0.38 + 10 * s, { align: 'center', color: C.white, scale: ts }); }
    T(ctx, r.phase === 'arrive' ? 'WELCOME TO ' + VH.Lockup.NAME : 'OFF UP THE HILL TO ' + VH.Lockup.NAME + '...', w / 2, Math.round(bar / 2 - 3 * ts), { align: 'center', color: C.hi, scale: ts });
    T(ctx, I.touchMode ? 'TAP TO SKIP' : 'ENTER: SKIP', w - 6 * ts, h - bar / 2 - 3 * ts, { align: 'right', color: C.dim, scale: ts });
    if (I.consume('confirm') || I.tap()) VH.Lockup.skipRide();
  };
  UI.lockedUp = function (ctx, ts) {
    const b = G().bustInfo || {}; const wrapN = Math.floor(ctx.canvas.width / (6 * ts)) - 4;
    card(ctx, ts, 'LOCKED UP', '#7fa6ff', ['A SHORT STAY AT ' + VH.Lockup.NAME + '.', '', ...U.wrap('THE SERGEANT: "' + b.line + '"', wrapN), '', `FINE: $${b.fine} (DONATED TO THE FOOTY CLUB)`, "YOU'RE LET OUT AT THE GATE. THE JOB STARTS OVER."], 'PRESS ENTER / TAP');
    if (G().stateT > 1 && (I.consume('confirm') || I.tap())) G().afterBust();
  };
  UI.nightEnd = function (ctx, ts) {
    card(ctx, ts, `NIGHT ${G().night} DONE`, C.green, ['YOU STAGGER HOME AS THE SKY GOES GREY.', '', ...statLines()], 'PRESS ENTER / TAP FOR THE NEXT NIGHT');
    if (G().stateT > 1 && (confirm() || I.tap())) { sfx('menu'); M().toNight(G().night + 1); }
  };
  UI.sunrise = function (ctx, ts) {
    card(ctx, ts, "SUN'S UP", C.hi, ["THE BIRDS ARE OUT, THE PARTY'S OVER, AND", "YOU DIDN'T GET IT ALL DONE.", '', 'TRY THE NIGHT AGAIN.'], 'PRESS ENTER / TAP');
    if (G().stateT > 1 && (confirm() || I.tap())) { sfx('menu'); const sv = U.store.get('save', null); if (sv && sv.char === G().char && sv.night === G().night) G().cash = sv.cash; M().toNight(G().night); }
  };
  UI.win = function (ctx, ts) {
    const w = M().WIN[G().char] || { title: 'YOU WIN', text: '' }; const wrapN = Math.floor(ctx.canvas.width / (6 * ts)) - 4;
    if (Math.random() < 0.3) FX.confetti(G().player.x + U.rand(-20, 20), G().player.y - 10, 4);
    card(ctx, ts, w.title, C.pink, [...U.wrap(w.text, wrapN), '', ...statLines()], 'PRESS ENTER / TAP');
    if (G().stateT > 2 && (confirm() || I.tap())) G().toTitle();
  };
  UI.loading = function (ctx, ts, p, msg) {
    const w = ctx.canvas.width, h = ctx.canvas.height; ctx.fillStyle = '#120c24'; ctx.fillRect(0, 0, w, h);
    logo(ctx, w / 2, h * 0.2, Math.max(2, Math.floor(Math.min(w / 100, h / 60))), performance.now() / 1000);
    const bw = Math.min(w - 40, 200 * ts); panel(ctx, w / 2 - bw / 2, h * 0.68, bw, 10 * ts); ctx.fillStyle = C.pink; ctx.fillRect(w / 2 - bw / 2 + 2, h * 0.68 + 2, (bw - 4) * p, 10 * ts - 4);
    T(ctx, (msg || '').toUpperCase(), w / 2, h * 0.68 + 16 * ts, { align: 'center', color: C.dim, scale: ts });
  };
})(window.VH);
