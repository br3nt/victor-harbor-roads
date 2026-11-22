"""External gateways: where roads cross the study-area boundary, with their AADT.

Position: the point where the named OSM road crosses the study bbox shrunk by
GATEWAY_INSET_DEG (so it lies on an edge inside the network), nearest to a hint.
AADT: the counts stream's aadt.csv when it exists, otherwise the DIT 2026 release (S-D02).
"""
from __future__ import annotations

import csv
import json
from dataclasses import asdict, dataclass, fields
from functools import lru_cache
from pathlib import Path

from shapely.geometry import LineString, Point, box, shape

from . import params as P
from .geo import osm_ways_for


@dataclass(frozen=True)
class Gateway:
    gateway_id: str
    road: str
    lon: float
    lat: float
    aadt: int
    cv_pct: float
    count_year: str
    source: str
    merged_into: str = ""
    notes: str = ""


# id, OSM road name, hint lon/lat, DIT road number + RRD section (or None), "assumed", notes
_COMMON = [
    ("gw_per", "Port Elliot Road", (138.668, -35.532), ("04688", 0.0, 3.9), None,
     "DIT section 0-3.90 (McCracken roundabout to North Tce, Port Elliot)."),
    ("gw_wai", "Waitpinga Road", (138.552, -35.583), None, "assumed",
     "Council road, no DIT count: AADT assumed (config gateways.aadt_assumed)."),
    ("gw_rng", "Range Road", (138.552, -35.5735), None, "assumed",
     "Council road, no DIT count: AADT assumed (config gateways.aadt_assumed)."),
    ("gw_bvr", "Back Valley Road", (138.552, -35.531), None, "assumed",
     "Council road, no DIT count: AADT assumed (config gateways.aadt_assumed)."),
]
# Extended extract S-S1-01 (north edge -35.46): Greenhills Rd and Welch Rd lie wholly inside;
# Hindmarsh Tiers Rd has its own gateway.
_SPEC_NORTH = [
    ("gw_vhr", "Victor Harbor Road", (138.649, -35.462), ("04760", 28.26, 43.21), None,
     "Crosses the north edge of S-S1-01 on DIT section 28.26-43.21 (north of the Hindmarsh Tiers Rd / "
     "Virgin Rd junction at RRD 43.21). S-D18's >11,000/day summer figure refers to this stretch."),
    ("gw_hti", "Hindmarsh Tiers Road", (138.6053, -35.462), ("04790", 0.0, 20.86), None,
     "Crosses the north edge of S-S1-01; DIT road 04790 joins Victor Harbor Rd inside the network."),
    ("gw_ivr", "Inman Valley Road", (138.552, -35.5143), ("04793", 21.38, 30.41), None,
     "Crosses the west edge on the rural 1,700 section; the 12,000 on Victoria St (31.50-32.36) is town traffic."),
] + _COMMON
_MERGED_NORTH: list = []
# Original extract S-E01 (north edge -35.52), used only if S-S1-01 is absent.
_SPEC_SOUTH = [
    ("gw_vhr", "Victor Harbor Road", (138.634, -35.522), ("04760", 45.6, 47.66), None,
     "DIT section 45.60-47.66 (Adelaide Rd) starts ~90 m north of the bbox edge at the Waterport Rd "
     "junction; 43.21-45.60 carries 8,400 (16.5% CV) and includes Hindmarsh Tiers Rd traffic."),
    ("gw_ivr", "Inman Valley Road", (138.557, -35.522), ("04793", 21.38, 30.41), None,
     "Gateway on the rural 1,700 section; the 12,000 on Victoria St (31.50-32.36) is town traffic."),
    ("gw_grn", "Greenhills Road", (138.603, -35.522), None, "assumed",
     "Council road, no DIT count: AADT assumed (config gateways.aadt_assumed)."),
    ("gw_wel", "Welch Road", (138.6197, -35.522), None, "assumed",
     "Council road, no DIT count: AADT assumed (config gateways.aadt_assumed)."),
] + _COMMON
_MERGED_SOUTH = [
    ("gw_hti", "Hindmarsh Tiers Road", ("04790", 0.0, 20.86), "gw_vhr",
     "Joins Victor Harbor Rd ~2.3 km north of the S-E01 area (RRD 43.21), so its traffic enters "
     "through gw_vhr; DIT's 8,400 on 43.21-45.60 already includes it."),
]
_SPEC = _SPEC_NORTH if P.NORTH_EXTENDED else _SPEC_SOUTH
_MERGED = _MERGED_NORTH if P.NORTH_EXTENDED else _MERGED_SOUTH


