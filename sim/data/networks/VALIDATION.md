# Baseline network — validation (S1)

Build: `cd sim && python -m vhsim.network.build` (≈5 s). Inputs: OSM extract **S-E01**
(`sources/E/S-E01-overpass-victor-harbor.osm`, data timestamp 2026-11-20) and DIT State
Maintained Roads legal speed limits **S-D05** (`sources/D/D-state-maintained-roads-vh-area.geojson`).
Every check below is an automated test in `sim/tests/network/` (fast: `-m "not slow"`; the
`slow` tests build the real network). Counts and lists are in `build_report.json`. Choices not taken
from a source are in `sim/assumptions/S1-network.md` (ids A-S1-xx).

## Network at a glance

| Item | Value |
|---|---|
| Edges (directed, non-internal) | 4,340 |
| Junctions | 1,796 (1,671 priority, 121 right-before-left, 4 dead ends) |
| Roundabouts | 31 (from 32 OSM roundabout ways; the Armstrong Rd / George Main Rd ring is two OSM ways) |
| Traffic lights | 0 |
| Road length | 304.7 km of road (centreline, two-way roads counted once); 602.1 km of directed edges; 602.3 lane-km |
| Driving side | left (`--lefthand`); roundabouts circulate clockwise (tested) |
| Vehicle classes | every edge allows passenger, truck, trailer, delivery, bus (tested) |

## Import (requirement 1)

netconvert 1.28 options (`vhsim/network/config.py`): `--lefthand`, `--geometry.remove`,
`--roundabouts.guess`, `--junctions.join`, `--tls.guess false`, `--tls.guess-signals false`,
`--tls.discard-loaded`, `--osm.turn-lanes`, `--output.street-names`, `--output.original-names`,
`--keep-edges.by-vclass passenger,truck,trailer,delivery,bus`, `--remove-edges.isolated`,
`--osm.all-attributes` (OSM `highway, maxspeed, lanes, oneway, ref, junction, service` kept as
edge params). SUMO's OSM typemap is loaded with `vhsim/network/vh.typ.xml` on top (A-S1-01/02/04).

- **Dropped:** footways, cycleways, paths, steps, pedestrian ways, tracks, construction/proposed
  ways (no motor-vehicle class; tested). Before import, 153 OSM service ways that are not public
  road are removed (A-S1-03): 66 `access=private`, 1 `access=no` (a bus-only link), 48
  `service=driveway`, 38 `service=parking_aisle`. Other service roads (car-park entries, lanes,
  access roads; 777 edges) are kept and open to cars at 20 km/h (A-S1-02).
- **Traffic lights:** none. OSM has no signalised road junctions; its only three signal nodes are
  pedestrian crossings (Torrens St near Coral St ×2, near Bay Rd / Franklin Pde) [S-E01]. They are
  dropped with `--tls.discard-loaded`; pedestrians are not modelled, so a signal that only serves a
  crossing would only add random stops (A-S1-06). The DIT signal layer also has none [S-D10].
- **Cut at the extract edge:** 1 edge removed (an unnamed one-way service stub entering from nowhere,
  near the hospital). Every other edge is drivable for cars (next section).
- **netconvert warnings** (counts in `build_report.json`): 23 "Replacing loaded roundabout": the
  first segment of a closed OSM roundabout way is merged into its neighbour by `--geometry.remove`,
  so the roundabout is re-registered without that (no longer existing) edge id. This is what
  research/E-network.md called "~20 incomplete roundabouts" (with its options the same message
  read "Writing incomplete roundabout ... no longer exist"); it does not leave any ring incomplete
  (next check). 33 sharp-turn and 48 turning-radius speed reductions (geometry); 24 "intersecting
  left turns" at joined clusters, mostly Encounter Bay residential streets; 1 ignored restriction
  (re-applied, see turn restrictions).

## Speeds (requirement 2)

Rule: DIT legal limit [S-D05] where the edge runs along a State road section; else OSM
`maxspeed` [S-E01]; else 50 km/h (20 km/h on service roads). An edge takes a DIT section when ≥ 60%
of points sampled every 5 m along it lie within 20 m of the section centreline and run parallel
to it (within 30°), and its name belongs to the same DIT road number (or it is an unnamed
trunk/primary/secondary/link piece). Each edge's source is in `edge_attributes.csv`
(`speed_source`, `dit_section`, `osm_maxspeed`, `legal_speed_kmh`).

