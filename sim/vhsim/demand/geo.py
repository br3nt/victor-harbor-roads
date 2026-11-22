"""Small geographic helpers (WGS84 lon/lat; distances in km)."""
from __future__ import annotations

import math
import xml.etree.ElementTree as ET
from functools import lru_cache
from pathlib import Path

KM_PER_DEG_LAT = 110.95


def dist_km(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    """Equirectangular distance; accurate to well under 1% over the study area."""
    k = math.cos(math.radians((lat1 + lat2) / 2))
    dx = (lon2 - lon1) * KM_PER_DEG_LAT * k
    dy = (lat2 - lat1) * KM_PER_DEG_LAT
    return math.hypot(dx, dy)


def in_bbox(lon: float, lat: float, bbox) -> bool:
    lo0, la0, lo1, la1 = bbox
    return lo0 <= lon <= lo1 and la0 <= lat <= la1


# Georeference of the VHITS growth map (kb-assets/maps/vhits-growth-areas.png, 745x1053 px,
# = S-C12 p.2 / S-C38). Least-squares fit (no rotation; the map is north-up) to three control
# points read off the map and taken from OSM/DIT geometry (A-S2-24):
#   (480,700) Torrens St / Hindmarsh Rd / Seaview Rd roundabout  = (138.6230, -35.5517)  S-D05
#   (591,588) McCracken roundabout (Adelaide/Hindmarsh/Port Elliot) = (138.6391, -35.5365) S-D05
#   (555,466) Victor Harbor Rd / Waterport Rd junction           = (138.6346, -35.5191)  S-E01
# Checked by overlaying OSM Inman Valley Rd, Greenhills Rd, Hindmarsh River, Waterport Rd,
# Franklin Pde and Tabernacle Rd on the map: they follow the map's roads within a few pixels.
_MAP_PX0, _MAP_PY0 = 542.0, 584.67
_MAP_LON0, _MAP_LAT0 = 138.63223, -35.53577
_MAP_DLON, _MAP_DLAT = 0.0001465, 0.0001394   # degrees per pixel


def map_px_to_lonlat(px: float, py: float) -> tuple[float, float]:
    return (_MAP_LON0 + (px - _MAP_PX0) * _MAP_DLON, _MAP_LAT0 - (py - _MAP_PY0) * _MAP_DLAT)


@lru_cache(maxsize=2)
def osm_ways(osm_path: str):
    """Parse an OSM XML file once: returns list of (tags, [(lon,lat),...]) for every way."""
    root = ET.parse(osm_path).getroot()
    nodes = {n.get("id"): (float(n.get("lon")), float(n.get("lat"))) for n in root.iter("node")}
    ways = []
    for w in root.iter("way"):
        tags = {t.get("k"): t.get("v") for t in w.findall("tag")}
        pts = [nodes[nd.get("ref")] for nd in w.findall("nd") if nd.get("ref") in nodes]
        ways.append((w.get("id"), tags, pts))
    return ways


def osm_ways_for(path: Path):
    return osm_ways(str(path))
