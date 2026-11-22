# Assumptions — S4-metrics

Each entry: value, reason, expected sensitivity, and what evidence would replace it. Sourced values are not listed here; they carry their source id in the data files.

## Vehicle-id separator (contract change needed in S2)

- **Value:** `~` (parser also accepts `|`, used consistently). DESIGN.md says `|`.
- **Reason:** SUMO 1.28 `duarouter` rejects `|` in vehicle ids ("Invalid trip id ... Contains invalid characters"). Checked against every printable ASCII character: `|`, `,`, `;`, `&`, `<`, `>`, `\`, `'`, `"` and space are rejected; `~ # ! + = . : - _ ^ @ $ %` are accepted. Field values themselves contain `_` (e.g. `beach_foreshore`, `poi_17`), so `_` cannot be the separator.
- **Sensitivity:** none for results; S2 must emit `~` or its trips cannot be run.

## Hour bands (`vhsim.metrics.bands.DEFAULT_HOUR_BANDS`)

| band | hours | reason |
|---|---|---|
| 00-06 | 0 to 6 | night; almost no traffic, shown so nothing is silently dropped |
| 06-09 | 6 to 9 | morning peak window |
| 09-15 | 9 to 15 | inter-peak / daytime (includes the S-D19 7am-7pm count window's middle) |
| 15-18 | 15 to 18 | afternoon/school peak |
| 18-24 | 18 to 24 | evening |
| all | whole run | every trip/movement |

Bands are on the simulation clock (seconds since midnight, mod 24 h). Accessibility bands use the actual departure time; movement bands use the time the vehicle leaves the approach edge. Reason: the 2017 counts cover 07:00-19:00, so peaks should be separable; the exact edges are a judgement and can be overridden with `hour_bands=`. Sensitivity: only presentation; "all" is unaffected.
`flow_per_hour` = n / hours-in-band assumes the simulation covers the whole band; for partial runs pass `duration_hours` (for `all`) and read band rows with care.

## Travel-time histogram bins (`accessibility.HIST_BINS`, seconds)

`0, 60, 120, 180, 240, 300, 420, 600, 900, 1200, 1800, 3600, inf` (bins `[lo, hi)`).
Reason: 1-minute resolution up to 5 minutes (most in-town trips), coarser out to 1 hour for gateway trips. Fixed (not data-driven) so scenarios compare bin by bin. Sensitivity: presentation only.

## Percentiles

`numpy.percentile` default (linear interpolation, position `p/100*(n-1)`). Different conventions differ by less than one sample spacing; with n < ~100 p99 is essentially the maximum, hence the small-n flag.

## Travel time definition

`tripinfo duration` (arrival - actual departure). Time waiting to be inserted (`departDelay`) is excluded by default and available with `include_depart_delay=True`. Reason: insertion delay at a gateway in a saturated model is a demand-side artefact; but if it becomes large the run should be treated as unreliable (see waiting-to-insert in the run summary). Sensitivity: large in congested scenarios; always check `summary["waiting"]`.

## Strata in accessibility

Only `res` and `vis` by default (task spec). `thr` (through) and `ext` trips have no local origin zone or no meaningful destination category and are excluded unless `strata=` says otherwise. Zones missing from the zone-to-area mapping go to area `"unmapped"` (not dropped), so a mapping gap is visible.

## Approach delay (`movements`)

- **Delay** = time on approach edge A − length(A) / max lane speed(A). Uses the edge speed limit, not the vehicle's own maximum, so slow vehicle types (trucks, caravans) show some "delay" that is really lower speed; negative values (speedFactor > 1) are kept, not clipped, to avoid biasing means upward.
- **Excluded:** the first edge of each route (entry time is the departure time, so it measures insertion, not approach delay) and the last edge (no movement); internal edges; non-adjacent pairs; routes without exit times. If a vehicle was rerouted, only the final route element is used.
- SUMO's exit time is when the vehicle leaves the edge at the stop line, so junction crossing time falls in the *next* edge's time. Delay therefore means queueing / give-way / slowing on the approach, not crossing time.
- **Junction id** is the node A ends at (a roundabout is several nodes: movements are per entry node; combine on the integration side with `junctions.csv`).
- Vehicle-based, so the first edge after a roundabout or a long edge with mid-edge stops includes all of that time.

## Compass and turn angles

- 8 compass points, 45° sectors centred on N, NE, E ... (N covers 337.5°-22.5°).
- `approach_dir` = side the vehicle arrives from (a southbound vehicle approaches from N); `heading_dir` = direction of travel. This matches S3's `approach_dir` (`vhsim/counts/turning.py`: "side of the diagram the approach arrives from"), so S3 and S4 rows join on it directly (S3's diagram directions are schematic, not surveyed bearings, so a 45° offset against the real net is possible at oblique junctions).
- Turn = signed change of heading `a` between A's last segment and B's first segment, wrapped to (−180, 180]: `|a| < 30°` through (T), `30° ≤ a < 150°` right (R), `−150° < a ≤ −30°` left (L), `|a| ≥ 150°` U-turn (U).
  Reason: 30° tolerates the gentle kinks of real through roads; 150° catches turnarounds, which in a SUMO net are 180° minus a small geometry offset. Sensitivity: only movements at 5-way / acute junctions (e.g. Y-junctions with 25°-35° legs) could change label; thresholds are module constants (`THROUGH_MAX_DEG`, `UTURN_MIN_DEG`). Lane-0 edge shape is used for geometry.

## Small-n threshold (`compare.MIN_N`)

30 samples per cell on either side (a missing side counts as 0). Reason: below ~30 a mean has a wide interval and p95 depends on one or two trips; p99 needs ~100 to be meaningful, so p99 cells with n < 100 should be read as "about the maximum". Flagged cells are marked `low_n` and shown shaded with a dagger in reports; nothing is dropped. Sensitivity: presentation only.

## Run settings (`run.simulate`)

- `--time-to-teleport 300` s and a failure if teleports exceed 1 % of inserted vehicles (`max_teleport_fraction`). Reason: teleported vehicles distort delays and mean the network is gridlocked or disconnected; better to stop than publish. Both overridable.
- duarouter runs with `--unsorted-input`: SUMO silently drops trips that are out of departure order. `simulate` also raises if SUMO loads fewer vehicles than duarouter wrote (non-flow files).
- edgeData is written per hour (`excludeEmpty`).
- Lon/lat trips need a geo-referenced net and use `--mapmatch.distance 200` (m) to snap to the nearest road; a lon/lat further than that from a road fails routing.
