# S7 — Where the delay is, and targeted options aimed at it

Stream S7 (integration, 21–22 Nov 2026). Part 1 diagnoses where the simulated delay is on today's
network; part 2 defines options aimed at those places (ids N2–N9 in `sim/SCENARIOS.md`); part 3 gives
their results against today's network, the council's package (CP) and Brent's package (BP). Each
assumption has a value, a reason and how sensitive results are to it.

Tools: `python -m vhsim.integration.bottlenecks diagnose|hotspots ...` (from `sim/`; outputs in
`sim/data/results/s7_diagnosis/`). Measure: **vehicle-hours stopped** (SUMO edgeData `waitingTime`,
speed below 0.1 m/s), the same quantity as the "time stopped" in `report_2025_base/summary.csv` but
summed per edge, seed mean of 3 runs. The edgeData total is a little below the trip total (440 vs 460
vehicle-hours in summer 2025) because edgeData is written without internal lanes
(`vhsim.metrics.run`): time stopped *inside* a junction, mostly right-turners waiting at the turn
line, is on no edge. Per-approach and hotspot figures therefore slightly undercount right-turn waits;
the trip totals in part 3 include them.

## 1. Diagnosis (today's network)

### Totals and time of day

| Run (today's network, 3 seeds) | Vehicle-hours stopped / day (edgeData) | Worst hour | Share 10:00–17:00 |
|---|---|---|---|
| 2025 term weekday | 128 | 12:00–13:00 (19) | 83% |
| 2025 summer peak day | 440 | 12:00–13:00 (84) | 87% |
| 2041 high growth, term weekday | 584 | 12:00–13:00 (116) | 89% |

Delay is a **midday** problem (the counts' midday peak, S3), not a commuter-peak one. In summer
it builds from 09:00, peaks at 12:00–13:00 and stays high until 16:00.

### Hotspots (vehicle-hours stopped per day)

A hotspot is a bottleneck's whole queue: every approach (and its turn bay) ending at the listed
junction nodes. Definitions in `vhsim.integration.bottlenecks.HOTSPOTS`. Edges a scenario adds
other than S7 ring edges (e.g. the B5/BP slip lanes `s6_slip_*`) belong to no hotspot, so for B5/BP
the hotspot figures leave out waiting on the slips; the network total includes it.

| Hotspot | 2025 weekday | 2025 summer | 2041 high weekday |
|---|---|---|---|
| Victoria St, Bay Rd to Torrens St (its own through approaches, side streets, car-park accesses) | 22.4 | 77.4 | 110.2 |
| Hindmarsh Rd side streets north of the town centre (Wattle Dr, The Drive, Renown Ave, The Parkway, Adare Ave, Peace Ave, Rupara Ave) | 15.2 | 48.8 | 39.4 |
| Hindmarsh Rd / Grantley Ave / Bridge Tce (rail-crossing link) | 5.4 | 32.6 | 20.3 |
| Torrens/Seaview/Eyre roundabout + Eyre Tce / McKinlay St | 6.1 | 28.7 | 24.5 |
| Armstrong Rd / Crozier Rd | 3.0 | 18.2 | **54.3** |
| Torrens St / Coral St | 5.1 | 12.2 | 13.9 |
| McCracken roundabout | 4.9 | 10.2 | 9.3 |
| Crozier Rd / Burke St | 1.4 | 9.3 | 15.0 |
| Bay Rd / Victoria St / George Main Rd roundabout | 2.2 | 5.6 | 5.5 |
| Torrens St / Crozier Rd roundabout | 1.7 | 4.8 | 5.5 |
| Armstrong Rd / Greenhills Rd | 0.5 | 1.6 | 12.0 |
| **All eleven** | 68 (53%) | 249 (57%) | 310 (53%) |
| Network total | 128 | 440 | 584 |

The rest (about 45%) is spread thinly over hundreds of give-way junctions, driveways and car-park
exits, none above about 6 vehicle-hours a day.

### Top approaches (2025 summer peak day)

| Junction | Approach | Vehicles/day | Veh-h stopped | s stopped / vehicle | Worst hour |
|---|---|---|---|---|---|
| Bridge Tce at the Grantley Ave crossing | Bridge Tce `217056482#0` | 2,755 | 23.1 | 30 | 15:00 |
| Armstrong Rd / Crozier Rd | Crozier Rd `39946279` | 3,182 | 14.8 | 17 | 12:00 |
| Victoria St at the IGA car-park entry | Victoria St eastbound `173449383#3` | 9,588 | 13.4 | 5 | 15:00 |
| Victoria St at the IGA car-park entry | car-park exit `-1432093544` | 992 | 11.3 | 41 | 11:00 |
| Granite St / Victoria St | Granite St `42530572#1` | 1,218 | 10.8 | 32 | 11:00 |
| Hindmarsh Rd / Wattle Dr | Wattle Dr `-43152356#0` | 1,006 | 10.2 | 37 | 11:00 |
| Torrens/Seaview/Eyre roundabout | Eyre Tce `184390356` | 2,616 | 9.6 | 13 | 12:00 |
| Eyre Tce / McKinlay St | McKinlay St `42645831#7` | 1,845 | 8.7 | 17 | 12:00 |
| Crozier Rd / Burke St | Burke St `1242247847#2` | 1,842 | 8.4 | 16 | 12:00 |
| Victoria St / Oval Rd | Victoria St eastbound `173449383#0` | 10,870 | 8.3 | 3 | 11:00 |
| Hindmarsh Rd / Grantley Ave | crossing link `-184390360#1` | 2,154 | 8.1 | 14 | 12:00 |
| Victoria St / Oval Rd | Victoria St westbound `1242247851#0` | 12,096 | 7.3 | 2 | 12:00 |
| Torrens St / Coral St | Coral St `60269602#2` | 1,387 | 7.0 | 18 | 12:00 |
| Bay Rd / Bartel Blvd | Bartel Blvd `-183540840#0` | 3,246 | 6.5 | 7 | 12:00 |
| Hindmarsh Rd / Renown Ave | Renown Ave `46824061#2` | 794 | 6.4 | 29 | 12:00 |

(2025 weekday and 2041 tables: `sim/data/results/s7_diagnosis/*__approaches.csv`.)

### What the delay is

1. **Side-street right turns onto busy one-lane arterials** are most of it. Movement detail
   (`movements.csv`, summer 2025): Bridge Tce traffic turns left into the 17 m Grantley Ave crossing
   link (50 s mean wait) and then right onto Hindmarsh Rd (20 s) — the link holds two cars, so the
   right-turners' wait backs up into Bridge Tce. Wattle Dr right onto Hindmarsh Rd: 48 s. Granite St
   right onto Victoria St: 45 s. Coral St right onto Torrens St: 27 s. Crozier Rd onto Armstrong Rd:
   left 32 s and right 25 s (left-turners queue behind right-turners in the one shared lane).
2. **Victoria St between Bay Rd and Torrens St** is a chain of closely spaced give-way junctions and
   car-park accesses on a one-lane-each-way street carrying 10,000–12,000 vehicles a day in summer:
   2,400 a day turn left into Oval Rd (17 s each, slowing the through lane), 980 turn left into the
   IGA car park (1,400 at 2041 high growth), the car-park exit waits 41 s, Granite St's right turn 45 s, and the westbound queue
   from the Bay Rd roundabout entry reaches back 120 m. **Caution:** the calibration over-loads
   Victoria St (1.53 x the DIT count, A-INT-04) and models the car parks with a few OSM service roads,
   so this hotspot is the least trustworthy; a real fix here needs the car-park access design, which the
   model cannot test.
3. **The roundabouts are not the main problem today.** Mean approach delay at the two Torrens St
   roundabouts (Seaview/Eyre and Crozier) is 3–8 s on most approaches; the exceptions are Eyre Tce
   (13 s weekday, 20 s summer), Seaview Rd (8 / 13 s) and Crozier Rd from the west (5 / 8 s); at
   Torrens/Victoria/Wills, Wills St 7 / 10 s; at McCracken the three main legs 3–8 s (a minor leg
   9 / 14 s); at Bay Rd 2–7 s (`report_2025_base/intersections.csv`). This is
   why the council's signals (C4) and Brent's slip lanes (B5) do not help: they replace or bypass
   junctions that are not where the queues are.
4. **At 2041 high growth the ring road's give-way junctions fail.** Armstrong Rd / Crozier Rd becomes
   the worst junction in town (54 vehicle-hours; Crozier Rd waits 53 s a vehicle, its left-turners
   92 s); Armstrong Rd / Greenhills Rd grows from 0.5 (2025 weekday) to 12. The growth areas load onto the rural roads
   north of the ring (Waggon Rd, Day Rd, Greenhills Rd, Fuller Rd; S2 M3/M15) and cross or join the
   ring road at these give-way junctions. Both packages make this worse: CP 92, BP 106, B3 alone 92
   vehicle-hours at Armstrong/Crozier (more traffic on the ring road, fewer gaps for Crozier Rd).

## 2. Options and their assumptions

General: every option is a netconvert patch over the baseline (`vhsim.scenarios.defs`, patches in
`sim/data/networks/patches/<id>/`, built with `python -m vhsim.scenarios.build <id> --smoke`), then the
A-INT-01 turn bays as for every scenario. All pass the connectivity checks and the 30-minute smoke run.

### S7-01. New single-lane roundabouts (N2, N4, N5)
- **Value:** the priority junction is replaced by a ring of one node per leg on a circle of radius *r*
  round the old junction, one-lane ring edges running clockwise, approach and exit edges trimmed to
  the circle (`roundabout()` in `defs.py`, geometry in `vhsim/scenarios/s7.py`). The old junction's
  connections are dropped and netconvert computes the roundabout's (every movement stays possible;
  U-turns become possible). Ring speed follows the baseline's own single-lane roundabouts,
  v² = 2.9 r (m/s; 20 m → 27 km/h, 12 m → 21 km/h, 15 m → 24 km/h). Ring nodes are recorded as
  aliases of the named junction (`meta/summary.json` `junction_aliases`) so the R15 tables find them.
- **Radii:** N2 Armstrong/Crozier 20 m (as McCracken 18.8 m and Armstrong/George Main 25.4 m, rural
  100 km/h road); N5 Armstrong/Greenhills 15 m (the next Armstrong Rd node is 30 m north; 20 m would leave a
  9 m stub before it, 15 m about 14 m); N4 Hindmarsh/Grantley 12 m (urban, between the Torrens St roundabouts' 9–11 m
  and McCracken).
- **N4 placement:** the crossing link from Hindmarsh Rd to Bridge Tce is 17 m long. The ring centre
  is moved 8 m west (away from the railway) so about 13 m of link remains between the ring and Bridge
  Tce. Real design would need the roundabout's footprint west of Hindmarsh Rd (land) and level-crossing
  protection: queues from the ring would otherwise stand on the crossing (they already do today with
  the give-way). **Inference** — no design exists.
- **Not modelled:** approach speed reduction signs before a rural roundabout (SUMO slows vehicles at
  the ring anyway), entry deflection, pedestrians.
- **Sensitivity:** moderate for delay at the junction (gap acceptance at a roundabout entry vs a
  give-way T is SUMO's model, with the A-INT-02 impatience settings); low elsewhere.

### S7-02. Approach flares and turn lanes (N3, N8)
- **Value:** the approach edge is split so its last 40 m (at most half the edge; netconvert then cuts
  the junction area, leaving 28–41 m) have two lanes, the new end edge named `<id>.bay` like the
  A-INT-01 bays. N3 (Crozier Rd at Armstrong Rd): kerb lane left turns, median lane right turns.
  N8 (Victoria St eastbound into Oval Rd `173449383#0` and into the IGA car park `173449383#3`): kerb
  lane for the left turn only, median lane for through traffic, so slowing left-turners no longer hold
  up the through lane.
- **Inference:** lengths are our choice (a typical short turn lane); widths and land not checked.
- **Sensitivity:** low-moderate; SUMO's lane-change model decides how early drivers move over.

### S7-03. No right turn out (N6)
- **Value:** the right-turn movement out of Granite St (onto Victoria St), Coral St (onto Torrens St)
  and Wattle Dr (onto Hindmarsh Rd) is removed.
- **Selection:** the side-street right turn with the most vehicle-hours on each of the three arterials
  through or next to the town centre (summer 2025 movements: Granite St 13.0, Wattle Dr 10.6, Coral St
  8.0 vehicle-hours a day). Not included: Burke St onto Crozier Rd (14.7; Crozier Rd is a local road,
  not an arterial) and Bartel Blvd / Harbour View Tce onto Bay Rd (10.3 / 8.9; Bay Rd was left for a
  later variant). Renown Ave onto Hindmarsh Rd has a longer wait per vehicle (38 s) than Coral St but
  fewer vehicles. Drivers re-route (A-INT-03 rerouting) — typically left
  then round the next roundabout, or via a parallel side street.
- **Sensitivity:** where the displaced right-turners go decides the result; the model chooses by travel
  time, real drivers may also pick routes through residential streets the model under-uses.

### S7-04. Cost classes
- **Value:** $ under $0.5 M (line marking, signs, short widening), $$ $0.5–3 M (one roundabout on an
  existing road reserve), $$$ $3–10 M (two roundabouts, or one needing land and rail-crossing work).
- **Why:** an order-of-magnitude label so options can be compared; not from a source and not a cost
  estimate. Replace with council or DIT estimates.
- **Sensitivity:** none for the simulation results; affects only how options are ranked for value.

### S7-05. Options considered and not built
- **Roundabout metering signals (holiday peaks only):** metering helps an entry starved by one dominant
  circulating flow. Only the Eyre Tce entry at the Torrens/Seaview/Eyre roundabout shows that pattern
  (13–20 s a vehicle, about 10 vehicle-hours on a summer day); metering the Hindmarsh Rd flow would
  move part of that delay to Hindmarsh Rd. The possible gain is small next to the hotspots above.
- **Properly designed signals (turn bays, protected turns) at the C4 sites:** the two roundabouts
  carry their load with 3–8 s average delay on most approaches (Eyre Tce and Seaview Rd 13–20 s in
  summer); their hotspot totals are 5–30 vehicle-hours a day, so even a signal design that removed
  all of it would be a small gain, and C4 as built added 20–25%. Not a target.
- **Link road giving growth area 1 a second way out:** the demand model loads the growth areas onto
  existing rural roads (no estate streets, S2 M3/M15), so any new link's connection points would be
  invented. N2/N5 treat the junctions that growth traffic actually uses in the model.
- **Signed caravan/heavy-vehicle route; seasonal traffic management:** heavy vehicles on the foreshore
  are few in every run (R23a table, `foreshore.csv`) and seasonal management (event road closures,
  marshals) has no measurable model counterpart.
- **C5 outer freight ring road:** see the end of part 3.

## 3. Results

Runs: `python -m vhsim.integration.batch` as for every scenario (A-INT-02/03 settings, rerouting on),
2025 base demand 3 seeds per condition, 2041 high-growth term weekday 1–3 seeds per option (3 for today's network, CP, BP, B3). Tables:
`python -m vhsim.integration.s7_tables` (from `report_<year>_<growth>_s7/` and
`s7_diagnosis/hotspots__*.csv`). "Time stopped" is the trip total (tripinfo `waitingTime`), as in the
main report; hotspot numbers are edgeData vehicle-hours as in part 1. Summer runs vary a lot between
seeds (today's network 450–472, BP 437–546 vehicle-hours), so differences under about 10% in summer
are within the noise unless the seed ranges separate.

### 2025 (today's demand)

| Scenario | Weekday: trip Δ (s) | Weekday: time stopped (veh-h, seed range) | vs today | Summer: trip Δ (s) | Summer: time stopped (veh-h, seed range) | vs today | vs CP | vs BP |
|---|---|---|---|---|---|---|---|---|
| Today's network | 0 | 137 (134–142) | — | 0 | 460 (450–472) | — | −37% | −6% |
| CP council package | +14.4 | 216 (205–224) | +58% | +28.2 | 734 (714–754) | +60% | — | +49% |
| BP Brent's package | −2.4 | 134 (132–137) | −2% | 0 | 492 (437–546) | +7% | −33% | — |
| N2 Armstrong/Crozier roundabout | +1.8 | 140 (139–141) | +3% | +4.2 | 490 (472–504) | +7% | −33% | 0% |
| N3 Crozier Rd flare | −0.6 | 132 (132–134) | −3% | −2.4 | 426 (408–445) | −7% | −42% | −13% |
| N4 Hindmarsh/Grantley roundabout | +0.6 | 125 (124–127) | −8% | 0 | 429 (404–477) | −7% | −42% | −13% |
| N5 N2 + Armstrong/Greenhills roundabout | +3.6 | 144 (143–146) | +5% | +6.6 | 505 (489–514) | +10% | −31% | +3% |
| N6 no right turn out of 3 side streets | +0.6 | 138 (137–140) | +1% | +8.4 | 561 (518–641) | +22% | −24% | +14% |
| N7 N5 + N4 | +4.2 | 134 (131–140) | −2% | +1.8 | 412 (399–427) | −10% | −44% | −16% |
| N8 Victoria St left-turn lanes | 0 | 138 (134–140) | +1% | +2.4 | 500 (479–526) | +9% | −32% | +2% |
| **N9 N3 + N4** | 0 | **122 (120–123)** | **−11%** | **−3.6** | **378 (364–386)** | **−18%** | **−49%** | **−23%** |

Vehicle-hours stopped at the hotspots, summer peak day (edgeData, seed mean):

| Scenario | Armstrong/Crozier | Grantley/Bridge Tce | Victoria St | Hindmarsh side sts | Seaview rbt + Eyre | Torrens/Coral | Network |
|---|---|---|---|---|---|---|---|
| Today | 18.2 | 32.6 | 77.4 | 48.8 | 28.7 | 12.2 | 440 |
| CP | 37.1 | 5.3 | 113.6 | 49.7 | 20.9 | 7.1 | 714 |
| BP | 36.6 | 32.7 | 80.0 | 44.6 | 22.8 | 10.9 | 470 |
| N2 | 2.8 | 36.7 | 91.0 | 50.4 | 30.1 | 12.4 | 470 |
| N3 | 11.5 | 32.2 | 68.8 | 47.4 | 26.3 | 11.9 | 407 |
| N4 | 24.1 | 12.6 | 86.5 | 53.5 | 17.6 | 8.3 | 412 |
| N6 | 26.5 | 33.9 | 97.6 | 78.3 | 29.9 | 1.2 | 541 |
| N7 | 2.4 | 16.4 | 70.4 | 64.0 | 20.4 | 8.5 | 395 |
| N8 | 18.6 | 34.3 | 103.7 | 48.5 | 28.4 | 11.5 | 477 |
| N9 | 12.0 | 12.0 | 66.7 | 52.5 | 16.5 | 8.4 | 360 |

Mean delay on the key approaches, summer (s per vehicle, R15 definition): Crozier Rd at Armstrong Rd
today 29, CP 43, BP 52, N2 7, N3 16, N9 16; Bridge Tce at the crossing today 51, CP 10 (traffic pushed
elsewhere by the loop), BP 52, N4 16, N9 16; Eyre Tce at the Seaview roundabout today 20, N4 17,
N9 16. Full tables: `report_2025_base_s7/intersections.csv`.

Reading:
- **N4 and N3 each help on their own, and together (N9) they are the best option tested at today's
  traffic**: 11% less time stopped on a term weekday and 18% less on a summer day, trips 3.6 s shorter
  in summer, with seed ranges well clear of today's (364–386 vs 450–472). N4 gives the Bridge Tce /
  Grantley traffic a roundabout instead of a right turn across both Hindmarsh Rd streams, and also
  takes load off the Seaview/Eyre roundabout (drivers who now use Grantley instead). N3 stops Crozier
  Rd's left-turners queuing behind right-turners. Both packages are worse than today in summer; N9 is
  49% below CP and 23% below BP.
- **N2 fixes its own junction and still loses overall at today's traffic.** Armstrong/Crozier drops
  from 18 to 3 vehicle-hours in summer, but the network total rises 7% (seed ranges 472–504 vs
  450–472, so this is not noise) and trips are 2–4 s longer. Two effects: every vehicle on the
  100 km/h ring road now slows to the 27 km/h ring, and the easier Crozier Rd exit draws traffic
  down Crozier Rd and into the Victoria St corridor (+14 vehicle-hours there) and George Main Rd.
  N5 adds a second ring-road roundabout and is worse again (+5% / +10%). The cheap flare (N3) is the
  better answer at this junction until traffic grows.
- **N6 (turn bans) makes summer worse (+22%).** Granite St's wait falls from 44 to 12 s and Coral St's
  queue disappears, but the displaced right-turners go round via the Hindmarsh Rd side streets
  (49 → 78 vehicle-hours) and Victoria St. Banning turns moves the delay.
- **N8 (Victoria St left-turn lanes) does nothing useful** (+1% weekday, +9% summer, within or near
  the summer noise). The Victoria St queues are not mainly caused by slowing left-turners in this
  model; see the caution on Victoria St in part 1.
- Trucks on the foreshore (vehicle-km on Flinders Pde and the Esplanade) stay at 4–8 a day for every
  N option, against 10–17 under CP.

### 2041 high growth, term weekday

| Scenario | Seeds | Mean trip (min) | Trip Δ vs today's network (s) | Time stopped (veh-h, seed range) | vs today's network | vs CP | vs BP |
|---|---|---|---|---|---|---|---|
| Today's network | 3 | 6.65 | 0 | 608 (589–619) | — | −38% | −37% |
| CP council package | 3 | 7.14 | +29.4 | 976 (910–1,084) | +61% | — | +1% |
| BP Brent's package | 3 | 6.98 | +19.8 | 965 (773–1,189) | +59% | −1% | — |
| B3 four-lane ring road | 3 | 6.75 | +6.0 | 748 (698–785) | +23% | −23% | −22% |
| N2 Armstrong/Crozier roundabout | 1 | 6.64 | −0.6 | 559 | −8% | −43% | −42% |
| N3 Crozier Rd flare | 2 | 6.61 | −2.4 | 571 (538–604) | −6% | −42% | −41% |
| N4 Hindmarsh/Grantley roundabout | 2 | 6.71 | +3.6 | 634 (510–757) | +4% | −35% | −34% |
| N5 N2 + Armstrong/Greenhills roundabout | 2 | 6.62 | −1.8 | 513 (497–529) | −16% | −47% | −47% |
| **N7 N5 + N4** | 2 | **6.59** | **−3.6** | **465 (454–476)** | **−24%** | **−52%** | **−52%** |
| N9 N3 + N4 | 3 | 6.62 | −1.8 | 556 (509–642) | −9% | −43% | −42% |

Hotspots (edgeData vehicle-hours; Armstrong/Crozier, Armstrong/Greenhills, Grantley/Bridge Tce,
Victoria St): today 54 / 12 / 20 / 110; CP 92 / 16 / 3 / 154; BP 106 / 26 / 16 / 194; N5 4 / 3 / 21 /
96; N7 4 / 3 / 7 / 98; N9 54 / 13 / 7 / 113. Crozier Rd's mean wait at Armstrong Rd: today 74 s,
CP 100, BP 130, N3 52, N5 and N7 8 s.

Reading:
- **At high growth the ring-road junctions decide the result.** With roundabouts at Armstrong/Crozier
  and Armstrong/Greenhills (N5, N7) the runs are lower and much more stable between seeds; without
  them (N3, N4, N9) the Crozier Rd queue at Armstrong Rd tips into long queues on some seeds and the
  totals swing (N4: 510 on one seed, 757 on the other). N7 is the best option tested: 24% less time
  stopped than today's network at 2041 demand and about half of either package's, trips 3.6 s shorter.
- **This reverses the 2025 ranking at Armstrong/Crozier:** the roundabout (N2/N5) costs a little at
  today's traffic and pays at 2041 high growth; the flare (N3) helps today and is not enough in 2041.
  A staged reading: flare now, roundabout when growth area traffic arrives.
- **No option copes with 2041 high growth.** N7's 465 vehicle-hours a day is still 3.4 times today's
  weekday (137). The growth areas load onto existing rural roads (no estate streets or new links, S2
  M3/M15), so the growth result says more about where growth traffic is forced to go in the model than
  about a planned 2041 network.
- One or two seeds per option and a large seed spread for N4 and N9: the 2041 differences under about
  15% are not firm. N5 and N7 are clear of today's range on both seeds.

### What clearly helps

| Option | Today's traffic (2025) | 2041 high growth | Cost class |
|---|---|---|---|
| **N9** Crozier Rd flare + Hindmarsh/Grantley roundabout | Best: −11% weekday, −18% summer time stopped; summer trips −3.6 s; seed ranges clear of today's | −9%, noisy (509–642) | $$–$$$ |
| **N7** roundabouts at Armstrong/Crozier, Armstrong/Greenhills and Hindmarsh/Grantley | −2% weekday, −10% summer, trips +2–4 s | Best: −24%, stable | $$$ |
| N3 Crozier Rd flare alone | −3% / −7% | −6% | $ |
| N4 Hindmarsh/Grantley roundabout alone | −8% / −7% | +4%, very noisy | $$–$$$ |

Every N option except N6 is far better than the council package (CP is +58–61% on time stopped in
every condition). Against Brent's package: on a summer day N3, N4, N7 and N9 are 13–23% lower; on a
term weekday the packages and options are within a few per cent except N4 (−6%) and N9 (−9%); at 2041
high growth every option run is 34–52% lower, because BP (with its four-lane ring road) is as bad as CP.

A combined reading: **N9 now (Crozier Rd flare and a Grantley roundabout), and the Armstrong Rd
roundabouts (N5, which replaces the flare) when growth-area traffic arrives**, i.e. N7 by the 2030s
under high growth. Did not help: N2/N5 at today's traffic, N6 turn bans, N8 Victoria St left-turn lanes.

### Caveats
- No option touches the largest hotspot, the Victoria St corridor (shopping-centre accesses on a
  one-lane street), and that hotspot is the model's least reliable (Victoria St over-loaded 1.5 x,
  car parks as OSM service roads). The Hindmarsh Rd side-street right turns (about 50 vehicle-hours on a
  summer day) are untouched too. Even N9 leaves about 80% of the summer delay where it is.
- Gap acceptance at give-way junctions and roundabout entries is SUMO's model with the A-INT-02
  impatience settings; the roundabout-vs-give-way comparisons (N2, N4, N5, N7) depend on it. It has not
  been checked against observed waits.
- The roundabouts, flares and turn lanes are geometric approximations, not designs; N4 sits beside a
  level crossing and would need crossing protection and land west of Hindmarsh Rd.
- Summer runs vary ±5–12% between seeds; 2041 option runs have 1–3 seeds.
- Growth demand has no estate streets; the 2041 summer peak was not run (it does not finish for any
  option, A-INT-05) and the optional 2031 high summer run was not done.

### Grantley Ave in the viewer: a 53-minute difference that was an export artefact (22 Nov 2026)
The residents' site showed Grantley Ave → Woolworths on a 2025 summer peak day at 12:30 as 53 minutes faster under
the council package than today (56.6 minutes today). Checked against the three 2025 summer runs of today's network:
- **Not a real queue.** The vehicles' own exit times (vehroute) give the longest traversal of the Grantley Ave
  section before Hindmarsh Rd (`-42530401#0`, 194 m) between 12:00 and 13:00 as 70, 97 and 79 s in seeds 1–3 (22,
  15 and 15 vehicles). The queue there is a normal side-street wait of under a minute and a half.
- **Not a stuck vehicle or a teleport.** No teleport on Grantley Ave, Bridge Tce or the crossing link in any seed
  (5, 2 and 1 teleports in the whole day elsewhere); the A-INT-02 impatience and junction-blocker settings are not
  involved.
- **The cause:** SUMO's edgeData `traveltime` (length × vehicle-seconds ÷ distance the vehicles' fronts travelled).
  In 12:15–12:30, seeds 2 and 3 each saw a single vehicle that had been waiting at the stop line since before 12:15;
  it moved a few centimetres and left after 12 s and 7 s. SUMO extrapolated 19,308 s and 9,678 s; the seed mean
  reached the export format's cap (6,553 s), and the viewer interpolated that into the 12:30 departure.
- **Fix (export layer, assumption V1a in `S5-viewer.md`):** when the vehicles covered less than one edge length in
  the interval, the edge time is the vehicle-seconds observed plus free flow over the rest of the edge. Grantley Ave
  at 12:15 becomes 24 s (seed mean); Grantley Ave → Woolworths at 12:30 becomes 2.7 minutes today against
  3.6 minutes under the council package (the package is about a minute slower, not 53 minutes faster). In the 2025
  summer baseline the rule changes 517 of 449,568 edge-intervals by more than a second and 17 by more than
  5 minutes, all on short local streets and car-park aisles. Published runs are re-timed with
  `python -m vhsim.viewer.retime`.
- **N4/N9 do not depend on it.** Every number in this note (time stopped from tripinfo, hotspot vehicle-hours from
  edgeData `waitingTime`, approach delays from vehroute exit times) is computed without `traveltime`, so the N4/N9
  summer results stand (time stopped −7% and −18%; Bridge Tce at the crossing 51 → 16 s a vehicle). The artefact
  only affected the viewer: it put the same false 56-minute value on that section in today's network and in N4
  (both 56.4–56.6 minutes at 12:30), and none in N9 or the council package, so before the fix the residents' site
  overstated the gain of N9 and CP at that one section and time, and understated N4's.

### C5 (outer freight ring road) — not built here; see S9
Built afterwards from the described end points and existing roads: `sim/assumptions/S9-ring-road.md`. The
original reason for leaving it out follows.
The indicative alignment (S-A04b) could not be placed reliably. Georeferencing the map from road
junctions the map labels (Greenhills/Hutchinson Rd, Hutchinson/Hindmarsh Tiers Rd, Greenhills/Day Rd)
gave scales that disagree by nearly a factor of two (the labelled junctions cannot be pinned on the map), so the new sections (south-west across the Inman
River to Greenhills Rd, and the north/north-east section to Victor Harbor Rd) would have invented end
points. The parts that follow existing roads (Greenhills Rd from Day Rd north, Hutchinson Rd, then
Hindmarsh Tiers Rd) are already in the network at 50–100 km/h. In this demand model C5 could only
attract through traffic between Inman Valley Rd and Victor Harbor Rd, a small flow, and would not touch
the bottlenecks in part 1. It needs the council's alignment (or a careful georeferencing like S2's for
the growth map) before it is worth simulating.
