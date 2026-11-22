"""Scenario areas (GeoJSON polygons in WGS84) and the network edges inside them."""
from __future__ import annotations

import json
from pathlib import Path

from shapely.geometry import LineString, shape

from vhsim.paths import DATA

AREAS_DIR = DATA / "networks" / "patches" / "areas"
TOWN_CENTRE = AREAS_DIR / "town_centre.geojson"


def load_polygon(path: Path = TOWN_CENTRE):
    feats = json.loads(Path(path).read_text())["features"]
    return shape(feats[0]["geometry"])


def edge_lonlat_line(net, edge) -> LineString:
    pts = [net.convertXY2LonLat(x, y) for x, y in edge.getShape()]
    if len(pts) == 1:
        pts = pts * 2
    return LineString(pts)


def edges_inside(net, polygon, min_share: float = 0.5) -> list[str]:
    """Non-internal edges with at least `min_share` of their length inside the polygon.

    Zero-length edges count as inside when their midpoint is."""
    out = []
    for e in net.getEdges():
        if e.getFunction() == "internal":
            continue
        line = edge_lonlat_line(net, e)
        if line.length == 0:
            inside = polygon.contains(line.interpolate(0.5, normalized=True))
        else:
            inside = line.intersection(polygon).length / line.length >= min_share
        if inside:
            out.append(e.getID())
    return sorted(out)
