// Keyboard, mouse and touch input. Touch: floating joystick on the left, buttons on the right.
'use strict';
(function (VH) {
  const U = VH.U;
  const I = VH.Input = { keys: {}, edge: {}, pointers: new Map(), buttons: [], held: {}, tapped: [], touchMode: false, stick: { x: 0, y: 0, mag: 0, active: false, ox: 0, oy: 0 }, scale: 1 };
  const MAP = {
    ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
    Space: 'action', KeyE: 'enter', Enter: 'confirm', NumpadEnter: 'confirm', KeyF: 'kick', Slash: 'help', KeyH: 'horn', KeyM: 'map', KeyP: 'pause', Escape: 'pause',
    KeyT: 'time', KeyN: 'mute', KeyJ: 'job', KeyO: 'job', KeyX: 'spikes', KeyB: 'backup', Equal: 'zoomIn', NumpadAdd: 'zoomIn', Minus: 'zoomOut', NumpadSubtract: 'zoomOut', Digit0: 'zoomReset', Numpad0: 'zoomReset', ShiftLeft: 'run', ShiftRight: 'run', Tab: 'map', Backspace: 'back', KeyQ: 'back', KeyC: 'camera',
  };
  I.init = function (canvas) {
    I.canvas = canvas;
    addEventListener('keydown', e => {
      const a = MAP[e.code]; if (!a) return; if (['up', 'down', 'left', 'right', 'action', 'map'].includes(a) || e.code === 'Space') e.preventDefault();
      if (!I.keys[a]) I.edge[a] = true; I.keys[a] = true; if (a === 'confirm') { I.edge.enter = I.edge.enter || false; }
      I.touchMode = false; window.SFX && SFX.init();
    });
    addEventListener('keyup', e => { const a = MAP[e.code]; if (a) I.keys[a] = false; });
    addEventListener('blur', () => { I.keys = {}; });
    // mouse wheel zooms (one step per notch, throttled so a trackpad flick isn't ten steps)
    let wheelT = 0;
    canvas.addEventListener('wheel', e => { e.preventDefault(); const now = performance.now(); if (now - wheelT < 120 || Math.abs(e.deltaY) < 2) return; wheelT = now; I.edge[e.deltaY < 0 ? 'zoomIn' : 'zoomOut'] = true; }, { passive: false });
    const toArt = e => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) * (canvas.width / r.width) / I.scale, (e.clientY - r.top) * (canvas.height / r.height) / I.scale]; };
    canvas.addEventListener('pointerdown', e => {
      // preventDefault stops the browser moving focus here, so take it back ourselves: inside the published
      // artifact's iframe the keyboard only works while this window has focus
      e.preventDefault(); window.focus(); window.SFX && SFX.init(); canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
      if (e.pointerType === 'touch') I.touchMode = true;
      const [x, y] = toArt(e); const p = { x, y, sx: x, sy: y, btn: null, stick: false, t: performance.now() };
      const b = I.buttons.find(b => x >= b.x && y >= b.y && x <= b.x + b.w && y <= b.y + b.h);
      // a second finger down (neither on a button) starts a pinch instead of moving
      const free = [...I.pointers.values()].filter(q => !q.btn);
      if (!b && I.touchMode && free.length === 1) { const o = free[0]; if (o.stick) { I.stick.active = false; I.stick.mag = 0; o.stick = false; } I.pinch = { a: o, d0: Math.hypot(x - o.x, y - o.y) || 1 }; }
      if (b) { p.btn = b.id; I.held[b.id] = true; I.edge[b.id] = true; }
      else if (I.pinch && !I.pinch.b) { I.pinch.b = p; }
      else if (I.touchMode && I.stickZone && x < I.stickZone) { p.stick = true; I.stick.active = true; I.stick.ox = x; I.stick.oy = y; I.stick.x = I.stick.y = I.stick.mag = 0; }
      I.pointers.set(e.pointerId, p);
      I.tapped.push({ x, y });
    });
    canvas.addEventListener('pointermove', e => {
      const p = I.pointers.get(e.pointerId); if (!p) return; const [x, y] = toArt(e); p.x = x; p.y = y;
      if (I.pinch && I.pinch.b && (p === I.pinch.a || p === I.pinch.b)) { const d = Math.hypot(I.pinch.a.x - I.pinch.b.x, I.pinch.a.y - I.pinch.b.y); if (d > I.pinch.d0 * 1.3) { I.edge.zoomIn = true; I.pinch.d0 = d; } else if (d < I.pinch.d0 / 1.3) { I.edge.zoomOut = true; I.pinch.d0 = d; } }
      if (p.stick) { const R = I.stickR || 30; let dx = x - I.stick.ox, dy = y - I.stick.oy; const d = Math.hypot(dx, dy); if (d > R) { I.stick.ox = x - dx / d * R; I.stick.oy = y - dy / d * R; dx = x - I.stick.ox; dy = y - I.stick.oy; } I.stick.x = dx / R; I.stick.y = dy / R; I.stick.mag = Math.min(1, Math.hypot(dx, dy) / R); }
    });
    const up = e => { const p = I.pointers.get(e.pointerId); if (!p) return; if (p.btn) I.held[p.btn] = false; if (p.stick) { I.stick.active = false; I.stick.mag = 0; I.stick.x = I.stick.y = 0; } if (I.pinch && (p === I.pinch.a || p === I.pinch.b)) I.pinch = null; I.pointers.delete(e.pointerId); };
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    if (matchMedia && matchMedia('(pointer: coarse)').matches) I.touchMode = true;
  };
  I.down = a => !!(I.keys[a] || I.held[a]);
  I.pressed = a => { const v = !!I.edge[a]; return v; };
  I.consume = a => { const v = !!I.edge[a]; I.edge[a] = false; return v; };
  I.endFrame = () => { I.edge = {}; I.tapped.length = 0; };
  I.setButtons = list => { I.buttons = list; };
  I.tap = () => I.tapped[0] || null;
  // movement intent for walking: screen-relative vector
  I.moveVec = function () {
    let x = (I.down('right') ? 1 : 0) - (I.down('left') ? 1 : 0), y = (I.down('down') ? 1 : 0) - (I.down('up') ? 1 : 0);
    if (I.stick.active && I.stick.mag > 0.15) { x = I.stick.x; y = I.stick.y; }
    const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; } return [x, y];
  };
  // driving intent given the vehicle heading
  I.drive = function (ang, speed) {
    if (I.stick.active && I.stick.mag > 0.15) {
      const want = Math.atan2(I.stick.y, I.stick.x); const da = U.angDiff(ang, want);
      if (Math.abs(da) > 2.2 && speed < 3) return { throttle: 0, brake: I.stick.mag, steer: U.clamp(-da * 1.5, -1, 1), hb: I.down('action') };
      return { throttle: I.stick.mag * (Math.abs(da) > 1.6 ? 0.4 : 1), brake: Math.abs(da) > 2.2 ? 0.6 : 0, steer: U.clamp(da * 1.8, -1, 1), hb: I.down('action') };
    }
    return { throttle: I.down('up') ? 1 : 0, brake: I.down('down') ? 1 : 0, steer: (I.down('right') ? 1 : 0) - (I.down('left') ? 1 : 0), hb: I.down('action') };
  };
})(window.VH);
