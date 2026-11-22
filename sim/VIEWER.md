# Viewer — what Brent wants to see, and the data contract

A static web app (no build step) that shows simulation results on a map of Victor Harbor.

## Views

1. **Travel time to a target (accessibility heatmap).** Pick a target — click anywhere on the
   map (snaps to the nearest road node) or choose a named POI (supermarket, beach, hospital, …).
   Every place on the network is coloured by how long it takes to drive *to* the target, departing
   at the selected time. Residential zones can be shaded by their median time.
2. **Congestion (SimCity-style).** Roads coloured by congestion **per lane and per direction** —
   each direction of a two-way road drawn separately (offset), multi-lane roads show each lane.
   Colour = speed relative to the speed limit (free-flowing → stopped), with optional metrics:
   waiting time, density, vehicle count.
3. **Timeline.** A scrubber over the day (15-minute steps) with play/pause and speed. **Bookmarks**
   mark significant moments: automatically detected (network delay rising/falling sharply, peak
   hour, a junction tipping into queueing) plus scenario-defined ones (school pick-up, event road
   closures, fireworks end). Clicking a bookmark jumps there; each has a short label.
   A second selector steps through **demand years and growth** (2025, 2031, 2041, 2051 ×
   moderate/high) and **conditions** (term weekday, Saturday, summer peak, New Year's Eve).
4. **Before / after.** Choose scenario A and scenario B (e.g. baseline vs council package). Modes:
   side-by-side (synced pan/zoom/time), swipe (draggable divider), and **difference** (B − A:
   travel time or speed change, diverging colours). This must be one click away from any view.
5. Hover/click details: street name, direction, lane, limit, value at this time, sparkline of the
   day; for accessibility, the route and minutes from the clicked origin.

Acronyms in the UI use `<abbr title="full name">`. Colour scales must work for colour-blind
viewers and in dark mode; numbers shown with units.

## Data contract (exported by `vhsim.viewer.export`)

`sim/data/viewer/network.json` — one per network variant (keyed by scenario network name):
- `lanes`: id, edge id, lane index, direction bearing, street name, speed limit (km/h), length,
  shape as lon/lat arrays.
- `edges`: id, from node, to node, length, speed limit, street name, lane ids, shape lon/lat.
- `nodes`: id, lon/lat, name (if a named junction), control type.
- `pois`, `zones` (from S2 when present).

`sim/data/viewer/runs/<run_id>/` — one per (network scenario, condition, year, growth, seed or
seed-mean):
- `meta.json`: run id, scenario, condition, year, growth, interval seconds (900), interval count,
  bookmarks `[{t, label, kind: auto|scenario, detail}]`, summary stats, source run paths.
- `lanes.bin` (or `.json` if small): per lane × interval — mean speed ratio (speed / limit,
  quantised to uint8 0–255), waiting time (s), vehicle count; documented byte layout.
- `edge_times.bin`: per edge × interval — mean travel time (s) for routing; free-flow time where
  the edge had no traffic in that interval.

Travel time to a target is computed **in the browser** with a reverse Dijkstra over
`edge_times` for the departure interval (edge times taken from the interval the vehicle is in as
it travels — time-dependent; if a static per-interval approximation is used, document it and show
the method in the UI's "about" panel).

Simulation outputs needed: SUMO `laneData` and `edgeData` with period 900 s (exporter provides
`viewer_additional(path, period=900)` that returns an additional file to pass to
`vhsim.metrics.run.simulate(..., additional=...)`).

## Comparison maps (November 2026)

Brent could not see real differences between scenarios on the difference maps. Measured on the real
results (summer peak weekday 2025, departing 12:30, the busiest 15 minutes; target Woolworths; mean of
seeds; per road section, B − A of the driving time to the target):

| B vs today's network | sections | median | 95th pct | within 15 s | 15 s – 1 min | 1–2 min | over 2 min |
|---|---|---|---|---|---|---|---|
| Council package (`cp`) | 4,645 | +19 s | +73 s | 47% | 27% | 25% slower (1,173) | 0.5% |
| N9 (`n9`) | 4,680 | −23 s | −13 s (5th: −52 s) | 10% | 89% faster | 1.2% faster | 0.04% |
| C3 one-way loop (`c3`) | 4,661 | +44 s | +126 s | 5% | 54% | 28% | 13% |

At 8:30 on a term weekday the changes are smaller still: `cp` adds 39–41 s for 36% of sections and nothing
reaches a minute; `n9` changes every section by under 15 s (99th percentile 9 s). Congestion (vehicles
queued, 12:30 summer): only 1.1% (`cp`) and 0.5% (`n9`) of lanes change by more than half a vehicle (99th
percentile +0.4), the largest by −5.4 to +4.2 vehicles; speed changes by more than 5 percentage points on
12–15% of lanes.

So both were true. The differences are modest: the options move most trips by seconds to two minutes, and
whole districts move together, because the time to the target changes for every road behind a changed
junction. And the encoding hid them: the travel-time difference scale ran to ±5 minutes, so +1 minute was
drawn about halfway between the neutral grey and the palest red, and +40 s almost grey; every road was
drawn at the same width, so the few changed lanes on the congestion difference were lost among thousands of
unchanged ones.

What changed (`viewer/js/colour.js`, `viewer/js/changes.js`, both apps):
- Difference scales are fixed (comparable between pairs) to where real changes are strongly coloured:
  travel time ±2 min (was ±5), vehicles queued ±3 (was ±5); speed ±30 points, density ±40 and volume
  ±300 per hour unchanged. Values beyond the ends take the end colour (legend "≤−2 … ≥+2").
- Emphasis per road: inside the noise band (15 s; half a vehicle; 5 points …) the road is drawn thin and
  faint, bigger changes thicker, full width at the scale's end.
- Engineer viewer: a "What changed, B − A" panel on the difference map: how many streets changed by a
  notable amount (1 minute; 1 vehicle; 15 points; …) and which, the share of road sections within the
  noise band, the biggest changes as buttons that zoom to the street, and for travel time a second list,
  "roads whose own driving time changed most" (whole network), which points at the
  junction that causes the district-wide shift. On the congestion difference it also gives the network
  delay in vehicle-hours for the 15 minutes in A and B.
- Residents' "Change" heat map keeps its plain-language classes and "about the same" band
  (`viewer/residents/js/change.js`: the larger of 30 s or 5%, doubled for single runs). "About the same"
  roads are drawn thin and faint and faster/slower roads thicker by the size of the change; the caption says
  how much of town is about the same and which streets are a minute or more slower or faster; the legend has
  a "Biggest changes" list (tap to zoom), and tapping a street gives the size of its change.

## Base map, landmarks and 3D (November 2026)

The published maps may not load map tiles from the internet, so they showed only the simulated roads on a
blank background. Both apps now draw a bundled base map under the roads (`viewer/basemap/`, styled in
`viewer/js/basemap.js`): sea (from the OpenStreetMap coastline; beyond the OSM extract, from the terrain tiles), rivers, land use, the causeway and piers,
the railway and tram, 11,800 building footprints, hill shading, and HTML labels (islands, the Bluff with its
height, Encounter Bay, town centre, Mount Breckan, rivers, parks, schools, hospital, suburbs; no font server
needed). The **3D** button on the map tilts it with terrain (1.5× vertical exaggeration) and extruded
buildings, and allows turning; road colours are drawn above the buildings so they stay readable.
Data: OpenStreetMap (ODbL, "© OpenStreetMap contributors") baked by `vhsim.viewer.basemap`; terrain from
the AWS Open Data Terrain Tiles (Geoscience Australia CC BY 4.0, USGS SRTM/GMTED2010, NOAA ETOPO1) baked by
`vhsim.viewer.terrain`; label positions for suburbs from G-NAF. Provenance and the rebuild commands are in
`viewer/basemap/SOURCES.md`; the credits show on the map when it opens and fold behind its ⓘ button once it is moved. Terrain tiles missing at the deepest
zoom are cut from their bundled parent tile in the browser (a `vhdem://` protocol in `mapview.js`), so
nothing 404s. `bin/stage-maps` copies the base map (24 files, about 5 MB). OpenStreetMap raster tiles remain
an option in the engineer viewer only when it is served from localhost.
