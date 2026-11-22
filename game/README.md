# Schoolies Siege

A light-hearted, slightly spooky top-down pixel-art caper set in Victor Harbor, South Australia, during Schoolies week.
Roam the real streets, borrow cars (and the horse tram, and the steam train), knock over bins and street lights, and work through a short three-night story as one of three characters.
Nobody gets hurt: people always jump out of the way.

It is an original game. It uses no names, art, music, logos or UI from any other game series, and no real people.
The police are early-90s arcade police: when you play Jaz or Merv they chase, ram, set roadblocks and (at high gossip) taser you on foot and fire at your car, with tracers, sparks, dents and blown tyres, never blood or injuries, never at bystanders, and never at open riders (bikes, scooters, gophers).
When you play Constable Kev you have no gun: siren, PIT nudges, spike strips, a megaphone and backup. Kev never gets tackled; he does the tackling, and plays the struggle in reverse (keep the culprit in the zone until the cuffs are on; his Grip level grows like the Escape Artist level).
Real places (Warland Reserve, Granite Island causeway, Rosetta Head / The Bluff, the golf club, the station) come from OpenStreetMap.

![Title](screenshots/title.png)

## Run it

It is static files only. Serve the `game/` folder with any static server and open `index.html`:

```sh
cd game
python3 -m http.server 8000
# open http://localhost:8000/
```

Opening `index.html` straight from disk (`file://`) won't work, because browsers block `fetch()` of the local data files.

The game makes no network calls at runtime: map data, styles and scripts are all local, and there are no external libraries.
Sound is synthesised with the Web Audio API.

## Characters and story