| Source | Edges | Directed km |
|---|---|---|
| S-D05 (DIT) | 219 | 36.6 |
| OSM maxspeed | 2,022 | 328.5 |
| default (50 / service 20) | 1,960 | 236.5 |
| roundabout cap (A-S1-05) | 139 | 0.5 |

DIT sections matched (directed km; both carriageways or directions count):

| DIT section [S-D05] | Limit | Edges | km |
|---|---|---|---|
| 04760 Victor Harbor Rd 45.14–46.00 | 80 | 4 | 0.56 |
| 04760 Victor Harbor Rd 46.00–46.45 | 60 | 2 | 1.00 |
| 04760 Adelaide Rd 46.45–47.66 | 60 | 24 | 2.06 |
| 04760 Hindmarsh Rd 47.66–49.45 | 60 | 41 | 3.08 |
| 04760 Hindmarsh Rd 49.45–49.53 | 60 | 2 | 0.22 |
| 04760 Hindmarsh Rd 49.55–50.00 | 50 | 18 | 0.56 |
| 04760 Torrens St 50.00–50.56 | 50 | 25 | 0.80 |
| 04688 Port Elliot Rd 0.00–2.95 | 60 | 44 | 5.20 |
| 04793 Victoria St 31.72–32.36 | 50 | 21 | 1.30 |
| 04793 George Main Rd 31.59–31.72 | 50 | 3 | 0.29 |
| 04793 George Main Rd 30.41–31.59 | 60 | 26 | 1.92 |
| 04793 Inman Valley Rd 29.34–30.41 | 60 | 7 | 2.31 |
| 04793 Inman Valley Rd 28.44–29.34 | 80 | 4 | 1.40 |
| 04793 Inman Valley Rd 15.00–28.44 | 100 | 10 | 15.98 |

Hindmarsh Rd 49.53–49.55 (20 m, 50 km/h) is shorter than any edge and is absorbed by its
neighbours. Hindmarsh Tiers Rd, Goolwa Rd and North Tce lie outside the extract.

**DIT vs OSM conflicts (DIT used):**

| Street | OSM | DIT | Directed km |
|---|---|---|---|
| Torrens Street | 60 | 50 | 0.79 (22 edges: all of it) |
| Victoria Street (Torrens St – Bay Rd) | 60 | 50 | 1.43 |
| Hindmarsh Road (RRD 49.55–50.00, Cornhill Rd – Torrens St) | 60 | 50 | 0.56 |
| Inman Valley Road | 100 / 80 | 80 / 60 | 0.44 / 1.27 |

DIT warns its legal limits "may not coincide with the posted speed limit signage" [S-D06]. The DIT
regulatory sign extract [S-D11] supports the DIT value in the town: a 50 sign on Torrens St near
Crozier Rd (SI-105902, -35.5549, 138.6204), a 50 sign on Hindmarsh Rd before Torrens St
(SI-105466, -35.5511, 138.6235), back-to-back 50/60 signs where Hindmarsh Rd changes
(SI-105373/105374 and SI-105376/105377, about -35.5500, 138.6241, i.e. RRD ≈ 49.5), a 50 sign on
Victoria St near King St (SI-105967) and back-to-back 50/60 signs at Victoria St / Bay Rd
(SI-111221/111233). So OSM's 60 on Torrens St and Victoria St looks out of date. Tested:
`test_torrens_street_uses_dit_50_not_osm_60`, `test_state_roads_take_dit_limits`.

**Roundabouts:** circulating edges get V = √(127 R (e+f)), e+f = 0.3, R = ring radius from the
SUMO junction positions (A-S1-05), never above the legal limit: 18–20 km/h at the Torrens St
roundabouts, 23 at Bay Rd, 27 at McCracken, 31 at Armstrong Rd / George Main Rd (tested 15–35).

**Defaults that are probably too low (outside the town):** untagged rural roads default to 50 km/h:
Greenhills Rd 17.1 km (directed), Cartwright Rd 9.0, Waterport Rd 7.8 (its tagged part is 80),
Wilson Hill Rd 5.2, Tugwell Rd 4.9, Jagger Rd 4.4 km. They only affect travel times to/from the
north-west and north-east fringes. OSM tags Waitpinga Rd 110 km/h (22 km); unverified (SA's
open-road default is 100).