def dit_aadt(road_no: str, start: float, end: float, release: str = "2026"):
    """(aadt, cv_pct) for a DIT section from S-D02; KeyError if absent."""
    with open(P.DIT_AADT_CSV, newline="") as f:
        for r in csv.DictReader(f):
            if (r["release_year"] == release and r["road_no"] == road_no
                    and abs(float(r["start_rrd"]) - start) < 1e-6 and abs(float(r["end_rrd"]) - end) < 1e-6):
                return int(r["aadt"]), float(r["cv_percent"])
    raise KeyError((road_no, start, end))


def _dit_count_year(road_no: str, start: float, end: float, release: str = "2026") -> str:
    with open(P.DIT_AADT_CSV, newline="") as f:
        for r in csv.DictReader(f):
            if (r["release_year"] == release and r["road_no"] == road_no
                    and abs(float(r["start_rrd"]) - start) < 1e-6):
                return r["count_year"]
    return ""


def counts_stream_aadt(road_no: str, start: float, end: float, path: Path | None = None):
    """(aadt, cv_pct, count_year, source) from S3's sim/data/counts/aadt.csv for a DIT section, or None.

    S3 columns: road, road_no, section_from_km, section_to_km, aadt, count_year, cv_pct, lon, lat, ...
    """
    path = path or P.COUNTS_AADT_CSV
    if not path.exists():
        return None
    with open(path, newline="") as f:
        for r in csv.DictReader(f):
            try:
                if (r["road_no"] == road_no and abs(float(r["section_from_km"]) - start) < 1e-6
                        and abs(float(r["section_to_km"]) - end) < 1e-6):
                    return (int(float(r["aadt"])), float(r.get("cv_pct") or 0), r.get("count_year", ""),
                            "S-D02 via sim/data/counts/aadt.csv")
            except (KeyError, ValueError):
                continue
    return None


def crossing_point(road: str, hint, osm_path: Path = P.OSM_EXTRACT):
    lo0, la0, lo1, la1 = P.STUDY_BBOX
    d = P.GATEWAY_INSET_DEG
    ring = box(lo0 + d, la0 + d, lo1 - d, la1 - d).exterior
    best = None
    for _id, tags, pts in osm_ways_for(osm_path):
        if tags.get("name") != road or "highway" not in tags or len(pts) < 2:
            continue
        inter = LineString(pts).intersection(ring)
        for g in getattr(inter, "geoms", [inter]):
            if g.is_empty or g.geom_type != "Point":
                continue
            dd = Point(hint).distance(g)
            if best is None or dd < best[0]:
                best = (dd, g.x, g.y)
    if best is None or best[0] > 0.01:
        raise ValueError(f"{road}: no crossing of the inset study bbox near {hint}")
    return round(best[1], 6), round(best[2], 6)


