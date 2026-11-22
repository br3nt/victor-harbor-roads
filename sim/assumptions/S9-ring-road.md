# S9 — The council's ring-road options (VHITS Option 1 vs Option 2)

Stream S9 (22 Nov 2026). Brent's question: *"what of the ring route options?"* The October 2026 consultation
(S-A03 p.5, S-B03 pp.91–94, S-A05) offered two:

- **Option 1 — new outer ring road** (`C5`): a new high-speed road moving freight round the town, away from
  residential areas; the existing ring road (Welch Rd / Armstrong Rd) becomes a 60 km/h "link road" with better
  connections between the existing south and the growing north.
- **Option 2 — retain the current ring road** (`C6` in the options register): today's network. The consultation
  pairs it with a new activity centre north of the ring road (a demand change, not built here). Brent's four-lane
  ring road (`B3`) and our junction fixes (`N7`, roundabouts at Armstrong/Crozier, Armstrong/Greenhills and
  Hindmarsh/Grantley, from S7) are two ways of keeping and improving the current ring road.

Every year is stated: "2025" is the model's *now* (2025 demand data, the latest available in 2026); 2031 and 2041
are the S2 growth scenarios (UGMS moderate and high series).

## 1. How C5 was built

The council's ring-road map (S-A04b, S-B03 p.94) draws the outer road as an "indicative" dashed line. S7 tried to
georeference it and failed: the labelled junctions gave scales nearly a factor of two apart (the map is
schematic). So C5 is **not traced from the drawing**. It is built from the route the text and map describe — from
Inman Valley Rd near Greenhills Rd, north along the west of the growth area to Hutchinson Rd, then east across
Hindmarsh Tiers Rd to Victor Harbor Rd — using existing OpenStreetMap roads and road reserves wherever they follow
that description, plus short new sections where none do. Two readings are built.

### S9-01. Route, C5 (inner reading: along Greenhills Rd, as the map's line)
| Section | Length | Today | In C5 |
|---|---|---|---|
| Swains Crossing Rd, Inman Valley Rd → Cemetery Rd (crosses the Inman River at Swains Crossing) | 0.8 km | 50 km/h tertiary | 100 km/h |
| **New link** along the Water Reserve Rd line to its south end | 0.4 km | — | new, 100 km/h |
| Water Reserve Rd (unsealed road reserve) to Greenhills Rd | 0.5 km | 50 km/h residential | 100 km/h |
| Greenhills Rd, from its southern bend past Day Rd to Hutchinson Rd (west edge of growth areas 1 and 3) | 3.6 km | 50 km/h | 100 km/h |
| Hutchinson Rd | 3.4 km | 80 km/h | 100 km/h |
| Hindmarsh Tiers Rd, Hutchinson Rd → Victor Harbor Rd | 1.3 km | 100 km/h | 100 km/h |
| **Total** | **9.9 km**, of which 0.4 km new | | |

### S9-02. Route, C5b (outer reading: west of Greenhills Rd)
| Section | Length | Today | In C5b |
|---|---|---|---|
| Swains Crossing Rd (as C5) | 0.8 km | 50 km/h | 100 km/h |
| Stock Rd | 1.1 km | 50 km/h unclassified | 100 km/h |
| **New link** Stock Rd → Spring Rd | 0.2 km | — | new |
| Spring Rd and the Glenvale Rd stub to Cartwright Rd | 0.4 km | 50 km/h | 100 km/h |
| **New road**, straight north 0.3–0.9 km west of Greenhills Rd, to the Greenhills Rd / Hutchinson Rd junction | 2.8 km | — | new |
| Hutchinson Rd | 3.4 km | 80 km/h | 100 km/h |
| Mont Rosa Rd, straight across Hindmarsh Tiers Rd to Victor Harbor Rd (further north than C5) | 1.1 km | 100 km/h residential | 100 km/h |
| **Total** | **9.7 km**, of which 3.0 km new | | |

C5b keeps the outer road off the growth areas' Greenhills Rd frontage (driveways, future estate entries), which is
how a freight bypass would normally be placed, and reaches Victor Harbor Rd by the shortest line "across Hindmarsh
Tiers Rd" as the text says. C5 is the cheaper reading (0.4 km new road) and follows the map's line up Greenhills
Rd. Both are **inferences**; neither is a design.