## Lanes (requirement 3)

OSM `lanes` where tagged (309 edges); otherwise one lane per direction on every road class
(A-S1-04: SUMO's default of two per direction on untagged trunk/primary ways is wrong here).

| Arterial | Directed km | Lanes per direction | OSM-tagged km | One-way (divided) km | Speeds |
|---|---|---|---|---|---|
| Torrens Street | 0.79 | 1 | 0.21 | 0.62 | 50 |
| Victoria Street | 2.10 | 1 | 0.22 | 1.06 | 50 / 60 |
| Hindmarsh Road | 3.85 | 1 | 2.06 | 0.14 | 50 / 60 |
| Adelaide Road | 2.05 | 1 | 2.05 | 0.08 | 60 |
| Port Elliot Road | 5.18 | 1 | 0.13 | 0.13 | 60 |
| Victor Harbor Road | 1.56 | 1 | 1.00 | 0.44 | 60 / 80 |
| Bay Road | 3.81 | 1 | 0 | 0.29 | 50 / 60 |
| Armstrong Road | 8.51 | 1 | 0 | 0.02 | 50 / 60 / 100 |
| Welch Road | 1.04 | 1 | 0 | 0 | 60 / 100 |
| Waterport Road | 10.04 | 1 | 0 | 0.42 | 50 / 80 |

Where OSM tags lanes on these roads it always says one per direction (e.g. `lanes=2` on two-way
Hindmarsh Rd and Adelaide Rd, `lanes=1` on the divided Torrens St and McCracken approaches).
**Not checked against aerial imagery** (no imagery source is archived; this session had none).
Turn pockets, flared roundabout entries and right-turn bays are **not** in OSM and not modelled
(A-S1-10): a right-turner waiting on a one-lane approach blocks through traffic. This matters most
for right turns from Torrens St / Hindmarsh Rd into Stuart St, Cornhill Rd and Grantley Ave, and
for the ~50 m right-turn lane into Ocean St that the 2017 review describes [S-D19 s3]; add them as
patches once the layout is checked.

**Fix F1 — Torrens St → Ocean St right turn.** OSM has no median opening at Torrens St / Ocean St,
so the right turn from the north-east-bound carriageway into Ocean St did not exist. The 2017 review
counts about 700 such right turns a day and recommends retaining them [S-D19 s3]. The build adds a
one-lane median link (`vhsim/network/fixes/`, edge `vhfix_torrens_ocean_right`) that yields to the
south-west-bound carriageway and leads only into Ocean St (tested). The real ~50 m storage is not
modelled (A-S1-09). The other Torrens St side-street turns (Coral, Hill, Stuart: left and right) are
present.

## Roundabouts (requirement 4)

`vhsim.network.checks.check_roundabouts` tests each ring: edges form one closed directed cycle,
it circulates clockwise, every ring→ring link has priority (`M`), every entry yields (`m`), no
ring node is signalised and it has approaches. **All 31 pass**, and every OSM
`junction=roundabout` way is inside a SUMO roundabout (tested). Named rings:

| Junction | lat, lon | Radius m | Approaches | Circulating km/h |
|---|---|---|---|---|
| torrens_victoria_wills | -35.5559, 138.6207 | 10 | 4 | 19 |
| torrens_crozier | -35.5545, 138.6208 | 11 | 4 | 20 |
| torrens_eyre_seaview_hindmarsh | -35.5516, 138.6230 | 9 | 4 | 18 |
| bay_victoria_georgemain | -35.5573, 138.6119 | 14 | 4 | 23 |
| esplanade_king | -35.5572, 138.6189 | 6 | 3 | 15 |
| adelaide_hindmarsh_portelliot (McCracken) | -35.5365, 138.6391 | 19 | 4 | 27 |
| crozier_canterbury | -35.5495, 138.6110 | 8 | 4 | 18 |
| canterbury_greenhills | -35.5441, 138.6141 | 9 | 4 | 18 |
| armstrong_georgemain_inmanvalley (ring road) | -35.5569, 138.5996 | 25 | 5 | 31 |

The other 22 are residential rings (Encounter Bay, McCracken estates); they pass the same check,
but their radius is small and their shapes come only from OSM: treat them as approximate. There is
no roundabout on Armstrong Rd / Welch Rd other than the George Main Rd one inside the extract.

## Connectivity (requirement 5)

- **Strongly connected:** every edge is usable by cars, trucks and caravans (`trailer`): the
  network is the largest strongly connected car component plus the one-way chains that link it to
  the extract boundary (`checks.drivable_edges`; tested for passenger, truck, trailer).
- **Boundary U-turns (A-S1-08):** where a two-way road splits into one-way carriageways just
  before the extract ends (Victor Harbor Rd / Waterport Rd junction), netconvert builds no
  turnaround, so the two-way road beyond the split was exit-only one way and entry-only the other.
  Three U-turns are added (Victor Harbor Rd at -35.5221, Waterport Rd at -35.5201, Adelaide Rd at
  -35.5266). After that, only edges touching the boundary itself lie outside the inner component
  (tested), so any origin/destination mapped by lon/lat can reach any other inside the model.
- **Gateways** (`gateway_edges.csv`): Victor Harbor Rd north, Port Elliot Rd east, Inman Valley Rd
  west, Waitpinga Rd south-west, plus Welch Rd north, Greenhills Rd north and Waterport Rd east.
  duarouter routes cars, trucks and caravans from every gateway to the town centre (Coral St) and
  back, and trucks between every pair of gateways (tested).
- **Hindmarsh Tiers Rd is not in the extract.** It meets Victor Harbor Rd at about -35.4986, 138.6289
  [S-D05], north of S-E01's bbox (north edge -35.52); its traffic must enter on the Victor Harbor Rd
  north gateway (`hindmarsh_tiers_rd` row resolves to the same edges).
- **The ring road is cut.** S-E01 ends on Welch Rd at -35.5199, 138.6231, before Welch Rd meets
  Victor Harbor Rd. In the model, Victor Harbor Rd north and Welch Rd north are separate gateways;
  traffic that uses the ring road between Victor Harbor Rd and Inman Valley Rd / Waitpinga Rd must be
  injected at the Welch Rd gateway, or it will route through town. The northern extension
  S-S1-01 (below) closes this.
- **Suburbs:** a residential street in each of Victor Harbor, Encounter Bay, Hayborough, McCracken
  and Hindmarsh Valley (its part inside the extract, on Waterport Rd) routes to and from the town
  centre by `fromLonLat`/`toLonLat` (the S2 trip format; tested).

## Turn restrictions

All 16 OSM restriction relations map onto net movements (`vhsim/network/restrictions.py`;
tested: none violated). Five had been lost and are re-applied as connection deletions in the plain
files:

- **Victoria St 17070777–80** (at Burke, King, Granite, Island Sts). OSM tags them `no_right_turn`
  *into the median opening* from one carriageway; the opening only leads to the opposite carriageway,
  so in effect they ban U-turns through the median. `--junctions.join` merged both carriageways and
  the opening into one junction, the restriction was lost and a U-turn appeared; the build deletes it.
  **Correction for the knowledge base:** these are not bans on turning right from Victoria St into
  the side streets. Per OSM, eastbound traffic may still turn right into King St and Burke St
  across the median, and westbound into Granite St and Island St.
- **Torrens St 8181749** (no U-turn via the Torrens Lane median link, a via-way relation netconvert
  ignored): re-applied.

## Named junctions (requirement 6)

`junctions.csv`: 37 intersections from research/E-network.md table E20b plus four on the ring road.
Each is located by the streets that meet there near its OSM position; `control` is read back from
the network and tested against the OSM control type (`control_osm`); `sumo_nodes`, `in_edges` and
`out_edges` give the SUMO elements for movement metrics (S4). All 37 found; all match.

Notes: Torrens St / Coral St has 3 legs (Coral St runs east only; the short `trunk_link` across the
median is inside the joined junction). Hindmarsh Rd / Grantley Ave / Bridge Tce includes the Bridge
Tce node 32 m away and service accesses (6 legs). Where two streets of equal class meet
(e.g. Coral St / Ocean St) both are listed as `major_road`.

## Scenario patches (requirement 7)

`vhsim.network.scenario.build(name, patches_dir)` loads the baseline plain files plus
`*.nod|edg|con|tll|typ.xml` patches and writes `sim/data/networks/<name>.net.xml`. The baseline
net itself is built the same way with no patches. Test scenario
`patches/test_torrens_40/` sets one Torrens St edge (`50904910#0`) to 40 km/h; the test asserts that
edge, and only that edge, changes. The plain files are deterministic (two builds are identical).

## Smoke simulation (requirement 8)

`python -m vhsim.network.smoke` (random trips, 10% trucks, one hour, `--time-to-teleport 300`):

| Run | Trips | Arrived | Teleports (jam / yield) | Jam teleports at roundabouts |
|---|---|---|---|---|
| random, seed 42 | 400 | 400 | 0 | 0 |
| random, seed 1 | 400 | 400 | 0 | 0 |
| random, seed 1 | 3,000 | 3,000 | 0 | 0 |
| town-focused (`--mode town`), seed 7 | 1,500 | 1,500 | 0 | 0 |
| town-focused, seeds 7 and 8 | 3,000 | 3,000 | 0 | 0 |
| town-focused, seed 7 (overload) | 6,000 | 6,000 | 92 (30 / 62) | 0 |

`--mode town` sends half the trips within 1.2 km of the town centre and half between gateways and
the centre. At 3,000 trips/h the Torrens St roundabouts take ~200–550 entering vehicles/h (below the
2017 peak-hour counts, e.g. 1,823/h at Torrens/Seaview/Eyre [S-D19]). At 6,000/h minor-street
entries onto Hindmarsh Rd and Acraman St start timing out (yield teleports), but no roundabout
deadlocks. Gridlock at roundabouts appears only far beyond observed demand (9,000/h). Random trips
are not a demand model; capacity is checked again once S2/S3 demand and calibration exist.

## Northern extension S-S1-01 (pending download)

The northern growth areas (UGMS areas 2 and 3, north of area 1) reach about -35.48, north of S-E01.
`python -m vhsim.network.fetch_osm` fetches a supplementary Overpass extract with S-E01's tag
filters (query `sources/E/query1.overpassql`, bbox -35.60, 138.55, -35.46, 138.67) into
`sim/data/networks/raw/S-S1-01-overpass-victor-harbor-north.osm`, saves the query as
`raw/S-S1-01.overpassql` and writes `raw/SOURCES.tsv` (id, url, query, OSM data timestamp,
retrieved_at, sha256). When that file exists, `python -m vhsim.network.build` uses it instead of
S-E01 (its bbox contains S-E01's), with the north edge at -35.46 for fringe detection and its own
gateway list (Victor Harbor Rd and Hindmarsh Tiers Rd at the DIT centreline crossings of -35.46).
Tests waiting for it (skipped until then): every northern road (Hutchinson Rd, Hindmarsh Tiers Rd,
Waggon Rd, Day Rd, Greenhills Rd, Victor Harbor Rd, Waterport Rd, Welch Rd) routes to and from the
town centre, Hindmarsh Tiers Rd is its own gateway, and a truck from Victor Harbor Rd north to Inman
Valley Rd can use Welch Rd / Armstrong Rd. **Not yet fetched:** downloading needs the user's
approval. Everything above describes the S-E01 build; rerun the build and this file's numbers
after the fetch.

## Still approximate

1. Lanes and turn bays: not imagery-checked; no turn pockets or flared entries (see Lanes).
2. Ring road north end and Hindmarsh Tiers Rd outside the extract (see Connectivity).
3. Junction geometry comes from OSM node positions and `--junctions.join`; divided-road junctions
   are single SUMO junctions; internal turning speeds are netconvert's radius estimates.
4. Rural untagged roads at 50 km/h; Waitpinga Rd 110 km/h from OSM (see Speeds).
5. Give-way/stop signs are not imported: priority comes from road class (the T-junction rule). The
   only OSM `stop`/`give_way` nodes are at Cockle Train level crossings; trains and the 23 railway
   crossings are not modelled.
6. Car parks: car-park aisles are dropped; entries are dead-end service stubs. No parking search
   or parking capacity.
7. Residential roundabouts outside the town centre: complete but small, OSM-shaped (table above).
8. Pedestrian crossings (3 signalised, others zebra) and pedestrians are not modelled.
