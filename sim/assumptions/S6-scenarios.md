# Assumptions — S6 scenario networks

How each option in `sim/SCENARIOS.md` is turned into a network. Each entry: what changed (edges,
km), why, what is inference, how sensitive results are likely to be, and what would replace it.

Build: `python -m vhsim.scenarios.build <name|all> [--smoke]` from `sim/`. Definitions live in
`vhsim/scenarios/defs.py`; the generated netconvert patches (committed, reviewable) are in
`sim/data/networks/patches/<name>/` with `meta/summary.json` (edges and km changed, checks). The
network a run should use is `sim/data/networks/<name>_bays.net.xml`: baseline plain files +
patch, then the A-INT-01 right-turn bays added from the scenario's own plain files, so every
scenario has the same bay rule as `baseline_bays`. Edge ids are the original OSM-derived ids
(bays add `<id>.bay`, as in the baseline), so edge-level metrics and viewer joins work unchanged
**except at rebuilt junctions**: at the C4/CP signal sites the baseline's R15 movement rows are
keyed on ring nodes and ring edges, the scenario's on `s6_signal_*` and the exit edge, so a plain
`(junction_id, from_edge, to_edge)` join finds no match there; under B5, left-turners leave the
approach edge for the slip (their delay sits at the upstream node, feeder -> slip).
`meta/summary.json` has `junction_aliases` (new node/edge id -> named junction in
`junctions.csv` and the baseline ids it replaces); compare those sites per approach, summed over
exits and including slip feeders.

Out of scope here: C5 (outer freight ring road) and C6 (demand-side activity centre) are not
built; C2b (10 km/h), C4b (three-lane signal approaches) and an N1 half-closure are not built.
Where this file differs from `sim/SCENARIOS.md` (BP without B2, C4 without a pedestrian phase),
this file records what the networks contain.

Every scenario network is checked for: drivable between all gateways for passenger and truck
(`vhsim.network.checks.drivable_edges` = every edge), roundabouts complete, and a 30-minute smoke
run (750 trips concentrated on the town centre and gateways, 10% trucks) in which every vehicle
arrives without a jam teleport.

## S6-01. Town-centre area polygon (C1, C2)
- **Value:** `sim/data/networks/patches/areas/town_centre.geojson`. Traced from the VHITS
  town-centre map (S-A04c / S-B03 p.93): the map was georeferenced from the Torrens/Seaview/Eyre
  and Torrens/Crozier roundabouts and checked on Coral St / Flinders Pde (agrees within a few
  metres). The shading is bounded by Torrens St (north-west), Eyre Tce (north-east), the foreshore
  east of Flinders Pde, the coast south of the Esplanade, Albert Pl (west side of the southern
  part) and Crozier Rd between Torrens St and Victoria St (south-west). Each side was moved 10–25 m
  outward so the streets the shading is drawn along fall inside. An edge is "inside" when at least
  half its length is.
- **Inside (baseline):** Albert Pl, Coral St, Crozier Rd (Torrens St to Victoria St), Esplanade
  (Flinders Pde to Albert Pl only), Eyre Tce, Flinders Pde, McKinlay St, Ocean St, Railway Tce,
  Stuart St, the boat-ramp road, Granite Island Rd car-park lanes (already 20 km/h), Torrens St
  (both carriageways, Seaview to Crozier roundabouts), 13 m of Victoria St at Crozier Rd.
- **Inference:** the map shows shading only; the boundary streets are our reading. Torrens St
  south of the Crozier roundabout, the Esplanade west of Albert Pl, Wills St, Torrens Lane, Hill
  St, Seaview Rd and Hindmarsh Rd are outside.
- **Sensitivity:** low-moderate — the bounding streets are short; Eyre Tce and Flinders Pde carry
  most of the affected traffic.

## S6-02. C1a / C1b — 30 km/h
- **C1a:** every inside edge whose limit is above 30 km/h set to 30 km/h; edges already at or
  below 30 (car-park lanes 20, roundabout rings 18–20) unchanged. Excluded: Victoria St and Torrens
  St by name, and every trunk/primary edge (Torrens St's median-crossing links and roundabout
  rings), as DIT freight/strategic routes (S-D08, S-D22). **56 edges, 3.4 directed km.**
