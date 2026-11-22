# S8 — Hotspot evidence pack: method

Stream S8 (22 Nov 2026). For each hotspot, the evidence for "today's roads vs the council's package vs the
best tested alternative": waits, queues, vehicles, time stopped and travel time from the existing batch
runs; animations replayed from the same runs; congestion pictures from the engineer viewer. This year is
2026; the model's today is built on 2025 data and is labelled **now (2025 data)**; other years carry how far
ahead they are ("2031, in about 5 years").

Code: `vhsim.integration.hotspot_defs` (places, roles, animation sets), `vhsim.integration.hotspots`
(metrics), `vhsim.integration.hotspot_anim` (replays and animation export), `viewer/hotspots/player.js`
(player), `viewer/test/hotspot-shots.mjs` (pictures). Tests: `sim/tests/integration/test_hotspots.py`,
`test_hotspot_anim.py`, `viewer/test/hotspots-player.test.mjs`.

Rebuild:

```
cd sim
python -m vhsim.integration.hotspots extract --workers 6   # one pass over each run (cached)
python -m vhsim.integration.hotspots build                  # sim/data/results/hotspots/<id>.json
python -m vhsim.integration.hotspot_anim run --workers 6    # FCD replays + viewer/hotspots/data/
python -m vhsim.integration.hotspot_anim shots              # picture plan
cd ../viewer && node test/hotspot-shots.mjs                 # viewer/hotspots/img/
```

## S8-01. Where a hotspot is
- **Value:** a hotspot is one or more measuring circles (centre, radius 20–120 m) round the junctions named
  in `hotspot_defs.HOTSPOTS` (each entry says which junction ids it uses), or for the Victoria St corridor
  every node on Victoria St between longitude 138.6125 and 138.6200 (as `bottlenecks.HOTSPOTS`). An edge
  belongs to the hotspot when its **stop line** (end of its lane shape) is inside a circle, in the network
  of the scenario being measured.
- **Why:** options rebuild junctions (signals, new roundabouts, turn lanes) and rename or split edges; the
  stop-line rule measures the same ground in every scenario. A turn bay ends at the same stop line as its
  approach, so it joins its approach.
- **Sensitivity:** circles that also catch a nearby driveway or minor street add its (usually small) waits.
  Circle sizes were chosen so the approaches' last 30–50 m are inside. Where the S8 and S7 areas are the same
  the S7 totals are reproduced (Victoria St 77.4, Armstrong/Crozier 18.2 vehicle-hours on a summer day now);
  elsewhere the S8 circles are wider and catch upstream edges and nearby side streets, so S8 totals are
  higher than the S7 hotspot table's (summer now: oval roundabout 15.8 vs 5.6, McCracken 22.7 vs 10.2,
  Torrens St roundabouts 43.7 vs 33.5; 2041 high weekday Armstrong/Greenhills 15.6 vs 12.0). Compare
  scenarios within one table, not S7 figures with S8 figures.

## S8-02. Approaches
- **Value:** approaches are grouped by street name and the side traffic comes from (compass point opposite
  the direction of travel on the last segment of the approach's stop-line edge), per measuring circle
  ("site"). An approach split into pieces (an upstream edge and a turn bay or flare, as in N3) is one
  approach: an edge whose end node has no other way out and where the street continues takes the group of
  the edge it feeds. Unnamed edges are "access road" (car parks, service stations) or "roundabout" (ring
  edges, including the S7 rings).
- **Sensitivity:** a curving approach can land in the neighbouring compass sector in a rebuilt network; the
  comparison then falls back to the same street and side anywhere in the hotspot.

## S8-03. Metrics (all from the batch runs' own outputs)
- **Approach wait** (seconds per vehicle; mean and 95th percentile): per vehicle, the sum over the approach's
  edges inside the hotspot of (time on the edge − length / speed limit), from `vehroute.xml` exit times: the
  R15 approach delay (integration I2). The edge a vehicle starts on is not counted. Seeds pooled. Two
  consequences: crossing the previous junction is counted in the next edge, so even a free approach shows
  about 1 s; and time waiting *inside* the junction (right-turners at the turn line) is counted on the exit
  edge, which is usually outside the hotspot, so right-turn waits are somewhat understated.
  `peak15_mean_wait_s` is the same for vehicles leaving the approach in the hotspot's peak quarter-hour.
- **Queue** (peak 15 minutes): laneData (`viewer_lanedata.xml`, 15-minute periods) waitingTime / 900 s =
  vehicles standing still (< 0.1 m/s) on average during that quarter-hour, summed over the approach's lanes;
  metres = vehicles × 7.5 m (a 4.6 m car plus its 2.5 m gap, rounded up for the trucks and caravans). The
  hotspot's peak quarter-hour is the one with most time stopped over all its lanes (seed mean). This is an
  **average** over 15 minutes, so the longest queue at any moment is longer; the animations show the
  moment-to-moment queue (seed 1).
- **Vehicles per day:** distinct vehicles with a wait counted on the approach (so not those that start on
  it), per seed; with trucks, caravans and buses separately.
- **Time stopped** (vehicle-hours a day): laneData waitingTime on all the hotspot's lanes / 3600 (no
  internal lanes, as the S7 edgeData figures: time waiting inside a junction, mostly right-turners at the
  turn line, is not included).
