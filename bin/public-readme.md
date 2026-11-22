# Victor Harbor roads

An independent look at the City of Victor Harbor's Victor Harbor Integrated Transport Strategy (VHITS): a traffic
simulation of the town's roads, the evidence behind it, and tools for residents to see how the road options would
change their own trips. Built by a resident, Brent Jacobs, in November 2026.

**Website:** https://br3nt.github.io/victor-harbor-roads/

- **Trip checker** (`docs/maps/residents/`): add the trips you make and see whether each option makes them faster,
  slower or about the same, now and as the town grows. Your trips stay in your browser.
- **Detailed results viewer** (`docs/maps/engineer.html`): congestion lane by lane, travel time to any place, a
  timeline through the day, and before/after comparisons for every simulated option, in 2D or 3D.
- **Knowledge base** (`docs/kb/`): the council decisions, documents, data sources, assumptions, calibration and
  results, each linked to its source. Start at the Simulation Results page.
- **Schoolies Mayhem** (`docs/game/`): a light-hearted pixel-art game on the real streets of Victor Harbor.

Results are preliminary. Read them as differences between options on the same traffic, not as exact forecasts.

## What is in this repository

| folder | what |
|--------|------|
| `sim/` | The simulation (Python package `vhsim`, Eclipse SUMO 1.28): road network, demand, counts, scenarios, metrics, viewer export. Design in `sim/DESIGN.md`, scenarios in `sim/SCENARIOS.md`, every assumption in `sim/assumptions/`, small results in `sim/data/results/`. |
| `viewer/` | The trip checker (`viewer/residents/`) and the detailed results viewer: static pages, no build step. |
| `game/` | The game (static files) and its map baker (`game/tools/build_map.mjs`). |
| `kb/` | The knowledge base: one HTML note per file (OKF/HTML format). |
| `research/` | Research notes per stream and the source lists (`*-sources.tsv`: URL, retrieval time, sha256 of each archived copy). |
| `results/` | Screenshots of results. |
| `bin/` | Tools: `bin/kb` (knowledge base), `bin/sources-register`, `bin/build-decisions`, `bin/kb-status`, `bin/stage-maps`, `bin/build-public`. |
| `docs/` | The website, served by GitHub Pages from `/docs`. Generated; do not edit by hand. |
| `submission/` | The submission to the council, added once it is final. |

### Not included

- **Archived sources** (`sources/` in the working repository): council PDFs and web pages, map images, data
  downloads and screenshots. They belong to their publishers, so they are not republished here. Every one is listed,
  with its URL, retrieval time and sha256, in `research/*-sources.tsv` and `sim/data/*/raw/SOURCES.tsv`, and in the
  knowledge base's Sources Register, so anyone can fetch and check the originals.
- **The council's map images** shown in the working copy of the knowledge base: the exported pages link to the
  council's originals instead.
- **Third-party documents inside `sim/`**: a Delaware Department of Transportation PDF and a text extract of a
  Transport for NSW guide (both listed in their `SOURCES.tsv`).
- **Raw OpenStreetMap extracts** for the game (the query is in `game/data/raw/`, with the retrieval time and sha256).
- **The author's survey receipt** and Facebook screenshots.

### Private residents

A post in a public Victor Harbor community Facebook group raised the one-way loop; it is cited only as a sign of public
sentiment. Members of the public are not named here: the post's author appears only as **Resident 1** in a source file
name, and individual comments are not used. Everyone else named is acting in a public
or professional role recorded in council documents (councillors, council officers, the local Member of Parliament,
State and consultancy staff), or is the author.

## How to run

**Website, locally.** Any static file server over `docs/`:

```sh
python3 -m http.server 8000 --directory docs    # then open http://localhost:8000/
```

**Simulation.** Python 3.11 or later, from `sim/`:

```sh
python3 -m venv ../.venv && ../.venv/bin/pip install -e '.[test]'
../.venv/bin/pytest -m 'not slow'               # fast tests; the slow ones run SUMO on the real network
../.venv/bin/python -m vhsim.network.build       # road network from the OpenStreetMap extract in sim/data/networks/raw/
../.venv/bin/python -m vhsim.integration.batch   # every scenario run (hours)
../.venv/bin/python -m vhsim.integration.report  # result tables
../.venv/bin/python -m vhsim.viewer.export       # data for the viewers (sim/data/viewer/)
```

Some build steps read archived sources (`vhsim.paths.SOURCES`, set `VHSIM_SOURCES`). Fetch them from the URLs in the
source lists and check them against the recorded sha256 (`bin/sources-register --verify`).

**Viewers.** From `viewer/`: `npm install` (MapLibre GL and Playwright, for the tests), `npm test`, and
`node test/serve.mjs` to serve the folder (it follows `viewer/data`, which points at `sim/data/viewer/`).

**Game.** Serve `game/` with any static server and open `index.html`. See `game/README.md`.

**Knowledge base.** `bin/kb` needs Ruby and the okf-html gem (https://github.com/br3nt/okf-html; set
`OKF_HTML_LIB` to its `lib/` folder). `bin/kb export site` writes a browsable copy.

## How to rebuild the website