def build_gateways(osm_path: Path = P.OSM_EXTRACT, cfg=None) -> list[Gateway]:
    from .config import Config
    cfg = cfg or Config.load()
    out = []
    for gid, road, hint, dit, assumed, notes in _SPEC:
        lon, lat = crossing_point(road, hint, osm_path)
        s3 = counts_stream_aadt(*dit) if dit else None
        if s3:
            aadt, cv, cy, src = s3
            notes = f"DIT road {dit[0]} RRD {dit[1]}-{dit[2]}. " + notes
        elif dit:
            aadt, cv = dit_aadt(*dit)
            src, cy = "S-D02", _dit_count_year(*dit)
            notes = f"DIT road {dit[0]} RRD {dit[1]}-{dit[2]}. " + notes
        else:
            aadt, cv = int(cfg["gateways.aadt_assumed"][gid]), float(cfg["gateways.cv_pct_assumed"])
            src, cy = "assumption (config gateways.aadt_assumed)", ""
        out.append(Gateway(gid, road, lon, lat, aadt, cv, cy, src, "", notes))
    by = {g.gateway_id: g for g in out}
    for gid, road, dit, into, notes in _MERGED:
        aadt, cv = dit_aadt(*dit)
        host = by[into]
        out.append(Gateway(gid, road, host.lon, host.lat, aadt, cv, _dit_count_year(*dit), "S-D02", into,
                           f"DIT road {dit[0]} RRD {dit[1]}-{dit[2]}. " + notes))
    return out


def write_gateways(table: list[Gateway], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=[x.name for x in fields(Gateway)])
        w.writeheader()
        for g in table:
            w.writerow(asdict(g))


def read_gateways(path: Path) -> list[Gateway]:
    with open(path, newline="") as f:
        rows = list(csv.DictReader(f))
    return [Gateway(r["gateway_id"], r["road"], float(r["lon"]), float(r["lat"]), int(r["aadt"]),
                    float(r["cv_pct"]), r["count_year"], r["source"], r["merged_into"], r["notes"])
            for r in rows]


def active(table: list[Gateway]) -> list[Gateway]:
    return [g for g in table if not g.merged_into]


# DIT state roads (S-D05) whose rural lengths feed a gateway: (road_no, max RRD, gateway)
_DIT_FEEDERS = [("04760", 46.0, "gw_vhr"), ("04790", 99.0, "gw_hti" if P.NORTH_EXTENDED else "gw_vhr"),
                ("04793", 29.4, "gw_ivr"), ("04688", 99.0, "gw_per")]
STATE_ROADS = P.SOURCES / "D" / "D-state-maintained-roads-vh-area.geojson"   # S-D05


@lru_cache(maxsize=1)
def access_lines() -> dict:
    """Road geometry leading to each active gateway from outside the study area.

    OSM ways carrying the gateway's road name (S-E01; the extract keeps whole ways, so they
    run past the bbox) plus the rural DIT sections (S-D05). Used to send rural zones to the
    gateway on the road nearest to them (A-S2-03)."""
    lines: dict[str, list] = {}
    for gid, road, *_ in _SPEC:
        for _id, tags, pts in osm_ways_for(P.OSM_EXTRACT):
            if tags.get("name") == road and "highway" in tags and len(pts) > 1:
                lines.setdefault(gid, []).append(LineString(pts))
    with open(STATE_ROADS) as f:
        feats = json.load(f)["features"]
    for road_no, max_rrd, gid in _DIT_FEEDERS:
        for ft in feats:
            p = ft["properties"]
            if p["crrs_road_no"] == road_no and p["start_rrd"] < max_rrd:
                geom = shape(ft["geometry"])
                for g in getattr(geom, "geoms", [geom]):
                    lines.setdefault(gid, []).append(g)
    return lines


def nearest_gateway_by_road(lon: float, lat: float) -> str:
    """Gateway whose access road passes nearest the point (lon scaled by cos(lat))."""
    import math
    k = math.cos(math.radians(lat))
    best = None
    for gid, ls in access_lines().items():
        for line in ls:
            # nearest point on the line in degrees, then measure with lon scaled
            q = line.interpolate(line.project(Point(lon, lat)))
            d = math.hypot((q.x - lon) * k, q.y - lat)
            if best is None or d < best[0]:
                best = (d, gid)
    return best[1]
