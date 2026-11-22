"""Base map for the viewer: sea, water, land use, lines, labels and buildings from the G-01 OpenStreetMap extract.

    python -m vhsim.viewer.basemap [--osm PATH] [--out viewer/basemap] [--addresses PATH] [--terrain DIR]

Run from ``sim/``, after ``python -m vhsim.viewer.terrain`` (label heights are sampled from its tiles).
Inputs: G-01 (``game/data/raw/G-01-victor-harbor-all.osm`` in the main checkout, ODbL 1.0,
"© OpenStreetMap contributors"), G-NAF address points (``viewer/residents/data/addresses.json``, for suburb
label positions) and the terrain tiles. Provenance, licences and hand-placed labels: ``viewer/basemap/SOURCES.md``.

Writes two GeoJSON FeatureCollections (WGS84 lon/lat, 5 decimals, one feature per line, deterministic):

``basemap.json``: every feature has ``l`` (layer) and, where relevant, ``c`` (class) and ``name``:
  - ``sea``       one (Multi)Polygon: the sea inside the OSM box, from ``natural=coastline`` (land on the left).
  - ``water``     inland water polygons, ``c`` lake|river|pond|reservoir|wetland-water.
  - ``landuse``   polygons, ``c`` see ``LANDUSE``; clipped to the box.
  - ``waterway``  lines, ``c`` river|stream|drain.
  - ``rail``      lines, ``c`` rail|tram|disused.
  - ``pier``      lines or polygons (man_made=pier/breakwater/groyne), ``c`` pier|breakwater.
  - ``bridge``    lines of highway/railway ways tagged bridge, ``c`` road|rail|foot.
  - ``label``     points, ``c`` water|island|landmark|peak|suburb|park|school|hospital, ``z`` (map zoom from
                  which to show it) and ``ele`` (m, peaks and The Bluff).
``buildings.json``: building polygons with ``h`` (height m, to 0.5) and ``c``
  (house|apartments|commercial|civic|industrial|shed|other). Defaults: ``sim/assumptions/S5-viewer.md`` V10.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import shapely
from shapely.geometry import LineString, MultiLineString, MultiPolygon, Point, Polygon, mapping
from shapely.ops import linemerge, polygonize, polylabel, unary_union

from vhsim.paths import MAIN_CHECKOUT, REPO
from vhsim.viewer.png import decode_png
from vhsim.viewer.terrain import NETWORK_BBOX, OSM_BBOX, _merc, sample_elevation, terrarium_decode

DEFAULT_OSM = MAIN_CHECKOUT / "game" / "data" / "raw" / "G-01-victor-harbor-all.osm"
GRID = 1e-5                                      # output coordinate grid (degrees, ~1 m)
LON0, LAT0 = 138.615, -35.565                    # local metric projection origin
KX = 111_320.0 * math.cos(math.radians(LAT0))    # m per degree of longitude here
KY = 110_574.0                                   # m per degree of latitude
SIMPLIFY_M = dict(sea=1.0, water=1.0, landuse=1.5, line=1.0, pier=0.5, building=0.5)
MIN_BUILDING_M2 = 12.0
SEA_EXTENT = (NETWORK_BBOX[0] - 0.03, NETWORK_BBOX[1] - 0.03, NETWORK_BBOX[2] + 0.03, NETWORK_BBOX[3] + 0.03)
SEA_MAX_ELEV_M = 1.0                             # terrain below this (after clamping the sea floor to 0) may be sea
SEA_ISLAND_MIN_ELEV_M = 5.0                      # offshore land must rise this high somewhere to stay an island
SEA_MIN_ISLAND_M2 = 20_000.0                     # smaller land specks in the terrain-derived sea are noise: filled
SEA_OUTSIDE_TOL_M = 40.0                         # simplification of the terrain-derived sea outside the OSM box
LAYERS = ["sea", "water", "landuse", "waterway", "rail", "pier", "bridge", "label"]


# ---- OSM parsing ---------------------------------------------------------------------------------------------

@dataclass
class Osm:
    nodes: dict = field(default_factory=dict)       # id -> (lon, lat)
    node_tags: dict = field(default_factory=dict)   # id -> tags (tagged nodes only)
    ways: dict = field(default_factory=dict)        # id -> ([node ids], tags)
    rels: dict = field(default_factory=dict)        # id -> ([(type, ref, role)], tags)


def parse_osm(src) -> Osm:
    """``src``: a path or a file-like object holding OSM XML."""
    osm = Osm()
    for _ev, el in ET.iterparse(str(src) if isinstance(src, Path) else src):
        if el.tag == "node":
            i = int(el.get("id"))
            osm.nodes[i] = (float(el.get("lon")), float(el.get("lat")))
            t = {c.get("k"): c.get("v") for c in el if c.tag == "tag"}
            if t:
                osm.node_tags[i] = t
            el.clear()
        elif el.tag == "way":
            osm.ways[int(el.get("id"))] = ([int(c.get("ref")) for c in el if c.tag == "nd"],
                                           {c.get("k"): c.get("v") for c in el if c.tag == "tag"})
            el.clear()
        elif el.tag == "relation":
            osm.rels[int(el.get("id"))] = ([(c.get("type"), int(c.get("ref")), c.get("role") or "")
                                            for c in el if c.tag == "member"],
                                           {c.get("k"): c.get("v") for c in el if c.tag == "tag"})
            el.clear()
    return osm


def way_coords(osm: Osm, wid: int) -> list[tuple[float, float]]:
    return [osm.nodes[n] for n in osm.ways[wid][0] if n in osm.nodes]


def way_line(osm: Osm, wid: int) -> LineString | None:
    c = way_coords(osm, wid)
    return LineString(c) if len(c) >= 2 else None


def _is_closed(osm: Osm, wid: int) -> bool:
    nd = osm.ways[wid][0]
    return len(nd) >= 4 and nd[0] == nd[-1]


def way_polygon(osm: Osm, wid: int):
    if not _is_closed(osm, wid):
        return None
    c = way_coords(osm, wid)
    if len(c) < 4:
        return None
    return _polygonal(shapely.make_valid(Polygon(c)))


def relation_polygon(osm: Osm, rid: int):
    members, _tags = osm.rels[rid]
    outer, inner = [], []
    for typ, ref, role in members:
        if typ != "way" or ref not in osm.ways:
            continue
        line = way_line(osm, ref)
        if line is not None:
            (inner if role == "inner" else outer).append(line)
    if not outer:
        return None
    shell = unary_union(list(polygonize(unary_union(outer))))
    if inner:
        shell = shell.difference(unary_union(list(polygonize(unary_union(inner)))))
    return _polygonal(shell)


def area_features(osm: Osm):
    """(kind, id, tags, polygon) for closed ways and multipolygon relations, in id order."""
    for wid in sorted(osm.ways):
        if _is_closed(osm, wid):
            tags = osm.ways[wid][1]
            if tags and tags.get("natural") != "coastline":
                poly = way_polygon(osm, wid)
                if poly is not None:
                    yield "w", wid, tags, poly
    for rid in sorted(osm.rels):
        tags = osm.rels[rid][1]
        if tags.get("type") == "multipolygon":
            poly = relation_polygon(osm, rid)
            if poly is not None:
                yield "r", rid, tags, poly


# ---- geometry helpers ----------------------------------------------------------------------------------------

def to_m(g):
    return shapely.transform(g, lambda c: np.column_stack([(c[:, 0] - LON0) * KX, (c[:, 1] - LAT0) * KY]))


def to_deg(g):
    return shapely.transform(g, lambda c: np.column_stack([c[:, 0] / KX + LON0, c[:, 1] / KY + LAT0]))


def area_m2(g) -> float:
    return to_m(g).area


def _polygonal(g):
    if g is None or g.is_empty:
        return None
    if isinstance(g, (Polygon, MultiPolygon)):
        return g
    parts = [p for p in getattr(g, "geoms", []) if isinstance(p, (Polygon, MultiPolygon))]
    parts = [q for p in parts for q in (p.geoms if isinstance(p, MultiPolygon) else [p])]
    if not parts:
        return None
    return parts[0] if len(parts) == 1 else MultiPolygon(parts)


def _lineal(g):
    if g is None or g.is_empty:
        return None
    if isinstance(g, LineString):
        return g
    parts = [q for p in getattr(g, "geoms", [g]) for q in (p.geoms if isinstance(p, MultiLineString) else [p])
             if isinstance(q, LineString) and not q.is_empty]
    if not parts:
        return None
    return parts[0] if len(parts) == 1 else MultiLineString(parts)


def finish_polygon(g, tol_m: float):
    """Simplify in metres, snap to the 1e-5 degree grid (kept valid), orient exteriors counter-clockwise."""
    g = _polygonal(g)
    if g is None:
        return None
    if tol_m:
        g = to_deg(to_m(g).simplify(tol_m, preserve_topology=True))
    g = _polygonal(shapely.set_precision(g, GRID))
    return None if g is None else shapely.orient_polygons(g)


def finish_line(g, tol_m: float):
    g = _lineal(g)
    if g is None:
        return None
    if tol_m:
        g = to_deg(to_m(g).simplify(tol_m, preserve_topology=True))
    return _lineal(shapely.set_precision(g, GRID))


def _round(c):
    if isinstance(c, (tuple, list)) and c and isinstance(c[0], (int, float)):
        return [round(float(v), 5) + 0.0 for v in c]
    return [_round(x) for x in c]


def feature(geom, **props) -> dict:
    m = mapping(geom)
    return {"type": "Feature", "properties": {k: v for k, v in props.items() if v is not None},
            "geometry": {"type": m["type"], "coordinates": _round(m["coordinates"])}}


def write_collection(path: Path, feats: list[dict]) -> int:
    body = ",\n".join(json.dumps(f, separators=(",", ":"), ensure_ascii=False) for f in feats)
    text = '{"type":"FeatureCollection","features":[\n' + body + "\n]}\n"
    path.write_text(text, encoding="utf-8")
    return len(text.encode("utf-8"))


# ---- sea from the coastline ----------------------------------------------------------------------------------

def _check_coastline(osm: Osm, ids: list[int], box) -> None:
    """Refuse a coastline that cannot split the box cleanly: missing nodes, or a loose end inside the box (land
    and sea would merge into one face and the sea would silently vanish)."""
    starts, ends = {}, {}
    for w in ids:
        nd = osm.ways[w][0]
        missing = [n for n in nd if n not in osm.nodes]
        if missing or len(nd) < 2:
            raise ValueError(f"coastline way {w} has {len(missing)} missing nodes")
        starts[nd[0]] = starts.get(nd[0], 0) + 1
        ends[nd[-1]] = ends.get(nd[-1], 0) + 1
    for n in sorted(set(starts) | set(ends)):
        if starts.get(n, 0) != ends.get(n, 0) and box.buffer(-1e-9).contains(Point(osm.nodes[n])):
            raise ValueError(f"coastline ends inside the box at node {n} {osm.nodes[n]}: the coast is broken")


def sea_polygon(osm: Osm, bbox=OSM_BBOX):
    """The sea inside ``bbox``. The box is cut along every ``natural=coastline`` way; each resulting face is sea
    when the coastline edges on its outer ring have it on their right (OSM: land on the left). Closed coastline
    rings (islands) become holes, and closed ``place=island|islet`` ways that are not coastline are cut out."""
    box = shapely.box(*bbox)
    ids = [w for w in sorted(osm.ways) if osm.ways[w][1].get("natural") == "coastline"]
    if not ids:
        return None
    _check_coastline(osm, ids, box)
    coast = [way_coords(osm, w) for w in ids]
    a = np.array([p for c in coast for p in c[:-1]])
    b = np.array([p for c in coast for p in c[1:]])
    tree = shapely.STRtree(shapely.linestrings(np.stack([a, b], axis=1)))
    cut = unary_union([box.exterior] + [LineString(c).intersection(box) for c in coast])
    eps = 1e-7  # ~1 cm

    def vote(face, ring) -> float:
        xy = np.asarray(ring.coords)
        p, q = xy[:-1], xy[1:]
        mid = (p + q) / 2
        seglen = np.hypot(*(q - p).T)
        idx = tree.query(shapely.points(mid), predicate="dwithin", distance=1e-9)
        if idx.size == 0:
            return 0.0
        first = {}
        for m_i, s_i in zip(*idx):
            first.setdefault(m_i, s_i)
        m_ids = np.array(sorted(first))
        s_ids = np.array([first[i] for i in m_ids])
        d = b[s_ids] - a[s_ids]
        d = d / np.hypot(*d.T)[:, None]
        left = np.column_stack([-d[:, 1], d[:, 0]])
        mm = mid[m_ids]
        on_left = shapely.contains_xy(face, *(mm + eps * left).T)
        on_right = shapely.contains_xy(face, *(mm - eps * left).T)
        w = seglen[m_ids]
        return float((w * on_left).sum() - (w * on_right).sum())   # > 0: land, < 0: sea

    sea_faces = []
    for face in polygonize(cut):
        v = vote(face, face.exterior)
        if v == 0.0:
            v = sum(vote(face, r) for r in face.interiors)
        if v < 0:
            sea_faces.append(face)
    if not sea_faces:
        return None
    sea = unary_union(sea_faces)
    extra = [way_polygon(osm, w) for w in sorted(osm.ways)
             if osm.ways[w][1].get("place") in ("island", "islet") and osm.ways[w][1].get("natural") != "coastline"]
    extra = [e for e in extra if e is not None]
    if extra:
        sea = sea.difference(unary_union(extra))
    return _polygonal(sea)


# ---- sea outside the OSM box, from the terrain tiles ---------------------------------------------------------

def _dem_grid(terrain_dir: Path, extent, z: int):
    """Elevation on the pixel grid of zoom ``z`` (512-px tiles) covering ``extent``, each pixel from the finest
    written tile that covers it (coarser zooms repeated). NaN where no tile covers. Returns (grid, x0, y0, size)
    with x0, y0 the global pixel index of grid[0, 0] and size = 512 * 2**z."""
    size = 512 * 2 ** z
    x0, y0 = (math.floor(v * size) for v in _merc(extent[0], extent[3]))
    x1, y1 = (math.ceil(v * size) for v in _merc(extent[2], extent[1]))
    grid = np.full((y1 - y0, x1 - x0), np.nan)
    zooms = sorted(int(d.name) for d in Path(terrain_dir).iterdir() if d.is_dir() and d.name.isdigit())
    for zz in [q for q in zooms if q <= z]:
        f = 2 ** (z - zz)
        for png in sorted(Path(terrain_dir, str(zz)).glob("*/*.png")):
            tx, ty = int(png.parent.name), int(png.stem)
            gx0, gy0 = tx * 512 * f, ty * 512 * f
            ax0, ax1 = max(gx0, x0), min(gx0 + 512 * f, x1)
            ay0, ay1 = max(gy0, y0), min(gy0 + 512 * f, y1)
            if ax0 >= ax1 or ay0 >= ay1:
                continue
            e = terrarium_decode(decode_png(png.read_bytes()))
            if f > 1:
                e = np.repeat(np.repeat(e, f, axis=0), f, axis=1)
            grid[ay0 - y0:ay1 - y0, ax0 - x0:ax1 - x0] = e[ay0 - gy0:ay1 - gy0, ax0 - gx0:ax1 - gx0]
    return grid, x0, y0, size


def _connected_runs(mask: np.ndarray, seeds: np.ndarray) -> list[tuple[int, int, int]]:
    """Row runs (row, start, end) of the 4-connected parts of ``mask`` that contain a ``seeds`` pixel."""
    runs, row_runs = [], []
    for r in range(mask.shape[0]):
        d = np.diff(np.concatenate([[0], mask[r].astype(np.int8), [0]]))
        st, en = np.flatnonzero(d == 1), np.flatnonzero(d == -1)
        row_runs.append(list(range(len(runs), len(runs) + len(st))))
        runs += [(r, int(a), int(b)) for a, b in zip(st, en)]
    parent = list(range(len(runs)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for r in range(1, mask.shape[0]):
        up, cur = row_runs[r - 1], row_runs[r]
        i = j = 0
        while i < len(up) and j < len(cur):
            _, a0, a1 = runs[up[i]]
            _, b0, b1 = runs[cur[j]]
            if a0 < b1 and b0 < a1:
                parent[find(up[i])] = find(cur[j])
            if a1 <= b1:
                i += 1
            else:
                j += 1
    cs = np.concatenate([np.zeros((seeds.shape[0], 1), dtype=np.int64), np.cumsum(seeds, axis=1)], axis=1)
    roots = {find(k) for k, (r, a, b) in enumerate(runs) if cs[r, b] > cs[r, a]}
    return [run for k, run in enumerate(runs) if find(k) in roots]


def outer_sea(terrain_dir: Path, inner_sea, inner_box=OSM_BBOX, extent=SEA_EXTENT, z: int = 12,
              tol_m: float = SEA_OUTSIDE_TOL_M):
    """Sea in ``extent`` outside ``inner_box``, from the terrain tiles: pixels below ``SEA_MAX_ELEV_M`` (the sea
    floor was clamped to 0; the source has patches of 0.1-0.7 m noise offshore) that are connected to the sea, i.e.
    to such a pixel inside ``inner_sea`` (the OSM sea) or on the south or west edge of the extent (the Southern
    Ocean and Gulf St Vincent). Inland low patches are not connected, so they stay land. Land that never
    rises to ``SEA_ISLAND_MIN_ELEV_M`` and is cut off from higher land (offshore noise) counts as sea. Land specks under
    ``SEA_MIN_ISLAND_M2`` inside the sea are filled. Grid: zoom ``z`` pixels (about 15 m at z 12), each taken from
    the finest tile written there. Simplified by ``tol_m``."""
    grid, x0, y0, size = _dem_grid(terrain_dir, extent, z)
    with np.errstate(invalid="ignore"):
        mask = grid < SEA_MAX_ELEV_M          # NaN (no tile) compares False
        high = ~(grid < SEA_ISLAND_MIN_ELEV_M)  # NaN counts as high (land)
    # land blobs that never reach SEA_ISLAND_MIN_ELEV_M (offshore noise, 1-5 m in the source) become sea candidates
    land_kept = np.zeros_like(mask)
    for r, a, b in _connected_runs(~mask, high):
        land_kept[r, a:b] = True
    mask = ~land_kept
    h, w = mask.shape
    lon = (x0 + np.arange(w) + 0.5) / size * 360.0 - 180.0
    lat = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * (y0 + np.arange(h) + 0.5) / size))))
    seeds = np.zeros_like(mask)
    seeds[-1] = mask[-1]
    seeds[:, 0] = mask[:, 0]
    if inner_sea is not None:
        cols = np.flatnonzero((lon > inner_box[0]) & (lon < inner_box[2]))
        rows = np.flatnonzero((lat > inner_box[1]) & (lat < inner_box[3]))
        if cols.size and rows.size:
            X, Y = np.meshgrid(lon[cols], lat[rows])
            inside = shapely.contains_xy(inner_sea, X, Y)
            seeds[np.ix_(rows, cols)] |= inside & mask[np.ix_(rows, cols)]
    runs = _connected_runs(mask, seeds)
    if not runs:
        return None
    r = np.array(runs, dtype=float)
    cells = unary_union(shapely.box(r[:, 1], r[:, 0], r[:, 2], r[:, 0] + 1))
    lat0 = (extent[1] + extent[3]) / 2
    px_m = 40_075_016.7 * math.cos(math.radians(lat0)) / size
    min_hole = SEA_MIN_ISLAND_M2 / px_m ** 2
    cells = _polygonal(MultiPolygon([Polygon(q.exterior, [h for h in q.interiors if Polygon(h).area >= min_hole])
                                     for q in getattr(cells, "geoms", [cells])]))
    cells = cells.simplify(tol_m / px_m, preserve_topology=True)

    def to_lonlat(c):
        gx, gy = (x0 + c[:, 0]) / size, (y0 + c[:, 1]) / size
        return np.column_stack([gx * 360.0 - 180.0, np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * gy))))])

    sea = shapely.transform(cells, to_lonlat).intersection(shapely.box(*extent)).difference(shapely.box(*inner_box))
    return _polygonal(sea)


# ---- classes -------------------------------------------------------------------------------------------------

LANDUSE = ["farmland", "grass", "park", "pitch", "golf", "wood", "scrub", "sand", "rock", "residential",
           "commercial", "cemetery", "wetland", "caravan"]


def landuse_class(t: dict) -> str | None:
    """Land-use class of an area's tags, or None. Specific uses (golf, pitch, park, caravan park, cemetery) win
    over generic land cover."""
    if t.get("building") or t.get("natural") == "water" or t.get("natural") == "coastline":
        return None
    le, lu, na = t.get("leisure"), t.get("landuse"), t.get("natural")
    if le == "golf_course":
        return "golf"
    if le in ("pitch", "track"):
        return "pitch"
    if le in ("park", "garden", "dog_park"):
        return "park"
    if t.get("tourism") in ("caravan_site", "camp_site"):
        return "caravan"
    if lu == "cemetery" or t.get("amenity") == "grave_yard":
        return "cemetery"
    if na == "wetland":
        return "wetland"
    table = {
        ("landuse", "farmland"): "farmland", ("landuse", "farmyard"): "farmland", ("landuse", "orchard"): "farmland",
        ("landuse", "vineyard"): "farmland",
        ("landuse", "grass"): "grass", ("landuse", "meadow"): "grass", ("landuse", "village_green"): "grass",
        ("landuse", "recreation_ground"): "grass", ("leisure", "common"): "grass", ("natural", "grassland"): "grass",
        ("landuse", "forest"): "wood", ("natural", "wood"): "wood",
        ("natural", "scrub"): "scrub", ("natural", "heath"): "scrub",
        ("natural", "sand"): "sand", ("natural", "beach"): "sand", ("natural", "shingle"): "sand",
        ("natural", "bare_rock"): "rock", ("natural", "scree"): "rock",
        ("landuse", "residential"): "residential",
        ("landuse", "retail"): "commercial", ("landuse", "commercial"): "commercial",
        ("landuse", "industrial"): "commercial",
    }
    for k in ("landuse", "leisure", "natural"):
        if (k, t.get(k)) in table:
            return table[(k, t.get(k))]
    return None


def is_water(t: dict) -> bool:
    return t.get("natural") == "water" or t.get("waterway") == "riverbank" or t.get("landuse") in ("reservoir", "basin")


def water_class(t: dict, area: float) -> str:
    w = t.get("water")
    if t.get("waterway") == "riverbank" or w in ("river", "canal", "stream"):
        return "river"
    if w == "reservoir" or t.get("landuse") == "reservoir":
        return "reservoir"
    if w in ("pond", "basin", "wastewater") or t.get("landuse") == "basin" or t.get("golf") == "water_hazard":
        return "pond"
    if w in ("lake", "lagoon", "oxbow"):
        return "lake"
    if w in ("wetland", "marsh"):
        return "wetland-water"
    return "pond" if area < 10_000 else "lake"


FOOT = {"footway", "path", "pedestrian", "steps", "cycleway", "bridleway", "corridor"}

HOUSE = {"house", "detached", "semidetached_house", "semi", "terrace", "residential", "bungalow", "cabin",
         "farm", "static_caravan"}
SHED = {"garage", "garages", "carport", "shed", "roof", "hut", "greenhouse", "barn", "farm_auxiliary", "toilets",
        "kiosk", "boathouse"}
APARTMENTS = {"apartments", "flats", "dormitory"}
COMMERCIAL = {"retail", "commercial", "supermarket", "office", "hotel", "motel", "shop"}
CIVIC = {"school", "college", "university", "kindergarten", "church", "chapel", "cathedral", "mosque",
         "temple", "synagogue", "hospital", "civic", "public", "government", "train_station", "transportation",
         "townhall", "museum", "sports_centre", "fire_station"}
INDUSTRIAL = {"industrial", "warehouse", "factory", "manufacture", "service", "storage_tank"}
WORSHIP = {"church", "chapel", "cathedral", "mosque", "temple", "synagogue"}
CIVIC_AMENITY = {"school", "college", "university", "kindergarten", "hospital", "place_of_worship", "townhall",
                 "library", "police", "fire_station", "community_centre", "courthouse", "post_office",
                 "social_facility", "clinic", "doctors"}
COMMERCIAL_AMENITY = {"restaurant", "cafe", "fast_food", "pub", "bar", "bank", "fuel", "ice_cream", "car_wash",
                      "veterinary", "pharmacy"}


def building_class(t: dict) -> str:
    b = t.get("building", "yes")
    for cls, values in (("house", HOUSE), ("shed", SHED), ("apartments", APARTMENTS),
                        ("commercial", COMMERCIAL), ("civic", CIVIC), ("industrial", INDUSTRIAL)):
        if b in values:
            return cls
    am = t.get("amenity")
    if am in CIVIC_AMENITY or t.get("tourism") == "museum" or t.get("railway") == "station":
        return "civic"
    if am in COMMERCIAL_AMENITY or t.get("shop") or t.get("tourism") in ("hotel", "motel") or t.get("office"):
        return "commercial"
    return "other"


def _number(v: str | None) -> float | None:
    if not v:
        return None
    m = re.match(r"\s*([0-9]+(?:\.[0-9]+)?)", v.replace(",", "."))
    return float(m.group(1)) if m else None


def building_height(t: dict, area: float) -> float:
    """Height (m, to 0.5): OSM ``height``, else ``building:levels`` x 3 + 1, else a default by type (V10)."""
    h = _number(t.get("height"))
    if h is None:
        lv = _number(t.get("building:levels"))
        if lv is not None:
            h = lv * 3 + 1
    if h is None:
        b, am = t.get("building", "yes"), t.get("amenity")
        if b in SHED:
            h = 2.8
        elif b in APARTMENTS:
            h = 10.0
        elif b in WORSHIP or am == "place_of_worship":
            h = 10.0
        elif b == "hospital" or am == "hospital":
            h = 9.0
        elif b in ("hotel",) or t.get("tourism") == "hotel":
            h = 10.0
        elif b in ("school", "college", "university", "kindergarten") or am in ("school", "college", "university"):
            h = 7.0
        elif b in INDUSTRIAL:
            h = 7.0
        elif b in ("retail", "commercial", "supermarket", "office") or t.get("shop"):
            h = 6.5
        elif b in HOUSE:
            h = 4.5
        else:
            h = 6.5 if area > 800 else 4.5
    return round(h * 2) / 2


# ---- layers --------------------------------------------------------------------------------------------------

def _sort_key(kind: str, i: int) -> tuple:
    return (0 if kind == "w" else 1, i)


def area_layers(osm: Osm, bbox) -> list[tuple]:
    """(layer, sort key, feature) for water and land use."""
    box = shapely.box(*bbox)
    out = []
    for kind, i, t, poly in area_features(osm):
        if is_water(t):
            layer, cls, tol = "water", water_class(t, area_m2(poly)), SIMPLIFY_M["water"]
        else:
            cls = landuse_class(t)
            if cls is None:
                continue
            layer, tol = "landuse", SIMPLIFY_M["landuse"]
        g = finish_polygon(poly.intersection(box), tol)
        if g is None or area_m2(g) < 20:
            continue
        out.append((layer, (-round(area_m2(g)), _sort_key(kind, i)), feature(g, l=layer, c=cls, name=t.get("name"))))
    return out


def line_layers(osm: Osm, bbox) -> list[tuple]:
    box = shapely.box(*bbox)
    out = []
    for wid in sorted(osm.ways):
        t = osm.ways[wid][1]
        found = []
        ww = t.get("waterway")
        if ww in ("river", "canal", "stream", "drain", "ditch"):
            found.append(("waterway", {"river": "river", "canal": "river", "stream": "stream"}.get(ww, "drain")))
        rw = t.get("railway")
        if rw in ("rail", "narrow_gauge", "light_rail", "preserved", "tram", "disused", "abandoned"):
            found.append(("rail", {"tram": "tram", "disused": "disused", "abandoned": "disused"}.get(rw, "rail")))
        br = t.get("bridge")
        if br and br != "no" and (t.get("highway") or rw):
            found.append(("bridge", "rail" if rw else ("foot" if t.get("highway") in FOOT else "road")))
        mm = t.get("man_made")
        if mm in ("pier", "breakwater", "groyne"):
            found.append(("pier", "pier" if mm == "pier" else "breakwater"))
        if not found:
            continue
        line = way_line(osm, wid)
        if line is None:
            continue
        for layer, cls in found:
            if layer == "pier" and _is_closed(osm, wid) and (t.get("area") == "yes" or not t.get("highway")):
                g = finish_polygon(way_polygon(osm, wid), SIMPLIFY_M["pier"])
            else:
                g = finish_line(line.intersection(box), SIMPLIFY_M["pier" if layer == "pier" else "line"])
            if g is not None:
                out.append((layer, (wid,), feature(g, l=layer, c=cls, name=t.get("name"))))
    return out


def building_features(osm: Osm) -> list[dict]:
    feats = []
    for kind, i, t, poly in area_features(osm):
        b = t.get("building")
        if not b or b == "no":
            continue
        area = area_m2(poly)
        if area < MIN_BUILDING_M2:
            continue
        g = finish_polygon(poly, SIMPLIFY_M["building"])
        if g is None:
            continue
        if isinstance(g, MultiPolygon):
            # keep the main part: snapping can split a sliver off. (This would also drop real parts of a
            # multi-outer building relation; G-01 has none.)
            g = max(g.geoms, key=lambda p: p.area)
        feats.append((_sort_key(kind, i), feature(g, h=building_height(t, area), c=building_class(t))))
    return [f for _, f in sorted(feats, key=lambda kv: kv[0])]


# ---- labels --------------------------------------------------------------------------------------------------

# Labels placed from specific OSM objects or by hand (the reasons are in viewer/basemap/SOURCES.md).
SPECIAL_LABELS = [
    dict(name="The Bluff (Rosetta Head)", c="landmark", z=13, node=4375060501, ele="dem"),  # OSM summit node
    dict(name="Town centre", c="landmark", z=13, node=249072879),                           # OSM place=town
    dict(name="The Causeway", c="landmark", z=13, way_mid=1004582502),                     # OSM causeway way
    dict(name="Mount Breckan", c="landmark", z=13, way=762827955),                         # OSM building
    dict(name="Chiton Rocks", c="landmark", z=14, node=1178907825),                        # OSM place=locality
    dict(name="Encounter Bay", c="water", z=12, lonlat=(138.6125, -35.5720)),              # hand-placed
]


def _label_point(poly) -> Point:
    """Pole of inaccessibility of the largest part (a point well inside the shape), in lon/lat."""
    if isinstance(poly, MultiPolygon):
        poly = max(poly.geoms, key=lambda p: p.area)
    return to_deg(polylabel(to_m(poly), tolerance=2.0))


def _line_mid(line) -> Point:
    if isinstance(line, MultiLineString):
        merged = linemerge(line)
        line = max(getattr(merged, "geoms", [merged]), key=lambda g: g.length)
    lm = to_m(line)
    return to_deg(lm.interpolate(0.5, normalized=True))


def _label(pt: Point, name: str, c: str, z: float, ele=None) -> dict:
    z = int(z) if float(z).is_integer() else z
    return feature(Point(round(pt.x, 5), round(pt.y, 5)), l="label", c=c, name=name, z=z, ele=ele)


def _ele(v) -> int | None:
    x = _number(v)
    return None if x is None else int(round(x))


def osm_labels(osm: Osm, bbox, terrain_dir: Path | None) -> list[dict]:
    box = shapely.box(*bbox)
    out = []
    for kind, i, t, poly in area_features(osm):
        name = t.get("name")
        if not name:
            continue
        a = area_m2(poly)
        if t.get("place") in ("island", "islet"):
            out.append(_label(_label_point(poly), name, "island", 12 if a >= 100_000 else 13))
        elif t.get("amenity") in ("school", "college"):
            out.append(_label(_label_point(poly), name, "school", 14.5))
        elif t.get("amenity") == "hospital":
            out.append(_label(_label_point(poly), name, "hospital", 14))
        elif (t.get("leisure") in ("park", "golf_course") or t.get("landuse") == "recreation_ground"
              or t.get("natural") == "wetland" or (t.get("leisure") == "pitch" and a >= 10_000)):
            z = 13.5 if (t.get("leisure") == "golf_course" or a >= 200_000) else 14.5
            out.append(_label(_label_point(poly), name, "park", z))
    # islands drawn by closed coastline ways (area_features skips coastline)
    for wid in sorted(osm.ways):
        t = osm.ways[wid][1]
        if t.get("natural") == "coastline" and t.get("place") in ("island", "islet") and t.get("name"):
            poly = way_polygon(osm, wid)
            if poly is not None:
                out.append(_label(_label_point(poly), t["name"], "island", 12 if area_m2(poly) >= 100_000 else 13))
    for nid in sorted(osm.node_tags):
        t = osm.node_tags[nid]
        name, pt = t.get("name"), Point(osm.nodes[nid])
        if not name or not box.contains(pt):
            continue
        if t.get("natural") == "bay":
            out.append(_label(pt, name, "water", 13))
        elif t.get("natural") == "peak":
            ele = _ele(t.get("ele"))
            if ele is None and terrain_dir is not None:
                ele = _dem_ele(terrain_dir, pt)
            out.append(_label(pt, name, "peak", 13, ele))
        elif t.get("amenity") in ("school", "college"):
            out.append(_label(pt, name, "school", 14.5))
        elif t.get("amenity") == "hospital":
            out.append(_label(pt, name, "hospital", 14))
    rivers: dict[str, list] = {}
    for wid in sorted(osm.ways):
        t = osm.ways[wid][1]
        if t.get("waterway") == "river" and t.get("name"):
            line = way_line(osm, wid)
            if line is not None:
                rivers.setdefault(t["name"], []).append(line)
    for name in sorted(rivers):
        inside = _lineal(unary_union(rivers[name]).intersection(box))
        if inside is not None:
            out.append(_label(_line_mid(inside), name, "water", 13))
    for s in SPECIAL_LABELS:
        pt = None
        if "node" in s and s["node"] in osm.nodes:
            pt = Point(osm.nodes[s["node"]])
        elif "way" in s and s["way"] in osm.ways:
            poly = way_polygon(osm, s["way"])
            pt = _label_point(poly) if poly is not None else None
        elif "way_mid" in s and s["way_mid"] in osm.ways:
            pt = _line_mid(way_line(osm, s["way_mid"]))
        elif "lonlat" in s:
            pt = Point(s["lonlat"])
        if pt is None or not box.contains(pt):
            continue
        ele = _dem_ele(terrain_dir, pt) if s.get("ele") == "dem" and terrain_dir is not None else None
        out.append(_label(pt, s["name"], s["c"], s["z"], ele))
    return out


def _dem_ele(terrain_dir: Path, pt: Point) -> int | None:
    v = sample_elevation(terrain_dir, pt.x, pt.y, mode="max")
    return None if v is None else int(round(v))


def load_addresses(path: Path) -> dict[str, np.ndarray]:
    """Locality name -> (n, 2) array of address points (lon, lat), from viewer/residents/data/addresses.json."""
    d = json.loads(Path(path).read_text())
    pts: dict[str, list] = {}
    for _name, loc, lon, lat, addrs in d["streets"]:
        for a in addrs:
            pts.setdefault(d["loc"][loc], []).append((lon + a[1] * 1e-5, lat + a[2] * 1e-5))
    return {k: np.array(v) for k, v in pts.items()}


def suburb_labels(path: Path, min_addresses: int = 100, town_min: int = 1000) -> list[dict]:
    """One label per locality with at least ``min_addresses`` addresses, at the address point nearest the
    locality's median position (so it lands on a real address, never in the sea). z 12 for town suburbs
    (at least ``town_min`` addresses), 11 for rural localities (large and far apart)."""
    out = []
    for name, p in sorted(load_addresses(path).items()):
        if len(p) < min_addresses:
            continue
        med = np.median(p, axis=0)
        d2 = ((p[:, 0] - med[0]) * KX) ** 2 + ((p[:, 1] - med[1]) * KY) ** 2
        best = p[np.lexsort((p[:, 1], p[:, 0], d2))[0]]
        pt = Point(round(best[0], 5), round(best[1], 5))
        out.append(_label(pt, name, "suburb", 12 if len(p) >= town_min else 11))
    return out


# ---- bake ----------------------------------------------------------------------------------------------------

def bake(osm: Osm, out: Path, bbox=OSM_BBOX, addresses: Path | None = None, terrain_dir: Path | None = None,
         sea_extent=SEA_EXTENT) -> dict:
    """Write basemap.json and buildings.json. With ``terrain_dir`` the sea continues outside ``bbox`` (to
    ``sea_extent``) from the terrain tiles, and label heights are sampled from them."""
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    items = []
    sea = sea_polygon(osm, bbox)
    if sea is not None:
        sea = to_deg(to_m(sea).simplify(SIMPLIFY_M["sea"], preserve_topology=True))
        if terrain_dir is not None:
            outer = outer_sea(terrain_dir, sea, inner_box=bbox, extent=sea_extent)
            if outer is not None:
                sea = unary_union([sea, outer])
        sea = finish_polygon(sea, 0)
    if sea is None:
        print("warning: no sea (no natural=coastline in the box, or no face on the sea side)")
    else:
        items.append(("sea", (0,), feature(sea, l="sea")))
    items += area_layers(osm, bbox)
    items += line_layers(osm, bbox)
    labels = osm_labels(osm, bbox, terrain_dir)
    if addresses is not None:
        labels += suburb_labels(addresses)
    for f in labels:
        p = f["properties"]
        items.append(("label", (p["z"], p["c"], p["name"], f["geometry"]["coordinates"]), f))
    items.sort(key=lambda it: (LAYERS.index(it[0]), it[1]))
    feats = [f for _, _, f in items]
    size_b = write_collection(out / "basemap.json", feats)
    bfeats = building_features(osm)
    size_bu = write_collection(out / "buildings.json", bfeats)
    return {"basemap_bytes": size_b, "buildings_bytes": size_bu, "features": feats, "buildings": bfeats,
            "sea": sea}


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--osm", type=Path, default=DEFAULT_OSM)
    ap.add_argument("--out", type=Path, default=REPO / "viewer" / "basemap")
    ap.add_argument("--addresses", type=Path, default=REPO / "viewer" / "residents" / "data" / "addresses.json")
    ap.add_argument("--terrain", type=Path, default=REPO / "viewer" / "basemap" / "terrain")
    a = ap.parse_args(argv)
    terrain = a.terrain if (a.terrain / "tiles.json").exists() else None
    if terrain is None:
        print("warning: no terrain tiles; run python -m vhsim.viewer.terrain first for label heights")
    r = bake(parse_osm(a.osm), a.out, addresses=a.addresses, terrain_dir=terrain)
    from collections import Counter

    lay = Counter((f["properties"]["l"], f["properties"].get("c")) for f in r["features"])
    for k in sorted(lay, key=lambda k: (LAYERS.index(k[0]), str(k[1]))):
        print(f"{k[0]:9s} {str(k[1]):13s} {lay[k]}")
    box = shapely.box(*OSM_BBOX)
    if r["sea"] is not None:
        print(f"sea: {r['sea'].area / box.area:.3f} of the box")
    print(f"buildings: {len(r['buildings'])}; heights", dict(sorted(Counter(f['properties']['h'] for f in r['buildings']).items())))
    print("building classes", dict(Counter(f["properties"]["c"] for f in r["buildings"]).most_common()))
    print(f"basemap.json {r['basemap_bytes']} bytes, buildings.json {r['buildings_bytes']} bytes")
    for f in r["features"]:
        p = f["properties"]
        if p["l"] == "label":
            print(f"label {p['c']:9s} z{p['z']:<5} {f['geometry']['coordinates']} {p['name']}"
                  + (f" ele {p['ele']}" if "ele" in p else ""))


if __name__ == "__main__":
    main()