`bin/build-public` makes this repository from the author's working repository: it copies the published folders,
replaces the private residents' names with pseudonyms, leaves out the archives listed above, exports the knowledge
base to `docs/kb/`, stages the viewers and their data in `docs/maps/` and the game in `docs/game/`, and then scans
everything (contents, file names and compressed data) for private names, email addresses and phone numbers, failing
if any is left. Run `bin/build-public --help` for the options; `python3 -m pytest bin/tests` runs its tests.

## Licences and attributions

Our own work is under two licences (see `LICENSE`):

- **Code** (the program files in `sim/`, `viewer/`, `game/`, `bin/` and the pages' code in `docs/`): MIT License.
  Data files are not covered by it: see "Data files" below.
- **Notes and writing** (`kb/`, `research/`, the Markdown files, the exported knowledge base in `docs/kb/`, results
  and screenshots): Creative Commons Attribution 4.0 International (CC BY 4.0). Credit "Brent Jacobs, Victor Harbor
  roads" with a link to this repository. Map imagery inside screenshots is © OpenStreetMap contributors (ODbL).

Data from others keeps its own licence:

- **OpenStreetMap** (OSM): map data © OpenStreetMap contributors, under the Open Database License (ODbL) 1.0,
  https://www.openstreetmap.org/copyright. The road network, the base map (`viewer/basemap/basemap.json`,
  `buildings.json`), the game map (`game/data/map.json`, `ground_*.png`) and the OSM extracts in
  `sim/data/networks/raw/` are derived databases of OSM data and are offered under the ODbL as well. The detailed
  viewer can also show OSM's own map tiles, loaded from tile.openstreetmap.org.
- **G-NAF addresses** (`viewer/residents/data/addresses.json`, used for address search): Incorporates or developed
  using G-NAF © Geoscape Australia licensed by the Commonwealth of Australia under the Open Geo-coded National
  Address File (G-NAF) End User Licence Agreement. Modified: reduced to this area and simplified. The Open G-NAF End
  User Licence Agreement is Creative Commons Attribution 4.0 with a restriction: the data must not be used to make a
  list of addresses for sending mail unless each address is verified from another source. Details in
  `viewer/residents/data/SOURCES.md`.
- **Australian Bureau of Statistics** (ABS): 2021 Census mesh block counts and Australian Statistical Geography
  Standard boundaries (`sim/data/zones/raw/`), CC BY 4.0. Adapted: clipped to the study area and aggregated into
  zones.
- **Department for Infrastructure and Transport** (DIT), South Australia: traffic volume estimates, crash data and
  road data from data.sa.gov.au, CC BY 4.0. Adapted: clipped to the study area, reprojected, summarised.
- **PlanSA** (Government of South Australia): population projections, CC BY 4.0. Adapted: summarised for the
  council area.
- **Terrain tiles** (`viewer/basemap/terrain/`): Terrain Tiles (Mapzen/Tilezen, AWS Open Data): Australia terrain
  data © Commonwealth of Australia (Geoscience Australia) 2017, CC BY 4.0; SRTM and GMTED2010 terrain data courtesy
  of the U.S. Geological Survey; ETOPO1: U.S. National Oceanic and Atmospheric Administration. Details in
  `viewer/basemap/SOURCES.md`.
- **City of Victor Harbor**: council documents are cited and briefly quoted for review and comment; they are not
  copied here. Traffic counts and figures taken from them are cited to the document and page.
- **MapLibre GL JS** (BSD 3-Clause), loaded from cdnjs; a copy of its stylesheet is in `viewer/vendor/`, with its
  licence in `viewer/vendor/MAPLIBRE-LICENSE.txt`.

### Data files

| files | source | terms |
|-------|--------|-------|
| `sim/data/networks/raw/*.osm`, `sim/data/networks/*` (road network), `sim/data/zones/pois.geojson`, `viewer/basemap/*.json`, `game/data/*`, `docs/maps/data/networks/*` | OpenStreetMap | ODbL 1.0, © OpenStreetMap contributors (derived databases) |
| `viewer/residents/data/addresses.json` | G-NAF, Geoscape Australia | Open G-NAF End User Licence Agreement (attribution above) |
| `sim/data/zones/raw/*`, `sim/data/zones/residential_zones.geojson`, `zone_areas.csv` | ABS | CC BY 4.0, adapted |
| `sim/data/counts/aadt.csv`, `projection_validation.csv`, `seasonal_factors.csv` | DIT traffic volume estimates | CC BY 4.0, adapted |
| `sim/data/counts/turning_2017.csv`, `turning_2017_report_totals.csv` | Torrens Street Traffic Management Review (Tonkin Consulting for the City of Victor Harbor, 2017), Appendix A, counts by Austraffic | factual counts transcribed for analysis and cited to the report; not relicensed here |
| `sim/data/counts/newer_counts.csv` | figures from the council's VHITS consultant report (SMEC) and other cited documents | factual figures cited to their source; not relicensed here |
| `sim/data/zones/growth_areas.geojson` | traced from the council's VHITS growth-areas map | cited to its source; not relicensed here |
| `viewer/basemap/terrain/*` | Terrain Tiles (Geoscience Australia, USGS, NOAA) | credits above |
| `sim/data/results/*`, `sim/data/demand/*`, `docs/maps/data/runs/*` and other simulation outputs | this project, from the inputs above | CC BY 4.0, with the input credits above |

### Checking for private details

`bin/build-public` scans text, file names and compressed data. It cannot read text inside images, so screenshots
(`*/screenshots/`, `results/screenshots/`) have to be checked by eye before each publish.