- **C1b:** as C1a plus Torrens St inside the area (both carriageways between the Seaview/Eyre and
  Crozier roundabouts, and their median links) at 30 km/h. Torrens St south of the Crozier
  roundabout is outside the shading and keeps 50. **72 edges.**
- **Not modelled:** traffic calming, signage compliance. SUMO drivers follow the limit with the
  usual speed-factor spread, so the effect is an upper bound on the travel-time cost if real
  compliance is lower.

## S6-03. C2 — 20 km/h shared zones
- **Value:** Ocean St, Albert Pl and Railway Tce inside the area at 20 km/h (**11 edges**).
  Within CP, C2 overrides C1a's 30 on those streets (the lower limit wins).
- **Not modelled:** pedestrian priority / crossing delay at Ocean St / Coral St. The model has no
  pedestrians, so the shared zone appears only as a lower speed. This understates the delay to
  vehicles; C2b (10 km/h) is not built yet.

## S6-04. C3 — one-way outer loop (clockwise)
- **Value:** the carriageways running against the loop are removed (cars and trucks alike):
  - Torrens St one-way north-east from Victoria St to the Seaview/Eyre roundabout — the whole
    south-west-bound carriageway and its links (`576495725#0`, `576495725#2`, `576495721#0`,
    `576495721#1`, `50904910#0`, `50904910#2`, `1202918967#0`, `1202918967#1`, `-173449378`,
    `50904911`);
  - Eyre Tce one-way south-east (`184390356`, `-50904907#1`, `-50904907#5`);
  - Flinders Pde one-way south from Eyre Tce to the Esplanade (`23075179#5`, `23075179#1`,
    `23075179#0`);
  - Esplanade one-way west from Flinders Pde to Albert Pl (`-184389891#1`, `-184389891#2`).
  - Removed because the change leaves them without access: the Torrens St median link to Hill St
    from the removed carriageway (`173449330`) and a 22 m car-park access off it
    (`±1204648898`).
  **21 edges, 1.1 directed km.** Roundabouts stay roundabouts. Victoria St, Albert Pl and every
  internal street keep their current directions (Ocean St, Stuart St, McKinlay St and Railway Tce
  are already one-way and none conflicts with the loop: they feed it).
- **Inference:** street names and direction are our reading of the map's arrows (S-A04c). The
  map's return arrow runs north up Albert Pl and west to Victoria St; we keep Albert Pl two-way
  (it is the only access from Victoria St to Railway Tce and the southern Ocean St, and
  SCENARIOS.md keeps Victoria St two-way). A stricter reading (Albert Pl one-way north/west) is
  not built.
- **Consequences to watch:** traffic from Hindmarsh Rd to Ocean St's main block now enters only by
  the right turn from Torrens St (north-east) into Ocean St (`vhfix_torrens_ocean_right`) after
  going round via Eyre Tce, Flinders Pde, Esplanade, Albert Pl and Victoria St, or via Coral St
  for the southern block. The Seaview/Eyre roundabout loses its Torrens St exit and Eyre Tce entry.
- **Tests:** loop streets one-way in the loop direction; Victoria St and internal streets keep all
  their edges; connected for cars and trucks; a car from Hindmarsh Rd reaches both Ocean St
  blocks and leaves to Victoria St westbound (Encounter Bay); a truck from Victor Harbor Rd to
  Inman Valley Rd uses Welch Rd / Armstrong Rd and none of the loop streets.
- **Sensitivity:** high for town-centre travel times and for Victoria St / Albert Pl volumes.

## S6-05. C3b — anticlockwise loop
- Mirror of C3: Torrens St one-way south-west (north-east carriageway removed), Eyre Tce one-way
  north-west, Flinders Pde one-way north, Esplanade one-way east. The right-turn link from Torrens
  St into Ocean St (`vhfix_torrens_ocean_right`) and a car-park access (`±1204058675`) lose their
  access and are removed; Ocean St is entered directly from the south-west carriageway.
  **23 edges, 1.2 directed km.**

## S6-06. C4 — signals at Torrens/Seaview/Eyre/Hindmarsh and Torrens/Crozier
- **Value:** at each site the roundabout's ring edges (8 + 8, `173449320#1–8`, `1202918969#1–8`)
  and ring nodes are removed and the 8 approach/exit edges per site are joined at one new node
  (`s6_signal_torrens_eyre_seaview_hindmarsh`, `s6_signal_torrens_crozier`) at the ring's centre,
  type traffic_light, actuated. Approach shapes are trimmed at the old ring and run to the centre.
  Lanes: the existing approach lanes (one per approach), no land taken.
