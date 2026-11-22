# Stream E: road network, points of interest, residential areas, SUMO feasibility

Retrieved 2026-11-21 (Adelaide). OSM data timestamp 2026-11-20T23:03:20Z. All data (c) OpenStreetMap contributors, ODbL. Sources: S-E01 (OSM extract), S-E02 (boundaries), S-E03 (POI GeoJSON), S-E04 (SUMO test). Methods are in `sources/E/scripts/` (run with `python3 -I`).

## 1. Summary

- The OSM extract imports cleanly into SUMO netconvert 1.28.0 (exit "Success", 0.7 s) [S-E04]. SUMO installs on this Mac (arm64) from a PyPI wheel; `brew` has no `sumo` formula [S-E04].
- The bbox holds 1,708 highway ways, 1,323 of them drivable [S-E01]. Lane counts are missing on 1,253 of the 1,323 (95%); maxspeed is missing on 794 (60%); oneway is untagged on 963 (most are simply two-way) [S-E01].
- There are no signalised road junctions in OSM. Every major town-centre junction is a roundabout or priority T/cross; the only `traffic_signals` tags are 3 pedestrian crossings [S-E01]. **Inference:** the town has no traffic lights, or they are untagged; a site check is needed before assuming that.
- 32 roundabout ways in the bbox; 7 are on the arterial spine (Torrens/Victoria/Wills, Torrens/Crozier, Torrens/Eyre/Seaview/Hindmarsh, Bay/Victoria/George Main, Esplanade/King, Adelaide/Hindmarsh/Port Elliot, Crozier/Canterbury) [S-E01].
- Of the consultation-map streets, Torrens, Victoria, Bay, Crozier, Seaview, Eyre, Coral, Ocean, Railway Tce, Albert Place and Flinders Parade all exist in OSM with those names [S-E01]. Lanes are tagged only on short stretches.
- POIs: 12 supermarket/food-retail, 33 other shops, 17 food/drink, 1 hospital, 6 fuel, 3 caravan sites plus 1 camp site, 5 hotels/motels, 2 schools, 64 sport pitches [S-E03]. Coverage of cafes and restaurants looks low (17) for a town this size.
- Residential landuse: 71 polygons, 874.5 ha; 11 construction polygons (29.5 ha) and two `highway=construction` roads (Seascape Rise, Sandpiper Drive) mark new estate stages in Encounter Bay and McCracken/Chiton [S-E01].

## 2. Findings

### E20a. Network structure of the town centre

Town centre is centred on the OSM `place=town` node at -35.5546, 138.6235 [S-E01]. The arterial spine is the B37 route, tagged as trunk/primary:

| Street | OSM class | lanes | maxspeed | oneway | Notes |
|---|---|---|---|---|---|
| Torrens Street | trunk, ref B37 (11 segments) | mostly missing; 1 on 3 segments, 2 on 1 | 60 | yes on 10 of 11 | Split carriageways around roundabouts [S-E01] |
| Victoria Street | primary, ref B37 (14 segments) + minor segments | missing | 60 (arterial), 50 (local) | yes on 12 of 14 | Split carriageways [S-E01] |
| Bay Road | primary, B37 (6) | missing | 60 | mixed yes/no/untagged | |
| Crozier Road | residential/unclassified (9) | 1 or 2 on 3 segments | 50 on 1 only | yes on 4 | One-way pairs already in the tagging |
| Seaview Road | secondary (3) | 1 on 2 | 60 on 1 | yes on 2 | |
| Hindmarsh Road | trunk, B37 (7) | 1 or 2 on 5 | 60 | yes on 4 | Links to McCracken |
| Adelaide Road | trunk, A13 (6) | 1 or 2 | 60 | yes on 2 | Approach from Adelaide |
| Port Elliot Road | primary, B37 (6) | 1 on 2 | 60 on 2 | yes on 2 | Approach from Port Elliot |
| Victor Harbor Road | trunk, A13 (4) | 2 on 1 | 80 on 3, 60 on 1 | yes on 3 | |
| Ocean Street | residential (1 way) | missing | 50 | yes | Already one-way in OSM [S-E01] |
| Railway Terrace | unclassified (1 way) | missing | missing | yes | Already one-way in OSM |
| Albert Place | unclassified (2) | 2 | missing | no on one | |
| Flinders Parade | residential (1) | 2 | missing | untagged | |
| Coral Street | residential x2 + trunk_link | 2 on one | 50 | untagged | |
| Eyre Terrace | residential (3) | 1 | 50 on 1 | yes on 2 | Part of the Torrens/Eyre roundabout |
| Esplanade | residential (3) | 2 | missing | untagged | Foreshore, Victoria St east |
| Franklin Parade | tertiary (10) | 2 | 50 | no | Encounter Bay |

