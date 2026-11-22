"""Future dwellings: how many (UGMS scenarios, S-B10) and where (infill + growth areas).

Growth-area polygons are APPROXIMATE: digitised by eye from the VHITS fact-sheet growth map
(kb-assets/maps/vhits-growth-areas.png = S-C12 p.2) on a 20-px grid and converted with the
3-point georeference in vhsim.demand.geo (checked against OSM roads and the Hindmarsh River).
Expect boundary errors of the order of 100-200 m. Replace with the UGMS/GARP GIS layers when
obtained.
"""
from __future__ import annotations

import math
from dataclasses import replace

from shapely.geometry import Polygon, box

from .config import Config
from .gateways import build_gateways
from .geo import KM_PER_DEG_LAT, map_px_to_lonlat
from .zones import Zone, make_zone

# Pixel outlines on the 745x1053 map. Areas 1-3 were traced on a 2x crop with origin (255, 258);
# the GARP-only parcels on a 1.8x crop with origin (40, 500). Values below are already converted
# back to full-map pixels.
def _crop(points, ox, oy, scale):
    return [(ox + x / scale, oy + y / scale) for x, y in points]


_PX = {
    # Area 3: north-west, towards Greenhills Rd
    "GA3": _crop([(40, 190), (62, 160), (100, 150), (160, 145), (225, 135), (240, 180), (265, 235),
                  (290, 280), (305, 335), (195, 385), (160, 315), (100, 285), (55, 240)], 255, 258, 2),
    # Area 1: closest to town, both sides of the Hindmarsh River, south to the Ring Road
    "GA1": _crop([(195, 385), (305, 335), (290, 280), (345, 285), (355, 325), (380, 400), (430, 420),
                  (470, 440), (490, 480), (525, 545), (470, 575), (460, 640), (415, 680), (360, 700),
                  (330, 770), (250, 700), (300, 610), (240, 560), (180, 480), (140, 410)], 255, 258, 2),
    # Area 2: largest, north-east along the Hindmarsh River
    "GA2": _crop([(335, 170), (345, 90), (370, 10), (410, 10), (470, 70), (530, 130), (520, 320),
                  (355, 325), (345, 285), (335, 240)], 255, 258, 2),
    # GARP-only residential parcels: along Inman Valley Rd, and south-west near Tabernacle Rd
    "GARP_IV": _crop([(15, 150), (50, 125), (210, 250), (160, 295), (120, 275), (105, 290), (20, 240)],
                     40, 500, 1.8),
    "GARP_SW": _crop([(245, 383), (360, 437), (330, 545), (360, 578), (320, 622), (170, 550), (185, 495),
                      (220, 440)], 40, 500, 1.8),
}
# Employment growth areas (for work destinations in growth years), map pixels
EMPLOYMENT_PX = {"EMP_UGMS": (620, 475), "EMP_GARP": (548, 340)}

AREA_LABEL = {"GA1": "Growth area 1 (north)", "GA2": "Growth area 2 (north-east)",
              "GA3": "Growth area 3 (north-west)", "GARP_IV": "GARP growth (Inman Valley Rd)",
              "GARP_SW": "GARP growth (south-west)"}


def growth_area_polygons() -> dict[str, Polygon]:
    out = {}
    for name, pts in _PX.items():
        poly = Polygon([map_px_to_lonlat(x, y) for x, y in pts])
        if not poly.is_valid:
            poly = poly.buffer(0)
        out[name] = poly
    return out


def employment_points() -> dict[str, tuple[float, float]]:
    return {k: map_px_to_lonlat(*v) for k, v in EMPLOYMENT_PX.items()}


def area_ha(poly) -> float:
    lat = poly.centroid.y
    return poly.area * (KM_PER_DEG_LAT ** 2) * math.cos(math.radians(lat)) * 100.0


def dwellings_added(growth: str, year: int, cfg: Config | None = None) -> float:
    """Dwellings added between growth.base_year and `year` under a scenario (S-B10 rates)."""
    cfg = cfg or Config.load()
    base_year = cfg["growth.base_year"]
    if growth == "base":
        if year != base_year:
            raise ValueError(f"'base' is only defined for {base_year}")
        return 0
    rates = cfg["growth.rates"]
    if growth not in rates:
        raise ValueError(f"unknown growth scenario {growth!r}")
    total = 0
    for a, b, per_year in rates[growth]:
        lo, hi = max(a, base_year), min(b, year)
        if hi > lo:
            total += (hi - lo) * per_year
    return total


