"""Per-edge speed limits.

Order of precedence (DESIGN.md S1):
  1. DIT legal limit for State-maintained roads (S-D05), matched spatially;
  2. OSM `maxspeed` (S-E01);
  3. default: 50 km/h (SA urban default), 20 km/h on service roads (assumptions A-S1-01/02).
Roundabout circulating edges are additionally capped by a radius-based speed (A-S1-05).
"""
from __future__ import annotations

import json
import math
import re
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable, Sequence

from shapely.geometry import LineString

from vhsim.network.config import DEFAULT_SPEED_KMH, DIT_SOURCE_ID, SERVICE_SPEED_KMH

MATCH_BUFFER_M = 20.0      # divided carriageways sit up to ~15 m off the DIT centreline
MATCH_MAX_ANGLE_DEG = 30.0
MATCH_MIN_SHARE = 0.6
SAMPLE_STEP_M = 5.0
# Unnamed edges of these OSM classes may take the DIT limit (links, carriageway joins).
UNNAMED_STATE_CLASSES = {"trunk", "primary", "secondary", "trunk_link", "primary_link", "secondary_link"}

# Austroads relation V^2 = 127 R (e + f); e + f = 0.3 for low-speed roundabout curves (A-S1-05).
ROUNDABOUT_E_PLUS_F = 0.3

_ABBREV = {"street": "st", "road": "rd", "terrace": "tce", "parade": "pde", "avenue": "ave",
           "place": "pl", "drive": "dr", "highway": "hwy", "lane": "la"}


@dataclass(frozen=True)
class DitSection:
    road_no: str
    rdname: str
    start_rrd: float
    end_rrd: float
    speed_kmh: int
    line: LineString

    @property
    def label(self) -> str:
        return f"{self.road_no} {self.rdname} {self.start_rrd:.2f}-{self.end_rrd:.2f}"


def normalise_name(name: str | None) -> str:
    if not name:
        return ""
    words = re.sub(r"[^a-z0-9 ]", " ", name.lower()).split()
    return " ".join(_ABBREV.get(w, w) for w in words)


def load_dit_sections(path: Path, to_xy: Callable[[float, float], tuple[float, float]]) -> list[DitSection]:
    """Read the DIT State Maintained Roads extract (lon/lat) and project each section."""
    data = json.loads(Path(path).read_text())
    out = []
    for f in data["features"]:
        p = f["properties"]
        g = f["geometry"]
        parts = g["coordinates"] if g["type"] == "MultiLineString" else [g["coordinates"]]
        for part in parts:
            out.append(DitSection(
                road_no=str(p["crrs_road_no"]), rdname=p["rdname"], start_rrd=float(p["start_rrd"]),
                end_rrd=float(p["end_rrd"]), speed_kmh=int(p["speed_limit"]),
                line=LineString([to_xy(lon, lat) for lon, lat in part])))
    return out


def _route_names(sections: Iterable[DitSection]) -> dict[str, set[str]]:
    names: dict[str, set[str]] = defaultdict(set)
    for s in sections:
        names[s.road_no].add(normalise_name(s.rdname))
    return names


def _direction(line: LineString, dist: float) -> tuple[float, float]:
    a = line.interpolate(max(0.0, dist - 1.0))
    b = line.interpolate(min(line.length, dist + 1.0))
    dx, dy = b.x - a.x, b.y - a.y
    n = math.hypot(dx, dy) or 1.0
    return dx / n, dy / n


def match_section(shape: Sequence[tuple[float, float]], name: str | None, highway: str | None,
                  sections: Sequence[DitSection]) -> DitSection | None:
    """The DIT section this edge runs along, or None.

    An edge matches a section when at least MATCH_MIN_SHARE of points sampled along it lie
    within MATCH_BUFFER_M of the section and run parallel to it (within MATCH_MAX_ANGLE_DEG),
    and its name belongs to the same DIT road number (or it is an unnamed arterial piece).
    Ties between sections go to the one covering most of the edge.
    """
    line = LineString(shape)
    if line.length == 0:
        return None
    route_names = _route_names(sections)
    norm = normalise_name(name)
    n = max(3, int(line.length // SAMPLE_STEP_M) + 1)
    dists = [line.length * i / (n - 1) for i in range(n)]
    samples = [(line.interpolate(d), _direction(line, d)) for d in dists]
    minx, miny, maxx, maxy = line.buffer(MATCH_BUFFER_M).bounds
    cos_max = math.cos(math.radians(MATCH_MAX_ANGLE_DEG))
    best, best_share = None, 0.0
    for sec in sections:
        if norm:
            if norm not in route_names[sec.road_no]:
                continue
        elif (highway or "") not in UNNAMED_STATE_CLASSES:
            continue
        sx0, sy0, sx1, sy1 = sec.line.bounds
        if sx1 < minx or sx0 > maxx or sy1 < miny or sy0 > maxy:
            continue
        hits = 0
        for pt, (ex, ey) in samples:
            if sec.line.distance(pt) > MATCH_BUFFER_M:
                continue
            sx, sy = _direction(sec.line, sec.line.project(pt))
            if abs(ex * sx + ey * sy) >= cos_max:
                hits += 1
        share = hits / len(samples)
        if share > best_share:
            best, best_share = sec, share
    return best if best_share >= MATCH_MIN_SHARE else None


def parse_maxspeed(value: str | None) -> int | None:
    if not value:
        return None
    m = re.match(r"\s*(\d+)", value)
    if not m:
        return None
    v = int(m.group(1))
    if "mph" in value:
        v = round(v * 1.609)
    return v


def choose_speed(edge_type: str, maxspeed_tag: str | None, dit: DitSection | None) -> tuple[int, str]:
    """(legal speed km/h, source) for one edge."""
    if dit is not None:
        return dit.speed_kmh, DIT_SOURCE_ID
    osm = parse_maxspeed(maxspeed_tag)
    if osm:
        return osm, "OSM"
    if edge_type == "highway.service":
        return SERVICE_SPEED_KMH, "default"
    return DEFAULT_SPEED_KMH, "default"


def ring_radius_m(node_xy: Sequence[tuple[float, float]]) -> float:
    """Ring radius as the mean distance of the ring's junction positions from their centroid.

    (The SUMO ring edges are trimmed by the junction areas, so their summed length is far
    shorter than the real circumference.)"""
    cx = sum(p[0] for p in node_xy) / len(node_xy)
    cy = sum(p[1] for p in node_xy) / len(node_xy)
    return sum(math.hypot(x - cx, y - cy) for x, y in node_xy) / len(node_xy)


def roundabout_speed_kmh(radius_m: float, limit_kmh: float) -> float:
    """Circulating speed from the ring radius (Austroads V^2 = 127 R (e+f)), capped at the limit."""
    v = math.sqrt(127 * radius_m * ROUNDABOUT_E_PLUS_F)
    return round(min(limit_kmh, v), 1)
