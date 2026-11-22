# Base map: sources, licences and how it was made

Files in this folder, all generated (do not edit by hand):

| file | what | built by |
|------|------|----------|
| `basemap.json` | sea, inland water, land use, rivers, rail, piers, bridges, labels (GeoJSON) | `python -m vhsim.viewer.basemap` |
| `buildings.json` | 11,813 building outlines with heights (GeoJSON) | same |
| `terrain/{z}/{x}/{y}.png`, `terrain/tiles.json` | elevation tiles for MapLibre `raster-dem` (512 px, terrarium) | `python -m vhsim.viewer.terrain` |
| `terrain-sources.json` | URL, retrieval time and sha256 of every downloaded source tile | same |

Format: see the docstrings of `sim/vhsim/viewer/basemap.py` and `terrain.py`. Generalisation choices and building
heights are assumptions, recorded in `sim/assumptions/S5-viewer.md` (V10, V11).

## OpenStreetMap (sea, water, land use, lines, buildings, most labels)

- **Source:** extract **G-01**, `game/data/raw/G-01-victor-harbor-all.osm` (main checkout, git-ignored), all nodes and
  ways plus multipolygon relations in the box 138.57–138.66 E, 35.53–35.598 S, from the Overpass API.
  sha256 `4f8455f19ed3d6ed702ede2638cdb16c3175fc400bccb269ce997b850bd03ff1`, OSM data timestamp (`osm_base`)
  2026-11-21T13:05:36Z, retrieved 2026-11-21T13:06:30Z. Full provenance: `game/data/raw/SOURCES.md`.