- **Signal plan:** generated by netconvert (`--tls.default-type actuated --tls.cycle.time 90`):
  two green phases (opposite approaches together, turns permissive) of 42 s + 3 s yellow each.
  The build then sets every phase's maxDur to its duration, so actuation can shorten phases but
  the cycle never exceeds 90 s. Movements: every movement the roundabout allowed (including
  U-turns, which the roundabout gave) is kept and no other; the test checks this per approach.
- **Inference / not modelled:** the council named the sites (S-A03) but published no design. No
  pedestrian phase on Torrens St (no pedestrians in the model), no turn arrows, no all-red — these
  favour the signals. Against them: each approach is one shared lane and gets **no** A-INT-01
  right-turn bay (bays are added only at give-way junctions), so a right-turner filtering through
  oncoming traffic blocks everyone behind it. On balance C4/CP delays at these two sites are
  likely **biased against the signals**; a variant with the bay rule on signal approaches would
  test it. C4b (three lanes per approach at Seaview/Eyre, S-D21 s13.3.14) not built.
- **Sensitivity:** high for delay at both sites and for Torrens St queues; the phase split is
  netconvert's default, not an optimised plan.

## S6-07. CP — council town-centre package (C1a + C2 + C3 + C4)
- **Value:** the four components merged: a removed edge stays removed (C3 wins over C1a/C4 changes
  to it), on edges with two limits the lower wins (C2's 20 over C1a's 30), and C4's signals keep
  every roundabout movement whose approach and exit the loop leaves. With the loop, the Seaview/
  Eyre signal has 3 approaches (Hindmarsh Rd, Seaview Rd, Torrens St NE) and 3 exits; the
  Crozier signal keeps both Crozier Rd legs and Torrens St NE. netconvert again builds two
  42 + 3 s phases (90 s cycle).
- **Changed:** 11 edges to 20 km/h (0.9 km), 37 edges to 30 km/h (1.8 km), 37 edges removed (C3's
  21 and C4's 16 ring edges), 2 signals. 4.1 directed km touched in all.

## S6-08. Widening and connections (B3, B4)
- When a patch changes an edge's lane count, its baseline connections (lane-specific) are dropped
  and netconvert recomputes them for every lane (`vhsim.network.scenario`); the build then removes
  any movement netconvert adds beyond the baseline's, so turn bans survive (a movement still extra
  or missing after that fails the build). None had to be removed for B3/B4. Widened edges are no longer one-lane, so they get no A-INT-01 turn bay.

## S6-09. B3 — four-lane ring route
- **Value:** every Welch Rd and Armstrong Rd edge (36 directed edges, 11.4 directed km ≈ 5.7 km
  of road) gets two lanes per direction; speed limits unchanged (60/100 km/h, 50 near George Main
  Rd). Junctions along it keep their control: the Armstrong/George Main/Inman Valley roundabout
  and the Welch/Victor Harbor Rd end stay single-lane, so the extra lane merges there (lane drop).
- **Inference:** the Jan 2026 "duplication" note (S-B31) gives no design; whether junctions would
  be upgraded is unknown. Results show link capacity, not junction capacity.

## S6-10. B4 — two-lane McCracken roundabout
- **Value:** the Adelaide Rd / Hindmarsh Rd / Port Elliot Rd roundabout's 8 ring edges get two
  circulating lanes; the Adelaide Rd and Hindmarsh Rd entries get two lanes for the last
  ≈115 m before the give-way line (Adelaide Rd `53706691#1`, `53706691#0`, `74654896#6`;
  Hindmarsh Rd `53706695`, `173449332#16`): 13 edges, 0.29 directed km. Port Elliot Rd entry and
  all exits stay one lane. Lane use (which entry lane may go where) is netconvert's default for
  a two-lane roundabout.
- **Inference:** flare length (≈115 m, at least 100 m) is our choice; a real two-lane entry flare
  is typically 30–80 m, so this is generous to B4.

