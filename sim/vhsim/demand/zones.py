"""Residential zones: ABS 2021 mesh blocks of LGA 48050, scaled to a year, plus growth zones.

Each zone gets one loading point (lon/lat) for trips:
- the polygon's representative point if it lies inside the study bbox;
- else the representative point of the part inside the bbox if that part holds >= 50% of the
  polygon's area;
- else the nearest active gateway (the zone's traffic enters the network there) - A-S2-03.
"""
from __future__ import annotations

import csv
import json
from dataclasses import dataclass, field, replace
from pathlib import Path

from shapely.geometry import Point, box, mapping, shape

from . import params as P
from .config import Config
from .gateways import Gateway, active, build_gateways, nearest_gateway_by_road
from .geo import dist_km, in_bbox


@dataclass
class MeshBlock:
    mb_code: str
    suburb: str
    category: str
    dwellings: int
    persons: int
    area_sqkm: float
    geometry: object


@dataclass
class Zone:
    zone_id: str
    suburb: str
    kind: str                  # mesh_block | growth_area | infill
    category: str
    dwellings: float
    persons: float
    occupied_households: float
    unoccupied: float
    lon: float
    lat: float
    access: str                # inside | gateway
    gateway_id: str
    source: str
    geometry: object = field(default=None, repr=False)
    cars: float = 0.0


def load_mesh_blocks(csv_path: Path = P.MB_COUNTS_CSV, poly_path: Path = P.MB_POLYGONS) -> list[MeshBlock]:
    with open(poly_path) as f:
        polys = {ft["properties"]["mb_code_2021"]: shape(ft["geometry"]) for ft in json.load(f)["features"]}
    out = []
    with open(csv_path, newline="") as f:
        for r in csv.DictReader(f):
            code = r["mb_code_2021"]
            if code not in polys:
                raise KeyError(f"mesh block {code} has no polygon in {poly_path.name}")
            out.append(MeshBlock(code, r["sal_name_2021"], r["mb_category"], int(r["dwellings"]),
                                 int(r["persons"]), float(r["area_albers_sqkm"]), polys[code]))
    return out


def loading_point(geom, gateways: list[Gateway]):
    """(lon, lat, access, gateway_id) for a polygon (see module docstring)."""
    rp = geom.representative_point()
    if in_bbox(rp.x, rp.y, P.STUDY_BBOX):
        return round(rp.x, 6), round(rp.y, 6), "inside", ""
    clip = geom.intersection(box(*P.STUDY_BBOX))
    if not clip.is_empty and clip.area >= 0.5 * geom.area:
        cp = clip.representative_point()
        return round(cp.x, 6), round(cp.y, 6), "inside", ""
    gid = nearest_gateway_by_road(rp.x, rp.y)
    by = {g.gateway_id: g for g in active(gateways)}
    g = by.get(gid) or min(active(gateways), key=lambda g: dist_km(rp.x, rp.y, g.lon, g.lat))
    return g.lon, g.lat, "gateway", g.gateway_id


def make_zone(zone_id, suburb, kind, category, dwellings, persons, geom, gateways, source, cfg: Config) -> Zone:
    occ = min(persons / cfg["population.persons_per_household"], dwellings)
    lon, lat, access, gid = loading_point(geom, gateways)
    return Zone(zone_id, suburb, kind, category, dwellings, persons, occ, dwellings - occ,
                lon, lat, access, gid, source, geom, occ * cfg["population.cars_per_household"])


def base_zones(mbs: list[MeshBlock], year: int = 2025, gateways: list[Gateway] | None = None,
               cfg: Config | None = None) -> list[Zone]:
    """Mesh-block zones. 2021: Census counts (S-C30). Base year (2025): every block scaled by
    population.erp_2025 / 16,113 (S-C03; uniform scaling is an assumption, see S2-demand.md)."""
    cfg = cfg or Config.load()
    gateways = gateways or build_gateways(cfg=cfg)
    if year == 2021:
        factor, src = 1.0, "S-C30"
    elif year == cfg["growth.base_year"]:
        factor, src = cfg["population.erp_2025"] / sum(m.persons for m in mbs), "S-C30;S-C03(scaled to ERP 2025);S-S2-01"
    else:
        raise ValueError("base_zones covers 2021 and the 2025 base; use growth.zones_for for later years")
    return [make_zone(f"MB{m.mb_code}", m.suburb, "mesh_block", m.category, m.dwellings * factor,
                      m.persons * factor, m.geometry, gateways, src, cfg) for m in mbs]


def write_zones_geojson(zones: list[Zone], path: Path) -> None:
    feats = []
    for z in zones:
        feats.append({"type": "Feature", "geometry": mapping(z.geometry) if z.geometry is not None else None,
                      "properties": {"zone_id": z.zone_id, "suburb": z.suburb, "kind": z.kind,
                                     "category": z.category, "dwellings": round(z.dwellings, 3),
                                     "persons": round(z.persons, 3),
                                     "occupied_households": round(z.occupied_households, 3),
                                     "unoccupied": round(z.unoccupied, 3), "cars": round(z.cars, 3),
                                     "lon": z.lon, "lat": z.lat, "access": z.access,
                                     "gateway_id": z.gateway_id, "source": z.source}})
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump({"type": "FeatureCollection", "features": feats}, f, separators=(",", ":"))
        f.write("\n")


def read_zones_geojson(path: Path) -> list[Zone]:
    with open(path) as f:
        data = json.load(f)
    out = []
    for ft in data["features"]:
        p = ft["properties"]
        out.append(Zone(p["zone_id"], p["suburb"], p["kind"], p["category"], p["dwellings"], p["persons"],
                        p["occupied_households"], p["unoccupied"], p["lon"], p["lat"], p["access"],
                        p["gateway_id"], p["source"], shape(ft["geometry"]) if ft["geometry"] else None,
                        p.get("cars", 0.0)))
    return out


def scaled(z: Zone, factor: float) -> Zone:
    return replace(z, dwellings=z.dwellings * factor, persons=z.persons * factor,
                   occupied_households=z.occupied_households * factor, unoccupied=z.unoccupied * factor,
                   cars=z.cars * factor)


__all__ = ["MeshBlock", "Zone", "load_mesh_blocks", "base_zones", "make_zone", "loading_point",
           "write_zones_geojson", "read_zones_geojson", "scaled", "Point"]
