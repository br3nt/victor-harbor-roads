# Assumptions — integration

Each entry: value, reason, expected sensitivity, and what evidence would replace it. Sourced values are not listed here; they carry their source id in the data files.

## I1. Roundabouts appear as several junction ids
- **Value:** SUMO models a roundabout as a ring of nodes, so `movements.table` reports one row per entry node. Integration must map those nodes to the named intersection (S1 `junctions.csv`) and report per named intersection and approach.
- **Sensitivity:** presentation only, but required before any R15 table is published.

## I2. What "approach delay" includes
- **Value:** time on the approach edge minus length / lane speed limit. It includes the few seconds of crossing the *previous* junction and the effect of drivers' speed variation (SUMO speedFactor), so free-flowing approaches show a small positive delay. Lower speed limits change the free-flow time, so a 30 km/h zone does not appear as "delay"; it appears in travel times (R14).
- **Sensitivity:** uniform across scenarios; compare scenarios by difference, not absolute values.

## I3. Parking search not modelled explicitly (for now)
- **Value:** no cruising-for-parking traffic. The core CBD (Ocean St, Coral St) is over 80% full on typical weekdays (S-D21 s7.2), so some circling exists; omitting it understates town-centre volumes slightly, mostly on Ocean St / Coral St.
- **Replace with:** a parking-search detour share for trips to the core, calibrated against the 2017 turning counts.

## A-INT-01. Right-turn bays on arterial approaches
- **Value:** on one-lane trunk/primary/secondary/tertiary approaches (≥ 50 m) to give-way junctions that have a right turn, the last min(40 m, 40% of the edge) gets a second, median-side lane for right turns and U-turns (`vhsim.network.turn_bays`; 180 approaches). Network name `baseline_bays`.
- **Why:** the OSM import gives every arterial one lane per direction with no turning pockets, so each car waiting to turn right across oncoming traffic blocks all traffic behind it. The first full-day baseline run gridlocked at a few hundred vehicles per hour on Victoria St, Bay Rd and George Main Rd — far below DIT-counted volumes (S-D01) — which is a modelling artefact. Victor Harbor's arterials mostly have median openings, marked turn lanes or wide carriageways where right-turners can wait.
- **Sensitivity:** high for intersection delay on arterials. Bay lengths are not measured; aerial imagery or a site check per intersection would replace them.
- **Also fixed:** trips were first snapped to one direction of the nearest road, which forced 38% of routes into U-turns at the next junction. Trip ends are now traffic zones (TAZ) covering both directions of the nearest road (`vhsim.integration.snap.snap_trips_taz`), giving 0% U-turns.

## A-INT-02. Driver impatience at give-way junctions
- **Value:** SUMO `--time-to-impatience 60` (default 180 s) and `--ignore-junction-blocker 15`. After waiting, a driver on a give-way approach accepts progressively smaller gaps, reaching full impatience after 60 s; a vehicle stopped inside a junction for 15 s no longer blocks others.
- **Why:** with SUMO's defaults, side-street drivers waited indefinitely for gaps in main-road traffic, and the morning test run had ~2,100–2,600 vehicles "teleported" out of jams by 1pm. With these settings the same run has 0 teleports and normal congestion. Real drivers accept tighter gaps after a minute or so of waiting.
- **Sensitivity:** high for side-street delay at busy give-way junctions (the R15 "wait to turn" numbers). The value should be checked against observed side-street delays; until then it is a calibration parameter, kept identical across scenarios.

## A-INT-03. En-route rerouting (drivers avoid congestion)
- **Value:** every vehicle re-checks its route every 120 s using recent travel times (SUMO `--device.rerouting.*`, adaptation over 18 × 10 s).
- **Why:** routing once on empty-road travel times sent all Encounter Bay traffic onto Victoria St until it jammed, and any demand above today's gridlocked the network. Real drivers avoid congested routes. With rerouting, all 9 calibration variants ran with 0 teleports.
- **Sensitivity:** medium; it spreads traffic across parallel routes (Victoria St / Crozier Rd / ring road). Kept identical for every scenario.

