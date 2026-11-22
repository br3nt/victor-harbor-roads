// Procedural pixel-art sprites. Everything faces +x (east); 4 art pixels = 1 metre.
'use strict';
(function (VH) {
  const U = VH.U;
  const SP = VH.Sprites = { cache: new Map() };
  const S = 4;
  function get(key, fn) { let c = SP.cache.get(key); if (!c) { c = fn(); SP.cache.set(key, c); } return c; }
  SP.get = get;
  const shade = U.shade;

  // ---------- vehicles ----------
  // generic car body; L,Wd in metres
  function car(L, Wd, body, o = {}) {
    const w = Math.round(L * S) + 2, h = Math.round(Wd * S) + 2;
    const [c, x] = U.canvas(w, h);
    const r = (px, py, pw, ph, col) => { x.fillStyle = col; x.fillRect(px, py, pw, ph); };
    const bw = w - 2, bh = h - 2;
    // outline + body with rounded corners
    r(1, 2, bw, bh - 2, shade(body, 0.45)); r(2, 1, bw - 2, bh, shade(body, 0.45));
    r(2, 2, bw - 2, bh - 2, body);
    r(2, 2, bw - 2, 1, shade(body, 1.25)); // top highlight edge
    r(2, bh, bw - 2, 1, shade(body, 0.72)); // lower edge shadow
    const glass = '#2d3c52', glassHi = '#7d9cb8';
    if (o.ute) {
      const cabEnd = Math.round(bw * 0.55);
      r(Math.round(bw * 0.42) + 1, 3, 3, bh - 4, glass); r(Math.round(bw * 0.42) + 2, 3, 1, 2, glassHi); // windscreen
      r(Math.round(bw * 0.22) + 1, 3, Math.round(bw * 0.2), bh - 4, shade(body, 1.12)); // cab roof
      r(Math.round(bw * 0.2), 3, 1, bh - 4, glass);
      r(3, 3, Math.round(bw * 0.17) - 1, bh - 4, shade(body, 0.55)); // tray
      r(3, 3, Math.round(bw * 0.17) - 1, 1, shade(body, 0.85)); r(4, 5, 3, 2, '#7a5a3a'); // a hay bale-ish load
    } else if (o.gopher) {
      r(bw - 2, 2, 2, bh - 2, '#d8d4c8'); // basket
      r(3, 2, 3, bh - 2, '#3b3b44'); // seat
      r(5, 1, 2, 1, '#999'); r(5, bh + 1, 2, 1, '#999'); // tiller handles
    } else {
      const wsX = Math.round(bw * (o.hearse ? 0.66 : 0.6)) + 1, rwX = Math.round(bw * (o.hearse ? 0.1 : 0.16)) + 1;
      r(wsX, 3, 3, bh - 4, glass); r(wsX + 1, 3, 1, 2, glassHi);
      r(rwX, 3, o.hearse ? Math.round(bw * 0.5) : 2, bh - 4, o.hearse ? '#3a2040' : glass);
      if (o.hearse) { for (let i = rwX + 1; i < rwX + bw * 0.5; i += 3) r(i, 3, 1, bh - 4, '#6b3d6e'); }
      const roofX = rwX + (o.hearse ? Math.round(bw * 0.5) : 2), roofW = wsX - roofX;
      if (roofW > 0) r(roofX, 3, roofW, bh - 4, shade(body, o.police ? 1 : 1.1));
      if (o.police) {
        // blue and white chequer band along the sides, light bar on the roof
        for (let i = 2; i < bw; i += 2) { r(i, 2, 1, 1, (i / 2) % 2 ? '#1d3f8a' : '#fff'); r(i, bh, 1, 1, (i / 2) % 2 ? '#fff' : '#1d3f8a'); }
        const lx = roofX + Math.floor(roofW / 2) - 1; r(lx, 3, 2, Math.floor((bh - 4) / 2), '#d33'); r(lx, 3 + Math.floor((bh - 4) / 2), 2, Math.ceil((bh - 4) / 2), '#36f');
      }
      if (o.taxi) r(roofX + 1, Math.floor(h / 2) - 1, 2, 2, '#fd3');
      if (o.stripe) { r(2, Math.floor(h / 2), bw - 2, 1, o.stripe); }
    }
    // lights
    r(w - 2, 2, 1, 1, '#fff7c2'); r(w - 2, h - 3, 1, 1, '#fff7c2');
    r(1, 2, 1, 1, '#c22'); r(1, h - 3, 1, 1, '#c22');
    return c;
  }
  SP.CAR_COLOURS = ['#e9e6dc', '#8c1f2b', '#1f6f78', '#c99a2e', '#203a6b', '#a9adb3', '#2e5a37', '#c4372e', '#5d3f7a', '#d9762b', '#e3d3a8', '#4a8fc4'];
  SP.vehicle = (type, colour) => get('v:' + type + colour, () => {
    switch (type) {
      case 'hatch': return car(3.9, 1.75, colour);
      case 'sedan': return car(4.6, 1.85, colour);
      case 'ute': return car(5.0, 1.9, colour, { ute: true });
      case 'police': return car(4.8, 1.9, '#f2f2f0', { police: true });
      case 'hearse': return car(5.6, 1.95, '#1b1b22', { hearse: true });
      case 'gopher': return car(1.5, 0.8, colour, { gopher: true });
      case 'truck': return truckCab(colour);
      case 'trailer': return trailer(colour);
      case 'icecream': return car(5.2, 2.1, '#f4eadf', { stripe: '#e77aa8' });
      case 'paddy': return paddyWagon();
      case 'bmx': return bike(1.7, colour, 'bmx');
      case 'cruiser': return bike(1.9, colour, 'cruiser');
      case 'escooter': return bike(1.2, colour, 'scooter');
    }
    return car(4.2, 1.8, colour);
  });
  // the police van: white box body, chequer band, light bar, barred rear windows
  function paddyWagon() {
    const L = 5.4, Wd = 2.1; const [c, x] = U.canvas(L * S + 2, Wd * S + 2); const w = c.width, h = c.height;
    const r = (px, py, pw, ph, col) => { x.fillStyle = col; x.fillRect(px, py, pw, ph); };
    r(1, 2, w - 2, h - 4, '#6c6c74'); r(2, 1, w - 4, h - 2, '#6c6c74');
    r(2, 2, w - 4, h - 4, '#f2f2f0'); r(2, 2, w - 4, 1, '#ffffff');
    r(w - 9, 3, 3, h - 6, '#2d3c52'); r(w - 8, 3, 1, 2, '#7d9cb8'); // windscreen
    r(w - 6, 2, 4, h - 4, '#e4e4e2'); // bonnet
    r(3, 3, w - 13, h - 6, '#d9d9d6'); // box roof
    for (let i = 4; i < w - 10; i += 3) r(i, 4, 1, h - 8, '#c8c8c4'); // roof ribs
    for (let i = 2; i < w - 2; i += 2) { r(i, 1, 1, 1, (i / 2) % 2 ? '#1d3f8a' : '#fff'); r(i, h - 2, 1, 1, (i / 2) % 2 ? '#fff' : '#1d3f8a'); }
    r(2, 3, 1, h - 6, '#3a3a44'); r(2, 4, 1, 1, '#9aa'); r(2, h - 5, 1, 1, '#9aa'); // barred rear doors
    const lx = w - 11; r(lx, 3, 2, Math.floor((h - 6) / 2), '#d33'); r(lx, 3 + Math.floor((h - 6) / 2), 2, Math.ceil((h - 6) / 2), '#36f');
    r(w - 2, 2, 1, 1, '#fff7c2'); r(w - 2, h - 3, 1, 1, '#fff7c2'); r(1, 2, 1, 1, '#c22'); r(1, h - 3, 1, 1, '#c22');
    return c;
  }
  // bikes and the e-scooter: two wheels, a frame, handlebars at the front (east)
  function bike(L, colour, kind) {
    const w = Math.round(L * S) + 2, h = kind === 'cruiser' ? 5 : 4; const [c, x] = U.canvas(w, h);
    x.fillStyle = '#1b1b20'; x.fillRect(0, Math.floor(h / 2) - 1, 2, 2); x.fillRect(w - 2, Math.floor(h / 2) - 1, 2, 2); // tyres
    x.fillStyle = colour; x.fillRect(1, Math.floor(h / 2) - (kind === 'scooter' ? 1 : 0), w - 2, kind === 'scooter' ? 2 : 1); // frame or deck
    x.fillStyle = '#c9c9d0'; x.fillRect(w - 3, 0, 1, h); // handlebars
    if (kind === 'cruiser') { x.fillStyle = '#7a5434'; x.fillRect(2, 1, 3, 3); } // basket on the back
    if (kind === 'bmx') { x.fillStyle = '#2a2a30'; x.fillRect(Math.floor(w / 2) - 1, Math.floor(h / 2) - 1, 2, 2); }
    return c;
  }
  function truckCab(colour) {
    const [c, x] = U.canvas(6.5 * S + 2, 2.5 * S + 2); const w = c.width, h = c.height;
    x.fillStyle = '#26262c'; x.fillRect(1, 1, w - 2, h - 2);
    x.fillStyle = '#3c3c44'; x.fillRect(2, 3, w * 0.55, h - 6); // chassis + fifth wheel
    x.fillStyle = '#555'; x.fillRect(5, h / 2 - 2, 4, 4);
    x.fillStyle = colour; x.fillRect(w * 0.6, 1, w * 0.4 - 1, h - 2);
    x.fillStyle = shade(colour, 1.25); x.fillRect(w * 0.6, 1, w * 0.4 - 1, 1);
    x.fillStyle = '#2d3c52'; x.fillRect(w - 5, 2, 2, h - 4);
    x.fillStyle = '#ccc'; x.fillRect(w * 0.6 - 2, 1, 1, 2); x.fillRect(w * 0.6 - 2, h - 3, 1, 2); // exhaust stacks
    x.fillStyle = '#fff7c2'; x.fillRect(w - 2, 2, 1, 1); x.fillRect(w - 2, h - 3, 1, 1);
    return c;
  }
  function trailer(colour) {
    const L = 12, [c, x] = U.canvas(L * S + 2, 2.5 * S + 2); const w = c.width, h = c.height;
    x.fillStyle = '#2a2a2e'; x.fillRect(1, 1, w - 2, h - 2);
    x.fillStyle = colour; x.fillRect(2, 2, w - 4, h - 4);
    x.fillStyle = shade(colour, 0.85); for (let i = 4; i < w - 4; i += 4) x.fillRect(i, 2, 1, h - 4); // tarp ribs
    x.fillStyle = shade(colour, 1.2); x.fillRect(2, 2, w - 4, 1);
    x.fillStyle = '#c22'; x.fillRect(1, 2, 1, 1); x.fillRect(1, h - 3, 1, 1);
    return c;
  }
  // horse-drawn tram (double-deck, open top) and the Clydesdale
  SP.tram = () => get('tram', () => {
    const [c, x] = U.canvas(8.5 * S + 2, 2.5 * S + 2); const w = c.width, h = c.height;
    x.fillStyle = '#3b1f1a'; x.fillRect(1, 1, w - 2, h - 2);
    x.fillStyle = '#7a1f24'; x.fillRect(2, 2, w - 4, h - 4);
    x.fillStyle = '#e8dcb5'; x.fillRect(3, 3, w - 6, h - 6); // upper deck floor
    x.fillStyle = '#8a6a44'; for (let i = 5; i < w - 5; i += 3) x.fillRect(i, 4, 2, h - 8); // garden seats
    x.fillStyle = '#c9a23a'; x.fillRect(2, 2, w - 4, 1); x.fillRect(2, h - 3, w - 4, 1);
    x.fillStyle = '#5a3a2a'; x.fillRect(w - 3, 3, 2, h - 6); x.fillRect(1, 3, 2, h - 6);
    return c;
  });
  SP.horse = frame => get('horse' + frame, () => {
    const [c, x] = U.canvas(11, 7);
    x.fillStyle = '#3a2416'; x.fillRect(1, 1, 8, 5);
    x.fillStyle = '#7b4a2a'; x.fillRect(2, 2, 7, 3); // body
    x.fillStyle = '#7b4a2a'; x.fillRect(8, 2, 2, 3); x.fillStyle = '#efe6d6'; x.fillRect(10, 3, 1, 1); // head + blaze
    x.fillStyle = '#2a1a10'; x.fillRect(4, 3, 4, 1); // mane
    x.fillStyle = '#efe6d6'; // feathered hooves
    if (frame) { x.fillRect(7, 0, 1, 1); x.fillRect(2, 6, 1, 1); } else { x.fillRect(7, 6, 1, 1); x.fillRect(2, 0, 1, 1); }
    x.fillStyle = '#2a1a10'; x.fillRect(0, 3, 1, 1); // tail
    return c;
  });
  // steam train: loco, tender, carriages
  SP.loco = () => get('loco', () => {
    const [c, x] = U.canvas(10 * S + 2, 2.7 * S + 2); const w = c.width, h = c.height;
    x.fillStyle = '#111'; x.fillRect(1, 1, w - 2, h - 2);
    x.fillStyle = '#23262b'; x.fillRect(2, 3, w - 12, h - 6); // boiler
    x.fillStyle = '#3a3f47'; x.fillRect(2, 3, w - 12, 1);
    x.fillStyle = '#c3262b'; x.fillRect(w - 3, 1, 2, h - 2); // buffer beam
    x.fillStyle = '#2a2d33'; x.fillRect(w - 10, Math.floor(h / 2) - 2, 4, 4); x.fillStyle = '#111'; x.fillRect(w - 9, Math.floor(h / 2) - 1, 2, 2); // chimney
    x.fillStyle = '#b08d3a'; x.fillRect(w - 18, Math.floor(h / 2) - 1, 3, 3); // brass dome
    x.fillStyle = '#5a2a1f'; x.fillRect(2, 2, 9, h - 4); x.fillStyle = '#7a3a2a'; x.fillRect(3, 3, 7, h - 6); // cab roof
    x.fillStyle = '#fff4b0'; x.fillRect(w - 2, Math.floor(h / 2) - 1, 1, 2);
    return c;
  });
  SP.tender = () => get('tender', () => {
    const [c, x] = U.canvas(6 * S + 2, 2.7 * S + 2); const w = c.width, h = c.height;
    x.fillStyle = '#111'; x.fillRect(1, 1, w - 2, h - 2); x.fillStyle = '#2b2e34'; x.fillRect(2, 2, w - 4, h - 4);
    x.fillStyle = '#0c0c0e'; for (let i = 0; i < 30; i++) x.fillRect(4 + (i * 7) % (w - 8), 3 + (i * 3) % (h - 6), 2, 1); // coal
    return c;
  });
  SP.carriage = () => get('carriage', () => {
    const [c, x] = U.canvas(14 * S + 2, 2.8 * S + 2); const w = c.width, h = c.height;
    x.fillStyle = '#2a1712'; x.fillRect(1, 1, w - 2, h - 2);
    x.fillStyle = '#7d2a22'; x.fillRect(2, 2, w - 4, h - 4);
    x.fillStyle = '#b8b0a2'; x.fillRect(3, 4, w - 6, h - 8); // roof
    x.fillStyle = '#9d958a'; for (let i = 6; i < w - 6; i += 8) x.fillRect(i, 4, 1, h - 8);
    x.fillStyle = '#e8c86a'; x.fillRect(2, 2, w - 4, 1); x.fillRect(2, h - 3, w - 4, 1);
    return c;
  });

  // ---------- police extras ----------
  SP.boat = () => get('boat', () => {
    const [c, x] = U.canvas(8 * S + 2, 2.8 * S + 2); const w = c.width, h = c.height;
    x.fillStyle = '#20283a'; x.beginPath(); x.moveTo(1, 2); x.lineTo(w - 9, 1); x.lineTo(w - 1, h / 2); x.lineTo(w - 9, h - 1); x.lineTo(1, h - 2); x.closePath(); x.fill();
    x.fillStyle = '#f2f2f0'; x.beginPath(); x.moveTo(2, 3); x.lineTo(w - 9, 2); x.lineTo(w - 3, h / 2); x.lineTo(w - 9, h - 2); x.lineTo(2, h - 3); x.closePath(); x.fill();
    x.fillStyle = '#1d3f8a'; x.fillRect(2, 3, w - 12, 1); x.fillRect(2, h - 4, w - 12, 1);
    x.fillStyle = '#3d4a63'; x.fillRect(8, 5, 10, h - 10); x.fillStyle = '#7d9cb8'; x.fillRect(16, 5, 2, h - 10); // cabin
    x.fillStyle = '#d33'; x.fillRect(11, 5, 2, 2); x.fillStyle = '#36f'; x.fillRect(11, h - 7, 2, 2);
    x.fillStyle = '#555'; x.fillRect(0, h / 2 - 2, 2, 4); // outboard
    return c;
  });
  // the chopper, drawn from above; the rotor is drawn live on top
  // unbranded: 'police' is blue and white, 'rescue' is white and red
  SP.heli = (kind = 'police') => get('heli' + kind, () => {
    const [c, x] = U.canvas(48, 16); const r = (px, py, pw, ph, col) => { x.fillStyle = col; x.fillRect(px, py, pw, ph); };
    const [dark, body, band] = kind === 'rescue' ? ['#5a1a1a', '#f2f2f0', '#d6302a'] : ['#0f1830', '#1d3f8a', '#f2f2f0'];
    r(2, 7, 22, 2, kind === 'rescue' ? '#d6302a' : '#1d2a4a'); r(0, 5, 4, 6, kind === 'rescue' ? '#d6302a' : '#1d2a4a'); r(1, 6, 2, 4, '#f2f2f0'); // tail boom and fin
    r(20, 3, 20, 10, dark); r(21, 4, 18, 8, body); r(22, 4, 16, 2, band); r(22, 10, 16, 2, band);
    r(36, 5, 6, 6, '#2d3c52'); r(40, 6, 2, 4, '#7d9cb8'); // nose glass
    r(24, 2, 12, 1, '#555'); r(24, 13, 12, 1, '#555'); // skids
    return c;
  });
  SP.spikes = () => get('spikes', () => {
    const [c, x] = U.canvas(18, 4); x.fillStyle = '#1b1b20'; x.fillRect(0, 1, 18, 2);
    for (let i = 0; i < 18; i += 2) { x.fillStyle = (i / 2) % 2 ? '#ffd23a' : '#222'; x.fillRect(i, 1, 2, 2); x.fillStyle = '#e8e8f0'; x.fillRect(i, 0, 1, 1); x.fillRect(i + 1, 3, 1, 1); }
    return c;
  });
  // side-activity bits: stunt ramp, lost thong, the giant penguin
  SP.ramp = () => get('ramp', () => {
    const [c, x] = U.canvas(24, 18); x.fillStyle = '#5a3c22'; x.fillRect(0, 0, 24, 18);
    for (let i = 0; i < 24; i++) { x.fillStyle = U.shade('#c99a5a', 0.7 + i / 24 * 0.5); x.fillRect(i, 1, 1, 16); }
    x.fillStyle = '#ffd23a'; for (let i = 0; i < 18; i += 4) x.fillRect(22, i, 2, 2); x.fillStyle = '#222'; for (let i = 2; i < 18; i += 4) x.fillRect(22, i, 2, 2);
    return c;
  });
  SP.thong = () => get('thong', () => { const [c, x] = U.canvas(7, 5); x.fillStyle = '#ff4fa0'; x.fillRect(0, 0, 3, 5); x.fillRect(4, 0, 3, 5); x.fillStyle = '#fff'; x.fillRect(1, 1, 1, 2); x.fillRect(5, 1, 1, 2); return c; });
  SP.penguin = frame => get('peng' + frame, () => {
    const [c, x] = U.canvas(16, 14); x.fillStyle = '#10141c'; x.beginPath(); x.ellipse(8, 7, 7, 6, 0, 0, U.TAU); x.fill();
    x.fillStyle = '#f4f4f0'; x.beginPath(); x.ellipse(9, 7, 4, 4, 0, 0, U.TAU); x.fill();
    x.fillStyle = '#2a4a8a'; x.fillRect(13, 5, 2, 4); x.fillStyle = '#f2b23a'; x.fillRect(15, 6, 1, 2);
    x.fillStyle = '#10141c'; if (frame) { x.fillRect(4, 0, 3, 2); x.fillRect(4, 12, 3, 2); } else { x.fillRect(6, 0, 3, 2); x.fillRect(6, 12, 3, 2); }
    return c;
  });

  // ---------- people (top-down, chunky) ----------
  SP.PEOPLE = {
    schoolie: { shirts: ['#ff4fa0', '#38e0c8', '#ffd23a', '#7c5cff', '#ff7a2f', '#9be15d', '#ffffff'], hair: ['#2a1a10', '#d9b45a', '#7a3a1a', '#111', '#e0703a', '#f2e6a0'] },
    retiree: { shirts: ['#c9b48a', '#8d9fb0', '#b07a7a', '#7f8f6a', '#d8d0c0'], hair: ['#e8e8e8', '#cfcfcf', '#bdbdbd', '#f4f4f4'] },
    local: { shirts: ['#4a6fa5', '#a54a4a', '#3d7a5a', '#6a5a8a', '#d0a040', '#555'], hair: ['#2a1a10', '#5a3a1a', '#111', '#8a6a3a'] },
    cop: { shirts: ['#7fa6d8'], hair: ['#1a2236'] },
  };
  // 10x10 figure inside a 12x12 canvas with a dark 1-px outline, so people read clearly at any zoom.
  SP.person = (shirt, hair, frame, opts = {}) => get(`p:${shirt}${hair}${frame}${opts.hat || ''}${opts.glow || ''}${opts.sunnies ? 's' : ''}${opts.lying ? 'l' : ''}${opts.wade ? 'w' : ''}`, () => {
    const [c, x] = U.canvas(12, 12);
    x.translate(1, 1);
    // frames: 0 standing; 1-4 a walk cycle; 5-8 a run cycle (left foot forward, passing, right foot forward, passing).
    // Facing +x: legs show in front of and behind the body, hands swing at the shoulders, opposite to the legs.
    const run = frame >= 5, ph = frame ? (frame - 1) % 4 : -1, s = run ? 3 : 2; const cop = opts.hat === 'cop';
    const legC = cop ? '#2c3658' : '#4a4c6c', shoeC = '#22202b';
    const foot = (fwd, y, len) => { const x0 = fwd ? 8 : 2 - len; x.fillStyle = legC; x.fillRect(x0, y, len, 2); x.fillStyle = shoeC; x.fillRect(fwd ? x0 + len - 1 : x0, y, 1, 2); };
    if (!opts.wade) {
      if (ph === 0) { foot(true, 2, s); foot(false, 6, s); }
      else if (ph === 2) { foot(true, 6, s); foot(false, 2, s); }
      else if (ph === 1) foot(true, 6, 1); else if (ph === 3) foot(true, 2, 1);
      else { foot(true, 2, 1); foot(true, 6, 1); }
    }
    // shoulders and torso
    x.fillStyle = shade(shirt, 0.55); x.fillRect(3, 1, 4, 8); x.fillRect(2, 2, 6, 6);
    x.fillStyle = shirt; x.fillRect(4, 1, 2, 8); x.fillRect(3, 2, 4, 6);
    x.fillStyle = shade(shirt, 1.25); x.fillRect(3, 2, 1, 6);
    // the uniform: hi-vis shoulders, a duty belt with a buckle
    if (cop) { x.fillStyle = '#d8f03a'; x.fillRect(3, 1, 4, 1); x.fillRect(3, 8, 4, 1); x.fillStyle = '#15151c'; x.fillRect(2, 2, 1, 6); x.fillStyle = '#c9ccd8'; x.fillRect(2, 4, 1, 2); }
    // arms: sleeve and hand, swinging against the legs (left foot forward, left hand back)
    const arm = (y, at) => { x.fillStyle = shade(shirt, 0.8); x.fillRect(4, y, 1, 1); x.fillStyle = '#e0b48a'; x.fillRect(at, y ? y : y - 1, 2, 2); }; // a 2-pixel hand, swinging
    const fwdA = run ? 7 : 6, backA = run ? 1 : 2;
    if (ph === 0) { arm(0, backA); arm(9, fwdA); } else if (ph === 2) { arm(0, fwdA); arm(9, backA); }
    else if (ph === 1) { arm(0, 5); arm(9, 3); } else if (ph === 3) { arm(0, 3); arm(9, 5); }
    else { arm(0, 4); arm(9, 4); }
    // head
    x.fillStyle = shade(hair, 0.7); x.fillRect(4, 3, 4, 4); x.fillStyle = hair; x.fillRect(4, 3, 3, 3); x.fillStyle = '#e8bc90'; x.fillRect(7, 4, 1, 2);
    if (opts.hat === 'cop') { x.fillStyle = '#1a2236'; x.fillRect(3, 3, 5, 4); x.fillStyle = '#2d3a5a'; x.fillRect(4, 4, 2, 2); x.fillStyle = '#e8e2c0'; x.fillRect(7, 4, 1, 2); x.fillStyle = '#ffd23a'; x.fillRect(5, 4, 1, 1); }
    if (opts.hat === 'party') { x.fillStyle = '#ff3fa0'; x.fillRect(4, 4, 3, 2); x.fillStyle = '#fff'; x.fillRect(5, 4, 1, 1); }
    if (opts.hat === 'bucket') { x.fillStyle = '#d8cfa8'; x.fillRect(3, 3, 5, 4); x.fillStyle = '#bfb48a'; x.fillRect(4, 4, 3, 2); }
    if (opts.hat === 'cap') { x.fillStyle = '#c4372e'; x.fillRect(4, 3, 3, 4); x.fillRect(7, 4, 2, 2); x.fillStyle = '#e05a4a'; x.fillRect(4, 4, 2, 2); }
    if (opts.hat === 'beanie') { x.fillStyle = '#2e5a9a'; x.fillRect(4, 3, 4, 4); x.fillStyle = '#ffd23a'; x.fillRect(5, 4, 1, 1); }
    if (opts.hat === 'sunhat') { x.fillStyle = '#e8d8a0'; x.fillRect(2, 2, 7, 6); x.fillStyle = '#c9b06a'; x.fillRect(4, 4, 3, 2); x.fillStyle = '#ff4fa0'; x.fillRect(3, 3, 5, 1); }
    if (opts.sunnies) { x.fillStyle = '#111'; x.fillRect(7, 3, 1, 4); x.fillStyle = '#5fb0ff'; x.fillRect(7, 4, 1, 1); }
    x.setTransform(1, 0, 0, 1, 0, 0);
    // outline: every empty pixel touching the figure goes dark
    const img = x.getImageData(0, 0, 12, 12), d = img.data, out = new Uint8Array(144);
    for (let yy = 0; yy < 12; yy++) for (let xx = 0; xx < 12; xx++) {
      if (d[(yy * 12 + xx) * 4 + 3]) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ax = xx + dx, ay = yy + dy; if (ax >= 0 && ay >= 0 && ax < 12 && ay < 12 && d[(ay * 12 + ax) * 4 + 3] > 200) { out[yy * 12 + xx] = 1; break; } }
    }
    for (let i = 0; i < 144; i++) if (out[i]) { d[i * 4] = 18; d[i * 4 + 1] = 12; d[i * 4 + 2] = 36; d[i * 4 + 3] = 230; }
    x.putImageData(img, 0, 0);
    return c;
  });
  // dog for dog-walkers
  SP.dog = frame => get('dog' + frame, () => { const [c, x] = U.canvas(6, 4); x.fillStyle = '#8a5a2a'; x.fillRect(1, 1, 4, 2); x.fillRect(4, 0, 2, 2); x.fillStyle = '#3a2a1a'; x.fillRect(5, 0, 1, 1); x.fillRect(0, frame ? 0 : 2, 1, 1); return c; });

  // ---------- props: [upright, fallen] ----------
  const PK = { lamp: 0, signal: 1, bin: 2, letterbox: 3, fence: 4, chair: 5, table: 6, bench: 7, tree: 8, bush: 9, bollard: 10, sign: 11, binR: 12, binY: 13, binG: 14, hydrant: 15, phonebox: 16, speaker: 20, flamingo: 21, esky: 22, cone: 23, ball: 24, crate: 25 };
  SP.PK = PK;
  SP.prop = (k, fallen) => get(`prop:${k}:${fallen ? 1 : 0}`, () => {
    let c, x;
    const bin = lid => { if (!fallen) { [c, x] = U.canvas(5, 5); x.fillStyle = '#1f3d24'; x.fillRect(0, 0, 5, 5); x.fillStyle = lid; x.fillRect(1, 0, 4, 4); x.fillStyle = shade(lid, 1.25); x.fillRect(1, 0, 4, 1); x.fillStyle = '#111'; x.fillRect(0, 1, 1, 3); }
      else { [c, x] = U.canvas(8, 5); x.fillStyle = '#1f3d24'; x.fillRect(0, 0, 6, 5); x.fillStyle = '#2f5a35'; x.fillRect(1, 1, 4, 3); x.fillStyle = lid; x.fillRect(6, 0, 2, 5); x.fillStyle = '#111'; x.fillRect(5, 1, 1, 3); } };
    switch (k) {
      case PK.binR: bin('#c4372e'); break; case PK.binY: bin('#e6c63a'); break; case PK.binG: bin('#5aa043'); break;
      case PK.bin: if (!fallen) { [c, x] = U.canvas(4, 4); x.fillStyle = '#3d4a3a'; x.fillRect(0, 0, 4, 4); x.fillStyle = '#18201a'; x.fillRect(1, 1, 2, 2); } else { [c, x] = U.canvas(6, 4); x.fillStyle = '#3d4a3a'; x.fillRect(0, 0, 6, 4); x.fillStyle = '#18201a'; x.fillRect(5, 1, 1, 2); } break;
      case PK.letterbox:
        if (!fallen) { [c, x] = U.canvas(4, 4); x.fillStyle = '#5b3a22'; x.fillRect(1, 1, 2, 2); x.fillStyle = '#c4372e'; x.fillRect(0, 0, 4, 3); x.fillStyle = '#e0e0e0'; x.fillRect(3, 1, 1, 1); }
        else { [c, x] = U.canvas(9, 4); x.fillStyle = '#5b3a22'; x.fillRect(0, 1, 6, 2); x.fillStyle = '#c4372e'; x.fillRect(6, 0, 3, 4); } break;
      case PK.fence:
        if (!fallen) { [c, x] = U.canvas(9, 2); x.fillStyle = '#4e5a52'; x.fillRect(0, 0, 9, 2); x.fillStyle = '#6f7d73'; x.fillRect(0, 0, 9, 1); x.fillStyle = '#3a443d'; x.fillRect(0, 0, 1, 2); x.fillRect(8, 0, 1, 2); }
        else { [c, x] = U.canvas(9, 6); x.fillStyle = '#5d6b62'; x.fillRect(0, 0, 9, 6); x.fillStyle = '#4e5a52'; for (let i = 1; i < 9; i += 2) x.fillRect(i, 0, 1, 6); x.fillStyle = '#3a443d'; x.fillRect(0, 0, 9, 1); } break;
      case PK.lamp:
        if (!fallen) { [c, x] = U.canvas(9, 3); x.fillStyle = '#5c6066'; x.fillRect(0, 1, 7, 1); x.fillStyle = '#3c4046'; x.fillRect(0, 0, 2, 3); x.fillStyle = '#d9d6c8'; x.fillRect(6, 0, 3, 3); x.fillStyle = '#fff3c0'; x.fillRect(7, 1, 1, 1); }
        else { [c, x] = U.canvas(34, 4); x.fillStyle = '#4c5056'; x.fillRect(0, 1, 30, 2); x.fillStyle = '#6c7076'; x.fillRect(0, 1, 30, 1); x.fillStyle = '#9a9a92'; x.fillRect(29, 0, 4, 4); x.fillStyle = '#e8f4ff'; x.fillRect(33, 1, 1, 1); x.fillRect(31, 3, 1, 1); } break;
      case PK.signal:
        if (!fallen) { [c, x] = U.canvas(6, 4); x.fillStyle = '#3c4046'; x.fillRect(0, 1, 2, 2); x.fillStyle = '#1a1a1a'; x.fillRect(2, 0, 4, 4); x.fillStyle = '#e8c33a'; x.fillRect(3, 0, 1, 4); }
        else { [c, x] = U.canvas(20, 5); x.fillStyle = '#4c5056'; x.fillRect(0, 2, 16, 1); x.fillStyle = '#1a1a1a'; x.fillRect(15, 0, 5, 5); x.fillStyle = '#c22'; x.fillRect(16, 1, 1, 1); x.fillStyle = '#e8c33a'; x.fillRect(17, 2, 1, 1); x.fillStyle = '#2c2'; x.fillRect(18, 3, 1, 1); } break;
      case PK.chair:
        if (!fallen) { [c, x] = U.canvas(3, 3); x.fillStyle = '#f4f4ee'; x.fillRect(0, 0, 3, 3); x.fillStyle = '#c8c8c0'; x.fillRect(0, 0, 1, 3); }
        else { [c, x] = U.canvas(4, 3); x.fillStyle = '#d8d8d0'; x.fillRect(0, 0, 4, 3); x.fillStyle = '#a8a8a0'; x.fillRect(1, 1, 2, 1); } break;
      case PK.table:
        if (!fallen) { [c, x] = U.canvas(5, 5); x.fillStyle = '#f4f4ee'; x.fillRect(1, 0, 3, 5); x.fillRect(0, 1, 5, 3); x.fillStyle = '#d0d0c8'; x.fillRect(2, 2, 1, 1); }
        else { [c, x] = U.canvas(6, 5); x.fillStyle = '#d8d8d0'; x.fillRect(0, 0, 6, 5); x.fillStyle = '#999'; x.fillRect(2, 2, 2, 1); } break;
      case PK.bench:
        if (!fallen) { [c, x] = U.canvas(8, 3); x.fillStyle = '#7a5434'; x.fillRect(0, 0, 8, 3); x.fillStyle = '#9a6e46'; x.fillRect(0, 0, 8, 1); x.fillRect(0, 2, 8, 1); }
        else { [c, x] = U.canvas(8, 4); x.fillStyle = '#6a4a2e'; x.fillRect(0, 0, 8, 4); x.fillStyle = '#8a6040'; x.fillRect(0, 1, 8, 1); } break;
      case PK.bollard: [c, x] = U.canvas(2, 2); x.fillStyle = fallen ? '#9a9a90' : '#e8e4d0'; x.fillRect(0, 0, 2, 2); break;
      case PK.hydrant: [c, x] = U.canvas(2, 2); x.fillStyle = '#d23'; x.fillRect(0, 0, 2, 2); break;
      case PK.phonebox:
        if (!fallen) { [c, x] = U.canvas(5, 5); x.fillStyle = '#e8862a'; x.fillRect(0, 0, 5, 5); x.fillStyle = '#f2a54a'; x.fillRect(1, 1, 3, 3); }
        else { [c, x] = U.canvas(9, 5); x.fillStyle = '#c8701e'; x.fillRect(0, 0, 9, 5); x.fillStyle = '#8fb8d0'; x.fillRect(1, 1, 7, 3); } break;
      case PK.speaker:
        if (!fallen) { [c, x] = U.canvas(7, 7); x.fillStyle = '#111'; x.fillRect(0, 0, 7, 7); x.fillStyle = '#333'; x.fillRect(1, 1, 5, 5); x.fillStyle = '#555'; x.fillRect(2, 2, 3, 3); x.fillStyle = '#0ff'; x.fillRect(3, 3, 1, 1); }
        else { [c, x] = U.canvas(10, 7); x.fillStyle = '#111'; x.fillRect(0, 0, 10, 7); x.fillStyle = '#2a2a2a'; x.fillRect(1, 1, 8, 5); x.fillStyle = '#444'; x.fillRect(4, 2, 2, 3); } break;
      case PK.flamingo:
        if (!fallen) { [c, x] = U.canvas(12, 12); x.fillStyle = '#ff6fae'; x.beginPath(); x.arc(5, 7, 4.5, 0, U.TAU); x.fill(); x.fillStyle = '#ff9ccc'; x.fillRect(3, 4, 3, 2); x.fillStyle = '#ff6fae'; x.fillRect(8, 1, 2, 6); x.fillStyle = '#ff8fc0'; x.fillRect(8, 0, 3, 2); x.fillStyle = '#222'; x.fillRect(11, 1, 1, 1); }
        else { [c, x] = U.canvas(14, 6); x.fillStyle = '#e85a98'; x.fillRect(0, 1, 12, 4); x.fillRect(2, 0, 8, 6); x.fillStyle = '#ff9ccc'; x.fillRect(3, 2, 2, 1); x.fillRect(11, 2, 3, 1); } break;
      case PK.esky:
        [c, x] = U.canvas(fallen ? 6 : 5, 4); x.fillStyle = '#2a6ad0'; x.fillRect(0, 0, c.width, 4); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, 1); break;
      case PK.cone:
        [c, x] = U.canvas(fallen ? 5 : 3, 3); x.fillStyle = '#ff7a1a'; x.fillRect(0, 0, c.width, 3); x.fillStyle = '#fff'; x.fillRect(1, 1, 1, 1); break;
      case PK.crate: // a wooden loot crate
        if (!fallen) { [c, x] = U.canvas(7, 7); x.fillStyle = '#5a3c22'; x.fillRect(0, 0, 7, 7); x.fillStyle = '#b07a44'; x.fillRect(1, 1, 5, 5); x.fillStyle = '#7a5434'; x.fillRect(1, 3, 5, 1); x.fillRect(3, 1, 1, 5); x.fillStyle = '#ffd23a'; x.fillRect(3, 3, 1, 1); }
        else { [c, x] = U.canvas(9, 5); x.fillStyle = '#7a5434'; x.fillRect(0, 1, 3, 2); x.fillRect(4, 0, 2, 3); x.fillRect(6, 2, 3, 2); x.fillStyle = '#b07a44'; x.fillRect(1, 3, 3, 2); } break;
      case PK.ball: // a footy, laces up
        [c, x] = U.canvas(5, 3); x.fillStyle = '#8a3a1a'; x.fillRect(1, 0, 3, 3); x.fillRect(0, 1, 5, 1); x.fillStyle = '#f4f0e0'; x.fillRect(2, 1, 1, 1); break;
      default: [c, x] = U.canvas(3, 3); x.fillStyle = '#888'; x.fillRect(0, 0, 3, 3);
    }
    return c;
  });

  // ---------- creatures ----------
  SP.gull = frame => get('gull' + frame, () => {
    const [c, x] = U.canvas(7, 7);
    x.fillStyle = '#f4f4f0'; x.fillRect(2, 3, 4, 2); x.fillStyle = '#ffb020'; x.fillRect(6, 3, 1, 1); x.fillStyle = '#222'; x.fillRect(5, 3, 1, 1);
    x.fillStyle = '#9aa0a8';
    if (frame === 0) { x.fillRect(3, 3, 2, 1); } // sitting
    else if (frame === 1) { x.fillRect(3, 0, 2, 3); x.fillRect(3, 5, 2, 2); x.fillStyle = '#333'; x.fillRect(3, 0, 1, 1); x.fillRect(3, 6, 1, 1); }
    else { x.fillRect(2, 1, 3, 2); x.fillRect(2, 5, 3, 1); }
    return c;
  });
  SP.whale = ghost => get('whale' + (ghost ? 'g' : ''), () => {
    const L = 60, H = 18; const [c, x] = U.canvas(L + 10, H + 2);
    const body = ghost ? 'rgba(150,255,240,0.75)' : '#22262e', dark = ghost ? 'rgba(90,220,230,0.8)' : '#15181e';
    x.fillStyle = dark; x.beginPath(); x.ellipse(L / 2 + 4, H / 2 + 1, L / 2, H / 2 - 1, 0, 0, U.TAU); x.fill();
    x.fillStyle = body; x.beginPath(); x.ellipse(L / 2 + 4, H / 2, L / 2 - 2, H / 2 - 3, 0, 0, U.TAU); x.fill();
    x.fillStyle = dark; x.beginPath(); x.moveTo(6, H / 2); x.lineTo(0, 1); x.lineTo(3, H / 2); x.lineTo(0, H); x.closePath(); x.fill(); // flukes
    x.fillStyle = ghost ? '#fff' : '#d8d4c8'; [[L - 2, 6], [L + 1, 9], [L - 5, 11], [L - 8, 7]].forEach(([a, b]) => x.fillRect(a, b, 2, 2)); // callosities
    x.fillStyle = dark; x.fillRect(L * 0.55, 3, 6, 2); x.fillRect(L * 0.55, H - 4, 6, 2); // flippers
    return c;
  });
  SP.fluke = ghost => get('fluke' + (ghost ? 'g' : ''), () => { const [c, x] = U.canvas(18, 8); x.fillStyle = ghost ? 'rgba(150,255,240,0.8)' : '#1d2128'; x.beginPath(); x.moveTo(9, 7); x.quadraticCurveTo(0, 6, 0, 0); x.quadraticCurveTo(5, 3, 9, 3); x.quadraticCurveTo(13, 3, 18, 0); x.quadraticCurveTo(18, 6, 9, 7); x.fill(); return c; });

  // soft round light sprite (white, tinted at draw time via separate caches)
  SP.light = (color, size = 64) => get(`light:${color}:${size}`, () => {
    const [c, x] = U.canvas(size, size); const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    const [r, gg, b] = U.hex(color); g.addColorStop(0, `rgba(${r},${gg},${b},1)`); g.addColorStop(0.35, `rgba(${r},${gg},${b},0.55)`); g.addColorStop(1, `rgba(${r},${gg},${b},0)`);
    x.fillStyle = g; x.fillRect(0, 0, size, size); return c;
  });
  SP.cone = (color, len = 96) => get(`cone:${color}:${len}`, () => {
    const [c, x] = U.canvas(len, len * 0.7); const g = x.createRadialGradient(0, c.height / 2, 0, 0, c.height / 2, len);
    const [r, gg, b] = U.hex(color); g.addColorStop(0, `rgba(${r},${gg},${b},0.95)`); g.addColorStop(0.5, `rgba(${r},${gg},${b},0.4)`); g.addColorStop(1, `rgba(${r},${gg},${b},0)`);
    x.fillStyle = g; x.beginPath(); x.moveTo(0, c.height / 2 - 2); x.lineTo(len, 0); x.lineTo(len, c.height); x.lineTo(0, c.height / 2 + 2); x.closePath(); x.fill(); return c;
  });
  SP.puff = (color) => get('puff' + color, () => { const [c, x] = U.canvas(16, 16); const g = x.createRadialGradient(8, 8, 0, 8, 8, 8); const [r, gg, b] = U.hex(color); g.addColorStop(0, `rgba(${r},${gg},${b},0.9)`); g.addColorStop(0.6, `rgba(${r},${gg},${b},0.5)`); g.addColorStop(1, `rgba(${r},${gg},${b},0)`); x.fillStyle = g; x.fillRect(0, 0, 16, 16); return c; });
  // fog texture (tileable soft noise)
  SP.fog = () => get('fog', () => {
    const N = 128; const [c, x] = U.canvas(N, N); const img = x.createImageData(N, N);
    for (let y = 0; y < N; y++) for (let xx = 0; xx < N; xx++) {
      let v = 0, amp = 0.5, f = 4; for (let o = 0; o < 4; o++) { v += amp * tileNoise(xx / N * f, y / N * f, f, o); amp *= 0.5; f *= 2; }
      const k = (y * N + xx) * 4; img.data[k] = 176; img.data[k + 1] = 190; img.data[k + 2] = 214; img.data[k + 3] = Math.max(0, Math.min(255, (v - 0.32) * 520));
    }
    x.putImageData(img, 0, 0); return c;
  });
  function tileNoise(x, y, period, s) {
    const xi = Math.floor(x), yi = Math.floor(y), tx = x - xi, ty = y - yi; const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const h = (a, b) => U.hash(((a % period) + period) % period, ((b % period) + period) % period, s + 40);
    const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  }
  // damaged copy of a vehicle sprite
  SP.damaged = (base) => { const [c, x] = U.canvas(base.width, base.height); x.drawImage(base, 0, 0); return c; };
  SP.dent = (spr, lx, ly, big) => {
    const x = spr.getContext('2d'); const n = big ? 5 : 2;
    for (let i = 0; i < n; i++) { const px = Math.round(lx + U.rand(-1.5, 1.5)), py = Math.round(ly + U.rand(-1.5, 1.5)); x.fillStyle = U.pick(['rgba(20,20,25,0.55)', 'rgba(60,60,70,0.5)', 'rgba(200,200,210,0.6)']); x.fillRect(px, py, 1, 1); }
  };
})(window.VH);