### S9-03. Cross-section and junctions
- **Value:** one lane each way, 100 km/h, on new and upgraded sections; new sections are typed as rural secondary
  roads, so the A-INT-01 right-turn bays apply at their junctions like any arterial. The outer road has priority
  11 (as Inman Valley Rd and Greenhills Rd). Where it meets or follows local roads (Greenhills Rd at the join and at
  Hutchinson Rd, Hindmarsh Tiers Rd at Hutchinson Rd; C5b also Stock / Spring / Glenvale / Cartwright Rds), the
  other legs are lowered to priority 10, so the outer road is the major road and side roads give way. At Inman
  Valley Rd (Swains Crossing junction) the outer road and Inman Valley Rd west form the main road (equal priority;
  netconvert picks the faster pair), so Inman Valley Rd traffic to and from the town gives way there, the layout
  of a freight route turning off at a T. At Victor Harbor Rd (trunk, priority 13) the outer road gives way.
  Plain give-way junctions throughout, no roundabouts.
- **Why:** the consultation shows no junction designs. Give-way junctions are the cheapest reading and how the
  existing rural roads meet today; roundabouts at the two arterial junctions would be the natural upgrade if they
  queued. They do not (part 3).
- **Sensitivity:** low for totals; the Victor Harbor Rd give-way decides how long right-turning outer-road traffic
  waits, which matters only if the outer road carries much more than the model gives it.

### S9-04. The existing ring road as a 60 km/h link road
- **Value:** every Welch Rd and Armstrong Rd edge at 60 km/h or less (14 edges, 8.1 directed km lowered from
  80–100 km/h). Junctions unchanged.
