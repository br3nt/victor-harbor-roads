# Victor Harbor traffic simulation — design and contracts

Goal: test the City of Victor Harbor's VHITS road/traffic options (and alternatives) with a
microscopic simulation (Eclipse SUMO 1.28), today and at future demand, and report:

- **R14 accessibility:** per residential area → POI category, travel-time distributions
  (n, mean, median, p95, p99, histogram) by condition, scenario and year.
- **R15 intersections:** per intersection → approach → turning movement, delay (wait to turn),
  throughput and queue, by condition and scenario.
- Network totals, heavy vehicles/caravans past the foreshore (R23a), speed-limit effects (R23b).

Knowledge-base context: `site/investigation-plan.html`, `site/simulation-design.html`,
`site/road-network.html`, `site/traffic-and-crash-data.html`, `site/population-and-growth.html`,
`site/housing-and-visitors.html`, `site/seasons-and-events.html`, `site/options-register.html`.

## Ground rules (all streams)

- Python package `vhsim` in `sim/`; tests in `sim/tests/<subpackage>/`; run with
  `../.venv/bin/pytest` from `sim/` (shared venv at the main checkout root:
  `/Users/brent/Development/victor-traffic-simulation/.venv`).
- **Red/green TDD.** Every requirement gets a failing test first. Tests that run SUMO on the
  real Victor Harbor data are marked `@pytest.mark.slow`; fast tests use the `grid_net` fixture
  or small hand-made fixtures.
- Read archived sources through `vhsim.paths.SOURCES` (main checkout; some folders are
  git-ignored so they are not in worktrees). **Never modify anything under `sources/`.**
- **Provenance:** every number taken from a source carries its source id (e.g. `S-D01`) in the
  output file (a `source` column or a header comment). Every assumption that is NOT from a
  source goes in `sim/assumptions/<stream>.md` (e.g. `S2-demand.md`), with a value, a reason and how
  sensitive results are likely to be to it. Never present an assumption as data.
- Outputs that are small and deterministic (CSV, GeoJSON, XML < ~5 MB) are committed under
  `sim/data/...`. Large generated networks go to `sim/data/networks/*.net.xml` (git-ignored) and
  must be reproducible with one command.
- Each stream owns ONLY its subpackage, its tests directory, its `sim/data/<area>/` folder and its
  own `sim/assumptions/<stream>.md`. Do not edit `vhsim/paths.py`, `tests/conftest.py`, `pyproject.toml`
  or another stream's files; if you need a change there, say so in your report.
- Coordinates: WGS84 lon/lat in all files exchanged between streams. SUMO-internal x/y only
  inside a stream.

## Streams and their contracts

### S1 network — `vhsim/network/`, `sim/data/networks/`

Builds the **baseline** SUMO network from the OSM extract `sources/E/S-E01-overpass-victor-harbor.osm`.

Produces (command: `python -m vhsim.network.build`):
- `sim/data/networks/baseline.net.xml` (git-ignored, reproducible) and
  `sim/data/networks/baseline.plain/` (netconvert `--plain-output-prefix`: nod/edg/con/tll/typ,
  committed if < 5 MB total) — the base that scenario patches are applied to.
- `sim/data/networks/junctions.csv`: one row per *named* intersection in the town-centre study
  area: `junction_id, name, control (roundabout|priority|traffic_light|...), lon, lat, legs` and,
  per approach, nothing else needed here.
- `sim/data/networks/edge_attributes.csv`: `edge_id, street_name, speed_kmh, lanes, oneway,
  speed_source (S-D05|OSM|default), lanes_source`.
- `sim/data/networks/VALIDATION.md`: what was checked (roundabouts complete, connectivity,
  speeds vs DIT legal limits, lanes on arterials) and what is still approximate.

Requirements: passenger cars, trucks and caravans (vClass `passenger`, `truck`,
`trailer`/`delivery` as appropriate) can drive; footways/cycleways dropped; no traffic lights
(none exist today); speed limits on State roads from DIT's legal-limit layer
`sources/D/D-state-maintained-roads-vh-area.geojson` (S-D05), otherwise OSM `maxspeed`,
otherwise 50 km/h urban; ~20 "incomplete roundabouts" fixed or explained; network strongly
connected for cars between all gateways and the town centre.

Also provides the **scenario patch mechanism**: `vhsim.network.scenario.build(name, patches_dir)`
applies netconvert patch files (`*.edg.xml`, `*.con.xml`, `*.nod.xml`, `*.tll.xml`) over the
baseline plain files and writes `sim/data/networks/<name>.net.xml`. Scenario patch *content* is a
later stream; S1 ships the mechanism plus one test scenario proving it works (e.g. a speed change
on one edge).

### S2 demand — `vhsim/demand/`, `sim/data/zones/`, `sim/data/demand/`

Network-independent demand: who travels from where to where, when.

Produces (command: `python -m vhsim.demand.build --condition <c> --year <y> --growth <g>`):
- `sim/data/zones/residential_zones.geojson`: polygons (ABS 2021 mesh blocks for LGA 48050, or a
  documented fallback) with `zone_id, suburb, dwellings, persons, occupied_households,
  source`. Mesh-block counts: `sources/C/S-C30-victor-harbor-lga-mesh-blocks-2021.csv`.