**Inference:** because Ocean Street and Railway Terrace already carry `oneway=yes`, the OSM geometry may partly encode the existing local one-way pattern; the council's proposed loop direction must be checked against the consultation map before coding it. Street names not found in OSM: "Mount Breckan Road", "Lakala Road", "The Esplanade" (it is "Esplanade"). "Breckan Avenue" does exist (off Hindmarsh Road) [S-E01].

### E20b. Town-centre intersections (from OSM topology, plus roundabout tags)

Control type is what OSM shows; nothing is signalised. "Legs" counts roads meeting at the junction node (or roundabout).

| Intersection | Approx. lat, lon | Control (OSM) | Legs |
|---|---|---|---|
| Torrens St / Victoria St / Wills St | -35.5560, 138.6207 | Roundabout (trunk) | 3 |
| Torrens St / Crozier Rd | -35.5545, 138.6208 | Roundabout (trunk) | 3 |
| Torrens St / Eyre Tce / Seaview Rd / Hindmarsh Rd | -35.5516, 138.6230 | Roundabout (trunk), five-leg incl. split carriageways | 4 |
| Bay Rd / Victoria St / George Main Rd (+ service) | -35.5573, 138.6119 | Roundabout (primary) | 4 |
| Esplanade / King St | -35.5572, 138.6189 | Roundabout (residential) | 2 |
| Crozier Rd / Canterbury Rd | -35.5495, 138.6110 | Roundabout | 2 |
| Canterbury Rd / Greenhills Rd | -35.5441, 138.6141 | Roundabout | 2 |
| Adelaide Rd / Hindmarsh Rd / Port Elliot Rd (+ service) | -35.5365, 138.6391 | Roundabout (trunk), McCracken | 4 |
| Hindmarsh Rd / Cornhill Rd | -35.5505, 138.6239 | Priority T | 3 |
| Torrens St / Coral St (two nodes) | -35.5539, 138.6212 | Priority, 4 legs | 4 |
| Torrens St / Hill St | -35.5529, 138.6221 | Priority cross | 4 |
| Torrens St / Ocean St | -35.5521, 138.6227 | Priority T | 3 |
| Torrens St / Stuart St (with trunk_link) | -35.5531, 138.6219 | Priority | 4 |
| Victoria St / Crozier Rd / (residential) | -35.5555, 138.6222 | Priority | 4 |
| Coral St / Stuart St | -35.5539, 138.6221 | Priority cross | 4 |
| Coral St / Ocean St | -35.5539, 138.6230 | Priority cross | 4 |
| Coral St / McKinlay St | -35.5538, 138.6236 | Priority T | 3 |
| Coral St / Railway Tce | -35.5538, 138.6238 | Priority T | 3 |
| Coral St / Flinders Pde | -35.5538, 138.6247 | Priority T | 3 |
| Albert Pl / Ocean St | -35.5557, 138.6231 | Priority T | 3 |
| Albert Pl / Railway Tce | -35.5559, 138.6232 | Priority T | 3 |
| Albert Pl / Esplanade | -35.5567, 138.6232 | Priority T | 3 |
| Eyre Tce / Flinders Pde / Bridge Tce | -35.5526, 138.6244 | Priority | 3 |
| Eyre Tce / McKinlay St | -35.5519, 138.6234 | Priority T | 3 |
| Flinders Pde / Granite Island Rd | -35.5567, 138.6248 | Priority T | 3 |
| Victoria St / Burke St (+ primary_link) | -35.5563, 138.6195 | Priority, no right turn from Victoria St | 4 |
| Victoria St / King St | -35.5567, 138.6185 | Priority, no right turn from Victoria St | 4 |
| Victoria St / Island St | -35.5573, 138.6167 | Priority, no right turn from Victoria St | 4 |
| Victoria St / Granite St | -35.5571, 138.6172 | Priority, no right turn from Victoria St | 4 |
| Victoria St / Oval Rd | -35.5576, 138.6155 | Priority T | 3 |
| Crozier Rd / Stuart St | -35.5552, 138.6221 | Priority T | 3 |
| Crozier Rd / Acraman St / Lindsay St | -35.5534, 138.6186 | Priority cross | 4 |
| Seaview Rd / Acraman St / Carlyle St | -35.5503, 138.6209 | Priority cross | 4 |

