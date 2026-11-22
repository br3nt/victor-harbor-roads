/* audio.js - fully synthesized sound for the Victor Harbor Schoolies game.
 * No external files. Classic script: exposes window.SFX.
 * Every method is a safe no-op before init() or when Web Audio is missing.
 */
(function () {
  'use strict';

  var ctx = null, master = null, comp = null;
  var sfxBus = null, musicBus = null, ambBus = null, engBus = null;
  var noiseBuf = null;
  var muted = false, volume = 0.8;
  var voices = 0;                       // active counted one-shot voices
  var hist = {};                        // per-name throttle history
  var want = { music: null, amb: null, siren: false };

  // current one-shot render state (set by play(), read by T()/N())
  var OUT = null, VM = 1, PM = 1, TO = 0;

  function clamp(x, a, b) {
    x = +x;
    if (!(x === x)) return a;
    return x < a ? a : (x > b ? b : x);
  }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function ready() { return !!(ctx && noiseBuf); }

  /* ------------------------------------------------------------------ */
  /* Primitive voices                                                    */
  /* ------------------------------------------------------------------ */

  // Amplitude envelope: attack, optional sustain, exponential release.
  function env(g, t, dur, v, a, sus, rel) {
    v = Math.max(0.0002, v);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(v, t + a);
    if (sus) g.gain.setValueAtTime(v, t + Math.max(a, dur - (rel || 0.08)));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  function track(src, o) {
    if (o.nc) return;
    voices++;
    src.onended = function () { voices = Math.max(0, voices - 1); };
  }

  // o: {type,f,f2,at|t,dur,vol,a,sus,rel,lp,lp2,vib:[rate,depth],nc}
  function tone(dest, o) {
    var c = ctx;
    var t = o.at != null ? o.at : c.currentTime + (o.t || 0);
    var dur = o.dur, a = o.a != null ? o.a : 0.005;
    var os = c.createOscillator();
    os.type = o.type || 'square';
    os.frequency.setValueAtTime(Math.max(1, o.f), t);
    if (o.f2) os.frequency.exponentialRampToValueAtTime(Math.max(1, o.f2), t + dur);
    var g = c.createGain();
    env(g, t, dur, o.vol, a, o.sus, o.rel);
    if (o.lp) {
      var lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(o.lp, t);
      if (o.lp2) lp.frequency.exponentialRampToValueAtTime(Math.max(20, o.lp2), t + dur);
      os.connect(lp); lp.connect(g);
    } else {
      os.connect(g);
    }
    if (o.vib) {
      var lf = c.createOscillator(), lg = c.createGain();
      lf.frequency.value = o.vib[0];
      lg.gain.value = o.vib[1];
      lf.connect(lg); lg.connect(os.frequency);
      lf.start(t); lf.stop(t + dur + 0.05);
    }
    g.connect(dest);
    os.start(t);
    os.stop(t + dur + 0.05);
    track(os, o);
  }

  // o: {type(filter),f,f2,q,at|t,dur,vol,a,sus,rel,nc}
  function noise(dest, o) {
    var c = ctx;
    var t = o.at != null ? o.at : c.currentTime + (o.t || 0);
    var dur = o.dur;
    var src = c.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    var fl = c.createBiquadFilter();
    fl.type = o.type || 'lowpass';
    fl.frequency.setValueAtTime(o.f || 1000, t);
    if (o.f2) fl.frequency.exponentialRampToValueAtTime(Math.max(20, o.f2), t + dur);
    fl.Q.value = o.q || 0.7;
    var g = c.createGain();
    env(g, t, dur, o.vol, o.a != null ? o.a : 0.004, o.sus, o.rel);
    src.connect(fl); fl.connect(g); g.connect(dest);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
    track(src, o);
  }

  function noiseLoop() {
    var s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    s.loop = true;
    s.start(0, Math.random() * 1.5);
    return s;
  }

  // One-shot helpers: apply pitch (PM), volume (VM) and time offset (TO).
  function T(type, f, f2, t, dur, vol, x) {
    var o = x || {};
    o.type = type; o.f = f * PM; o.f2 = f2 ? f2 * PM : 0;
    o.t = TO + t; o.dur = dur; o.vol = vol * VM;
    tone(OUT, o);
  }
  function N(ftype, f, f2, t, dur, vol, x) {
    var o = x || {};
    o.type = ftype; o.f = f * PM; o.f2 = f2 ? f2 * PM : 0;
    o.t = TO + t; o.dur = dur; o.vol = vol * VM;
    noise(OUT, o);
  }

  /* ------------------------------------------------------------------ */
  /* One-shot sound table                                                */
  /* ------------------------------------------------------------------ */

  var S = {};

  S.crash = function () {
    N('lowpass', 3500, 150, 0, 0.6, 0.9);
    N('bandpass', 1400, 500, 0, 0.25, 0.5, { q: 2 });
    T('sawtooth', 130, 35, 0, 0.35, 0.5, { lp: 900 });
    for (var i = 0; i < 5; i++) {
      N('highpass', 3000, 0, 0.06 + i * 0.07 + rnd(0, 0.03), 0.05, 0.25);
      T('square', rnd(700, 1600), 0, 0.05 + i * 0.08, 0.05, 0.06);
    }
  };
  S.thud = function () {
    T('sine', 150, 45, 0, 0.2, 0.7);
    N('lowpass', 500, 100, 0, 0.1, 0.45);
  };
  S.clang = function () {
    var f0 = 520 * rnd(0.9, 1.12), r = [1, 1.52, 2.76, 4.07];
    for (var i = 0; i < r.length; i++) {
      T(i % 2 ? 'square' : 'sine', f0 * r[i], 0, 0, 0.55 - i * 0.12, 0.2 / (i + 1) + 0.03, { lp: 6000 });
    }
    N('highpass', 4000, 0, 0, 0.03, 0.3);
  };
  S.smash = function () {
    N('highpass', 5000, 0, 0, 0.12, 0.5);
    for (var i = 0; i < 9; i++) {
      T('sine', rnd(2500, 7500), 0, rnd(0, 0.35), rnd(0.08, 0.18), 0.12, { a: 0.002 });
    }
  };
  S.crunch = function () {
    for (var i = 0; i < 3; i++) N('bandpass', rnd(800, 1400), 300, i * 0.045, 0.07, 0.5, { q: 1.5 });
    T('square', 220, 90, 0, 0.12, 0.2, { lp: 900 });
    N('highpass', 2500, 0, 0.02, 0.05, 0.2);
  };
  S.pole = function () {
    T('sawtooth', 160, 95, 0, 0.7, 0.2, { lp: 700, vib: [18, 18], a: 0.05 });
    T('sawtooth', 240, 130, 0.15, 0.5, 0.12, { lp: 900, vib: [23, 25], a: 0.05 });
    T('sine', 120, 40, 0.68, 0.28, 0.55);
    var pm = PM, to = TO;
    TO = to + 0.7; S.clang();
    PM = pm * 0.8; TO = to + 0.86; S.clang();
    PM = pm; TO = to;
  };
  S.horn = function () {
    T('square', 392, 0, 0, 0.4, 0.2, { lp: 2200, sus: 1, rel: 0.05, a: 0.01 });
    T('square', 494, 0, 0, 0.4, 0.18, { lp: 2200, sus: 1, rel: 0.05, a: 0.01 });
  };
  S.horn_gopher = function () {
    for (var i = 0; i < 2; i++) {
      T('square', 880, 0, i * 0.17, 0.09, 0.14, { lp: 2500, sus: 1, rel: 0.02 });
      T('square', 1108, 0, i * 0.17, 0.09, 0.07, { lp: 2500, sus: 1, rel: 0.02 });
    }
  };
  S.bell_tram = function () {
    T('sine', 1568, 0, 0, 0.9, 0.24, { a: 0.003 });
    T('sine', 3170, 0, 0, 0.5, 0.08, { a: 0.003 });
    T('sine', 1568, 0, 0.24, 0.8, 0.2, { a: 0.003 });
    T('sine', 3170, 0, 0.24, 0.4, 0.06, { a: 0.003 });
  };
  S.whistle_train = function () {
    T('triangle', 440, 425, 0, 1.15, 0.3, { a: 0.07, sus: 1, rel: 0.4, vib: [6, 5] });
    T('triangle', 554, 535, 0, 1.15, 0.26, { a: 0.07, sus: 1, rel: 0.4, vib: [6.5, 5] });
    T('square', 880, 850, 0, 1.15, 0.05, { a: 0.07, sus: 1, rel: 0.4, lp: 2000 });
    N('bandpass', 3000, 0, 0, 1.1, 0.06, { q: 1, a: 0.08, sus: 1, rel: 0.4 });
  };
  S.doorbell = function () {
    T('sine', 659, 0, 0, 0.55, 0.3, { a: 0.003 });
    T('sine', 1318, 0, 0, 0.3, 0.08, { a: 0.003 });
    T('sine', 523, 0, 0.34, 0.9, 0.3, { a: 0.003 });
    T('sine', 1046, 0, 0.34, 0.4, 0.08, { a: 0.003 });
  };
  S.gull = function () {
    var ts = [0, 0.38, 0.72];
    for (var i = 0; i < ts.length; i++) {
      var f0 = rnd(1300, 1700), f1 = f0 * rnd(1.35, 1.6);
      T('sawtooth', f0, f1, ts[i], 0.1, 0.17, { lp: 3500, a: 0.01 });
      T('sawtooth', f1, f1 * 0.5, ts[i] + 0.1, 0.24, 0.17, { lp: 3000, vib: [28, 60], a: 0.01 });
    }
  };
  S.splash = function () {
    N('lowpass', 2500, 200, 0, 0.9, 0.8, { a: 0.03 });
    N('bandpass', 3500, 1200, 0, 0.4, 0.3, { q: 0.7 });
    for (var i = 0; i < 6; i++) {
      T('sine', rnd(400, 700), rnd(900, 1400), 0.12 + i * 0.09 + rnd(0, 0.05), 0.07, 0.12);
    }
  };
  S.cash = function () {
    T('square', 988, 0, 0, 0.07, 0.17);
    T('square', 1319, 0, 0.07, 0.45, 0.18, { lp: 5000 });
    T('sine', 2637, 0, 0.07, 0.5, 0.1);
  };
  S.pickup = function () {
    var n = [523, 659, 784];
    for (var i = 0; i < n.length; i++) T('square', n[i], 0, i * 0.06, 0.1, 0.16, { lp: 4500 });
  };
  S.fail = function () {
    var n = [311, 294, 277], i;
    for (i = 0; i < n.length; i++) T('sawtooth', n[i], n[i] * 0.97, i * 0.32, 0.3, 0.22, { lp: 800, lp2: 300 });
    T('sawtooth', 262, 240, 0.96, 0.85, 0.24, { lp: 900, lp2: 250, vib: [6, 9], a: 0.02 });
  };
  S.win = function () {
    var n = [523, 659, 784, 659, 784, 1047];
    for (var i = 0; i < n.length; i++) {
      var last = i === n.length - 1;
      T('square', n[i], 0, i * 0.1, last ? 0.6 : 0.09, 0.17, { lp: 5000 });
      T('triangle', n[i] / 2, 0, i * 0.1, last ? 0.6 : 0.09, 0.2);
    }
  };
  S.dive = function () {
    T('triangle', 250, 1000, 0, 0.14, 0.3);
    T('triangle', 1000, 220, 0.14, 0.28, 0.3, { vib: [14, 40] });
    N('bandpass', 500, 2500, 0, 0.35, 0.15, { q: 1 });
  };
  S.whoosh = function () {
    N('bandpass', 300, 2400, 0, 0.2, 0.4, { q: 1.5, a: 0.1 });
    N('bandpass', 2400, 400, 0.18, 0.2, 0.4, { q: 1.5, a: 0.02 });
  };
  S.click = function () { T('square', 1400, 900, 0, 0.03, 0.14); };
  S.menu = function () {
    T('square', 660, 0, 0, 0.07, 0.16);
    T('square', 990, 0, 0.07, 0.13, 0.16);
  };
  S.ghost = function () {
    T('sine', 380, 780, 0, 0.7, 0.28, { a: 0.15, sus: 1, rel: 0.25, vib: [6, 25] });
    T('sine', 780, 250, 0.6, 0.8, 0.28, { a: 0.1, sus: 1, rel: 0.3, vib: [7, 35] });
    T('triangle', 760, 1560, 0, 0.7, 0.07, { a: 0.15, vib: [6.5, 30] });
  };
  S.whale = function () {
    T('sine', 70, 120, 0, 1.1, 0.42, { a: 0.3, sus: 1, rel: 0.45, vib: [0.8, 6] });
    T('sine', 120, 58, 0.95, 1.5, 0.42, { a: 0.06, sus: 1, rel: 0.7, vib: [0.7, 6] });
    T('triangle', 140, 240, 0, 1.0, 0.1, { a: 0.3, lp: 500, vib: [0.9, 8] });
    N('lowpass', 200, 0, 0, 2.2, 0.05, { a: 0.5 });
  };
  S.spray = function () {
    N('highpass', 2500, 6000, 0, 0.6, 0.3, { a: 0.1 });
    N('bandpass', 6000, 3000, 0, 0.5, 0.15, { q: 1 });
  };
  S.door = function () {
    T('square', 200, 70, 0, 0.08, 0.3, { lp: 800 });
    N('lowpass', 900, 300, 0, 0.07, 0.4);
    N('highpass', 3000, 0, 0.07, 0.03, 0.2);
  };
  S.radio = function () {
    N('bandpass', 1800, 1000, 0, 0.12, 0.35, { q: 3 });
    T('sine', 1200, 0, 0.15, 0.07, 0.12);
    N('bandpass', 2400, 1500, 0.24, 0.08, 0.2, { q: 3 });
  };
  S.sms = function () {
    var n = [1568, 1568, 1319, 1760], t = [0, 0.11, 0.24, 0.35];
    for (var i = 0; i < n.length; i++) T('square', n[i], 0, t[i], 0.08, 0.14, { lp: 5000 });
  };
  S.puff = function () {
    T('sawtooth', 110, 45, 0, 0.55, 0.3, { lp: 500, lp2: 100 });
    var p = [0.35, 0.5, 0.62, 0.82], i;
    for (i = 0; i < p.length; i++) {
      N('lowpass', 1200, 200, p[i], 0.06, 0.5);
      T('sine', 200, 60, p[i], 0.08, i === 3 ? 0.55 : 0.35);
    }
  };
  S.boost = function () {
    N('bandpass', 300, 3500, 0, 0.6, 0.4, { q: 2, a: 0.05 });
    T('sawtooth', 120, 700, 0, 0.5, 0.18, { lp: 2000 });
    T('square', 400, 1200, 0.1, 0.3, 0.08);
  };

  // phone buzzing with a new job
  S.ring = function () {
    for (var i = 0; i < 2; i++) {
      T('square', 1320, 0, i * 0.5, 0.18, 0.13, { lp: 4000, vib: [24, 60], sus: 1, rel: 0.03 });
      T('square', 1660, 0, i * 0.5 + 0.2, 0.18, 0.11, { lp: 4000, vib: [24, 60], sus: 1, rel: 0.03 });
      N('bandpass', 180, 0, i * 0.5, 0.38, 0.12, { q: 4 });
    }
  };
  // taser: an electric crackle
  S.zap = function () {
    for (var i = 0; i < 7; i++) T('sawtooth', rnd(1800, 3200), rnd(400, 900), i * 0.05, 0.05, 0.12, { lp: 6000 });
    N('highpass', 4000, 0, 0, 0.35, 0.25);
  };
  // stylised arcade shot: a short "tak" with a tail
  S.shot = function () {
    N('bandpass', 1800, 300, 0, 0.09, 0.45, { q: 1.2 });
    T('square', 420, 90, 0, 0.08, 0.16, { lp: 1800 });
  };
  // ricochet ping off panel work
  S.ping = function () {
    T('sine', rnd(2600, 3400), rnd(1200, 1700), 0, 0.22, 0.18, { a: 0.002 });
    N('highpass', 5000, 0, 0, 0.03, 0.2);
  };
  // tyre blow-out: a pop and a hiss
  S.tyre = function () {
    N('lowpass', 2500, 200, 0, 0.12, 0.9);
    T('sine', 140, 40, 0, 0.15, 0.5);
    N('highpass', 3000, 6000, 0.1, 0.8, 0.22, { a: 0.02 });
  };
  // helicopter rotor: a few chops
  S.rotor = function () {
    for (var i = 0; i < 6; i++) N('lowpass', 420, 120, i * 0.085, 0.07, 0.4);
  };
  S.megaphone = function () {
    T('sawtooth', 660, 0, 0, 0.4, 0.14, { lp: 2200, vib: [30, 20], sus: 1, rel: 0.05 });
    N('bandpass', 1500, 0, 0, 0.4, 0.12, { q: 2 });
  };
  // the lock-up gate grinding open
  S.gate = function () {
    T('sawtooth', 70, 60, 0, 1.0, 0.25, { lp: 400, vib: [12, 6], a: 0.05, sus: 1, rel: 0.2 });
    for (var i = 0; i < 6; i++) N('bandpass', 900, 500, i * 0.16, 0.05, 0.25, { q: 3 });
    var to = TO; TO = to + 1; S.clang(); TO = to;
  };
  S.kick = function () {
    T('sine', 220, 70, 0, 0.12, 0.5);
    N('lowpass', 1500, 300, 0, 0.06, 0.4);
  };
  S.spikes = function () {
    for (var i = 0; i < 8; i++) T('square', rnd(1500, 2600), 0, i * 0.03, 0.03, 0.06);
    N('highpass', 3000, 0, 0, 0.25, 0.18);
  };
  S.hop = function () { T('triangle', 300, 700, 0, 0.12, 0.2); };
  S.collect = function () {
    var n = [784, 988, 1175, 1568];
    for (var i = 0; i < n.length; i++) T('square', n[i], 0, i * 0.05, 0.08, 0.14, { lp: 5000 });
  };

  var LIMIT = { clang: 12, click: 15, thud: 14, shot: 12, ping: 10 };

  function play(name, opts) {
    try {
      if (!ready() || muted || !S[name]) return;
      opts = opts || {};
      var now = ctx.currentTime;
      var h = hist[name] || (hist[name] = []);
      while (h.length && h[0] < now - 1) h.shift();
      if (h.length >= (LIMIT[name] || 20)) return;
      if (voices > 24) return;
      h.push(now);
      VM = opts.vol == null ? 1 : clamp(opts.vol, 0, 2);
      PM = opts.pitch > 0 ? +opts.pitch : 1;
      TO = 0;
      if (opts.pan && ctx.createStereoPanner) {
        var pn = ctx.createStereoPanner();
        pn.pan.value = clamp(opts.pan, -1, 1);
        pn.connect(sfxBus);
        OUT = pn;
      } else {
        OUT = sfxBus;
      }
      S[name]();
    } catch (e) { /* never throw */ }
  }

  /* ------------------------------------------------------------------ */
  /* Engine                                                              */
  /* ------------------------------------------------------------------ */

  var eng = { kind: null, k: {} };
  var KCFG = {
    car:    { b: 52, m: 3.2, t1: 'sawtooth', t2: 'square',   r2: 0.5,  lp: 380, lps: 1500, vol: 0.15 },
    ute:    { b: 44, m: 3.0, t1: 'sawtooth', t2: 'square',   r2: 0.5,  lp: 340, lps: 1300, vol: 0.16 },
    police: { b: 58, m: 3.4, t1: 'sawtooth', t2: 'square',   r2: 0.5,  lp: 420, lps: 1700, vol: 0.15 },
    truck:  { b: 34, m: 2.4, t1: 'sawtooth', t2: 'sawtooth', r2: 1.01, lp: 260, lps: 800,  vol: 0.2, wob: 9 },
    gopher: { b: 300, m: 2.4, t1: 'triangle', t2: 'sine',    r2: 2.0,  lp: 2500, lps: 3000, vol: 0.08 }
  };

  function buildTonal(cfg, outG) {
    var c = ctx;
    var o1 = c.createOscillator(), o2 = c.createOscillator(), o3 = c.createOscillator();
    o1.type = cfg.t1; o2.type = cfg.t2; o3.type = 'square';
    var grit = c.createGain(); grit.gain.value = 0;
    var lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 1.5; lp.frequency.value = cfg.lp;
    var vg = c.createGain(); vg.gain.value = cfg.vol;
    o1.connect(lp); o2.connect(lp); o3.connect(grit); grit.connect(lp);
    lp.connect(vg); vg.connect(outG);
    o1.start(); o2.start(); o3.start();
    if (cfg.wob) {
      var lf = c.createOscillator(), lg = c.createGain();
      lf.frequency.value = cfg.wob; lg.gain.value = cfg.vol * 0.3;
      lf.connect(lg); lg.connect(vg.gain); lf.start();
    }
    return function (sp, th, t) {
      var f = cfg.b * (1 + sp * cfg.m) * (1 + th * 0.04);
      o1.frequency.setTargetAtTime(f, t, 0.06);
      o2.frequency.setTargetAtTime(f * cfg.r2, t, 0.06);
      o3.frequency.setTargetAtTime(f * 2.01, t, 0.06);
      grit.gain.setTargetAtTime(th * 0.45, t, 0.06);
      lp.frequency.setTargetAtTime(cfg.lp + cfg.lps * (sp * 0.6 + th * 0.4), t, 0.08);
      vg.gain.setTargetAtTime(cfg.vol * (0.7 + 0.3 * th), t, 0.08);
    };
  }

  function lerp(a, b, x) { return a + (b - a) * x; }

  function buildTrain(g) {
    var st = { next: 0, alt: 0 };
    return function (sp, th, t) {
      var iv = sp > 0.02 ? lerp(0.62, 0.11, Math.sqrt(sp)) : 0.95;
      var vol = sp > 0.02 ? 0.5 : 0.25;
      if (st.next < t) st.next = t + 0.02;
      while (st.next < t + 0.1) {
        var acc = (st.alt++ % 2) ? 0.7 : 1;
        var at = st.next;
        noise(g, { type: 'lowpass', f: 1500, f2: 350, at: at, dur: 0.1, vol: vol * acc, a: 0.006, nc: true });
        tone(g, { type: 'sine', f: 85, f2: 45, at: at, dur: 0.1, vol: vol * 0.6 * acc, nc: true });
        st.next += iv;
      }
    };
  }

  function buildTram(g) {
    var st = { next: 0, alt: 0 };
    return function (sp, th, t) {
      if (sp < 0.02) { st.next = 0; return; }
      var iv = lerp(0.5, 0.17, sp);
      if (st.next < t) st.next = t + 0.02;
      while (st.next < t + 0.1) {
        var hi = (st.alt++ % 2) === 0, at = st.next;
        noise(g, { type: 'bandpass', f: hi ? 1900 : 1500, q: 5, at: at, dur: 0.035, vol: 0.5, a: 0.001, nc: true });
        tone(g, { type: 'sine', f: hi ? 720 : 520, f2: hi ? 520 : 380, at: at, dur: 0.05, vol: 0.28, a: 0.001, nc: true });
        st.next += iv * (hi ? 0.45 : 0.55);
      }
    };
  }

  function getKind(k) {
    if (eng.k[k]) return eng.k[k];
    var g = ctx.createGain();
    g.gain.value = 0;
    g.connect(engBus);
    var v = { g: g };
    if (KCFG[k]) v.update = buildTonal(KCFG[k], g);
    else if (k === 'train') v.update = buildTrain(g);
    else if (k === 'tram') v.update = buildTram(g);
    else v.update = function () {};
    eng.k[k] = v;
    return v;
  }

  function engine(s) {
    try {
      if (!ready()) return;
      s = s || {};
      var k = s.kind || 'car', t = ctx.currentTime;
      var sp = clamp(s.speed, 0, 1), th = clamp(s.throttle, 0, 1);
      for (var n in eng.k) {
        if (n !== k) eng.k[n].g.gain.setTargetAtTime(0, t, 0.08);
      }
      eng.kind = k;
      if (k === 'foot') return;
      var v = getKind(k);
      v.g.gain.setTargetAtTime(1, t, 0.08);
      v.update(sp, th, t);
    } catch (e) { /* ignore */ }
  }

  function engineStop() {
    try {
      if (!ready()) return;
      var t = ctx.currentTime;
      for (var n in eng.k) eng.k[n].g.gain.setTargetAtTime(0, t, 0.08);
      eng.kind = null;
    } catch (e) { /* ignore */ }
  }

  /* ------------------------------------------------------------------ */
  /* Skid and siren                                                      */
  /* ------------------------------------------------------------------ */

  var sk = null;
  function skid(level) {
    try {
      if (!ready()) return;
      var l = clamp(level, 0, 1), t = ctx.currentTime;
      if (!sk) {
        if (l < 0.02) return;
        var g = ctx.createGain(); g.gain.value = 0; g.connect(engBus);
        var bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 4; bp.frequency.value = 2400;
        var ns = noiseLoop(); ns.connect(bp); bp.connect(g);
        var o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 1250;
        var og = ctx.createGain(); og.gain.value = 0.07;
        var tb = ctx.createBiquadFilter(); tb.type = 'bandpass'; tb.Q.value = 6; tb.frequency.value = 1250;
        o.connect(tb); tb.connect(og); og.connect(g); o.start();
        sk = { g: g, bp: bp, o: o, tb: tb };
      }
      sk.g.gain.setTargetAtTime(l * l * 0.28, t, 0.04);
      sk.bp.frequency.setTargetAtTime(2200 + l * 900, t, 0.05);
      sk.o.frequency.setTargetAtTime(1150 + l * 250, t, 0.05);
      sk.tb.frequency.setTargetAtTime(1150 + l * 250, t, 0.05);
    } catch (e) { /* ignore */ }
  }

  var sir = null;
  function siren(on) {
    try {
      want.siren = !!on;
      if (!ready()) return;
      var t = ctx.currentTime;
      if (!sir) {
        if (!on) return;
        var g = ctx.createGain(); g.gain.value = 0; g.connect(sfxBus);
        var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200;
        var o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 710;
        var o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 710;
        var o2g = ctx.createGain(); o2g.gain.value = 0.25;
        // slow square LFO flips the pitch between two tones
        var lf = ctx.createOscillator(); lf.type = 'square'; lf.frequency.value = 1.5;
        var lg = ctx.createGain(); lg.gain.value = 85;
        lf.connect(lg); lg.connect(o.frequency); lg.connect(o2.frequency);
        o.connect(lp); o2.connect(o2g); o2g.connect(lp); lp.connect(g);
        o.start(); o2.start(); lf.start();
        sir = { g: g };
      }
      sir.g.gain.setTargetAtTime(on ? 0.16 : 0, t, 0.05);
    } catch (e) { /* ignore */ }
  }

  /* ------------------------------------------------------------------ */
  /* Music: small step sequencers                                        */
  /* ------------------------------------------------------------------ */

  var _ = null;
  var TRACKS = {
    title: {
      bpm: 132, root: 60, bassWave: 'square', leadWave: 'square', leadVol: 0.1, bassVol: 0.12,
      roots: [0, 5, 7, 0],
      bass: [0, _, 12, _, 7, _, 12, _, 0, _, 12, _, 7, _, 12, _],
      lead: [7, _, 12, _, 16, _, 12, _, 7, _, 12, 16, 19, _, _, _,
             9, _, 12, _, 17, _, 12, _, 9, _, 12, 17, 21, _, 19, 17,
             11, _, 14, _, 19, _, 14, _, 11, _, 14, 19, 17, _, 16, 14,
             12, _, 16, 12, 7, _, 12, _, 16, _, 19, _, 12, _, _, _],
      hat: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1],
      snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0]
    },
    night: {
      bpm: 96, root: 62, bassWave: 'triangle', leadWave: 'triangle', leadVol: 0.12, bassVol: 0.2,
      vib: [5, 7], leadLp: 2400,
      roots: [0, -4, -2, -7],
      bass: [0, _, _, _, _, _, 7, _, 0, _, _, _, 12, _, _, _],
      lead: [_, _, _, _, 12, _, _, 15, _, _, 14, _, _, _, _, _,
             _, _, 13, _, _, _, 10, _, _, _, 12, _, _, _, _, _,
             _, _, _, _, 15, _, 14, _, 12, _, _, _, 10, _, _, _,
             _, 11, _, _, 14, _, _, _, 12, _, _, _, _, _, _, _],
      hat: [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0],
      snare: null
    },
    chase: {
      bpm: 164, root: 57, bassWave: 'square', leadWave: 'square', leadVol: 0.1, bassVol: 0.12,
      roots: [0, 0, -4, -2],
      bass: [0, 0, 12, 0, 0, 12, 0, 12, 0, 0, 12, 0, 0, 12, 7, 12],
      lead: [12, _, 15, 12, _, 19, _, 15, 12, _, 15, 12, 17, _, 15, _,
             12, _, 15, 12, _, 19, _, 20, 19, _, 17, _, 15, _, 12, _,
             9, _, 12, 9, _, 17, _, 12, 9, _, 12, 9, 16, _, 12, _,
             11, _, 14, 11, _, 19, _, 14, 17, 16, 14, 11, 12, _, _, _],
      hat: [1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1],
      snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1]
    }
  };

  var cur = null;   // current song state

  function playStep(s, step, when) {
    var d = s.def, sd = s.dur, bar = Math.floor(step / 16) % d.roots.length, i = step % 16;
    var b = d.bass[i];
    if (b != null) {
      tone(s.gain, { type: d.bassWave, f: mtof(d.root - 12 + d.roots[bar] + b), at: when,
        dur: sd * 1.7, vol: d.bassVol, a: 0.004, lp: 900, nc: true });
    }
    var l = d.lead[step % d.lead.length];
    if (l != null) {
      tone(s.gain, { type: d.leadWave, f: mtof(d.root + 12 + l), at: when, dur: sd * 2.2,
        vol: d.leadVol, a: 0.006, lp: d.leadLp || 3500, vib: d.vib, nc: true });
    }
    var h = d.hat[i];
    if (h) noise(s.gain, { type: 'highpass', f: 7000, at: when, dur: 0.03, vol: 0.04, a: 0.001, nc: true });
    if (d.snare && d.snare[i]) {
      noise(s.gain, { type: 'bandpass', f: 1800, q: 0.8, at: when, dur: 0.1, vol: 0.09, a: 0.002, nc: true });
      tone(s.gain, { type: 'triangle', f: 220, f2: 110, at: when, dur: 0.08, vol: 0.1, nc: true });
    }
  }

  function tick(s) {
    try {
      if (!ctx) return;
      var now = ctx.currentTime;
      if (s.next < now - 0.2) s.next = now + 0.05;
      while (s.next < now + 0.15) {
        playStep(s, s.step, s.next);
        s.next += s.dur;
        s.step++;
      }
    } catch (e) { /* ignore */ }
  }

  function stopSong(s) {
    try {
      clearInterval(s.timer);
      s.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.25);
      setTimeout(function () { try { s.gain.disconnect(); } catch (e) {} }, 2500);
    } catch (e) { /* ignore */ }
  }

  function music(name) {
    try {
      want.music = name || null;
      if (!ready()) return;
      if (cur && cur.name === name) return;
      if (cur) { stopSong(cur); cur = null; }
      if (!name || !TRACKS[name]) return;
      var def = TRACKS[name], t = ctx.currentTime;
      var g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.setTargetAtTime(1, t, 0.3);
      g.connect(musicBus);
      var s = { name: name, def: def, gain: g, step: 0, next: t + 0.08, dur: 60 / def.bpm / 4 };
      s.timer = setInterval(function () { tick(s); }, 25);
      cur = s;
      tick(s);
    } catch (e) { /* ignore */ }
  }

  /* ------------------------------------------------------------------ */
  /* Ambience: surf, wind, distant party                                 */
  /* ------------------------------------------------------------------ */

  var amb = null;

  function buildAmb() {
    var c = ctx, a = {};
    // surf: noise swelling slowly
    var sg = c.createGain(); sg.gain.value = 0;
    var sw = c.createGain(); sw.gain.value = 0.55;
    var sl = c.createBiquadFilter(); sl.type = 'lowpass'; sl.Q.value = 0.7; sl.frequency.value = 650;
    var sn = noiseLoop(); sn.connect(sl); sl.connect(sw); sw.connect(sg); sg.connect(ambBus);
    var lf1 = c.createOscillator(); lf1.frequency.value = 0.11;
    var lg1 = c.createGain(); lg1.gain.value = 0.4;
    lf1.connect(lg1); lg1.connect(sw.gain); lf1.start();
    var lf2 = c.createOscillator(); lf2.frequency.value = 0.11;
    var lg2 = c.createGain(); lg2.gain.value = 280;
    lf2.connect(lg2); lg2.connect(sl.frequency); lf2.start();
    a.sea = sg;
    // wind: low howl
    var wg = c.createGain(); wg.gain.value = 0;
    var wb = c.createBiquadFilter(); wb.type = 'bandpass'; wb.Q.value = 3; wb.frequency.value = 340;
    var wn = noiseLoop(); wn.connect(wb); wb.connect(wg); wg.connect(ambBus);
    var lf3 = c.createOscillator(); lf3.frequency.value = 0.07;
    var lg3 = c.createGain(); lg3.gain.value = 140;
    lf3.connect(lg3); lg3.connect(wb.frequency); lf3.start();
    a.wind = wg;
    // party: muffled four-on-the-floor thump
    var pl = c.createBiquadFilter(); pl.type = 'lowpass'; pl.Q.value = 0.9; pl.frequency.value = 160;
    var pg = c.createGain(); pg.gain.value = 0;
    pl.connect(pg); pg.connect(ambBus);
    a.pl = pl; a.pg = pg; a.level = 0; a.next = 0;
    a.timer = setInterval(partyTick, 50);
    return a;
  }

  function partyTick() {
    try {
      if (!ctx || !amb) return;
      if (amb.level < 0.01) { amb.next = 0; return; }
      var now = ctx.currentTime, beat = 60 / 128;
      if (!amb.next || amb.next < now - 0.2) amb.next = now + 0.05;
      while (amb.next < now + 0.2) {
        var t = amb.next;
        tone(amb.pl, { type: 'sine', f: 150, f2: 40, at: t, dur: 0.22, vol: 1, a: 0.003, nc: true });
        noise(amb.pl, { type: 'highpass', f: 5000, at: t + beat / 2, dur: 0.05, vol: 0.18, a: 0.002, nc: true });
        amb.next += beat;
      }
    } catch (e) { /* ignore */ }
  }

  function ambience(o) {
    try {
      o = o || {};
      want.amb = o;
      if (!ready()) return;
      if (!amb) amb = buildAmb();
      var t = ctx.currentTime;
      var sea = clamp(o.sea, 0, 1), wind = clamp(o.wind, 0, 1), party = clamp(o.party, 0, 1);
      amb.sea.gain.setTargetAtTime(sea * 0.5, t, 0.4);
      amb.wind.gain.setTargetAtTime(wind * 0.4, t, 0.4);
      amb.level = party;
      amb.pg.gain.setTargetAtTime(party * 0.55, t, 0.3);
      amb.pl.frequency.setTargetAtTime(130 + party * 900, t, 0.3);
    } catch (e) { /* ignore */ }
  }

  /* ------------------------------------------------------------------ */
  /* Master, init and mute                                               */
  /* ------------------------------------------------------------------ */

  function applyMaster() {
    try {
      if (!master) return;
      master.gain.setTargetAtTime(muted ? 0 : volume * 0.75, ctx.currentTime, 0.03);
    } catch (e) { /* ignore */ }
  }

  function init() {
    try {
      if (!ctx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = muted ? 0 : volume * 0.75;
        comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -16; comp.knee.value = 14; comp.ratio.value = 6;
        comp.attack.value = 0.004; comp.release.value = 0.2;
        master.connect(comp); comp.connect(ctx.destination);
        sfxBus = ctx.createGain(); sfxBus.gain.value = 0.9; sfxBus.connect(master);
        musicBus = ctx.createGain(); musicBus.gain.value = 0.5; musicBus.connect(master);
        ambBus = ctx.createGain(); ambBus.gain.value = 0.7; ambBus.connect(master);
        engBus = ctx.createGain(); engBus.gain.value = 0.7; engBus.connect(master);
        var len = Math.floor(ctx.sampleRate * 2);
        noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
        var d = noiseBuf.getChannelData(0);
        for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      if (ctx.state === 'suspended') ctx.resume();
      // apply anything requested before the context existed
      if (want.music && !cur) music(want.music);
      if (want.amb && !amb) ambience(want.amb);
      if (want.siren && !sir) siren(true);
    } catch (e) { /* ignore */ }
  }

  function setMuted(m) { muted = !!m; applyMaster(); }
  function isMuted() { return muted; }
  function setVolume(v) { volume = clamp(v, 0, 1); applyMaster(); }

  try {
    document.addEventListener('visibilitychange', function () {
      try { if (ctx && !document.hidden && ctx.state !== 'running') ctx.resume(); } catch (e) {}
    });
  } catch (e) { /* ignore */ }

  function safe(fn) {
    return function () {
      try { return fn.apply(null, arguments); } catch (e) { return undefined; }
    };
  }

  window.SFX = {
    init: safe(init),
    setMuted: safe(setMuted),
    isMuted: function () { return muted; },
    setVolume: safe(setVolume),
    play: safe(play),
    engine: safe(engine),
    engineStop: safe(engineStop),
    skid: safe(skid),
    siren: safe(siren),
    music: safe(music),
    ambience: safe(ambience)
  };
})();
