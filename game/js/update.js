// Update check: published builds carry a build id (js/build.js, written by bin/publish-game) and a
// version.json next to index.html. Every few minutes, and whenever the tab comes back into view, fetch
// version.json; if it names a different build, show a small banner offering a reload. Never reloads by itself.
// In development (no build id) it does nothing.
'use strict';
(function () {
  const mine = window.VH_BUILD;
  if (!mine) return;
  let shown = false;
  async function check() {
    if (shown) return;
    try {
      const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) return;
      const v = await r.json();
      if (v && v.build && v.build !== mine) show(v);
    } catch (e) { /* offline: try again later */ }
  }
  function show(v) {
    shown = true;
    const b = document.createElement('div');
    b.setAttribute('role', 'status');
    b.style.cssText = 'position:fixed;left:50%;bottom:calc(10px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:50;' +
      'background:#120c24;color:#ffd23a;border:2px solid #ffd23a;padding:8px 12px;font:12px/1.4 ui-monospace,Menlo,monospace;' +
      'display:flex;gap:10px;align-items:center;max-width:calc(100vw - 32px);box-shadow:0 2px 0 #000';
    const t = document.createElement('span');
    t.textContent = 'NEW VERSION OF SCHOOLIES MAYHEM IS OUT' + (v.note ? ': ' + v.note : '');
    const go = document.createElement('button');
    go.textContent = 'RELOAD';
    go.style.cssText = 'font:inherit;background:#ffd23a;color:#120c24;border:0;padding:4px 8px;cursor:pointer';
    go.onclick = () => location.reload();
    const later = document.createElement('button');
    later.textContent = 'LATER';
    later.style.cssText = 'font:inherit;background:transparent;color:#c9ccd8;border:1px solid #c9ccd8;padding:3px 7px;cursor:pointer';
    later.onclick = () => { b.remove(); shown = false; setTimeout(check, 15 * 60 * 1000); };
    b.append(t, go, later);
    document.body.appendChild(b);
  }
  setInterval(check, 3 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  setTimeout(check, 20 * 1000);
})();
