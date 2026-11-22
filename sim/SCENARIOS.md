# Scenario definitions

Each scenario = a **network patch** over the baseline (S1) and/or a **demand variant** (S2), run
under each condition (`weekday_term`, `saturday`, `summer_peak`, `event_nye`) and demand year
(`2025/base`, `2031|2041|2051 × moderate|high`). Ids match the knowledge base Options Register
(`site/options-register.html`).

Where the council has not defined an option precisely, the definition below is **our reading**
of its map, marked *Inference*, and a variant tests the main alternative reading. Sources:
VHITS town-centre map (S-A04c, S-B03 p.93), Vision map (S-B03 p.92), ring-road map (S-A04b,
S-B03 pp.91, 94), fact sheet (S-A03), survey text (S-A05).

## Baselines

| Id | Network | Demand |
|---|---|---|
| X0 | baseline (today) | 2025/base — calibration target |
| X1 | baseline | each future year/growth ("do nothing") |

## Council options (VHITS preliminary Vision)

| Id | Change | Definition used | Status |
|---|---|---|---|
| C1 | 30 km/h town centre | All edges inside the shaded town-centre area: bounded by Torrens St (west), Seaview Rd / Eyre Tce (north), Flinders Pde / foreshore (east), Esplanade (south). **C1a**: Torrens St and Victoria St stay at their current limit (they are DIT freight/strategic routes; S-D08, S-D22). **C1b**: Torrens St inside the area also 30 km/h. | *Inference* — boundary is shading only |
| C2 | Shared use zones 10–20 km/h | 20 km/h on Ocean St (the 2014 Mainstreet plan's "shared space", S-B26) plus Albert Pl and Railway Tce within the area; pedestrian priority modelled as reduced speed plus pedestrian crossing delay at Ocean St / Coral St where SUMO supports it. **C2b**: 10 km/h. | *Inference* — locations not named |
| C3 | One-way outer loop | **Clockwise** (reading of the map's arrows): Torrens St one-way north-east from Victoria St to the Hindmarsh/Seaview/Eyre roundabout; Eyre Tce → Flinders Pde one-way southbound to the Esplanade; Esplanade one-way westbound to the Victoria St / Albert Pl area; Victoria St stays two-way. Internal streets keep their current direction unless they conflict with the loop. **C3b**: anticlockwise. | *Inference* — streets and direction never named in text |
| C4 | Traffic signals | Replace the roundabouts at Torrens St/Hindmarsh Rd × Seaview Rd/Eyre Tce and Torrens St × Crozier Rd with signalised intersections (actuated, fixed cycle ≤ 90 s, pedestrian phase on Torrens St). Lane layout: existing approach lanes (no land acquisition) — **C4b**: three lanes per approach at Seaview/Eyre as the 2015–16 study said signals there would need (S-D21 s13.3.14). | Sites named in text (S-A03); design not published |
| C5 | Outer freight ring road (Option 1), inner reading | Built from the described end points over existing roads, not traced from the map (S9, `sim/assumptions/S9-ring-road.md`): Inman Valley Rd → Swains Crossing Rd (existing Inman River crossing) → **new 0.4 km link** → Water Reserve Rd → Greenhills Rd past Day Rd → Hutchinson Rd → Hindmarsh Tiers Rd → Victor Harbor Rd. Outer road 100 km/h, one lane each way, priority over the side roads it meets; at Inman Valley Rd it forms the main road with Inman Valley Rd west (town-bound traffic gives way); give-way to Victor Harbor Rd. Existing ring road (Welch/Armstrong Rd) lowered to 60 km/h; trucks prefer the outer road (SUMO routing preference: the link road counts at twice its travel time for trucks). "More connections to the north growth area" not modelled (no estate streets, S2 M3/M15). | *Inference* — "indicative" alignment |
| C5b | Outer freight ring road (Option 1), outer reading | As C5, but Swains Crossing Rd → Stock Rd → new 0.2 km link → Spring Rd → **new 2.8 km road** 0.3–0.9 km west of Greenhills Rd (clear of the growth-area frontage) to Hutchinson Rd, then Mont Rosa Rd straight across Hindmarsh Tiers Rd to Victor Harbor Rd | *Inference* — variant |
| C5s | Sensitivity of C5 | C5 with Welch Rd / Armstrong Rd left at today's limits (truck preference kept): separates the outer road from the 60 km/h downgrade | Sensitivity (runs not finished, S9 gaps) |
| C6 | Retain current ring road (Option 2) | Baseline ring road; demand variant adds an activity centre (supermarket + services POIs) north of the ring road near Waggon Rd / Hindmarsh River (S-A03 p.5, S-B03 p.91). | Demand-side change |
| CP | Council town-centre package | C1a + C2 + C3 + C4 together, as consulted. | Package |

## Brent's options

| Id | Change | Definition used |
|---|---|---|
| B1 | Keep two-way streets | = baseline network (no C3) |
| B2 | Timed/event speed zones on variable signs | 30 km/h on the C1 area edges **only** in `event_nye` and `summer_peak` 10:00–16:00; baseline limits otherwise |
| B3 | Four-lane ring route | Welch Rd + Armstrong Rd duplicated to two lanes each way (consistent with the Jan 2026 "duplication" note, S-B31); same speed limits |
| B4 | Two-lane entry roundabout | Adelaide Rd / Hindmarsh Rd / Port Elliot Rd roundabout (McCracken) with two circulating lanes and two-lane entries on Adelaide Rd and Hindmarsh Rd |
| B5 | Roundabout slip lanes | Left-turn bypass lanes at Torrens/Seaview/Eyre and Torrens/Crozier roundabouts, where the turning movement exists |
| B6 | Retail closer to Encounter Bay | Demand variant: a supermarket + services POI cluster in Encounter Bay (near Bay Rd / Franklin Pde) |
| BP | Brent's package | B2 + B3 + B4 + B5 |

## Other options

| Id | Change | Source |
|---|---|---|
| N1 | Close or half-close the Grantley Ave rail crossing | 2015–16 study: Seaview/Eyre roundabout reaches capacity in summer unless closed (S-D21 s13.3.15); 2017 left-in/left-out trial (S-D19) |
| N2+ | Generated after the baseline shows where delay is (R16) | — |

### Targeted options from the bottleneck diagnosis (S7)

Chosen from where the simulated delay actually is (`sim/assumptions/S7-improvements.md`, diagnosis of
the 2025 summer and 2041 high-growth weekday baselines). Cost classes are rough orders of magnitude for
comparison only (**$** under $0.5 M, **$$** $0.5–3 M, **$$$** $3–10 M; assumption S7-04); none is a costed design.

| Id | Change | Why (diagnosis) | Definition used | Cost class |
|---|---|---|---|---|
| N2 | Roundabout at Armstrong Rd / Crozier Rd | Worst single junction at 2041 high growth (Crozier Rd waits ~53 s per vehicle on a weekday) and the second-worst single approach in 2025 summer; B3 makes it worse | Single-lane roundabout, ring radius 20 m (like the McCracken and Armstrong/George Main roundabouts), 3 legs, ring speed by the baseline's radius rule | $$ (DIT arterial, rural roundabout) |
| N3 | Crozier Rd approach flare at Armstrong Rd | Cheap alternative to N2: today left- and right-turners share one lane, so left-turners queue behind right-turners waiting for a gap in both directions | Last 40 m of the Crozier Rd approach get two lanes: kerb lane left, median lane right | $ (line marking, some widening) |
| N4 | Roundabout at Hindmarsh Rd / Grantley Ave (rail-crossing link to Bridge Tce) | Worst approach in 2025 summer: Bridge Tce traffic turning right onto Hindmarsh Rd via the 17 m crossing link (~50 s per vehicle); N1 (closing the crossing) made things worse | Single-lane roundabout, radius 12 m, centre moved 8 m west so ~13 m of the crossing link remains between the ring and Bridge Tce | $$–$$$ (next to a level crossing: crossing protection and land on the west side needed) |
| N5 | Ring-road junction roundabouts: N2 + Armstrong Rd / Greenhills Rd | Greenhills Rd is the second ring-road give-way approach that fails at 2041 high growth (growth areas 1 and 3 load onto it) | N2, plus a single-lane roundabout (radius 15 m) at Armstrong Rd / Greenhills Rd | $$$ (two roundabouts) |
| N6 | No right turn out of Granite St (onto Victoria St), Coral St (onto Torrens St) and Wattle Dr (onto Hindmarsh Rd) | The worst side-street right turn on each of the three town-centre arterials in 2025 summer (27–48 s per vehicle; selection rule in S7-03) | The right-turn movement out of each street removed; left turns and the turns into the street kept | $ (signs; possibly a median) |
| N7 | Combination: N5 + N4 | The three worst junctions together (ring road for growth, Grantley for summer) | N2 + Armstrong/Greenhills roundabout + N4 | $$$ |
| N8 | Left-turn lanes on Victoria St eastbound into Oval Rd and the IGA car park | The Victoria St corridor is the largest hotspot; 2,400 a day turn left into Oval Rd and 980 into the car park (summer 2025), slowing the one through lane | Last 40 m before each turn: kerb lane left turn only, median lane through | $ |
| N9 | Combination: N3 + N4 | The cheap Crozier Rd flare (best Armstrong/Crozier result at today's traffic) with the Grantley roundabout | N3 flare + N4 roundabout | $$–$$$ |

Not built, with the reason in `S7-improvements.md`: roundabout metering signals (no roundabout
approach in the diagnosis is starved by a dominant circulating flow except Eyre Tce, and its loss is
small), better-designed signals at the C4 sites (the two roundabouts there are not bottlenecks today),
a link road for growth area 1 (the demand model has no estate streets to connect it to), seasonal
traffic management and a caravan route (no measured target in the model). C5 was first left out because the
indicative alignment could not be georeferenced; it was built in S9 from the described end points and existing
roads instead (rows C5 / C5b above).

## Outputs per run

Accessibility (R14) and movement delay (R15) tables from `vhsim.metrics`; deltas vs X0/X1;
foreshore exposure (R23a: trucks and caravans on Flinders Pde / Esplanade / past Warland Reserve);
network totals. At least 5 seeds per run; report the spread across seeds.