| Character | Goal | Night 1 (Thu) | Night 2 (Fri) | Night 3 (Sat) |
|---|---|---|---|---|
| **Jaz, the Schoolie** | Become a Schoolies legend | Chip Run (fish shop to Warland Reserve, mind the gulls); Ding Dong Ditch (ring 4 doorbells, then hide from the resident's torch) | Doughnuts on the Green (250 m of tyre marks on the golf course); Tram-Jacking (horse tram to Granite Island) | The Last Train (steam train east to the end of the line); Midnight at the Bluff (finale) |
| **Merv, the Gopher Grump** | Shut down the party at Warland Reserve | Strongly Worded Letters (5 letterboxes); Turn That Down (scatter 3 backyard doof-doofs; unlocks the turbo gopher) | The Big Rig (park a B-double across the Esplanade); Lights Out (5 street lights near the reserve) | Shut It Down (flatten the speaker stacks and inflatable flamingos) |
| **Constable Kev** | Hound everyone equally | Gopher Patrol (pull over 3 gophers holding up traffic); Ding Dong Ditchers (run 3 kids down on foot, tackle them and keep hold) | Runaway Tram (stop the stolen tram); Hoon on the Esplanade (stop a hoon, tackle them when they bail, drive them to the lock-up); Bin Night Bandits (stand 8 bins back up) | Midnight Express (stop the stolen steam train); Midnight at the Bluff (finale) |

Each character has a win screen. **Free Roam** has no jobs and lets you cycle the time of day with `T`.
Kev is the senior constable at a small station: two junior constables (Tegan and Bazza) come when he calls backup, and the sergeant is on the radio.

The current job is always on screen (title and objective, bottom centre). `J` reopens its brief, the pause menu shows it, new jobs arrive with a phone buzz and wait for Enter, and the arrow at the screen edge says what it points to and how far ("FISH SHOP · 623M").

### The gossip meter and the police (Jaz, Merv, free roam)

Five curtain icons. Smashing things, borrowing cars, crashing into traffic, speeding past a patrol car, driving on the footpath and people jumping out of your way all raise it.
Two patrol cars cruise about town; if one sees you do something it joins in straight away. The HUD says **POLICE INTERESTED** when a patrol is near or the gossip is up, and **POLICE CHASING** once they're after you.

| Gossip | Response |
|---|---|
| 1.5 | a patrol car responds |
| 2.5 | two cars: one rams, one cuts you off |
| 3 | roadblocks ahead of you at roundabouts, bridges and the causeway (always with a gap, or the footpath); the police boat comes out if you're near the foreshore; officers who get out carry tasers |
| 3.5 | officers fire at your car: tracers, sparks, dents and blown tyres; never past a bystander, never at bikes, scooters or gophers (you can see the rider), never at the tram or train |
| 4 | Neighbourhood Watch on gophers (sooner if you're notorious); spike strips at roadblocks |
| 4.5 | four cars and the chopper with its spotlight |

**Busted:** when you're stopped, boxed in or on foot, patrol cars pull up and officers jump out and run at you. If one reaches you (pulling you out of the car first if you're sitting still) it's a flying tackle, and you're both on the ground.
Then comes **the struggle**: a green escape zone drifts along a bar. Hold Space (or the big HOLD button on a phone) to push your white mark right, and let go to let it slide back. Time in the zone fills your ESCAPE meter; time outside fills their CUFFS meter.
Every couple of seconds they shift their grip and a **SLIP** window flashes with a direction: press that arrow (or tap that side on a phone) in time for a big chunk of escape; pressing wrong, or flailing when nothing's on offer, costs you.
Rookies are easy, senior constables grip harder and move the zone faster, and the sergeant is the toughest. Your **Escape Artist** level (shown over the bar, kept between sessions) grows with every scramble and widens the zone; slippery sunscreen from the servo helps too.
Break free and the officer is left on the ground for a moment; lose and it's cuffs.
Drive off before they reach you, shove through them (they jump out of the way) or outrun them on foot. Officers left behind run back to their cars.
Then the paddy wagon takes you up the hill to **The Big House on the Hill**, the lock-up (a made-up lock-up on the hill: battlements, turrets, a flag, a sweeping searchlight and a gatehouse). You pay a small fine, are let out at the gate, and the current job starts again. Enter skips the ride.

**Losing them** (also in the `?` overlay):

- Break line of sight and stay out of view until the heat cools. The gossip only cools once they've lost sight of you.
- Hide and keep still: scrub and bushland, car parks, the golf course, the car wash on the main road, under the jetty. The gossip cools faster while you're hidden.
- Swap cars (or get out) where they can't see you: they keep looking for the old one.
- **Respray shops** (spray-can icon on the minimap and full map, a sign and a striped roller door on the street): drive in and stop. $25 gives your car a new colour and wipes its description. There are three, all with invented names: Dent & Duco in the industrial estate, Corner Panel & Paint in town, North End Resprays at McCracken. The first time the police chase you a tip points you at them, and a respray-voucher crate marks the nearest one.
- **A change of clothes** out of sight (clothes shop or op shop) does the same for you on foot, and makes the doorbell clips harder to match to you (notoriety drops one).
- Roadblocks always leave a gap or a footpath.
- Party poppers (from crates) make them look the wrong way for a few seconds; a sausage-sizzle snag stops Neighbourhood Watch.

**Complaints meter** (Constable): your own mayhem draws complaints. Five means the Sergeant rings, and that costs you.

### Ding dong ditch, doorbell cameras and notoriety

After you ring, duck behind cover and keep still (a bush or tree, a fence, a bin, a letterbox, a parked car): **HIDDEN** shows over you.
The resident comes out in a dressing gown with a torch and searches the yard. Some are quick, some thorough, and some bring a yappy dog that sniffs you out.
If the torch catches you on foot it's a citizen's arrest: the same struggle as a police tackle, but easier (residents and Neighbourhood Watch are the weakest grip in town). Notoriety gives them a head start.

Some houses have doorbell cameras (a blinking blue light by the door). Get caught on one and the clip goes up on **Victor Harbor Locals Talk**, an invented community page, with comments rolling in. Each clip adds to your **notoriety** (blue dots in the HUD): comments turn against you, locals recognise you ("IT'S THAT KID FROM THE COMMUNITY PAGE!"), retirees try citizen's arrests, and Neighbourhood Watch turns out sooner.

### Shops, clothes and gopher boosts

Walk into a shop door (they have a yellow mat and a sign) and the roof fades away to show the inside: a counter, shelves and a shop assistant. Press E (or ACT) at the counter for a chat with two or three choices. Walk back out of the door to leave.
The shops sit in real shop buildings from OpenStreetMap; every name is invented:

| Shop | Sells |
|---|---|
| Gulls Nil Fish & Chips | chips (gull bait), gossip |
| Crumbs Bakery | a finger bun (a sugar-rush sprint), a pie, gossip |
| Servo 24 | slippery sunscreen (better odds in a struggle), a slushie (a sprint) |
| Scoot & Sons Mobility | the double battery (a faster gopher, longer boosts) and the racing stripe (quicker off the mark, and a stripe) |
| Surf & Turf Threads | a new shirt, a hat (cap, bucket hat, beanie, party hat, sun hat), sunnies |
| Second Chance Op Shop | a mystery bag (random shirt and hat), Dad's old sunnies |

Clothes are cosmetic and per character: they show on your sprite and on the character select, and they're kept between sessions.

**Gopher boosts:** spare batteries turn up on footpaths (ride over one on a gopher), and boost pads (teal chevrons) sit along the foreshore path and the gopher grand prix route. A boosted gopher hits a comic top speed (about two and a third times normal) with sparks and a wheelie.

**Tags:** spray paint (from crates) goes where you can see it from above: the south-facing wall of a building, a shed roof, a Colorbond fence, or, if there's nothing else, chalk on the footpath or the skate park. The designs are cheerful pictures (a smiley, a star, a heart, a wave, a crown), and tags stay put between sessions.

### Things to do between jobs

Markers on the minimap and full map (`M`): **M** Mayhem Minute, **R** ramp, **G** gopher grand prix, **B** bike race, **T** tram trial, **S** train trial, **H** helipad, a spray can for each respray shop, and blue dots for the walk-in shops.

- **Mayhem combo:** each smash scores more while the combo runs. **Mayhem Minute** pads (the Esplanade lawn and the main street): topple 30 things in 60 seconds.
- **Drifts:** handbrake drifts score; drifts on a roundabout go on that roundabout's top three.
- **Stunt ramps** (Warland Reserve, the golf course, two ovals) and sand dunes on the beach, with airtime scores. Bikes bunny-hop with Space.
- **Races:** the Gopher Grand Prix along the Esplanade, the Foreshore Bike Race, and tram and steam-train time trials. Stop on the start pad in the right vehicle.
- **Loot crates** in alleys, car parks, the foreshore and the industrial estate: drive into one or kick it. Pickups: cash, a boost, a tyre repair, a respray voucher, a police scanner (patrol cars on your minimap for a minute), spray paint (see Tags), a party popper, a sausage-sizzle snag. Crates come back slowly.
- **Twenty lost thongs** around town, and two easter eggs (a giant penguin on Granite Island at night; the ghost whale at midnight outside the finale).
- **Clean getaways** from a chase of three curtains or more pay out.
- **Helicopters:** a white-and-red rescue helicopter on the hospital helipad (from OpenStreetMap) and the police helicopter on a pad at the oval by the Maude Street roundabout. Borrow one with E. It flies over everything; landing anywhere but a helipad is bumpy; rotor wash blows bins over. Stealing one raises the gossip a lot, and the police chopper comes after you.
- **Bikes:** BMXs, beach cruisers and e-scooters by the foreshore and footpaths. Fast on paths, wobbly on sand.

Bests (drifts, airtime, race times, thongs, getaways) are kept in `localStorage`.

Each night runs from 19:30 on a game clock (one game minute per real second). If the sun comes up before you finish, you replay the night.
Progress is saved to `localStorage` at the start of each night. If storage is blocked, the game still plays.

## Controls

W/A/S/D work everywhere the arrow keys do: walking, driving, flying and menus. No other action uses W, A, S or D.

| Action | Keyboard | Touch |
|---|---|---|
| Walk (default "like a car": forward, back, turn) | W / S, A / D (or arrows) | Drag on the left half: you turn and walk toward your thumb |
| Drive / ride | W accelerate, S brake and reverse, A / D steer | Drag on the left half: the vehicle steers toward your thumb |
| Sprint (on foot), giddy up (tram), turbo gopher | Shift | BOOST |
| Get in / get out (borrow), also by walking into a parked car's driver's door | E or Enter | GET IN / GET OUT |
| Handbrake drift; bike bunny-hop; on foot: use, ring doorbell, stand bins up, tag a wall or footpath, chat at a shop counter | Space (or E at a counter) | SKID / HOP / ACT |
| Go into a shop | walk into its door | walk into its door |
| The struggle when tackled (and Kev's version) | hold Space; the arrow it shows when SLIP flashes | HOLD button; tap that side |
| Kick (bins, cones, eskies, chairs, crates, footies) | F | KICK |
| Horn, siren (police car), shout, megaphone (Kev on foot), tram bell, train whistle | H | HORN / SIREN / SHOUT / MEGA |
| Helicopter: climb / descend and land | Shift / Space | UP / DOWN |
| Kev: spike strip / call backup | X / B | SPIKES / BACKUP |
| Zoom in / out / reset (remembered) | Mouse wheel or + and - (also = and _), 0 | Pinch |
| Current job brief | J (or O) | JOB |
| Contextual controls overlay | ? | ? |
| Map (zoom with wheel or + -, pan with arrows or drag, 0 resets) | M or Tab | MAP |
| Pause (shows the job; controls card; walking style) | P or Esc | PAUSE |
| Mute | N | (in the pause menu) |
| Time of day (Free Roam) | T | |

The pause menu has **Walking: like a car / screen direction**. Screen direction is the old style (WASD moves you up, left, down, right on screen); the choice is remembered.
The title screen and the pause menu both have a **Controls** card. A short set of tips runs the first time you play.

Rail vehicles only go forward and back along their track.

The camera is close when you're on foot or slow and pulls out as you pick up speed (or height in a helicopter), always at whole art-pixel scales so the pixel art stays crisp. Your zoom choice is added on top.

![Character select](screenshots/character-select.png)

| | |
|---|---|
| ![The lock-up at night](screenshots/lockup-night-searchlight.png) | ![Busted](screenshots/paddy-wagon-busted.png) |
| ![The paddy wagon ride](screenshots/paddy-wagon-ride.png) | ![A chase with a roadblock and the chopper](screenshots/chase-roadblock-chopper.png) |
| ![Kev with backup](screenshots/kev-backup-hoon-chase.png) | ![Hiding from the torch](screenshots/ding-dong-hide-from-torch.png) |
| ![The community page](screenshots/doorbell-camera-community-page.png) | ![A loot crate pickup](screenshots/loot-crate-pickup.png) |
| ![Rescue helicopter](screenshots/rescue-helicopter.png) | ![Handbrake drift](screenshots/handbrake-drift.png) |
| ![The ? overlay](screenshots/help-overlay-kev.png) | ![Phone, portrait](screenshots/phone-portrait-constable.png) |
| ![Inside the fish shop](screenshots/shop-interior-fish.png) | ![A new look from the clothes shop](screenshots/clothes-shop-new-look.png) |
| ![The struggle after a tackle](screenshots/tackle-struggle.png) | ![Kev tackles a ditcher](screenshots/kev-tackles-ditcher.png) |
| ![Respray shops on the map](screenshots/map-respray-shops.png) | ![At a respray shop](screenshots/respray-shop.png) |
| ![A boosted gopher pulling a wheelie](screenshots/gopher-boost-wheelie.png) | ![A wall tag and footpath chalk](screenshots/spray-tag-wall-and-chalk.png) |

## What's in the world

- **Map:** roads with real widths and lanes, roundabouts, footpaths, the Victor Harbor railway line, the horse-tram line along the causeway, about 11,800 building footprints, land use, the coastline, Granite Island, the Bluff, the rivers, and Encounter Lakes.
  - **Junctions** join with continuous asphalt: each corner has a kerbed fillet, lane and centre lines stop at the junction edge, and minor roads get give-way lines (stop lines near traffic signals). Cul-de-sacs end in a turning bulb.
  - **Roundabouts:** all 31 mapped roundabouts are drawn as a ring with a kerbed island (a truck apron, grass and shrubs, a tree on the bigger ones), flared entries and exits, give-way lines on every entry, and splitter islands where a divided road meets the ring. Traffic goes round clockwise.
  - **Bridges** have a car-scale deck (at least 9 m of carriageway on a two-way road, never narrower than the road leading on), footpaths on both sides, a shadow on the water and railings on both edges. The railings are solid: cars, people and the police can't go over the side. Footbridges and the causeway have timber railings.
  - **Level crossings:** the road carries straight over the tracks.
  - **Names:** street names are painted along the road (main roads stay when the camera pulls out; local streets drop out at the widest zoom), suburb and park names sit faintly on the ground, and the full map (`M`) shows street names as you zoom in.

| | |
|---|---|
| ![A roundabout before](screenshots/map-roundabout-victoria-bay-george-main-before.png) | ![The same roundabout after](screenshots/map-roundabout-victoria-bay-george-main-after.png) |
| ![The Hindmarsh River bridge before](screenshots/map-bridge-hindmarsh-river-before.png) | ![The Hindmarsh River bridge after](screenshots/map-bridge-hindmarsh-river-after.png) |
| ![A crossroads](screenshots/map-junction-crossroads-seaview-william-after.png) | ![Street names on the road](screenshots/street-names-close.png) |
| ![Street names on the full map](screenshots/full-map-names-zoomed.png) | ![A level crossing](screenshots/map-level-crossing-eyre-tce-after.png) |
- **Vehicles:** hatchbacks, sedans, utes, an ice-cream van, a hearse (parked at the cemetery), gophers, a B-double (at the Maude Street industrial estate, and now and then in traffic), police cars and the paddy wagon, BMXs, beach cruisers and e-scooters, two helicopters, the horse tram and the steam train. Cars top out around 190 km/h (police faster), with strong brakes and handbrake drifts.
- **Destructibles:** street lights, which go dark when knocked over; traffic lights; wheelie bins with red, yellow and green lids; letterboxes; Colorbond fence panels; café chairs and tables; benches; phone boxes; and fire hydrants, which gush.
  They topple with a bounce, spill debris, and stay down for the rest of the session.
- **Tyre marks:** these stay on grass, lawns, crops, sand and the golf course, and skid marks stay on asphalt. Marks are stored per map chunk, so they survive the chunk cache.
- **Life:** AI traffic drives on the left and follows the road graph, so gophers on the main road create queues and honking.
  There are also pedestrians who jump out of the way, seagulls that raid chips, whales surfacing in Encounter Bay, and a Schoolies party at Warland Reserve.
- **Look:** a crisp pixel-art style rendered at 4 art pixels per metre and upscaled with nearest-neighbour.
  - **Lighting:** day, golden hour, dusk and night grading with a multiplied light map, plus bloom on street lights, porch lights, shop windows, headlight cones, brake lights and police lights.
  - **Sea and surf:** depth-graded sea with wavelets, surf foam along the shore, and moonlight glints.
  - **Weather and spooks:** sea fog rolls in after about 22:00. At midnight on the Bluff there are wisps of light and a ghost whale.
  - **Juice:** screen shake, hit-stop, sparks, glass, smoke from damaged cars, dust on dirt, and confetti.

## Rebuilding the map

```sh
node game/tools/build_map.mjs             # writes game/data/map.json and game/data/ground_0.png, ground_1.png
node game/tools/build_map.mjs --preview /tmp/ground.png   # optional colour preview of the ground raster
```

It needs only Node 18 or later, with no npm packages. It reads `game/data/raw/G-01-victor-harbor-all.osm`.

To refresh the raw extract, re-run the Overpass query and update `game/data/raw/SOURCES.md` (date and sha256):

```sh
curl --data-urlencode "data@game/data/raw/G-01-victor-harbor-all.overpassql" \
  https://overpass-api.de/api/interpreter -o game/data/raw/G-01-victor-harbor-all.osm
```

What the baker does:

1. It projects WGS84 to local metres, with the origin at the north-west corner of bbox 138.57, -35.598 to 138.66, -35.53. That is 8.2 km by 7.5 km.
2. It extracts these vector layers: roads (class, width from `width` or `lanes` or a class default, one-way, roundabout, bridge), rails, buildings (levels), land-use areas, barriers, waterways, places, and points of interest.
3. It splits drivable ways at shared nodes into a road graph, which the AI traffic and the constable's A* route-finding use.
4. It rasterises a 2 m grid of ground classes. The sea comes from flood-filling inside the `natural=coastline` ways. It then computes chamfer distance fields for distance to the shore (used for the sea colour, surf and whales) and distance to the nearest road.
5. It generates props deterministically: a letterbox, wheelie bins and sometimes a front fence for each house, using the nearest local road; street lights along roads where OSM has none mapped; traffic-light poles at `traffic_signals` nodes; café furniture outside cafés; and trees and shrubs scattered through parks, scrub and backyards. Norfolk Island pines go on the foreshore.
6. It joins the rail pieces into one route for the steam train and one for the horse tram.
7. It builds the road furniture (map.json `decor`, all in decimetres):
   - **junctions:** at every graph node where three or more arms meet, each arm is carried in at full width until it clears its neighbours, and the corners between arms get a kerb-radius fillet (a quadratic curve through the point where the two road edges meet). The renderer fills the polygon with asphalt inside a kerb and cuts the lane markings back to its edge. Each junction also carries its give-way (dashed) or stop (solid) lines across the inbound lanes: on every roundabout entry, on the terminating arm of a T, on any arm of lower class than the two main arms, and stop lines on every inbound arm within 30 m of traffic signals.
   - **islands:** the `junction=roundabout` ways are chained into closed rings; the island is the ring pulled in by half the carriageway width. Rings too tight for an island get a painted dome (`minis`, as would any `highway=mini_roundabout`, though the extract has none).
   - **splitters:** where the two one-way carriageways of a divided road leave a ring and meet again within 120 m, the triangle between them.
   - **turning** (cul-de-sac bulbs at `highway=turning_circle` dead ends), **xings** (level crossings: where a road or path crosses a railway), **labels** and **places** (see below).
8. Bridges: a drivable bridge is widened to at least 9 m (6.5 m one-way) and to the widest road joining its ends, with a 1.6 m footpath each side (the road gets a `dk` deck half-width). Footbridges are at least 2.6 m. Railings run along both deck edges, a little past the abutments unless a road joins there, and are cut where a path or road leaves the deck or where two decks sit side by side (the causeway's path and tram line become one deck). They are written to map.json `walls`, which world.js adds to the building-wall grid, so every vehicle and walker collides with them (boats don't: they pass underneath). A railing is also cut wherever a road, path or railway passes under the deck, and the baker stops with an error if any railing still crosses one.
9. Street labels: each named road gets its name (with the suffix abbreviated: ST, RD, TCE, AVE…) every 150 m on main roads and 170 m on local streets, only where the road is straight under the text, in the left lane when there's a centre line, at least 2 m clear of junctions, roundabouts, turning bulbs, level crossings and bridges, and never upside down. Streets too short for any label get one map-only label (tier 2) for the full map.
10. Overhead structures (`building=roof` or `carport`, and `layer` 1+ buildings with a road or path running under them) get `ov: 1` in map.json `buildings`: they are drawn but are not solid and leave no building cells in the raster, so you can drive under a fuel-station canopy.
11. Car places (map.json `carPlaces`): every fuel station, car wash, car yard and repairer in the extract, for the game's invented garages and respray shops. Each has an OSM id, a `kind` (`fuel`, `car_wash`, `car_yard`, `repair`, `tyres`), a position, `b` (index into `buildings`, -1 if none) and `a` (the nearest road point, in decimetres). Business names are not kept.
12. It checks the road graph against the drawing: drivable roads that cross on the same level without sharing a node would be drawn joined but not be joined for the AI (there are none in this extract).

The baker prints the roundabouts it found. In the current extract all 31 are closed rings and all run clockwise.

Before this round the line simplifier collapsed any closed way (first point equal to last) to a single point, which is why roundabout rings were missing. The fix also brought back a few other closed ways that had vanished: 5 small water bodies near the north-east edge, Encounter Bay Recreation Reserve, a large residential area, 2 big buildings, 38 roads and a fence.

The game streams 64 m map chunks from these layers at runtime, renders them into cached canvases, and keeps about 150 in a least-recently-used cache.

## Data sources and licences

- **Map data:** © OpenStreetMap contributors, under the Open Database License (ODbL 1.0). The credit appears on the title screen and the full map.
  The raw extract, query, retrieval date and sha256 are in [`data/raw/SOURCES.md`](data/raw/SOURCES.md). The baked `data/map.json` and `data/ground_*.png` are derived databases under the same licence.
- **Imagery:** none. No satellite or aerial imagery was used, traced or sampled. Colours are hand-picked.
- **Art, sound and code:** original to this project. All sprites are drawn procedurally in `js/sprites.js`, and all sounds and music are synthesised in `js/audio.js`.

## Publishing as a Claude artifact

The playable bundle is `index.html`, `css/`, `js/` and `data/map.json` plus `data/ground_0.png` and `data/ground_1.png`, about 5.5 MB.
It has no CDN scripts and no `.gz` files. Leave out `data/raw/` (20 MB), `tools/` and `screenshots/`.

## Testing hooks

These URL parameters exist for automated screenshots and checks:

- `?play=schoolie|grump|cop|roam` skips the menus.
- `&night=2` starts on a later night.
- `&hour=23.9` sets the clock.
- `&at=x,y` teleports, in world metres.
- `&dpr=3` simulates a phone's pixel ratio.

The checks used for this round were run with Playwright from outside the repo (scripted arcs for all three characters to their win screens, a high-speed drive with a drift, a mayhem run that draws a chase without touching the meter, a forced high-gossip chase with a roadblock and the chopper, the bust and paddy-wagon ride, Kev's hoon job with backup, ding dong ditch hiding, a doorbell-camera post, a crate pickup, the helicopter, and the character select at 1280×800, 1650×1600, 1570×780, 1024×768, 390×844 and 844×390); none logged console errors.

## Known gaps

- Junction polygons are built from road centrelines, so where OpenStreetMap draws a divided road's two carriageways close together the splitter island is covered by asphalt, and a few tight junctions have a small notch or bulge in the asphalt.
- Give-way lines follow simple rules (roundabout entries, the terminating arm of a T, lower-class arms); the extract has no `highway=stop` or `give_way` signs at junctions, so real signage may differ.
- Street names are road paint, so at night they are as dim as the rest of the road outside the street lights and headlights.
- Labels on the full map are horizontal and can overlap the map's own landmark and shop labels.
- Buildings are footprints with a fixed oblique "wall sweep". There are no real roof shapes, and building heights are guessed from `building:levels`.
- The 2 m ground raster gives the coast and the causeway slightly stepped edges.
- Cars, the police and the AI handle collisions with simple circles. Patrol cars can get wedged in tight spots; they reverse out, and ones left far behind are brought round the block out of sight.
- The paddy-wagon ride follows the road graph and cuts the middle out of long trips with a short fade.
- The lock-up's turrets and gatehouse are drawn over the baked footprint; they don't block movement.
- The police boat stays in water at least 8 m from shore, so it can get stuck in tight bays.
- Helicopters can't land on roofs or water; holding descend over a building keeps you hovering at roof height.
- Race checkpoints follow the road graph (gopher grand prix) and the footpath polyline (bike race); there are no barriers.
- Phones are supported with touch controls, but the layout has only been checked in an emulated portrait viewport, not on real devices.
- The OpenStreetMap extract has no `shop=car_repair` or `craft=car_repair` tags, so the three respray shops are placed on retail and light-industrial buildings near main roads (the industrial estate, the town centre, McCracken), with invented names.
- Shop interiors are one generic layout (a counter a few metres in from the street door, the assistant behind it, a shelf at the back) clipped to the real footprint; long or odd-shaped buildings get a lot of empty floor. Only six shops can be entered.
- Officers on foot run straight at you and side-step along walls when blocked; they don't path-find, so a closed courtyard can still keep one out.
- Wall tags sit on the south-facing wall strip, which is only a few pixels tall on one-storey houses, so the tag overlaps the roof edge a little.
- The struggle's numbers (zone width, drift speed, meter rates) are first-pass tuning, checked with a scripted player that can win against a senior constable at level 0; they haven't been play-tested by a person.
- The Escape Artist and Kev Grip levels, outfits and tags are kept in `localStorage` with no way to reset them in game (clearing site data resets them).
