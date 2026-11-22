# AGENTS.md: working on Schoolies Mayhem

Read this before changing anything. It applies to every AI coding agent and every human contributor.

## What this is
- A browser game in plain JavaScript and Canvas 2D. Classic `<script>` tags share one `VH` namespace (see `index.html` for the load order). There's no build step and there are no runtime dependencies.
- Run it from any static server in this folder, e.g. `python3 -m http.server 8000`, then open http://localhost:8000/. It won't work from `file://`.
- **The map:** `data/map.json` plus `data/ground_*.png`, baked from OpenStreetMap by `tools/build_map.mjs` (needs a raw OSM extract; see `data/raw/SOURCES.md` for the query). Spawn spots are baked by `tools/bake_slots.mjs`.

## Rules every change must follow
1. **One movement path.** Every walker and vehicle moves through the shared movement and collision code. Mission or activity code sets goals and states only; it never writes positions directly.
2. **Spawns only from validated slots.** Use `VH.Spawn.pick(kind, opts)` / `VH.Spawn.many(...)`. Never place people, vehicles or props at literal coordinates. New kinds of spot go into `tools/bake_slots.mjs`, which validates them (outside buildings, on land or water as appropriate, clear space, reachable) and fails the build otherwise.
3. **No dead ends.** Every job declares what it needs (`requires()`), shows the next step on screen at all times, and recovers from losses (or offers Restart job / Restart night).
4. **Content:**
   - no weapons of any kind (no shooting, no tasers); an arrest is enough;
   - pedestrians are never hurt; they jump out of the way;
   - no drugs; no real private people named; real businesses only with changed, affectionate names and no logos;
   - all art, sound and music original (no copyrighted tunes, not even recognisable riffs);
   - spell the town **Victor Harbor**.
5. **Readable UI.** Text never overlaps or crosses a border at any viewport (check 1280×800 and 390×844 at least). Every interaction has an on-screen prompt and a line in the `?` help.
6. **Keep it static.** No external scripts except pinned cdnjs; served file types only; keep the bundle small.

## Before you open a PR
- Run the checks in `tests/` (once present): the spawn lint (`node tests/lint_spawns.mjs`) and the input-only playthrough harness (`node tests/playthrough.mjs`), which plays jobs using key presses only. Both must pass.
- Play your change in a browser at desktop and phone sizes, and attach a screenshot or short clip.
- Keep PRs small and focused, with one fix or feature each, and describe what you changed and how you tested it.
