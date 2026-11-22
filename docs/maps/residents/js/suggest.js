// A small accessible combobox (ARIA 1.2 list autocomplete) over a text input: the suggestion list works with the
// keyboard (Up/Down, Enter, Escape), a mouse, and touch. It knows nothing about addresses or places.
//
//   attachCombobox(input, listEl, { rows(query) -> [row], choose(row), onFocus() })
//   row: { label, sub?, data? }                  a choice
//        { group: 'Addresses' }                 a heading
//        { status: 'Loading...' }               a message
// `refresh()` on the returned handle re-renders (e.g. when the address list has finished loading).

export function attachCombobox(input, list, { rows, choose, onFocus = () => {}, autoPick = () => true }) {
  let shown = [];        // the rows on screen
  let active = -1;       // index into shown of the highlighted choice
  let open = false;
  const optionIds = [];

  const choices = () => shown.map((r, i) => (r.label !== undefined ? i : -1)).filter((i) => i >= 0);

  function render() {
    list.innerHTML = '';
    optionIds.length = 0;
    shown.forEach((r, i) => {
      const li = document.createElement('li');
      if (r.group !== undefined) { li.setAttribute('role', 'presentation'); li.className = 'group'; li.textContent = r.group; }
      else if (r.status !== undefined) { li.setAttribute('role', 'presentation'); li.className = 'status'; li.textContent = r.status; }
      else {
        li.id = `${list.id}-${i}`;
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', String(i === active));
        li.className = i === active ? 'active' : '';
        const main = document.createElement('span');
        main.className = 'main';
        main.textContent = r.label;
        li.append(main);
        if (r.sub) { const s = document.createElement('span'); s.className = 'sub'; s.textContent = r.sub; li.append(s); }
        li.addEventListener('click', () => pick(i));
        optionIds[i] = li.id;
      }
      list.append(li);
    });
    const show = open && shown.length > 0;
    list.hidden = !show;
    input.setAttribute('aria-expanded', String(show));
    if (show && active >= 0 && optionIds[active]) input.setAttribute('aria-activedescendant', optionIds[active]);
    else input.removeAttribute('aria-activedescendant');
  }

  function update() {
    shown = rows(input.value);
    active = -1;
    render();
  }

  function pick(i) {
    const row = shown[i];
    if (!row || row.label === undefined) return;
    open = false;
    render();
    choose(row);
  }

  function move(step) {
    const idx = choices();
    if (!idx.length) return;
    const at = idx.indexOf(active);
    active = idx[at < 0 ? (step > 0 ? 0 : idx.length - 1) : (at + step + idx.length) % idx.length];
    render();
    document.getElementById(optionIds[active])?.scrollIntoView({ block: 'nearest' });
  }

  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', list.id);
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('autocomplete', 'off');
  list.setAttribute('role', 'listbox');
  list.hidden = true;

  input.addEventListener('focus', () => { onFocus(); open = true; update(); });
  input.addEventListener('click', () => { if (!open) { open = true; update(); } });
  input.addEventListener('input', () => { open = true; update(); });
  input.addEventListener('blur', () => { open = false; render(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { open = true; update(); }
      move(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Escape') {
      if (open) { e.preventDefault(); open = false; render(); }
    } else if (e.key === 'Enter' && open && list.hidden === false) {
      const typed = input.value.trim().toLowerCase();
      const exact = shown.some((r) => r.label !== undefined && r.label.toLowerCase() === typed);
      if (active >= 0) { e.preventDefault(); pick(active); }
      else if (choices().length && typed && !exact && autoPick()) { e.preventDefault(); pick(choices()[0]); }   // Enter takes the top suggestion
    }
  });
  // keep focus in the input while a suggestion is pressed (so the list is still there for the click that follows)
  list.addEventListener('mousedown', (e) => e.preventDefault());

  return { refresh() { if (open) update(); }, close() { open = false; render(); } };
}
