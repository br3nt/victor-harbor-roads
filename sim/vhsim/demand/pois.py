"""Destinations (POIs) by DESIGN category, with attraction weights from the config."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path

from . import params as P
from .config import Config
from .geo import dist_km, in_bbox


@dataclass(frozen=True)
class POI:
    poi_id: str
    category: str
    name: str
    lon: float
    lat: float
    weight: float
    source: str


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")


def _osm_pois(cfg: Config) -> list[POI]:
    cmap, named, default = cfg["poi.category_map"], cfg["poi.named_weight"], cfg["poi.default_weight"]
    with open(P.POI_GEOJSON) as f:
        feats = json.load(f)["features"]
    out = []
    for ft in feats:
        pr = ft["properties"]
        cat = cfg["poi.category_override"].get(pr.get("name") or "", cmap.get(pr.get("category")))
        if not cat:
            continue
        if cfg["poi.drop_private_pools"] and pr.get("leisure") == "swimming_pool":
            continue
        lon, lat = ft["geometry"]["coordinates"][:2]
        if not in_bbox(lon, lat, P.STUDY_BBOX):
            continue
        name = pr.get("name") or ""
        kind, num = pr["osm"].split("/")
        weight = named.get(name, default[cat])
        out.append(POI(f"poi_{kind[0]}{num}", cat, name, round(lon, 6), round(lat, 6), float(weight),
                       f"S-E03 {pr['osm']}; weight " + ("poi.named_weight" if name in named else "poi.default_weight")))
    return out


def _extra_pois(cfg: Config) -> list[POI]:
    named, default = cfg["poi.named_weight"], cfg["poi.default_weight"]
    return [POI(f"poi_x_{_slug(e['name'])}", e["category"], e["name"], e["lon"], e["lat"],
                float(named.get(e["name"], default[e["category"]])), e["source"])
            for e in cfg["poi.extra"]]


def _mesh_block_pois(cfg: Config, existing: list[POI]) -> list[POI]:
    """Education / hospital mesh blocks (S-C30, polygons S-S2-01) as extra POIs, deduplicated."""
    from .zones import load_mesh_blocks
    out = []
    for m in load_mesh_blocks():
        cat = cfg["poi.mb_categories"].get(m.category)
        if not cat:
            continue
        pt = m.geometry.representative_point()
        if not in_bbox(pt.x, pt.y, P.STUDY_BBOX):
            continue
        if any(e.category == cat and dist_km(pt.x, pt.y, e.lon, e.lat) < cfg["poi.mb_dedupe_km"] for e in existing):
            continue
        out.append(POI(f"poi_mb{m.mb_code}_{cat}", cat, f"{m.category} mesh block {m.mb_code} ({m.suburb})",
                       round(pt.x, 6), round(pt.y, 6), float(cfg["poi.default_weight"][cat]),
                       "S-C30; S-S2-01 (ABS mesh block category)"))
    return out


def _work_pois(cfg: Config) -> list[POI]:
    from .zones import load_mesh_blocks
    dens = cfg["work.jobs_per_ha"]
    out = []
    for m in load_mesh_blocks():
        if m.category not in dens:
            continue
        pt = m.geometry.representative_point()
        if not in_bbox(pt.x, pt.y, P.STUDY_BBOX):
            continue
        w = m.area_sqkm * 100.0 * dens[m.category]
        if w <= 0:
            continue
        out.append(POI(f"poi_work_mb{m.mb_code}", "work", f"{m.category} mesh block {m.mb_code} ({m.suburb})",
                       round(pt.x, 6), round(pt.y, 6), round(w, 3),
                       "S-C30 (category, area); assumption work.jobs_per_ha"))
    tc_lon, tc_lat = cfg["work.town_centre_location"]
    out.append(POI("poi_work_town_centre", "work", "Town centre (Victor Central)", tc_lon, tc_lat,
                   float(cfg["work.town_centre_weight"]), "assumption work.town_centre_weight; S-E03 location"))
    return out


def build_pois(cfg: Config | None = None) -> list[POI]:
    cfg = cfg or Config.load()
    pois = _osm_pois(cfg) + _extra_pois(cfg)
    pois += _mesh_block_pois(cfg, pois)
    pois += _work_pois(cfg)
    return pois


def pois_for(cfg: Config, growth: str, year: int) -> list[POI]:
    """POIs for a scenario year: base POIs plus work weight at the employment growth areas."""
    from .growth import dwellings_added, employment_points
    pois = build_pois(cfg)
    added = dwellings_added(growth, year, cfg)
    if added > 0:
        pts = employment_points()
        for key, (lon, lat) in pts.items():
            lon = min(max(lon, P.STUDY_BBOX[0]), P.STUDY_BBOX[2] - P.GATEWAY_INSET_DEG)
            lat = min(max(lat, P.STUDY_BBOX[1]), P.STUDY_BBOX[3] - P.GATEWAY_INSET_DEG)
            pois.append(POI(f"poi_emp_{key[4:].lower()}", "work", f"Employment growth area ({key[4:]})",
                            round(lon, 6), round(lat, 6),
                            round(added * cfg["work.jobs_per_new_dwelling"] / len(pts), 3),
                            "S-C12 map (approximate location, clamped into study area); assumption work.jobs_per_new_dwelling"))
    return pois


def write_pois_geojson(pois: list[POI], path: Path) -> None:
    feats = [{"type": "Feature", "geometry": {"type": "Point", "coordinates": [p.lon, p.lat]},
              "properties": {"poi_id": p.poi_id, "category": p.category, "name": p.name,
                             "weight": p.weight, "source": p.source}} for p in pois]
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump({"type": "FeatureCollection", "features": feats}, f, indent=0)
        f.write("\n")