## A-INT-04. Calibration result (demand config `sim/data/demand/config/calibrated.json`)
- **Value:** `rates.senior_weight` 0.2 (default 0.42) and all gravity betas halved (longer trips). Chosen from a 9-variant grid scored on DIT daily volumes (S-D01/S-D02) on internal arterials (`vhsim.integration.calibrate`, variant `rr_sw0.2_b0.5`).
- **Fit (term weekday, 2025):** simulated / DIT daily volume — Port Elliot Rd 0.98, Victor Harbor Rd 1.08, Hindmarsh Rd 0.89–1.02, Torrens St 0.74–0.81, George Main Rd 0.86, **Adelaide Rd 0.58, Victoria St 1.53**. Against the 2017 turning counts (07–19, matched movements): about 0.8 of counted volume overall; Torrens/Victoria 1.31, Torrens/Crozier 0.58, others 0.75–0.84. Hourly shape follows the counts (midday peak).
- **Limits:** this is a partial calibration. Victoria St is over-loaded and Adelaide Rd under-loaded; the 2017 counts were a school-holiday day; several count movements at divided-road junctions and roundabouts could not be matched to the network. Scenario results are best read as differences between scenarios on the same demand, not as absolute predictions.

- **Update 21 Nov 2026 — fit against projected counts:** the 2017 turning counts were projected to a 2025 term weekday (`sim/data/counts/PROJECTION.md`; factors Torrens St 0.98, Hindmarsh Rd 1.05, Victoria St 0.91, council streets 1.17). At movements matched to the network the calibrated baseline (variant rr_sw0.2_b0.5) carries 0.80 of the projected 2025 volume (66,437 / 82,651, 07:00–19:00), against 0.82 of the raw 2017 counts. Computed with `vhsim.integration.calibration.compare_turning` using `turning_2025_projected.csv` (light/heavy = projected columns).

## A-INT-05 Growth runs: summer at high growth does not finish (21 Nov 2026)

2041 high growth (UGMS high, about +19,200 people) summer peak day, 120,386 trips (2025: about 85,700):
every option tried (today's network, council package, Brent's package, four-lane ring road) was still
running after 6 hours of computing, with the simulation clock at 13:00–14:00 and 40–44% of the day's
trips finished. Runs were stopped; outputs kept in data/runs/*summer_peak_2041_high*. Read this as
"demand exceeds what the road network can carry on a summer afternoon", not as a forecast of literal
gridlock: the model has no peak spreading, mode shift or trips not made. From now on runs stop after
VHSIM_SUMO_TIMEOUT seconds (45 min in timeline_batch.sh) and are recorded as gridlock errors.

2041 high term weekday (97,217 trips, 3 seeds each) finished: average trip 6.65 min on today's network
(2025: 6.29), time stopped 608 vehicle-hours (2025: 137). Against 2041 today's network: council package
+29 s per trip, time stopped +61%; Brent's package +20 s, +59%; four-lane ring road alone +6 s, +23%.

2051 high growth (22 Nov 2026): the term weekday also does not finish. All 12 runs (today's network, council
package, Brent's package, four-lane ring road; 3 seeds each) hit the 45-minute cap, as did the 1-seed timeline runs
for C3, C4 and N1. Same reading as above: demand exceeds what today's roads (plus each option) can carry, with
growth areas loaded onto existing roads.

Moderate growth, summer peak day (1 seed each, 22 Nov 2026): 2031 moderate finished for all options; 2041 moderate
finished for today's network, the council package, Brent's package and C4, but C3 (one-way loop), B3 and N1 hit the
45-minute cap; 2051 moderate jammed for all seven options tried.

Disk housekeeping (22 Nov 2026): to free disk space, the run folders in `sim/data/runs/` no longer keep the
regenerable intermediates (`routes.rou.alt.xml`, `routes.rou.xml`, `trips.xml`, `trips.snapped.xml`), and their
outputs (`vehroute`, `tripinfo`, `edgedata`, `viewer_lanedata`, `viewer_edgedata`, `teleports`) are gzip-compressed
(`*.xml.gz`). The aggregated results, viewer exports and reports are unaffected. To re-run a report that reads raw
run outputs, decompress first: `find sim/data/runs -name '*.xml.gz' -exec gunzip {} +` (or the folders you need).