All from [S-E01]; positions are node coordinates, rounded. The turn restrictions on Victoria Street (4 `no_right_turn`, relations 17070777-17070780) apply at Burke/link, King, Island and Granite Streets [S-E01].

Control-type inventory across the bbox [S-E01]: no `highway=traffic_signals` nodes; 3 `crossing=traffic_signals` pedestrian crossings (Torrens St near Coral St, two nodes at -35.5537, 138.6214; one at -35.5608, 138.6063 near Bay Rd/Franklin Pde); 2 `give_way` and 2 `stop` nodes (level-crossing signs on the Cockle Train line); 23 railway crossings.

Turn restrictions: 16 relations in the bbox (7 `no_u_turn`, 7 `no_right_turn`, 1 `only_right_turn`, 1 `only_straight_on`). In the centre: three `no_u_turn` on Torrens Street (including one at the Torrens Lane node 598105926) and four `no_right_turn` on Victoria Street. Others are at Hindmarsh Road/Adelaide Road (McCracken), Greenhills Road and Mill/Tabernacle Roads [S-E01].

### E20c. Granite Island causeway

Granite Island Road is tagged `highway=pedestrian` / `footway` with `access=no/permit` on the causeway segments, plus a `service` stub from Flinders Parade [S-E01]. The causeway is a pedestrian/horse-tram route, not a car route. The Cockle Train is `railway=rail`, `bridge=yes` on the same line [S-E01].

### E20d. Tagging gaps

Drivable ways (1,323) [S-E01]:

| Tag | Missing | Share |
|---|---|---|
| lanes | 1,253 | 95% |
| maxspeed | 794 | 60% |
| oneway | 963 | 73% (untagged normally means two-way) |
| name | 480 | 36% (mostly service roads) |
| surface | 557 | 42% |

By class: primary 35 ways (8 without maxspeed, 31 without lanes), secondary 45 (6, 42), tertiary 25 (10, 16), unclassified 65 (51, 58), residential 679 (283, 652). Maxspeed values present: 50 km/h x419, 60 x77, 100 x13, 80 x12, 110 x4, 40 x2, 20 x1, 30 x1 [S-E01]. Unlabelled maxspeed will default to the SUMO highway-type speed (netconvert default for residential is 50 km/h, for primary 70 km/h), which would be wrong on the 60 km/h arterial segments that lack tags. Most car parks are `highway=service` with no name; 146 parking features exist but only 4 have a name and 2 a capacity.

### E21. Points of interest (GeoJSON: S-E03, 405 points; category is a heuristic label)