- **Not modelled:** "better connectivity to … future growing north communities" (new junctions on the link road).
  The S2 demand model loads the growth areas onto the existing rural roads (Waggon Rd, Day Rd, Greenhills Rd, Fuller
  Rd; S2 M3/M15) and has no estate streets, so any new connection points would be invented. A 60 km/h main road also
  makes gaps easier to accept from the side roads (SUMO's gap model uses the approaching speed), which is the part
  of "better connections" the model does capture.

### S9-05. Trucks prefer the outer road
- **Value:** the ring road's edges carry SUMO `routingType="c5_link"`; a routing-preference file
  (`sim/data/networks/c5_bays.prefs.add.xml`, loaded by duarouter and by sumo's en-route rerouting) gives trucks a
  priority of 0.5 on them, i.e. a truck counts the link road at twice its travel time when it chooses a route. Cars
  are unaffected. Trucks still drive the link road at the normal limit when their trip starts or ends near it.
- **Why:** the council's text says the outer road "moves freight around Victor Harbor". A ban would strand trucks
  whose trip ends on the ring road (their trip ends are the nearest road, S2/A-INT-01), and a truck-only speed limit
  would physically slow them and the cars behind. A routing preference is how a "no through trucks" sign and a
  gazetted freight route work: through trucks go round, local trucks do not.
- **Check:** a truck from Inman Valley Rd (west) to Victor Harbor Rd north or to Waterport Rd routes round the
  outer road in both C5 readings (test `tests/scenarios/test_c5_ring.py`); to Waterport Rd it takes the outer road
  although the link road would be about 6 km shorter.
- **Sensitivity:** medium for truck numbers on the link road, low for everything else (trucks are about 3% of
  trips: 1,959 of 67,239 on a 2025 term weekday).

### S9-06. What the model can and cannot say about Option 1
- Through traffic between the gateways is small in this demand model: the 2025 term-weekday demand has 1,959 truck
  trips a day, and Hutchinson Rd carries almost nothing today (4 vehicles a day in the 2025 summer baseline, seed 1). The
  outer road's main users would be through freight (Inman Valley Rd ↔ Victor Harbor Rd north / Waterport Rd) and,
  from 2031, growth-area residents.
- Free-flow routing in today's network already sends Inman Valley Rd ↔ Victor Harbor Rd traffic over Swains
  Crossing Rd and Greenhills Rd to Armstrong Rd, not along Inman Valley Rd to the Armstrong Rd roundabout; and
  Inman Valley Rd ↔ Port Elliot Rd traffic through the northern residential streets (Canterbury Rd, Galpin Ave,
  Pine Ave, Field Ave, The Parkway) to Hindmarsh Rd, not the ring road. That second route is a model artefact (no
  truck restrictions on local streets) that neither option changes.
- No cost: the council gives none. Order of magnitude only (S7-04 classes): C5 is 9.9 km of rural arterial, almost
  all upgrading of council roads (sealing Water Reserve Rd, bringing Greenhills Rd and Hutchinson Rd to a 100 km/h
  freight standard, a 100 km/h crossing of the Inman River at Swains Crossing) plus 0.4 km new; C5b has 3 km of new
  road. Both are at least the top of the **$$$** class ($3–10 M) and probably above it, against **$$$** for N7's
  three roundabouts. A class label, not an estimate.

## 2. Runs

Network builds: `python -m vhsim.scenarios.build c5 --smoke` and `... c5b --smoke` (checks and 30-minute smoke run
clean). Runs as every scenario (A-INT-02/03 settings, rerouting on, 45-minute wall-clock cap, A-INT-05):

| Demand | Conditions | Seeds | Today's network, B3 | N7 | C5, C5b |
|---|---|---|---|---|---|
| 2025 ("now") | term weekday, summer peak day | 3 | earlier runs | earlier runs (S7) | S9 |
| 2031 moderate, 2031 high | term weekday, summer peak day | 1 | earlier runs (timeline) | runs from the parallel S7 stream | S9 |
| 2041 high | term weekday | 3 | earlier runs | seeds 1–2 (S7) + seed 3 (S9) | S9 |

C5s (sensitivity, `python -m vhsim.scenarios.build c5s --smoke`): the C5 outer road and truck preference with
Welch Rd / Armstrong Rd left at today's limits; planned for 2041 high weekday (3 seeds) and 2031 high summer.

Analysis: `python -m vhsim.integration.s9_ring` (reads the run directories; CSVs in
`sim/data/results/report_s9/`).

## 3. Results (22 Nov 2026; some runs missing, see the gaps list)

`python -m vhsim.integration.s9_ring` → `sim/data/results/report_s9/summary.csv`. "Time stopped" is total
vehicle-hours stationary (tripinfo); changes are against today's network on the same seeds. "Ring junctions" =
vehicle-hours stopped on the approaches of Armstrong Rd's four junctions (Inman Valley roundabout, Crozier Rd,
Greenhills Rd, Welch/Waggon Rd). Trucks = trucks a day using any town-centre street (the C1 area) / the existing
ring road / the outer-road streets.

### 2041 high growth, term weekday (3 seeds each)

| Option | Mean trip (min) | Δ trip | Time stopped (veh-h, seed range) | vs today | Ring junctions (veh-h) | Trucks: town centre / ring / outer | Growth areas ↔ town centre (min) |
|---|---|---|---|---|---|---|---|
| Today's network (Option 2 as is) | 6.65 | — | 608 (589–619) | — | 77.8 | 394 / 411 / 130 | 7.4 |
| N7 junction roundabouts (Option 2 + fixes) | 6.59 | −4 s | 462 (454–476) | **−24%** | 17.4 | 383 / 403 / 130 | 7.1 |
| B3 four-lane ring road | 6.75 | +6 s | 748 (698–785) | +23% | 135.1 | 392 / 436 / 133 | 7.5 |
| **C5** outer road via Greenhills Rd (Option 1) | 6.92 | +16 s | 714 (692–726) | **+18%** | 8.5 | 502 / 29 / 272 | 7.8 |
| **C5b** outer road west of Greenhills Rd (Option 1) | 7.03 | +22 s | 792 (752–815) | **+30%** | 14.0 | 509 / 38 / 271 | 7.9 |

Vehicles a day, 2041 high weekday: Armstrong Rd between Greenhills Rd and Waggon Rd 13,844 today → 6,293 (C5) /
6,473 (C5b); Hutchinson Rd 240 → 3,374 / 2,993; Swains Crossing Rd 2,012 → 5,404 / 4,864. Vehicle-km a day
(seed mean, edgeData): Hindmarsh Rd 37,900 → 43,400 (+14%), Adelaide Rd 8,300 → 10,200 (+23%), town-centre streets
10,400 → 11,100 (+6%), Armstrong + Welch Rd 71,800 → 35,500 (−51%).

### 2025 summer peak day ("now", 2025 demand)
Only seed 1 of C5 finished (C5b none): time stopped 834 vehicle-hours against 457 for today's network on the same
seed (**+83%**), trips +34 s, trucks using town-centre streets 586 → 797 a day. N7: −10% (3 seeds, 399–427 vs
450–472); B3: +4% (noise).

### 2031 (1 seed each)
Today's network / N7 / B3 finished (N7 2031 from the parallel S7 stream): N7 −4% (moderate) and −6% (high) on a term
weekday, −43% and −37% on a summer day; B3 −2% / −1% weekday, +2% / +126% summer. **No C5 or C5b 2031 run finished**
(see gaps).

### Where Option 1's delay comes from
Lowering Welch Rd / Armstrong Rd to 60 km/h makes the ring road no faster than going through town, so about half its
traffic leaves it: some for the outer road (growth-area traffic heading north, through traffic), the rest onto
Hindmarsh Rd, Adelaide Rd and the town-centre streets. The ring-road junction queues all but vanish (77.8 → 8.5
vehicle-hours at 2041 high growth, because there is less traffic and 60 km/h gaps are easier to accept), but the
diverted traffic queues at the side-street and roundabout junctions in town: the largest increases at 2041 high
growth are Bridge Tce at the Grantley Ave crossing (+17 vehicle-hours a day), Coral St / Torrens St (+10), Eyre Tce /
McKinlay St (+5) and the Hindmarsh Rd side streets (Renown Ave, The Drive, The Parkway, Peace Ave, Wattle Dr, +2–4
each). Growth-area trips to and from the town centre take about 0.4–0.5 minutes longer (7.4 → 7.8–7.9 minutes),
not shorter. The truck preference works on the ring road (trucks on it 411 → 29–38 a day) but trucks using
town-centre streets *rise* (394 → about 505), because local deliveries that used the 100 km/h ring road now cut
through town too.

C5s (the C5 outer road with the ring road left at today's limits) was built to separate the outer road from the
60 km/h downgrade; its runs did not finish in time (gaps).

## 4. Verdict: Option 1 vs Option 2 with targeted junction fixes

- **Option 1 as consulted (outer road + existing ring at 60 km/h) is worse than doing nothing in every run that
  finished**: +18% (C5) and +30% (C5b) time stopped at 2041 high growth, +83% on the one 2025 summer seed. It
  succeeds at its stated aim (through trucks off the existing ring road, the ring junctions decongested) but moves
  local traffic and delay into the town centre and onto Hindmarsh Rd, the opposite of the town-centre objective.
  It is also by far the most expensive option (about 10 km of road to a 100 km/h freight standard).
- **Option 2 with targeted junction fixes (N7: roundabouts at Armstrong/Crozier and Armstrong/Greenhills, plus
  Hindmarsh/Grantley) is the best option tested at every growth level**: −24% at 2041 high growth (3 seeds, ranges
  clear), −4 to −6% on 2031 weekdays and −37 to −43% on 2031 summer days (1 seed), −10% on a 2025 summer day.
  Widening the ring road (B3) without fixing its junctions makes things worse (+23% at 2041).
- **So, in this model: keep the ring road (Option 2), fix its junctions as growth arrives, and do not lower it to
  60 km/h.** Whether an outer road helps *without* downgrading the existing one is the open question C5s was built
  for.
- **Limits:** the demand model has no estate streets or new links for the growth areas (S2 M3/M15), little
  through freight (about 3% of trips are trucks) and no "better connections" from the link road to the north (S9-04),
  all of which an Option 1 design would add; the outer road's alignment is our reading (S9-01/02); 2031 runs are
  single seeds; the C5 2025 summer result is one seed.

### Sensitivity of the alignment
C5 (0.4 km new road, along Greenhills Rd) and C5b (3.0 km new road west of it, Mont Rosa Rd to Victor Harbor Rd) give
the same picture: similar outer-road volumes (Hutchinson Rd about 3,000–3,400 a day), the same diversion into town;
C5b is worse (+30% vs +18%); it leaves Greenhills Rd as a 50 km/h local road and its outer road is less direct for
traffic from growth areas 1 and 3 beside Greenhills Rd (not separated further). The verdict does not depend on which reading is used; it depends on the 60 km/h downgrade (C5s, gap).

## 5. Gaps (runs that did not finish by the deadline)
The machine's load average reached 70–166 during the runs (other jobs), so most runs hit the 45-minute wall-clock cap
(A-INT-05) while still progressing (for example C5 2031 moderate summer had 98% of trips finished at 22:00 when
stopped); these are **not** gridlock results and are not recorded as jammed. A second pass with a 4-hour cap was
running at the deadline and was stopped. Missing:
- C5: 2025 summer seeds 2–3, 2025 term weekday (3 seeds), 2031 moderate and high (weekday and summer).
- C5b: 2025 summer and term weekday (3 seeds each), 2031 moderate and high (weekday and summer).
- C5s: 2041 high weekday (3 seeds), 2031 high summer.
Rerun with `python -m vhsim.integration.batch --scenarios c5 c5b c5s --conditions ... --year ... --growth ...` when the
machine is free (for 2041 high: C5 and C5b are done, run C5s only), then `python -m vhsim.integration.s9_ring`.
