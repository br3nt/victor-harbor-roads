"""Build demand files.

    python -m vhsim.demand.build --condition weekday_term --year 2025 --growth base [--seed 1]
           [--config path.json] [--set key=value ...] [--out-dir DIR] [--zones-dir DIR] [--no-zones]

`--condition all` / `--year all` (with `--growth all`) builds every valid combination:
2025/base and 2031|2036|2041|2051 x moderate|high, for each condition.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import params as P
from .config import Config
from .gateways import write_gateways
from .generate import Inputs, generate
from .growth import zones_for
from .output import (write_growth_areas, write_meta, write_summary, write_trips, write_vtypes,
                     write_zone_areas)
from .pois import write_pois_geojson
from .zones import write_zones_geojson

VALID = [(2025, "base")] + [(y, g) for g in ("moderate", "high") for y in (2031, 2036, 2041, 2051)]


def combos(condition: str, year: str, growth: str):
    conds = P.CONDITIONS if condition == "all" else (condition,)
    out = []
    for c in conds:
        for y, g in VALID:
            if (year == "all" or int(year) == y) and (growth == "all" or growth == g):
                out.append((c, y, g))
    return out


def parse_args(argv):
    ap = argparse.ArgumentParser(prog="python -m vhsim.demand.build", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--condition", required=True, choices=list(P.CONDITIONS) + ["all"])
    ap.add_argument("--year", required=True, help="2025|2031|2036|2041|2051|all")
    ap.add_argument("--growth", required=True, choices=list(P.GROWTHS) + ["all"])
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--config", type=Path, default=None, help="config JSON (default sim/data/demand/config/default.json)")
    ap.add_argument("--set", action="append", default=[], metavar="KEY=VALUE",
                    help="override a config value (JSON-parsed); dotted sub-keys of an existing entry allowed (new sub-keys need the whole dict: --set 'poi.named_weight={...}'); repeatable")
    ap.add_argument("--out-dir", type=Path, default=P.DEMAND_DIR)
    ap.add_argument("--zones-dir", type=Path, default=P.ZONES_DIR)
    ap.add_argument("--no-zones", action="store_true", help="do not (re)write the zone/POI/gateway files")
    args = ap.parse_args(argv)
    todo = combos(args.condition, args.year, args.growth)
    if not todo:
        ap.error(f"no valid combination for year={args.year} growth={args.growth}; valid: {VALID}")
    return args, todo


def main(argv=None) -> int:
    args, todo = parse_args(sys.argv[1:] if argv is None else argv)
    cfg = Config.load(args.config).with_overrides(args.set)
    inputs = Inputs.load(cfg)
    if not args.no_zones:
        zd = args.zones_dir
        zd.mkdir(parents=True, exist_ok=True)
        write_zones_geojson(inputs.base_zones, zd / "residential_zones.geojson")
        write_pois_geojson(inputs.pois, zd / "pois.geojson")
        write_gateways(inputs.gateways, zd / "gateways.csv")
        write_growth_areas(cfg, zd / "growth_areas.geojson")
        all_zones = {z.zone_id: z for z in inputs.base_zones}
        hi = zones_for(inputs.base_zones, "high", 2051, cfg, inputs.gateways)   # every growth cell
        all_zones.update({z.zone_id: z for z in hi})
        write_zone_areas(all_zones.values(), zd / "zone_areas.csv")
    args.out_dir.mkdir(parents=True, exist_ok=True)
    write_vtypes(cfg, args.out_dir / "vtypes.add.xml")
    for cond, year, growth in todo:
        res = generate(cfg, cond, year, growth, args.seed, inputs)
        stem = f"{cond}_{year}_{growth}"
        write_trips(res, args.out_dir / f"{stem}.trips.xml")
        write_summary(res, args.out_dir / f"{stem}.summary.csv")
        write_meta(res, args.out_dir / f"{stem}.meta.json")
        print(f"{stem}: {len(res.trips)} trips; gw_vhr {res.meta['gateway_crossings'].get('gw_vhr')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