| Category | Count | Examples |
|---|---|---|
| Supermarket / food retail | 12 | Woolworths and Victor Central Shopping Centre (-35.553, 138.620), Drakes (-35.5517, 138.6222), IGA (-35.5577, 138.6161), Aldi (-35.5302, 138.6382), Coles (-35.5349, 138.6372), The Centre (mall), Veg Out, 2 bakeries, 2 convenience |
| Other shops | 33 | |
| Food and drink | 17 | cafes, restaurants, pubs (under-mapped) |
| Health | 1 hospital (South Coast District Hospital -35.5615, 138.6065), 2 pharmacies (Amcal, TerryWhite Chemmart), 1 vet | No medical/dental clinics mapped |
| Services | 1 bank (Commonwealth Bank), 2 post offices, 1 town hall node (-35.5542, 138.6223), 1 library, 1 courthouse, 1 police, 3 fire stations, 1 community centre, 5 social facilities (ECH) | |
| Gym / fitness | 1 fitness centre (Anytime Fitness -35.5568, 138.6165), 2 sports centres, 32 swimming pools (mostly private; ignore) | |
| Schools | 2 schools (Victor Harbor High -35.5563, 138.6117; Victor Harbor R-7 -35.5412, 138.6243), 1 childcare | |
| Sports grounds | 64 pitches (Encounter Bay Oval, croquet, oval cluster at -35.557, 138.613), 2 golf courses (McCracken Country Club, Victor Harbor Golf Club), 2 tracks | |
| Caravan / holiday parks | 3 caravan sites (Victor Harbor Beachfront Holiday Park -35.5599, 138.6123; Victor Harbor Holiday Park -35.5583, 138.6086; Adare Camp and Caravan Park -35.5411, 138.6279) + 1 camp site | |
| Hotels / motels | 2 hotels (Grosvenor, Anchorage Seafront), 3 motels | |
| Fuel | 6 | Caltex (Torrens St), Shell (Hindmarsh Rd), 3 at McCracken, Liberty |
| Beach / foreshore | 14 beach polygons; named car parks: Boomer Beach (50 spaces), McKinlay Street (2), Bluff Boat Ramp (24) | |
| Tourism | 2 attractions (Horse-Drawn Tram, Big Duck), 3 museum nodes, 13 viewpoints | |
| Bus stops / transport | 24 (Hindmarsh Rd and Port Elliot Rd stops 1-8, Victoria St, Bay Rd, Maude St) | |

All [S-E03]. No Victor Central parking-lot capacity is tagged. **Inference:** the trip attractors cluster in a band between Torrens Street and Ocean Street (Woolworths/Victor Central at -35.553, 138.620; Drakes at -35.5517, 138.6222; post offices, bank, hotels at -35.554, 138.623), which falls inside the proposed loop area.

### E22. Residential areas and growth

Suburb boundary relations (admin_level 9) in the bbox: Victor Harbor, Encounter Bay, Hayborough, McCracken, Hindmarsh Valley, Port Elliot, Chiton, Back Valley, Lower Inman Valley, Waitpinga; LGA relations are City of Victor Harbor and Alexandrina Council [S-E02]. No "Mount Breckan" boundary exists; OSM has Breckan Avenue only [S-E01, S-E02].

Landuse totals [S-E01]: residential 71 polygons / 874.5 ha; retail 8 / 27.2 ha; industrial 7 / 43.4 ha; construction 11 / 29.5 ha; farmland 28 / 189.5 ha. The largest residential polygons (ha, centroid): 135.4 (-35.526, 138.605); 90.2 (-35.584, 138.592); 68.8 (-35.577, 138.591); 40.8 (-35.561, 138.583); 31.1 (-35.568, 138.604).

New-estate signals in OSM [S-E01]:
- `landuse=construction` polygons checked 2025-09-23 and 2026-01-14: McCracken/Chiton edge (8.5 ha, -35.530, 138.647), Encounter Bay (5.9 ha at -35.566, 138.590; 4.1 ha at -35.565, 138.598), near Canterbury Rd (3.2 ha, -35.546, 138.611).
- `highway=construction`: Seascape Rise and Sandpiper Drive (Encounter Bay, -35.565, 138.590); `highway=proposed` River Road, Canterbury Road, Antrim Street (sourced from data.sa.gov.au) [S-E01].

## 3. SUMO toolchain feasibility [S-E04]