def capacities(cfg: Config) -> dict[str, float]:
    polys = growth_area_polygons()
    caps = {}
    for name, cap in cfg["growth.capacity"].items():
        if cap is None:
            cap = area_ha(polys[name]) * cfg["growth.garp_only_density_per_ha"]
        caps[name] = float(cap)
    return caps


def allocation(growth: str, year: int, cfg: Config | None = None) -> dict[str, float]:
    """Dwellings by destination: 'infill' plus each growth area, filled in growth.order."""
    cfg = cfg or Config.load()
    added = float(dwellings_added(growth, year, cfg))
    caps = capacities(cfg)
    alloc = {"infill": min(caps["infill"], cfg["growth.infill_share"] * added)}
    rest = added - alloc["infill"]
    for name in cfg["growth.order"]:
        take = min(rest, caps[name])
        alloc[name] = take
        rest -= take
    if rest > 1e-9:   # everything full: remaining infill capacity, then beyond capacity (reported)
        extra_infill = min(rest, caps["infill"] - alloc["infill"])
        alloc["infill"] += extra_infill
        rest -= extra_infill
        alloc["infill"] += rest
        alloc["over_capacity"] = rest
    return alloc


def _cells(poly, cell_deg: float):
    x0, y0, x1, y1 = poly.bounds
    out = []
    nx, ny = math.ceil((x1 - x0) / cell_deg), math.ceil((y1 - y0) / cell_deg)
    for j in range(ny):
        for i in range(nx):
            c = box(x0 + i * cell_deg, y0 + j * cell_deg, x0 + (i + 1) * cell_deg, y0 + (j + 1) * cell_deg)
            part = poly.intersection(c)
            if not part.is_empty and part.area > 0.02 * c.area:
                out.append(part)
    return out


def zones_for(base: list[Zone], growth: str, year: int, cfg: Config | None = None,
              gateways=None) -> list[Zone]:
    """Base zones plus this scenario's new dwellings (infill scaled in place, growth-area cells added)."""
    cfg = cfg or Config.load()
    alloc = allocation(growth, year, cfg)
    if sum(alloc.values()) - alloc.get("over_capacity", 0) <= 0:
        return list(base)
    gateways = gateways or build_gateways(cfg=cfg)
    occ_share = cfg["population.occupied_share_new_dwellings"]
    hh = cfg["population.persons_per_household"]
    cars = cfg["population.cars_per_household"]

    # infill: residential mesh blocks inside the study area, by existing dwellings (or area)
    pool = [z for z in base if z.kind == "mesh_block" and z.category == "Residential" and z.access == "inside"]
    if cfg["growth.infill_weighting"] == "area":
        wts = [z.geometry.area for z in pool]
    else:
        wts = [z.dwellings for z in pool]
    wsum = sum(wts)
    add_by_id = {z.zone_id: alloc["infill"] * w / wsum for z, w in zip(pool, wts)}
    out = []
    for z in base:
        a = add_by_id.get(z.zone_id, 0.0)
        if a:
            occ = a * occ_share
            z = replace(z, dwellings=z.dwellings + a, persons=z.persons + occ * hh,
                        occupied_households=z.occupied_households + occ,
                        unoccupied=z.unoccupied + a - occ, cars=z.cars + occ * cars,
                        source=z.source + f";infill {growth} {year} (S-B10)")
        out.append(z)

    polys = growth_area_polygons()
    for name in cfg["growth.order"]:
        d = alloc.get(name, 0.0)
        if d <= 0:
            continue
        cells = _cells(polys[name], cfg["growth.cell_deg"])
        tot = sum(c.area for c in cells)
        for k, c in enumerate(cells):
            dw = d * c.area / tot
            z = make_zone(f"{name}_{k:02d}", AREA_LABEL[name], "growth_area", "Residential", dw,
                          dw * occ_share * hh, c, gateways,
                          f"S-B10 {growth} {year}; polygon approximate from S-C12 map", cfg)
            out.append(z)
    return out