- `sim/data/zones/pois.geojson`: points with `poi_id, category, name, weight, source` for
  categories **supermarket, shops, dining, services, medical, gym, school, beach_foreshore,
  recreation, caravan_park, accommodation, work**. Start from `sources/E/S-E03-poi.geojson`.
- `sim/data/zones/gateways.csv`: external entry points with lon/lat, road name and AADT (from
  the counts stream's `aadt.csv` when available; otherwise S-D02 directly).
- `sim/data/demand/<condition>_<year>_<growth>.trips.xml`: SUMO trips using **`fromLonLat` /
  `toLonLat`** (network-independent), `depart` in seconds from midnight, `type` one of
  `car, truck, caravan`. **Vehicle id format (contract with S3):**
  `"{stratum}~{origin_zone}~{dest_category}~{dest_poi}~{seq}"` (SUMO rejects `|` and most punctuation in ids; field values must not contain `~`) where stratum is
  `res` (resident), `vis` (visitor), `thr` (through traffic), `ext` (external with a local
  end). Example: `res~MB40123450000~supermarket~poi_17~000042`.

Conditions: `weekday_term`, `saturday`, `summer_peak` (weekday between Christmas and New Year),
`event_nye`. Years/growth: `2025/base`, `2031|2041|2051` × `moderate|high` (UGMS scenarios:
moderate ≈ +8,000 people by 2050 at 185 dwellings/yr; high ≈ +19,200 at GARP 318→410→475
dwellings/yr; S-B10). New households go to the northern growth areas and infill; the growth-area
polygons are approximations (document how they were drawn).

Trip generation, purpose shares, time-of-day and destination choice are assumptions unless a
source is archived: record each in `sim/assumptions/S2-demand.md`. Use the hourly profile from the counts
stream (`sim/data/profiles/hourly_profile.csv`) when present; until then a placeholder profile
with a clear `PLACEHOLDER` marker. Visitors are a separate layer sized so that inbound volume on
Victor Harbor Rd reaches the DIT summer figure (> 11,000/day, S-D18) in `summer_peak`.

### S3 counts — `vhsim/counts/`, `sim/data/counts/`, `sim/data/profiles/`

Turns the observed data into calibration targets.

Produces (command: `python -m vhsim.counts.build`):
- `sim/data/counts/turning_2017.csv`: from the Tonkin 2017 Torrens Street review
  (`sources/D/S-D-torrens-street-review-draft-2017.txt`, S-D19; PDF alongside), the 12-hour
  (7am–7pm, Wed 26 Apr 2017) turning counts at 7 intersections in 15-minute bins:
  `intersection, approach_road, approach_dir (N|NE|E|...), movement (L|T|R|U), to_road,
  bin_start (HH:MM), light, heavy, cycle, source`. Tests must reproduce the report's own
  totals (e.g. peak-hour volumes per intersection; ≈7,600 in / 6,700 out of the centre).
- `sim/data/counts/aadt.csv`: DIT AADT sections near Victor Harbor (S-D01/S-D02;
  `sources/D/D-tv-selected-roads-by-release.csv` and the GeoJSON in `sources/D/`):
  `road, section, aadt, count_year, cv_pct, lon, lat (section midpoint), bearing, source`.
- `sim/data/profiles/hourly_profile.csv`: share of daily traffic by hour (0–23) derived from the
  2017 counts for 07–19 and an explicitly marked assumption for night hours.
- `sim/data/counts/seasonal_factors.csv`: summer/peak factors with source or assumption marker.
- `sim/data/counts/COUNTS.md`: what each target is, its date/season, and its limits.

### S4 metrics — `vhsim/metrics/`

Turns SUMO outputs into the report tables. Develop against small simulations on `grid_net` or a
hand-made network; no dependency on S1/S2 outputs.

Provides:
- `vhsim.metrics.run.simulate(net, trips, out_dir, seed, end)`: runs duarouter + sumo with the
  outputs the metrics need: `--tripinfo-output`, `--vehroute-output` with
  `--vehroute-output.exit-times`, `--statistic-output`, edgeData; teleports logged.
- `vhsim.metrics.accessibility`: from tripinfo + the vehicle-id contract above → table per
  `(origin_area, dest_category, hour_band)` with `n, mean, median, p95, p99` and histogram bins;
  `origin_area` is the zone's suburb via a zone→area mapping passed in.
- `vhsim.metrics.movements`: from vehroute exit times → per `(junction_id, from_edge, to_edge)`
  movement: `n, mean_delay, median_delay, p95_delay, flow_per_hour` where delay on the approach
  edge = actual time on edge − free-flow time (length / allowed speed). Label each movement with
  approach compass direction and turn type (L/T/R/U) from edge geometry.
- `vhsim.metrics.compare`: scenario vs baseline deltas for both tables.
- `vhsim.metrics.report`: writes HTML fragments (tables + `<script type="application/json">` data
  + simple inline SVG histograms) that the knowledge base can embed.

## Integration (main loop, after streams land)

Map counts to edges; calibrate the baseline (demand scaling / routeSampler against turning
counts and AADT; target GEH < 5 on most counted links); validate; then scenario patches
(C1–C6, B1–B6, N1) and runs; results into the knowledge base.
