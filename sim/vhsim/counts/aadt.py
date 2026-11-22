"""DIT AADT sections near Victor Harbor, with a representative point and bearing per section.

AADT, count year and CV% come from the 2026 release rows of S-D02
(``sources/D/D-tv-selected-roads-by-release.csv``).  The CSV carries only road number and
road-running-distance (RRD, km); positions come from the state-maintained-roads GeoJSON
(S-D05), whose features carry ``crrs_road_no`` and ``start_rrd``/``end_rrd``.  A point at RRD x
inside a feature is placed at the same fraction of the feature's polyline length (assumption: RRD
is proportional to distance along each feature).  A section's point is the midpoint (in RRD) of the
part of the section that lies inside the study box; ``notes`` says when a section was clipped.
"""
from __future__ import annotations

import csv
import json
import math
from pathlib import Path

from vhsim.paths import SOURCES

LON_MIN, LON_MAX = 138.50, 138.72
LAT_MIN, LAT_MAX = -35.62, -35.48
RELEASE = "2026"
COLUMNS = ["road", "road_no", "section_from_km", "section_to_km", "aadt", "count_year", "cv_pct",
           "lon", "lat", "bearing_deg", "release", "source", "notes"]

_CSV = SOURCES / "D" / "D-tv-selected-roads-by-release.csv"
_GEO = SOURCES / "D" / "D-state-maintained-roads-vh-area.geojson"
_features: dict[str, list[dict]] | None = None


def in_box(lon: float, lat: float) -> bool:
    return LON_MIN <= lon <= LON_MAX and LAT_MIN <= lat <= LAT_MAX


def _load() -> dict[str, list[dict]]:
    global _features
    if _features is None:
        feats: dict[str, list[dict]] = {}
        for f in json.loads(_GEO.read_text())["features"]:
            p = f["properties"]
            pts = [tuple(c[:2]) for line in f["geometry"]["coordinates"] for c in line]
            cum = [0.0]
            for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
                cum.append(cum[-1] + math.hypot((x1 - x0) * math.cos(math.radians(y0)), y1 - y0))
            feats.setdefault(p["crrs_road_no"].zfill(5), []).append(
                dict(name=p["rdname"], a=float(p["start_rrd"]), b=float(p["end_rrd"]), pts=pts, cum=cum))
        for v in feats.values():
            v.sort(key=lambda d: d["a"])
        _features = feats
    return _features


def _locate(road_no: str, rrd: float):
    """(lon, lat, bearing_deg, road name) at RRD ``rrd``, or None when no feature covers it."""
    for f in _load().get(road_no, []):
        if f["a"] - 1e-9 <= rrd <= f["b"] + 1e-9 and f["b"] > f["a"]:
            target = (rrd - f["a"]) / (f["b"] - f["a"]) * f["cum"][-1]
            for i in range(len(f["pts"]) - 1):
                if f["cum"][i + 1] >= target - 1e-12 and f["cum"][i + 1] > f["cum"][i]:
                    (x0, y0), (x1, y1) = f["pts"][i], f["pts"][i + 1]
                    t = (target - f["cum"][i]) / (f["cum"][i + 1] - f["cum"][i])
                    lon, lat = x0 + t * (x1 - x0), y0 + t * (y1 - y0)
                    dx = (x1 - x0) * math.cos(math.radians(lat))
                    brg = (math.degrees(math.atan2(dx, y1 - y0)) + 360) % 360
                    return lon, lat, brg, f["name"]
    return None


def section_midpoint(road_no: str, a: float, b: float):
    """Representative point of the part of section [a, b] km inside the study box.

    Returns (lon, lat, bearing_deg, road_name, clipped_range_or_None) or None if no part of the
    section with known geometry is in the box.  Bearing is the direction of increasing RRD."""
    road_no = road_no.zfill(5)
    n = 400
    inside = []
    for i in range(n + 1):
        x = a + (b - a) * i / n
        pos = _locate(road_no, x)
        if pos and in_box(pos[0], pos[1]):
            inside.append(x)
    if not inside:
        return None
    lo, hi = min(inside), max(inside)
    pos = _locate(road_no, (lo + hi) / 2)
    clipped = None if (lo - a < (b - a) / n * 1.5 and b - hi < (b - a) / n * 1.5) else (round(lo, 2), round(hi, 2))
    return pos[0], pos[1], pos[2], pos[3], clipped


def build_rows() -> list[dict]:
    seen: set[tuple] = set()
    out: list[dict] = []
    with open(_CSV) as fh:
        for r in csv.DictReader(fh):
            if r["release_year"] != RELEASE:
                continue
            road_no, a, b = r["road_no"].zfill(5), float(r["start_rrd"]), float(r["end_rrd"])
            if (road_no, a, b) in seen:
                continue
            seen.add((road_no, a, b))
            mid = section_midpoint(road_no, a, b)
            if mid is None:
                continue
            lon, lat, brg, name, clipped = mid
            notes = "bearing = direction of increasing road-running distance; point placed by RRD fraction along S-D05 geometry"
            if clipped:
                notes += f"; clipped to study box: point is midpoint of the part inside it (RRD {clipped[0]}-{clipped[1]} km)"
            out.append(dict(
                road=name.title(), road_no=road_no, section_from_km=f"{a:g}", section_to_km=f"{b:g}",
                aadt=int(float(r["aadt"])), count_year=r["count_year"], cv_pct=r["cv_percent"],
                lon=f"{lon:.6f}", lat=f"{lat:.6f}", bearing_deg=f"{brg:.1f}", release=RELEASE,
                source="S-D02 (AADT); S-D05 (geometry)", notes=notes))
    out.sort(key=lambda d: (d["road_no"], float(d["section_from_km"])))
    return out


def write_csv(path: Path) -> int:
    rows = build_rows()
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=COLUMNS, lineterminator="\n")
        w.writeheader()
        w.writerows(rows)
    return len(rows)
