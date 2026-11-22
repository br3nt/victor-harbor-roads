# Raw map sources

| id | what | publisher | licence |
|----|------|-----------|---------|
| G-01 | `G-01-victor-harbor-all.osm`: every node and way, plus multipolygon relations, in bbox south -35.598, west 138.57, north -35.53, east 138.66 (Victor Harbor, Encounter Bay, Hayborough, McCracken, Granite Island, The Bluff / Rosetta Head) | OpenStreetMap contributors, via the Overpass API | ODbL 1.0, credit "© OpenStreetMap contributors" |

- URL: `https://overpass-api.de/api/interpreter` (HTTP POST, `data=` the query file)
- Query: `G-01-victor-harbor-all.overpassql` (in this folder)
- Retrieved: 2026-11-21T13:06:30Z
- OSM data timestamp (`osm_base`): 2026-11-21T13:05:36Z
- sha256: `4f8455f19ed3d6ed702ede2638cdb16c3175fc400bccb269ce997b850bd03ff1`
- Size: 20,598,780 bytes

Boundary and route relations were left out on purpose: the "Mainland Australia" land-area relation alone drags in about 850,000 nodes.
The sea is derived from the `natural=coastline` ways by flood fill in `game/tools/build_map.mjs`.

No satellite or aerial imagery was used or traced. Colours are hand-picked.

The two older extracts in the repo (`sources/E/S-E01-overpass-victor-harbor.osm`, `sim/data/networks/raw/S-S1-01-overpass-victor-harbor-north.osm`) only hold roads, land use and a few building types (no houses, no coastline), so the game uses G-01 instead.