- **Licence:** Open Database License (ODbL) 1.0. The map must show **"© OpenStreetMap contributors"** (link to
  https://www.openstreetmap.org/copyright). `basemap.json` and `buildings.json` are derived databases of OSM data and
  are offered under the ODbL as well.
- **What was derived:** the sea is the part of the box on the right of the `natural=coastline` ways (OSM draws land on
  the left); the three closed coastline rings (Granite Island, Wright Island, Seal Rock) and the `place=islet` way
  near Chiton Rocks are land. Outside the box the sea comes from the terrain tiles instead (next section). Areas and lines are clipped to the box; buildings and pier outlines that cross the box edge are kept whole (41 buildings reach outside it). Everything is simplified by 0.5–1.5 m and rounded to 5 decimals.
- **The causeway:** OSM maps the causeway to Granite Island as way 1004582502 "Granite Island Road"
  (`highway=pedestrian`, `man_made=pier`, `bridge=yes`; 635 m from the mainland end to the island), with the
  horse-drawn tram track (`railway=tram`, way 415051627, `bridge=yes`) along it and two short `area=yes` pier polygons named
  "Old Causeway" (about 50 m and 80 m long) within 11 m of it, one at each end. These are in the `pier` layer (`c: pier`) together with
  the other pier objects along it: the unnamed `area=yes` outline 1324252962 around the causeway deck, the short
  "Granite Island Road" end piece 1324258369 and the small pier 1324252957. The pedestrian way and the tram are also in
  the `bridge` layer (`foot`, `rail`). The label "The Causeway" sits at the middle of way 1004582502.

## G-NAF address points (suburb label positions, Mount Breckan check)

- **Source:** `viewer/residents/data/addresses.json` (Geoscape G-NAF, November 2026, see
  `viewer/residents/data/SOURCES.md`).
- **Use:** each locality with 100+ addresses gets one label, at the address point nearest the median of its
  addresses (so it always lands on an address, never in the sea). Localities with 1,000+ addresses (Victor Harbor,
  Encounter Bay, Hayborough, McCracken) show from zoom 12, the six rural ones from zoom 11.
- **Licence and attribution:** Open G-NAF End User Licence Agreement (CC BY 4.0 plus a no-mail-generation
  restriction). Attribution: "Incorporates or developed using G-NAF © Geoscape Australia licensed by the
  Commonwealth of Australia under the Open Geo-coded National Address File (G-NAF) End User Licence Agreement.
  Modified: reduced to this area and simplified."

## Terrain (elevation tiles, label heights)

- **Source:** AWS Open Data "Terrain Tiles" (Mapzen / Tilezen Joerd), terrarium encoding,
  `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png` (256 px; elevation m =
  R × 256 + G + B / 256 − 32768). 80 source tiles (zoom 11: 16, zoom 12: 48, zoom 13: 16) retrieved
  2026-11-21T23:10:15Z – 23:11:34Z UTC; each tile's URL, time and sha256 are in `terrain-sources.json`. Raw
  downloads are cached in `sim/data/terrain-raw/` (git-ignored).
- **What was made:** 20 tiles of 512 px, each a 2 × 2 mosaic of the four source tiles one zoom deeper, so tile z/x/y
  covers the same area as the standard XYZ tile z/x/y: zoom 12 over the G-01 box (4 tiles, about 15 m per pixel),
  zoom 11 (12 tiles) and zoom 10 (4 tiles) over the simulated network (138.208–138.693 E, 35.426–35.612 S).
  Elevations below 0 (sea-floor bathymetry) were set to 0 and every value rounded to 1/8 m. Bounds of all tiles:
  138.164062, −35.746512, 138.867188, −35.173808 (the z10 tiles); z11 and z12 tiles exist only where listed in
  `tiles.json` → `tiles`; the viewer (`viewer/js/mapview.js`, the `vhdem://` protocol) cuts any other tile from its nearest bundled parent, so nothing is requested that is not there. A few isolated source pixels on land or at the shore were below 0
  (down to −72 m, e.g. 138.7151 E 35.4682 S; −477 m offshore at 138.1649 E 35.5215 S) and are now 0.
- **Licences** (from https://github.com/tilezen/joerd/blob/master/docs/attribution.md and `data-sources.md`):
  the tiles combine Geoscience Australia's DEM of Australia (5 m around coastal South Australia; CC BY 4.0), SRTM and
  GMTED2010 (U.S. Geological Survey, public domain, credit requested) and ETOPO1 bathymetry (NOAA, public domain).
  Joerd's documentation lists the GA data at its native zoom (14) and SRTM for mid zooms on land, and does not say
  which source each zoom 11–13 pixel came from, so all three Australian-relevant credits are given.
- **Attribution the map must show** (also in `terrain/tiles.json` as `attribution`, as HTML):
  "Terrain Tiles (Mapzen/Tilezen, AWS Open Data): Australia terrain data © Commonwealth of Australia (Geoscience
  Australia) 2017, CC BY 4.0; SRTM and GMTED2010 terrain data courtesy of the U.S. Geological Survey; ETOPO1:
  U.S. National Oceanic and Atmospheric Administration".

## Sea outside the OSM box (from the terrain tiles)

The `sea` feature continues beyond the G-01 box, out to the simulated network's box plus 0.03° on each side
(138.178–138.723 E, 35.396–35.642 S), so the coast does not stop at a rectangle when the map is zoomed out.

- **Data:** the terrain tiles above, on a 15 m grid (zoom 12 pixels); each pixel takes the finest tile written
  there: zoom 12 (about 15 m) between 138.516 and 138.691 E and 35.461 and 35.604 S, zoom 11 (about 31 m) elsewhere.
- **Method:** a pixel is sea when its elevation is below 1 m (the sea floor was clamped to 0; the source has patches
  of 0.1–0.7 m offshore) and it is connected to the sea: to such a pixel inside the OSM sea, or to the south or west
  edge of the area (the Southern Ocean and Gulf St Vincent). Low inland patches are not connected, so they stay land.
  Offshore land that never reaches 5 m (blobs of 1–5 m in the source around the Waitpinga cliffs) and land specks
  under 2 ha count as sea. The pixels are joined into polygons, simplified by 40 m, the G-01 box is cut out and the
  detailed OSM sea is put back inside it; the two meet along the box edge with no gap (tested along the south and
  east edges).
- **Accuracy:** this coastline is good to about 30–50 m, not to the 1 m of the OSM coast inside the box. West
  Island (south-west of The Bluff) comes out larger than it is, because the shallow 1–5 m fringe around it is
  joined to it.

## Labels placed from a specific object or by hand

Every other label comes straight from a named OSM object (islands, Petrel Cove, rivers, Newland Hill, parks,
golf courses, schools, the hospital) at a point well inside its area (pole of inaccessibility) or, for rivers, at the
middle of the river inside the box.

| label | position | why |
|-------|----------|-----|
| **Encounter Bay** (water) | 138.6125, −35.5720, **hand-placed** | OSM has no name for the bay as water ("Encounter Bay" there is only the suburb). Placed in open water south-west of the town centre, between the town and The Bluff, about 400 m off the Encounter Bay shore and clear of Wright Island and Granite Island. |
| **The Bluff (Rosetta Head)** | OSM node 4375060501 (`natural=peak`, 138.60378, −35.59141) | the summit of the headland; OSM's `place=locality` node "Rosetta Head (The Bluff)" sits 30 m west of it. Height `ele` = 100 m: the highest of the four terrain pixels (zoom 12, 15 m grid) around the summit, rounded; OSM gives no height. |
| **Town centre** | OSM node 249072879 (`place=town` "Victor Harbor", 138.62347, −35.55456) | OSM's town node, about 80 m from the Ocean Street / Coral Street corner. |
| **The Causeway** | middle of OSM way 1004582502 | see above. |
| **Mount Breckan** | inside OSM building way 762827955 (`name=Mount Breckan`), 138.62194, −35.54657 | OSM has the house itself. Cross-check with G-NAF: the nearest Renown Avenue address is **27–31 Renown Avenue, Victor Harbor**, 12 m from the label. |
| **Chiton Rocks** | OSM node 1178907825 (`place=locality`) | as mapped (it sits just offshore, on the rocks). |
| **Newland Hill** | OSM node 3008902895 | `ele` 164 m from OSM (the terrain tiles give 171 m there). |

Plain names are used for the hand-picked labels ("The Bluff (Rosetta Head)", "Town centre", "The Causeway");
all other names are as in OSM or G-NAF.

## Rebuild

From `sim/` with the project venv (the OSM extract must be in the main checkout):

```
python -m vhsim.viewer.terrain     # downloads only tiles missing from sim/data/terrain-raw/
python -m vhsim.viewer.basemap     # reads the terrain tiles for label heights
```

Both are deterministic: re-running them on the same inputs gives identical files.