- **Travel time through:** from entering the first hotspot edge (exit time of the edge before) to leaving
  the last, for vehicles that enter from outside and leave again (mean and 95th percentile), and the same
  minus free-flow time (`mean_delay_s`). Different paths through the area are pooled, so this changes when
  an option changes the paths (the one-way loop).
- **Seeds and jams:** now (2025 data) has 3 seeds for every scenario; 2031 has 1 seed; 2041 high growth
  1–3 (weekday only). A run is **jammed** when it hit the `VHSIM_SUMO_TIMEOUT` cap, was stopped before the
  end of the day (2041 high summer, A-INT-05), or exceeded the batch's 5% teleport limit; jammed runs give
  no metrics and are flagged (`jammed`, `jammed_seeds`); when only some seeds jam, the metrics come from the
  others and `partial` is true (none so far).
- **Hours:** `hourly_stopped_veh_h` has 26 values (00:00 to 26:00, the simulated day ends at 02:00 next
  morning).

## S8-04. Scenarios and roles
- Every hotspot reports today's network (`baseline`), the council package (`cp`), the council component
  acting there (`c3` one-way loop or `c4` signals, when one does), Brent's package (`bp`), the hotspot's
  alternative (the best tested option there, or the option built for it when none helps: Victoria St →
  N8), plus N9 and N7, the two best options overall. Periods: summer peak day and term weekday, now,
  2031 moderate and high growth, and 2041 high growth (weekday only; the 2041 high-growth summer day jammed
  for every option tried there: today's network, CP, BP and B3; N3, N4, N7 and N9 were not tried).
- **2031 gap runs (22 Nov 2026):** N3, N4, N7 and N9 had no 2031 runs; they were run with
  `python -m vhsim.integration.batch --scenarios n3 n4 n7 n9 --conditions weekday_term summer_peak --year
  2031 --growth moderate|high --seeds 1` and `VHSIM_SUMO_TIMEOUT=2700`, as the other 2031 runs.

## S8-05. Animations
- **Replay:** the batch run's own SUMO command (first line of its `sumo.log`: same network, routes, seed
  1, A-INT-02/03 settings) with its outputs replaced by an FCD output restricted to the hotspots' view
  squares (`--fcd-output.filter-shapes`, lon/lat) from the window start, ending at the window end. SUMO is
  deterministic for a given seed and inputs; each replay also writes a tripinfo file and the share of its
  arrivals from the hour before the window onwards that are identical (time and route length) to the batch
  run's is recorded as `same_as_batch` (1.0 for all 33 animation files).
- **Window:** 15 minutes, the quarter-hour with most time stopped on the hotspot's lanes in the three seed-1
  runs shown, added together (laneData), so the same clock time is shown side by side and it is the
  busiest moment of the runs actually animated. It can differ from the seed-mean peak in the numbers.
- **Export:** positions every second, local metres (x east, y north, centred on the hotspot) quantised to
  0.5 m and delta-encoded per vehicle (a run of still frames is one marker); vehicle kind (car, truck,
  caravan, bus) and initial heading; the player derives heading and speed from the motion, so "stopped" in
  the player is under about 0.5 m/s (1.8 km/h). Queue counters: vehicles below 0.1 m/s (SUMO speed) on the
  lanes of the approaches that queue most in that window, counted only inside the picture, so a queue longer
  than the picture (Crozier Rd at Armstrong Rd reaches about 190 m) is undercounted. Trucks and caravans are
  drawn 1.5 times their size so they can be picked out; this makes queues with many of them look longer.
  Geometry: that scenario's lanes and junction areas in the view.
- **Sensitivity:** one seed. Summer runs vary ±5–12% between seeds now (S7) and single 2031 runs much more
  at busy hotspots (Victoria St today's network: 193 vehicle-hours at moderate growth, 178 at high), so a single 15-minute window can
  look better or worse than the 3-seed average; the panels show the whole-day time stopped (3-seed mean
  for now) under each animation for context.

## S8-06. Pictures
`viewer/test/hotspot-shots.mjs` opens the engineer viewer (real results, bundled base map with landmarks) at
the hotspot's view and the animation window's quarter-hour: congestion as "vehicles queued" (15-minute
average) for each of the three scenarios, and the difference maps (council − today, alternative − today).
The viewer shows seed means for now and the single seed for 2031.

## Caveats (apply to every hotspot)
- Differences between options on the same demand, not forecasts (A-INT-04): Victoria St is over-loaded
  about 1.5×, the town centre somewhat under-loaded.
- Gap acceptance at give-way junctions and roundabout entries is SUMO's model with the A-INT-02 impatience
  settings; not checked against observed waits.
- Route choice is by travel time only (A-INT-03), with no reluctance to use residential streets, so
  diverted volumes (Acraman St, Lindsay St) may be on the high side.
- No pedestrians, buses stopping, parking manoeuvres or level-crossing closures are simulated; events (New
  Year's Eve) are not run.
