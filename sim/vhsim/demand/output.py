"""Writers: SUMO trips + vTypes, per-file summary CSV and meta JSON, zone/POI/gateway files."""
from __future__ import annotations

import csv
import json
from collections import Counter
from pathlib import Path
from xml.sax.saxutils import quoteattr

from shapely.geometry import mapping

from .config import Config
from .generate import Result

SOURCES_USED = ("S-C30 mesh-block counts; S-S2-01 mesh-block polygons; S-C03 ERP 2025; S-C01 household size; "
                "S-S2-03 TfNSW trip rates; S-E03/S-E01 POIs; S-D02 AADT (via sim/data/counts/aadt.csv); "
                "S-D18 summer Victor Harbor Rd; S-B10 growth; S-C12 growth map; S-C31 NYE venue; "
                "hourly profile sim/data/profiles/hourly_profile.csv (S3)")


def _comment(s: str) -> str:
    return s.replace("--", "- -")


def write_trips(res: Result, path: Path) -> None:
    m = res.meta
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = ['<?xml version="1.0" encoding="UTF-8"?>',
             "<!-- Victor Harbor demand (vhsim.demand, stream S2). Network-independent: fromLonLat/toLonLat (WGS84).",
             _comment(f"     condition={m['condition']} year={m['year']} growth={m['growth']} seed={m['seed']}"),
             _comment(f"     config={Path(m['config']).name if m['config'] else ''} overrides={';'.join(m['overrides']) or 'none'}"),
             _comment(f"     hourly profile: {m['hourly_profile']}"),
             _comment(f"     sources: {SOURCES_USED}"),
             "     id = stratum~origin_zone~dest_category~dest_poi~seq (see sim/DESIGN.md). Types in vtypes.add.xml. -->",
             "<routes>"]
    for t in res.trips:
        lines.append(f'    <trip id={quoteattr(t.id)} type="{t.vtype}" depart="{t.depart:.2f}" '
                     f'fromLonLat="{t.from_lon:.6f},{t.from_lat:.6f}" toLonLat="{t.to_lon:.6f},{t.to_lat:.6f}"/>')
    lines.append("</routes>")
    path.write_text("\n".join(lines) + "\n")


def write_vtypes(cfg: Config, path: Path) -> None:
    lines = ['<?xml version="1.0" encoding="UTF-8"?>',
             "<!-- vehicle types for the S2 demand; parameters from config key 'vtypes' (assumption) -->",
             "<additional>"]
    for vid, attrs in cfg["vtypes"].items():
        a = " ".join(f'{k}={quoteattr(str(v))}' for k, v in attrs.items())
        lines.append(f'    <vType id="{vid}" {a}/>')
    lines.append("</additional>")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n")


def write_summary(res: Result, path: Path) -> None:
    c = Counter((t.stratum, t.purpose, int(t.depart // 3600), t.vtype) for t in res.trips)
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["stratum", "purpose", "hour", "vtype", "trips"])
        for (s, p, h, v), n in sorted(c.items()):
            w.writerow([s, p, h, v, n])


def write_meta(res: Result, path: Path) -> None:
    m = dict(res.meta)
    m["config"] = Path(m["config"]).name if m["config"] else ""
    by = Counter(t.stratum for t in res.trips)
    m["trips_by_stratum"] = dict(sorted(by.items()))
    m["sources"] = SOURCES_USED
    path.write_text(json.dumps(m, indent=1, sort_keys=True, default=float) + "\n")


def write_zone_areas(zones_all, path: Path) -> None:
    """zone_id -> suburb/area mapping for S4 (covers base zones and every growth cell)."""
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["zone_id", "suburb", "kind", "access", "gateway_id", "lon", "lat"])
        for z in sorted(zones_all, key=lambda z: z.zone_id):
            w.writerow([z.zone_id, z.suburb, z.kind, z.access, z.gateway_id, z.lon, z.lat])


def write_growth_areas(cfg: Config, path: Path) -> None:
    from .growth import AREA_LABEL, area_ha, capacities, growth_area_polygons
    caps = capacities(cfg)
    feats = []
    for name, poly in growth_area_polygons().items():
        feats.append({"type": "Feature", "geometry": mapping(poly),
                      "properties": {"area_id": name, "label": AREA_LABEL[name], "area_ha": round(area_ha(poly), 1),
                                     "capacity_dwellings": round(caps[name]),
                                     "source": "APPROXIMATE: digitised from S-C12 p.2 growth map, georeferenced "
                                               "to S-D05/S-E01 roads (see vhsim/demand/growth.py)"}})
    path.write_text(json.dumps({"type": "FeatureCollection", "features": feats}) + "\n")