- `brew info sumo`: no formula found. No `sumo` in homebrew/core, supabase/tap or gcenx/wine.
- `pip index versions eclipse-sumo`: 1.28.0 current (also 1.27.1, 1.27.0 ...). PyPI has `eclipse_sumo-1.28.0-py3-none-macosx_15_0_arm64.whl` (54 MB); this Mac is Darwin 24.6 / macOS 15.6.1 arm64 and Python 3.15.2, so it fits [S-E04].
- I installed it into a throwaway venv in the session scratchpad (not system-wide) and ran netconvert on the OSM. The venv contains `netconvert`, `sumo` and `sumo-gui` and the "Build features" line reports Darwin arm64 with GUI, Proj, GDAL, Parquet, JuPedSim [S-E04].
- Command that would be needed (in a project venv): `python3 -m venv .venv && .venv/bin/pip install eclipse-sumo traci sumolib`, then `SUMO_HOME=$(.venv/bin/python -c "import sumo;print(sumo.SUMO_HOME)")`. `sumo-gui` on macOS may need XQuartz; the wheel's GUI build is OpenGL/Cocoa-based, untested here. Source build is the other route.
- netconvert test: command saved in `sources/E/netconvert-test-command.sh`, finished "Success." in 0.7 s, producing 14,380 `<edge>` elements (including internal lane edges) and 0 traffic lights. Warnings: 22 sharp turns, 12 intersecting left turns, 44 turn-radius speed reductions; ~20 "incomplete roundabout" notes after `--geometry.remove` / vclass filtering. The roundabouts that lose edges should be checked in `netedit` before the model is trusted [S-E04].
- **Inference:** because OSM has no signalised junctions, the base network needs no TLS programmes unless a site check says otherwise; apply 60 km/h to untagged B37/A13 segments (see tagging gaps) before running.

## 4. Expected items status

| E-id | Status | Sources | Notes |
|---|---|---|---|
| E20 OSM road network | found | S-E01, S-E02 | Raw .osm archived; lanes/maxspeed gaps listed |
| E20 intersection table | partial | S-E01 | Derived from topology; control types limited to what OSM shows; not field-verified |
| E21 POIs (GeoJSON, counts) | found | S-E03 | Cafe/restaurant coverage looks thin; Victor Central is a mall polygon + Woolworths |
| E22 residential zones, new estates | partial | S-E01, S-E02 | Landuse polygons and construction flags found; no estate names or lot yields |
| Toolchain feasibility | found | S-E04 | netconvert runs; commands given |

## 5. Discoveries

- All three signal-tagged nodes are pedestrian crossings; there are no tagged traffic-signal intersections in Victor Harbor [S-E01].
- Victoria Street and Torrens Street already carry split carriageways (oneway=yes on most segments) which complicates the "one-way loop" scenario in a model [S-E01].
- Four existing `no_right_turn` restrictions on Victoria Street between King and Burke Streets [S-E01].
- `highway=proposed` roads (River Road, Canterbury Road, Antrim Street) sourced from the SA government data portal hint at planned subdivision links [S-E01].
- OSM has numbered bus stops 1-8 along Hindmarsh Road and Port Elliot Road, which gives a ready-made bus route to model [S-E03].

## 6. Open questions / leads

- Confirm with council whether any junction in the centre is signalised or planned to be, and the loop direction (OSM already marks Ocean St and Railway Tce one-way).
- Obtain traffic counts and speed limits for B37/A13 segments (Torrens, Victoria, Hindmarsh, Adelaide Rd), since OSM lanes are 95% untagged.
- Check the Crozier Road / Torrens Street 'roundabout' ways that lose edges in netconvert; may need netedit repair.
- Get parking capacities for the McKinlay Street car parks, Victor Central, and foreshore from council records.
- Chase new-estate stage details (Seascape Rise, Sandpiper Drive; McCracken/Chiton construction) via planning approvals; OSM only shows geometry.
- The OSM POI set is light on cafes and clinics; supplement from council or Google/Yellow Pages if trip generation matters.
