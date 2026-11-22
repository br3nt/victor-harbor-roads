"""Land-use sanity checks of the demand, before any traffic calibration.

    python -m vhsim.demand.validate [--condition C ...] [--year 2025 --growth base] [--seed 1]
           [--config path] [--set key=value ...] [--out-dir sim/data/demand]

Writes VALIDATION.md and validation.csv (one row per check item: value, reference, basis, status).
Status: ok (within the stated reference), warn (outside it: look before using), info (no reference).
"""
from __future__ import annotations

import argparse
import csv
import math
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
from shapely.geometry import Point
from shapely.strtree import STRtree

from . import params as P
from .config import Config
from .generate import Inputs, Result, generate
from .geo import in_bbox
from .profiles import target_profile

FIELDS = ["condition", "check", "item", "value", "reference", "reference_basis", "status", "note"]
SHOPPING = ("supermarket", "shops")


def _suburb_lookup(inputs: Inputs):
    geoms = [m.geometry for m in inputs.mesh_blocks]
    tree = STRtree(geoms)
    subs = [m.suburb for m in inputs.mesh_blocks]
    cache = {}

    def suburb(lon, lat):
        key = (lon, lat)
        if key not in cache:
            pt = Point(lon, lat)
            hits = tree.query(pt, predicate="intersects")
            cache[key] = subs[int(hits[0])] if len(hits) else "outside LGA"
        return cache[key]
    return suburb


def _near(lon, lat, ref, km=0.7):
    kx = 110.95 * math.cos(math.radians(lat))
    return math.hypot((lon - ref[0]) * kx, (lat - ref[1]) * 110.95) <= km


