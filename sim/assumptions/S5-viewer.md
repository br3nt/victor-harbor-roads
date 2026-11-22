# Assumptions and data format — S5 viewer

Each assumption: value, reason, expected sensitivity, what would replace it. The viewer shows simulation
outputs; it adds no traffic data of its own. The data contract is `sim/VIEWER.md`; this file records the
exact format and the choices made while implementing it.

## Files (exporter output)

`python -m vhsim.viewer.export --net <net.xml> --run <run_dir> [--run <seed2> ...] --out <data_dir> --scenario S
--condition C --year Y --growth G [--seed N] [--network-name NAME] [--begin s] [--end s] [--bookmark "HH:MM=label"]
[--bookmarks file.json] [--pois pois.geojson] [--zones zones.geojson] [--junctions junctions.csv]`

```
<data_dir>/index.json                  {version, networks: {name: "networks/<name>.json"},
                                        runs: [{id, scenario, network, condition, year, growth, seed, label, path}]}
<data_dir>/networks/<name>.json        one per network variant
<data_dir>/runs/<run_id>/meta.json     run_id = "<scenario>__<condition>__<year>-<growth>__s<seed>" (or "__mean")
<data_dir>/runs/<run_id>/lanes.bin.gz
<data_dir>/runs/<run_id>/edge_times.bin.gz
```
Several `--run` directories (seeds) are averaged into one run with seed `mean` (plain mean per lane/edge and
interval; a seed with no vehicles on a lane is left out of that lane's speed and density mean). `index.json` is merged,
so runs can be exported one at a time into the same folder.

Safety checks: the exporter refuses to replace `networks/<name>.json` with a network whose lane/edge ids differ
(`--force-network` overrides; then re-export every run on it), refuses runs whose measured edges are mostly not in
`--net`, and refuses seeds with different output periods. The viewer refuses a run whose `network_hash`, `n_lanes`
or `n_edges` do not match the loaded network.

### networks/<name>.json (columnar: one array per field, index = position)
- `version`, `name`, `hash` (16 hex digits of SHA-1 over the edge and lane id lists: the order the run binaries
  follow), `lefthand`, `bbox [w, s, e, n]`, `projection`, `routing_vclass` (`passenger`).
- `nodes`: `id`, `lon`, `lat`, `name` (from S1 `junctions.csv` when given, else null), `type` (SUMO junction type).
- `edges`: `id`, `from`/`to` (node index), `length` (m), `speed_kmh`, `name`, `lanes` (lane indices), `shape`
  (flat `[lon, lat, lon, lat, …]`, 6 decimals ≈ 0.1 m, the edge's centre line from junction to junction),
  `routable` (1 if `passenger` may use it), `next` (edge indices reachable through a SUMO connection),
  `via_s` (free-flow time through the junction's internal lane for each `next`), `bearing` (deg, first→last point),
  `slot` (drawing offset of the direction line, see below).
- `lanes`: `id`, `edge` (edge index), `index` (SUMO lane index, 0 = kerb), `bearing`, `name`, `speed_kmh`, `length`,
  `slot`, `shape` (the lane's own SUMO shape in lon/lat; the viewer draws lanes from the edge centre line + `slot`).
- `pois`: `{id, category, name, lon, lat, node (nearest node a car can enter), snap_m, source}`.
- `zones`: `{id, name, geometry (GeoJSON), edges (routable edges whose midpoint is inside), suburb?, dwellings?, …}`.

### meta.json
`run_id, label, network, network_hash, scenario, condition, year, growth, seed, begin_s, interval_s (900), n_intervals,
n_lanes, n_edges, files {lanes, edge_times} (binary layouts, below), bookmarks [{t, label, kind: auto|scenario,
detail}], series {delay_veh_h, waiting_veh_h, vehicles_mean, speed_ratio_mean} (one value per interval),
summary {loaded, inserted, arrived, teleports, waiting, running, delay_veh_h_total, peak_interval_begin_s},
queue_threshold_vehicles, sources (run dirs), synthetic, notes, created`.

### Binary layout (both files)
gzip-compressed, little-endian, **interval-major** planes (`value[t * n + i]` for lane/edge `i` in interval `t`),
each plane padded to a 4-byte boundary; `decoded = raw * scale` unless `raw == missing`. `meta.files.*.planes`
lists `{name, dtype, offset, scale, missing, unit, description}`.

| file | plane | dtype | scale | missing | meaning |
|---|---|---|---|---|---|
| lanes | `waiting_s` | uint16 | 2 | – | seconds vehicles were halted on the lane in the interval, summed over vehicles (cap 131070 s ≈ 145 vehicles halted all interval) |
| lanes | `vehicles` | uint16 | 1 | – | vehicles entering the lane, incl. lane changes onto it (entered + departed + laneChangedTo); a vehicle can count on two lanes of one road |
| lanes | `speed_ratio` | uint8 | 1/254 | 255 | time-weighted mean speed / lane limit (SUMO `speedRelative`), capped at 1; 255 = no vehicles |
| lanes | `density` | uint8 | 1 | 255 | vehicles per km of lane (cap 254) |
| edge_times | `travel_time_s` | uint16 | 0.1 | 65535 | SUMO edgeData `traveltime`; free-flow time where no vehicle; cap 6553.4 s; 65535 = impassable |

Size: 6 bytes per lane-interval + 2 per edge-interval before gzip. Victor Harbor scale (~15k lanes, 96 intervals) is
about 9 MB raw per run; gzip typically reduces it 5–10×. The sample (1,238 lanes, 76 intervals) is 120–140 kB per run.

## V1. Edge travel time = SUMO edgeData `traveltime`, free-flow where empty
- **Value:** mean of the vehicles on the edge in each 15-minute interval (length / time-weighted mean speed, so it
  includes queueing at the stop line); free-flow time (length / limit) where no vehicle used the edge; never below half
  the free-flow time (guards one fast sample). Junction crossing time: free-flow time of the internal lane.
- **Reason:** contract; edgeData is the only per-interval travel time SUMO gives for every edge.
- **Sensitivity:** low on busy roads, higher on rarely used ones (a single slow vehicle sets the value). Seed-mean runs
  smooth this. Waiting to turn is on the approach edge for all movements, so a long right-turn queue also slows the
  through movement in the viewer (SUMO lane data would separate them; the routing graph is per edge). The junction
  time counts only the first internal lane of a connection (slight underestimate for turns with an internal stop).
- **Not represented:** road closures (event, NYE). The binary format has an "impassable" code and the router honours
  it, but the exporter does not write it yet: closed roads would be routed through at free-flow speed. Needed before
  event scenarios are shown: a closures input (edge, begin, end) to the exporter.

## V2. Travel time to a target: arrival-anchored searches, routes driven forward
- **Value:** for arrival times t, t + 3¾ min, t + 7½ min, … (4 anchors per 15-minute interval, up to 4 hours) a
  reverse time-dependent Dijkstra gives every edge's latest entry time and the route (a tree towards the target).
  The latest entry time is solved exactly on the piecewise-linear edge-time function. For each edge the two anchors
  whose latest entry times bracket the departure t give two routes; both are driven forward from t with the
  time-dependent edge times and the faster is shown. Edge times are interpolated linearly between interval
  centres. Departure = start of the selected interval. Shown value = time from the **middle** of each road section
  (route time minus half the section's free-flow time, so a queue at its stop line still counts).
- **Accuracy:** every value is the exact time of a real route; it is longer than the true fastest time only when a
  route neither bracketing anchor chose would be faster. Tested against a forward time-dependent search from each
  origin on a 12 × 12 grid with sudden 1–10 minute queues on 30% of edges: 5,280 checks, worst error 5.0 s, 1 over
  max(2%, 5 s). Time: about 12 ms for 9,800 edges in Node; 1–3 ms on the sample network in the browser.
- **Limits:** exact only while FIFO holds (an edge's time never falls by more than 15 minutes between two interval
  centres). Not modelled: drivers re-routing as conditions change, parking search (integration I3), the walk from
  the car, road closures (V1). Edges with no route are grey.

## V3. Snapping the target
- **Value:** the target snaps to the nearest node that a car can drive into; a POI likewise. The node's label is its
  S1 junction name or the street names meeting there.
- **Sensitivity:** a target in the middle of a long road snaps to a junction up to half the road's length away.

## V3b. Zone shading
- **Value:** a zone's value is the median travel time over the routable road sections whose midpoint lies inside it;
  a zone with none (small mesh blocks) uses up to 3 nearest road sections within 300 m of its centroid
  (`edges_nearest: true`); a zone with no road within 300 m (e.g. Granite Island) stays grey.
- **Sensitivity:** presentation; a mesh block's median is close to the time from its frontage roads.

## V4. Automatic bookmarks (exporter, `vhsim/viewer/bookmarks.py`)
- **Value:** peak interval of network delay (sum of SUMO `timeLoss`, vehicle-hours per interval); up to two sharpest
  rises and two falls (each ≥ 15% of the peak and ≥ 0.5 vehicle-hours per 15 min; neighbouring intervals merged; a rise
  into the peak interval is folded into the peak); the first interval where a junction approach (edge ending at a node
  with 3+ legs) averages ≥ 5 halted vehicles per lane (`waitingTime / 900 / lanes`), top 5 approaches by peak queue; the label says
  "halted vehicles per lane (15-minute average)".
  In the browser, A-vs-B bookmarks mark the intervals where network delay differs most each way (≥ 10% of the peak and
  ≥ 0.5 vehicle-hours).
- **Reason:** plain, explainable rules. Thresholds are guesses tuned on the sample; `--queue-threshold` changes the queue one.
- **Sensitivity:** presentation only.

## V5. Congestion colours
- **Value:** speed ratio ≥ 80% of the limit counts as free-flowing (lightest colour); 0% = stopped. Waiting = average
  halted vehicles (`waiting_s / 900`). Volume shown per hour. Lanes with no vehicles are grey.
- **Reason:** SUMO's urban links rarely average the full limit even when empty (junction slow-downs, speed factor),
  so a 100% anchor made every road look congested.
- **Sensitivity:** presentation only.

## V6. Comparing scenarios
- **Value:** lanes/edges are matched by SUMO id across networks; roads only in A are drawn dashed ("removed in B"),
  roads only in B are grey. In difference mode speeds are capped at the free-flow anchor (80% of the limit) and a lane
  with no vehicles counts as free-flowing, so an empty lane in A and a lightly used one in B do not show as a slow-down;
  queue, volume and density count no vehicles as zero. A road with a route in A but none in B shows as the largest
  increase (darkest red). When B's time window does not cover the selected time, B shows no data (it is not clamped to
  its nearest interval); runs with different interval lengths cannot be compared. Differences inside a dead band (15 s, 5 percentage points, half a vehicle, 3 vehicles/km,
  20 vehicles/h) are shown as no change, because single-seed runs differ by that much by chance.
- **Sensitivity:** with one seed per scenario, small differences are noise; use seed-mean runs (several `--run`).
  If a scenario patch renames edges (e.g. splits one), those edges will not match and show as removed + new.

## V7. Lane drawing offsets
- **Value:** lanes are drawn from the edge's junction-to-junction centre line (`getRawShape`) with a pixel offset
  (`slot` lane widths, MapLibre `line-offset`): two-way roads put each direction on its driving side (left in
  left-hand networks, read from the net's `lefthand` attribute), kerb lane outermost, 0.15 lane widths gap at the
  centre line; one-way roads are centred. Widths are exaggerated below zoom 16 and true to scale (3.2 m) above.
- **Sensitivity:** presentation only. One-way roads imported with `spreadType=right` are drawn half a road width off.

## V8. Sample data (`sim/data/viewer/sample/`, `python -m vhsim.viewer.sample`)
- **Value:** NOT RESULTS. A quick netconvert of the S-E01 OSM extract clipped to 138.598–138.640 E, 35.540–35.568 S
  (`--lefthand`, OSM speeds, no S1 fixes); 15,000 synthetic car/truck trips (shape of the S3 hourly profile, made-up
  purposes: home ↔ centre/shops, 15% through traffic, 250 school trips per school each way at drop-off and pick-up);
  2041-high = 1.3 × trips; summer peak = beach trips instead of school trips; "test_variant" = Victoria Street one-way
  (south/west-bound edges deleted) and Esplanade 40 km/h. One seed per run. Places from S-E03; zones are a 3 × 3 grid
  of test cells. Every run is marked `synthetic` and the UI shows a banner.
- **Reason:** real network (S1), demand (S2) and calibrated runs are not ready; the viewer needed congestion and a
  before/after difference to be built and tested against.

## V9. External libraries
- MapLibre GL JS 5.6.0 from cdnjs (`viewer/index.html`); no build step. The tests load the same version from
  `viewer/node_modules` so they run offline. Background map: OpenStreetMap raster tiles, off by default.

## Residents' site (`viewer/residents/`)

## R1. Trip times
- **Value:** fastest time-dependent route (forward search, `routeFromNode`) from the simulated junction nearest each
  end of the trip, departing at the trip's time, on the run for that option, day type, year and growth. Places more
  than 800 m from any junction count as "outside the simulated area". Door-to-door parts (parking, walking) are not included.
- **Sensitivity:** small for trips between named places; a home picked in a paddock snaps to the nearest road.

## R2. "About the same" band (grey)
- **Value:** a trip is "about the same" when the option's time is within the larger of **30 seconds or 5%** of today's
  time; outside it, faster (green) or slower (red). Route sections on the map use the larger of 3 seconds or 10% of
  the section's time. Colours: Okabe-Ito bluish green and vermillion, always with words and ▲/▼/= symbols.
- **Single-seed runs** (some future years are 1 seed): the band doubles to the larger of **60 seconds or 10%**, and
  the page says the result is from a single run and less certain. The heat-map difference uses the same band.
- **Reason:** results are seed means, and the 15-minute averaging of section times moves trip times by tens of
  seconds even with no change. Not yet measured from the seed spread: when per-seed runs are exported, the band can
  be set to about twice the seed-to-seed standard deviation of trip times.
- **Sensitivity:** presentation; it decides only which small changes are called "about the same".

## R3. Day types
- Weekday (school term) → `weekday_term`, Saturday → `saturday`, Summer holidays → `summer_peak`. Day types or
  years without a run are shown as "not simulated yet"; nothing is interpolated or borrowed from another day or year.
  2025 is "today" (growth `base`) for both growth settings.

## R4. Privacy
- Trips and saved places live only in `localStorage` (key `vh-residents-v1`), every access wrapped in try/catch; if
  storage is blocked the site works for the visit and says nothing is saved. No trip data goes in URLs, requests
  or logs; all routing runs in the browser on the published results. Place search uses the published places list
  (no external address lookup). The only third-party requests are the map library (cdnjs) and, if a future
  version turns it on, background map tiles.

## R5. Data the site loads
- `networks/<name>.lite.json` (routing-only, written by the exporter, or backfilled with
  `python -m vhsim.viewer.lite --data <dir>`; falls back to the full network file) and each run's
  `edge_times.bin.gz`. The "all options at a glance" table loads every option's network and only runs when asked.

## Base map (`viewer/basemap/`, `vhsim/viewer/basemap.py`, `vhsim/viewer/terrain.py`)

Provenance, licences and hand-placed labels: `viewer/basemap/SOURCES.md`. These choices only change how the map
looks; no simulation result depends on them.

## V10. Building heights (3-D buildings)
- **Value:** OSM `height` when present (none in G-01), else `building:levels` × 3 m + 1 m (4 buildings), else a
  default by type: house / detached / semi-detached / terrace / residential, and `building=yes` up to 800 m²: 4.5 m;
  garage / carport / shed / roof / hut: 2.8 m; apartments: 10 m; retail / commercial / supermarket / office (or any
  building with a `shop` tag): 6.5 m; school / college: 7 m; church or place of worship: 10 m; hospital: 9 m;
  industrial / warehouse: 7 m; hotel: 10 m; `building=yes` over 800 m²: 6.5 m. Rounded to 0.5 m.
- **Reason:** 97% of G-01 buildings are `building=yes` with no height or levels. Victor Harbor is mostly single-storey
  detached houses (about 3 m walls plus a pitched roof, so about 4.5 m to the ridge); footprints over 800 m² are
  shops, halls and sheds with high single-storey roofs. The type defaults are typical heights for one-storey
  outbuildings, two-storey schools and shops, and three-storey apartment and hotel blocks.
- **Sensitivity:** presentation only. A two-storey house is drawn about 2–3 m too low.
- **Class (`c`):** from the `building` value, then `amenity` / `shop` / `tourism` tags; plain `building=yes` with
  no other tag is `other` (not guessed to be a house), so most buildings are `other`.
- Buildings under 12 m² are dropped (mostly garden sheds and water tanks); outlines are simplified with a 0.5 m
  tolerance and snapped to the 1e-5° (about 1 m) output grid.

## V11. Base-map generalisation
- **Value:** areas and lines are clipped to the G-01 box (138.57–138.66 E, 35.53–35.598 S), where the extract is
  complete; outside it the map shows the terrain only. Buildings and pier outlines crossing the box edge are kept whole. Simplification tolerances (in metres, before snapping to
  1e-5°): sea and inland water 1 m, land use 1.5 m, lines 1 m, piers 0.5 m. Land-use areas under 20 m² are dropped.
  `landuse=construction` (10 new housing estates) and `landuse=quarry` (1) are left out: they have no class in the
  map style. `leisure=nature_reserve`, `swimming_pool` and `playground` areas are left out too.
- **Label zooms:** islands and the bay 12 (islands under 10 ha 13); town suburbs (1,000+ G-NAF addresses) 12, rural
  localities 11; landmarks, rivers, peaks and Petrel Cove 13; Chiton Rocks and the hospital 14; golf courses and
  parks over 20 ha 13.5; other parks, the large named oval and schools 14.5.
- **Sea outside the G-01 box:** from the terrain tiles: below 1 m and connected to the OSM sea or to the south/west
  edge of the area; offshore land under 5 m or under 2 ha counts as sea; simplified by 40 m (details in
  `viewer/basemap/SOURCES.md`). The 1 m and 5 m thresholds deal with noise in the source near the coast; a lower
  coast (beaches under 1 m) would be drawn as sea, a 30–50 m effect at this scale.
- **Terrain:** sea-floor elevations are set to 0 (a flat sea, no bathymetry shading) and elevations are rounded to
  1/8 m. Zoom 12 (about 15 m per pixel) covers the town only; zooms 10–11 cover the whole network.
- **Sensitivity:** presentation only.