## S6-11. B5 — left-turn slip lanes
- **Value:** at the Torrens/Seaview/Eyre/Hindmarsh and Torrens/Crozier roundabouts, every left-turn
  movement (heading change 30–150° to the left; 4 per site, all of which exist today) gets a
  one-lane bypass edge `s6_slip_<approach>_<exit>` from the approach's upstream node to the exit's
  downstream node, following the approach and exit kerb lines and bowing out through a point 5 m
  outside the ring (a test checks every slip stays outside the ring). Everything that fed the
  approach (except by U-turn) may enter it from the kerb lane; it continues wherever the exit did
  (except U-turns) and gives way where it rejoins (priority 1). The roundabouts are unchanged; the
  left turn through the ring remains possible.
- **Speed:** the approach road's posted limit (50 km/h), an **upper bound**: a real slip's curve
  (radius ≈ 20 m) holds cars to roughly 35–40 km/h, which SUMO does not apply on a plain edge.
- **Routing caveat (important for reading B5):** runs originally routed once on free-flow costs; rerouting is now the default for all runs (A-INT-03), so slip lanes are used when queues build
  (duarouter), in which the roundabout's yield delay is nearly invisible. With this geometry the
  free-flow router sends only 4 of the 8 left turns through their slips (from Eyre Tce, Seaview Rd
  and both Crozier Rd legs); at 30 km/h it used none. So B5's benefit shows only with load-aware
  routing (SUMO `--device.rerouting` or duaIterate), which applies to every scenario that adds a
  way round queueing; integration should run B5/BP that way, or treat single-pass B5 results as
  a lower bound on use and an upper bound on slip speed.
- **Inference:** where the slip starts and ends is set by the existing OSM nodes, not a design:
  the Torrens St south-west slip at Crozier Rd starts at the Coral St junction (51 m back).
  Type `highway.trunk_link`, so no A-INT-01 bay is added on it.

## S6-12. BP — Brent's package
- **Built:** B3 + B4 + B5 (49 edges widened, 11.7 directed km; 8 slip lanes; B5's routing caveat
  applies). B2 (timed speed
  zones) is a run-time variant (speeds changed by time of day), not a network, so it is not part
  of the BP network.

## S6-13. N1 — Grantley Ave rail crossing closed
- **Value:** the level crossing (OSM node 1948692262) is on the 17 m link (OSM way 184390360,
  unnamed) that continues Grantley Ave east across the railway from Hindmarsh Rd to Bridge Tce.
  Both directions (`184390360#0`, `-184390360#1`, 34 directed m) are removed for all motor
  vehicles. Grantley Ave keeps its junction with Hindmarsh Rd; Bridge Tce traffic reaches
  Hindmarsh Rd by other streets (Bridge Tce north, or Eyre Tce and the Seaview/Eyre roundabout).
- **Inference:** "close" read as a full closure (S-D21 s13.3.15). The 2017 left-in/left-out trial
  (S-D19) is a half-closure variant, not built.
- **Sensitivity:** moderate for the Seaview/Eyre roundabout and Bridge Tce; nil elsewhere.

## Scenario summary (baseline 4,683 edges after bays; all pass connectivity and smoke)

| Scenario | Change | Edges | Directed km |
|---|---|---|---|
| C1a | 30 km/h town centre, not Torrens/Victoria St | 56 speed | 3.4 |
| C1b | C1a + Torrens St in the area | 72 speed | 4.0 |
| C2 | 20 km/h Ocean St, Albert Pl, Railway Tce | 11 speed | 0.9 |
| C3 | clockwise one-way loop | 21 removed | 1.1 |
| C3b | anticlockwise loop | 23 removed | 1.2 |
| C4 | 2 roundabouts → actuated signals | 16 ring edges removed, 16 rejoined, 2 TLS | — |
| CP | C1a + C2 + C3 + C4 | 48 speed, 37 removed, 2 TLS | 4.1 |
| B3 | Welch + Armstrong Rd 2 lanes each way | 36 widened | 11.4 |
| B4 | McCracken roundabout 2 lanes, 2-lane entries | 13 widened | 0.3 |
| B5 | left-turn slip lanes at the two Torrens St roundabouts | 8 added | 0.4 |
| BP | B3 + B4 + B5 | 49 widened, 8 added | 12.1 |
| N1 | Grantley Ave rail crossing closed | 2 removed | 0.03 |