def checks(cfg: Config, res: Result, inputs: Inputs) -> list[dict]:
    cond = res.meta["condition"]
    rows = []

    def row(check, item, value, reference="", basis="", status="info", note=""):
        rows.append({"condition": cond, "check": check, "item": item,
                     "value": round(value, 4) if isinstance(value, float) else value,
                     "reference": round(reference, 4) if isinstance(reference, float) else reference,
                     "reference_basis": basis, "status": status, "note": note})

    res_trips = [t for t in res.trips if t.stratum == "res"]
    outbound = [t for t in res_trips if t.dest_category not in ("home",)]
    pois = {p.poi_id: p for p in inputs.pois}

    # 1 supermarket attraction vs weight
    sm = [p for p in inputs.pois if p.category == "supermarket"]
    wsum = sum(p.weight for p in sm)
    n_sm = Counter(t.dest_poi for t in outbound if t.dest_category == "supermarket")
    tot = sum(n_sm.values()) or 1
    lim = cfg["validation.max_share_to_weight_ratio"]
    for p in sorted(sm, key=lambda p: -p.weight):
        share, wshare = n_sm[p.poi_id] / tot, p.weight / wsum
        ratio = share / wshare if wshare else float("nan")
        ok = (1 / lim) <= ratio <= lim
        row("supermarket_attraction", p.name or p.poi_id, share, wshare, "config poi.named_weight / default_weight",
            "ok" if ok else "warn", f"share of resident supermarket trips vs weight share; ratio {ratio:.2f}")

    # 2 spatial pattern: same suburb / town centre / McCracken
    suburb = _suburb_lookup(inputs)
    centre = (138.6203, -35.5529)     # Victor Central (S-E03)
    mccracken = (138.6372, -35.5349)  # Coles McCracken (S-E03)
    by_sub = defaultdict(Counter)
    for t in outbound:
        o = suburb(t.from_lon, t.from_lat) if t.origin_zone.startswith(("MB", "GA")) else None
        if o is None:
            continue
        c = by_sub[o]
        c["n"] += 1
        c["same"] += suburb(t.to_lon, t.to_lat) == o
        if t.dest_category in SHOPPING:
            c["shop"] += 1
            c["shop_centre"] += _near(t.to_lon, t.to_lat, centre)
            c["shop_mcc"] += _near(t.to_lon, t.to_lat, mccracken)
    for sub, c in sorted(by_sub.items(), key=lambda kv: -kv[1]["n"]):
        if c["n"] < 200:
            continue
        row("spatial_pattern", f"{sub}: same-suburb share", c["same"] / c["n"], "", "", "info",
            f"{c['n']} outbound resident trips")
        if c["shop"]:
            both = (c["shop_centre"] + c["shop_mcc"]) / c["shop"]
            row("spatial_pattern", f"{sub}: shopping to centre+McCracken", both, 0.5,
                "assumption: the two retail centres hold the big stores", "ok" if both >= 0.5 else "warn",
                f"centre {c['shop_centre'] / c['shop']:.2f}, McCracken {c['shop_mcc'] / c['shop']:.2f}")

    # 3 trip length by purpose
    ranges = cfg["validation.trip_length_km"]
    by_p = defaultdict(list)
    for t in outbound:
        by_p[t.dest_category].append(t.dist_km)
    for p, ds in sorted(by_p.items()):
        lo, hi = ranges.get(p, [None, None])
        m = float(np.mean(ds))
        st = "info" if lo is None else ("ok" if lo <= m <= hi else "warn")
        row("trip_length", p, m, f"{lo}-{hi}" if lo is not None else "", "assumption: config validation.trip_length_km",
            st, f"n={len(ds)}; median {np.median(ds):.2f} km; network km = straight line x detour")

    # 4 vehicle-km per household
    vkt = sum(t.dist_km for t in res.trips if t.resident)
    hh = res.meta["occupied_households"]
    cars = hh * cfg["population.cars_per_household"]
    ref = cfg["validation.vkt_reference_km_per_car_day"]
    row("vkt_per_household", "resident vehicle-km per household per day", vkt / hh, "", "", "info",
        "in-area km only (trips leaving the area stop at the gateway)")
    per_car = vkt / cars
    row("vkt_per_household", "resident vehicle-km per car per day", per_car, float(ref),
        "assumption: config validation.vkt_reference_km_per_car_day (ABS SMVU order of magnitude, not archived)",
        "ok" if per_car < ref else "warn", "should be well below the all-trips national figure")

    # 5 gateway volumes vs AADT
    for gid, n in res.meta["gateway_crossings"].items():
        aadt = res.meta["gateway_aadt"][gid]
        g = next(x for x in inputs.gateways if x.gateway_id == gid)
        if cond in ("summer_peak", "event_nye") and gid == "gw_vhr":
            tgt = cfg["visitors.summer_vhr_target"]
            row("gateway_vs_aadt", gid, float(n), float(tgt), "S-D18 (summer peak > 11,000/day)",
                "ok" if n >= tgt else "warn", f"AADT {aadt} ({g.source})")
            continue
        geh = math.sqrt(2 * (n - aadt) ** 2 / (n + aadt)) if n + aadt else 0.0
        if cond == "weekday_term":
            st = "ok" if geh < 5 else "warn"
        else:
            st = "info"
        row("gateway_vs_aadt", gid, float(n), float(aadt), g.source, st,
            f"two-way crossings vs AADT; GEH {geh:.1f}; trucks {res.meta['gateway_trucks'][gid]} vs CV {g.cv_pct}%")

    # 6 hourly shape
    target, label = target_profile(cfg)
    basis = label if "PLACEHOLDER" in label else f"{P.HOURLY_PROFILE_CSV.name} (S3; S-D19 07-18)"
    for name, sel in (("all_trips", res.trips), ("resident_trips", res_trips)):
        h = np.bincount(np.minimum(23, (np.array([t.depart for t in sel]) // 3600).astype(int) % 24), minlength=24)
        share = h / h.sum()
        tv = 0.5 * float(np.abs(share - target).sum())
        st = ("ok" if tv < 0.10 else "warn") if cond == "weekday_term" else "info"
        row("hourly_shape", f"{name}_tv_distance", tv, 0.10, basis, st,
            f"model peak hour {int(share.argmax())}, profile peak {int(target.argmax())}; 0 = identical shape")
    # 7 town-centre entries vs 2017 counts
    cord = cfg["validation.town_centre_cordon"]
    n_in = sum(1 for t in res.trips if 7 * 3600 <= t.depart < 19 * 3600
               and in_bbox(t.to_lon, t.to_lat, cord) and not in_bbox(t.from_lon, t.from_lat, cord))
    ref = cfg["validation.town_centre_entries_12h"]
    st = ("ok" if abs(n_in / ref - 1) <= 0.3 else "warn") if cond == "weekday_term" else "info"
    row("town_centre_entries_2017", "trips into the town-centre cordon 07-19", float(n_in), float(ref), "S-D19", st,
        "2017 count was a school-holiday Wednesday; destinations inside the cordon, origins outside")
    return rows


def write_md(path: Path, all_rows: list[dict], metas: list[dict]) -> None:
    titles = {"supermarket_attraction": "Supermarket attraction vs weight",
              "spatial_pattern": "Spatial pattern (same suburb, town centre, McCracken)",
              "trip_length": "Trip length by purpose",
              "vkt_per_household": "Vehicle-km per household",
              "gateway_vs_aadt": "Gateway volumes vs DIT AADT",
              "hourly_shape": "Hourly shape vs S3 profile",
              "town_centre_entries_2017": "Town-centre entries vs 2017 counts"}
    warn = [r for r in all_rows if r["status"] == "warn"]
    out = ["# S2 demand validation (land-use sanity checks)", "",
           "Generated by `python -m vhsim.demand.validate`. These checks test whether the demand is plausible from",
           "land use and published totals alone, before any calibration against counts. `ok` = inside the stated",
           "reference; `warn` = outside it; `info` = no reference. Data: `validation.csv`.", ""]
    for m in metas:
        out.append(f"- **{m['condition']} {m['year']} {m['growth']}** (seed {m['seed']}): {m['trips']} trips; "
                   f"config {Path(m['config']).name if m['config'] else 'default'}; overrides: "
                   f"{', '.join(m['overrides']) or 'none'}; profile: {m['hourly_profile']}. {m['summer_scaling']}")
    out += ["", f"## Warnings ({len(warn)})", ""]
    out += [f"- {r['condition']} / {r['check']} / {r['item']}: {r['value']} vs {r['reference']} ({r['note']})"
            for r in warn] or ["- none"]
    for check, title in titles.items():
        out += ["", f"## {title}", "", "| condition | item | value | reference | basis | status | note |",
                "|---|---|---|---|---|---|---|"]
        for r in all_rows:
            if r["check"] == check:
                out.append(f"| {r['condition']} | {r['item']} | {r['value']} | {r['reference']} | "
                           f"{r['reference_basis']} | {r['status']} | {r['note']} |")
    path.write_text("\n".join(out) + "\n")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m vhsim.demand.validate", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--condition", action="append", choices=list(P.CONDITIONS),
                    help="repeatable; default all four")
    ap.add_argument("--year", type=int, default=2025)
    ap.add_argument("--growth", default="base", choices=list(P.GROWTHS))
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--config", type=Path, default=None)
    ap.add_argument("--set", action="append", default=[], metavar="KEY=VALUE")
    ap.add_argument("--out-dir", type=Path, default=P.DEMAND_DIR)
    a = ap.parse_args(sys.argv[1:] if argv is None else argv)
    cfg = Config.load(a.config).with_overrides(a.set)
    inputs = Inputs.load(cfg)
    all_rows, metas = [], []
    for cond in a.condition or list(P.CONDITIONS):
        res = generate(cfg, cond, a.year, a.growth, a.seed, inputs)
        all_rows += checks(cfg, res, inputs)
        metas.append(res.meta)
    a.out_dir.mkdir(parents=True, exist_ok=True)
    with open(a.out_dir / "validation.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        w.writerows(all_rows)
    write_md(a.out_dir / "VALIDATION.md", all_rows, metas)
    n_warn = sum(r["status"] == "warn" for r in all_rows)
    print(f"{len(all_rows)} checks, {n_warn} warnings -> {a.out_dir / 'VALIDATION.md'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
