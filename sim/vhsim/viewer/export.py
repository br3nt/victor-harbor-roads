"""Export SUMO run(s) for the viewer.

    python -m vhsim.viewer.export --net <net.xml> --run <run_dir> [--run <seed2_dir> ...] --out <dir> \\
        --scenario baseline --condition weekday_term --year 2025 --growth base [--seed 1] \\
        [--network-name baseline] [--bookmark "15:00=School pick-up"] [--pois pois.geojson] [--zones zones.geojson]

Writes (``<dir>`` is the viewer data folder, e.g. ``sim/data/viewer``):
    index.json                      runs and networks known to the viewer (merged with what is there)
    networks/<network>.json         lanes, edges (with routing successors), nodes, POIs, zones
    runs/<run_id>/meta.json         run description, bookmarks, network-wide series, binary layouts
    runs/<run_id>/lanes.bin.gz      per lane x 15-minute interval: waiting, vehicles, speed ratio, density
    runs/<run_id>/edge_times.bin.gz per edge x interval: travel time for routing
Several ``--run`` directories (seeds) are averaged into one run with seed ``mean``.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import math
import warnings
from pathlib import Path

import numpy as np

from vhsim.viewer import formats
from vhsim.viewer.bookmarks import auto_bookmarks, junction_approaches, parse_bookmark, queue_bookmarks
from vhsim.viewer.lite import lite_network, lite_path
from vhsim.viewer.measures import edge_halted, edge_times, lane_measures, network_series, read_run
from vhsim.viewer.network import network_json

INDEX_VERSION = 1


def run_id(scenario, condition, year, growth, seed) -> str:
    s = "mean" if str(seed) == "mean" else f"s{seed}"
    return f"{scenario}__{condition}__{year}-{growth}__{s}"


def load_points(path) -> list[dict]:
    """GeoJSON points -> dicts (properties + lon/lat). Accepts the S2 ``pois.geojson`` and S-E03."""
    if not path:
        return []
    fc = json.loads(Path(path).read_text())
    out = []
    for i, f in enumerate(fc["features"]):
        g = f.get("geometry") or {}
        if g.get("type") != "Point":
            continue
        p = dict(f.get("properties") or {})
        p.setdefault("poi_id", p.get("id") or p.get("osm") or f"poi_{i}")
        p["lon"], p["lat"] = g["coordinates"][:2]
        out.append(p)
    return out


def load_zones(path) -> list[dict]:
    if not path:
        return []
    fc = json.loads(Path(path).read_text())
    out = []
    for i, f in enumerate(fc["features"]):
        p = dict(f.get("properties") or {})
        p.setdefault("zone_id", p.get("id") or f"zone_{i}")
        p["geometry"] = f["geometry"]
        out.append(p)
    return out


def load_junction_names(path) -> dict[str, str]:
    """S1 ``junctions.csv`` (junction_id, name, ...) -> node id -> name."""
    if not path:
        return {}
    with open(path, newline="") as fh:
        return {r["junction_id"]: r["name"] for r in csv.DictReader(fh) if r.get("name")}


def _mean(arrays: list[np.ndarray]) -> np.ndarray:
    if len(arrays) == 1:
        return arrays[0]
    stack = np.stack(arrays)
    if not np.isnan(stack).any():
        return stack.mean(axis=0)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)   # all-NaN cells (no vehicles in any seed) stay NaN
        return np.nanmean(stack, axis=0)


def _summary(run_dirs: list[Path]) -> dict:
    from vhsim.metrics.run import read_statistic

    stats = [read_statistic(d / "statistic.xml") for d in run_dirs if (d / "statistic.xml").exists()]
    if not stats:
        return {}
    return {k: round(float(np.mean([s[k] for s in stats])), 1) for k in stats[0]}


def export(net, run_dirs, out, scenario, condition, year, growth, seed=None, network_name=None, begin=0.0,
           end=86400.0, bookmarks=(), pois=None, zones=None, junction_names=None, label=None,
           queue_threshold=5.0, gzip=True, notes=None, synthetic=False, force_network=False) -> dict:
    out = Path(out)
    run_dirs = [Path(r) for r in run_dirs]
    seed = "mean" if len(run_dirs) > 1 else (seed if seed is not None else 1)
    network_name = network_name or Path(net).name.split(".")[0]
    nj = network_json(net, network_name, pois=pois, zones=zones, junction_names=junction_names)
    data = [read_run(d) for d in run_dirs]
    interval = data[0][1].period or 900.0
    _check_runs(nj, data, run_dirs)
    npath = out / "networks" / f"{network_name}.json"
    if npath.exists() and not force_network:
        old = json.loads(npath.read_text()).get("hash")
        if old != nj["hash"]:
            raise ValueError(
                f"{npath} holds a different network (lane/edge ids differ) under the name {network_name!r}; runs "
                f"exported against it would be misread. Use another --network-name, or --force-network and "
                f"re-export every run that uses it.")
    npath.parent.mkdir(parents=True, exist_ok=True)
    npath.write_text(json.dumps(nj, separators=(",", ":")))
    lite_path(npath).write_text(json.dumps(lite_network(nj), separators=(",", ":")))   # routing-only copy
    n_int = int(math.ceil((end - begin) / interval))
    lane_runs = [lane_measures(nj, ld, begin, n_int) for ld, _ in data]
    lanes = {k: _mean([r[k] for r in lane_runs]) for k in lane_runs[0]}
    tt = _mean([edge_times(nj, ed, begin, n_int) for _, ed in data])
    series_runs = [network_series(nj, ed, begin, n_int) for _, ed in data]
    series = {k: [None if all(r[k][i] is None for r in series_runs) else
                  round(float(np.mean([r[k][i] for r in series_runs if r[k][i] is not None])), 3)
                  for i in range(n_int)] for k in series_runs[0]}
    halted = _mean([edge_halted(nj, ed, begin, n_int) for _, ed in data])

    rid = run_id(scenario, condition, year, growth, seed)
    rdir = out / "runs" / rid
    rdir.mkdir(parents=True, exist_ok=True)
    ext = ".bin.gz" if gzip else ".bin"
    lanes_layout = formats.write_lanes(rdir / f"lanes{ext}", lanes)
    tt_layout = formats.write_edge_times(rdir / f"edge_times{ext}", tt)

    approaches = junction_approaches(nj)
    bms = auto_bookmarks(series["delay_veh_h"], begin, interval)
    bms += queue_bookmarks(halted[:, [a["edge"] for a in approaches]] if approaches else np.zeros((n_int, 0)),
                           approaches, begin, interval, threshold=queue_threshold)
    for b in bookmarks:
        bms.append(parse_bookmark(b) if isinstance(b, str) else {"kind": "scenario", "detail": {}, **b})
    bms.sort(key=lambda b: b["t"])

    ff = nj["edges"]["length"]
    delay = series["delay_veh_h"]
    peak_i = int(np.argmax(delay)) if any(delay) else None
    meta = {
        "version": INDEX_VERSION,
        "run_id": rid,
        "label": label or f"{scenario} · {condition} · {year} {growth}",
        "network": network_name,
        "network_hash": nj["hash"],
        "scenario": scenario, "condition": condition, "year": int(year), "growth": growth, "seed": seed,
        "begin_s": float(begin), "interval_s": float(interval), "n_intervals": n_int,
        "n_lanes": len(nj["lanes"]["id"]), "n_edges": len(ff),
        "files": {"lanes": lanes_layout, "edge_times": tt_layout},
        "bookmarks": bms,
        "series": series,
        "summary": {**_summary(run_dirs),
                    "delay_veh_h_total": round(float(np.nansum(delay)), 2),
                    "peak_interval_begin_s": None if peak_i is None else begin + peak_i * interval},
        "queue_threshold_vehicles": queue_threshold,
        "sources": [str(d) for d in run_dirs],
        "synthetic": bool(synthetic),
        "notes": notes or "",
        "created": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    (rdir / "meta.json").write_text(json.dumps(meta, indent=1))
    _update_index(out, network_name, meta)
    return meta


def _check_runs(nj, data, run_dirs) -> None:
    """Fail loudly on a wrong --net or seeds made with different output periods."""
    periods = {round(ld.period, 3) for ld, _ in data} | {round(ed.period, 3) for _, ed in data}
    if len(periods) > 1:
        raise ValueError(f"lane/edge data periods differ across {', '.join(map(str, run_dirs))}: {sorted(periods)}")
    known = set(nj["edges"]["id"])
    for (ld, ed), d in zip(data, run_dirs):
        seen = {eid for vals in ed.values for eid in vals}
        if seen and len(seen & known) < 0.5 * len(seen):
            raise ValueError(f"{len(seen - known)} of {len(seen)} edges measured in {d} are not in the network: "
                             f"is --net the network this run was simulated on?")


def _update_index(out: Path, network_name: str, meta: dict) -> None:
    p = out / "index.json"
    idx = json.loads(p.read_text()) if p.exists() else {"version": INDEX_VERSION, "networks": {}, "runs": []}
    idx["networks"][network_name] = f"networks/{network_name}.json"
    entry = {k: meta[k] for k in ("scenario", "network", "condition", "year", "growth", "seed", "label")}
    entry = {"id": meta["run_id"], **entry, "path": f"runs/{meta['run_id']}/meta.json"}
    idx["runs"] = sorted([r for r in idx["runs"] if r["id"] != entry["id"]] + [entry], key=lambda r: r["id"])
    p.write_text(json.dumps(idx, indent=1))


def main(argv=None) -> dict:
    ap = argparse.ArgumentParser(prog="python -m vhsim.viewer.export", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--net", required=True)
    ap.add_argument("--run", action="append", required=True, help="run directory (repeat for seeds -> mean)")
    ap.add_argument("--out", required=True)
    ap.add_argument("--scenario", required=True)
    ap.add_argument("--condition", required=True)
    ap.add_argument("--year", required=True, type=int)
    ap.add_argument("--growth", required=True)
    ap.add_argument("--seed")
    ap.add_argument("--network-name")
    ap.add_argument("--begin", type=float, default=0.0)
    ap.add_argument("--end", type=float, default=86400.0)
    ap.add_argument("--bookmark", action="append", default=[], help='scenario bookmark "HH:MM=label"')
    ap.add_argument("--bookmarks", help="JSON list of {t, label, detail}")
    ap.add_argument("--pois", help="GeoJSON points (S2 pois.geojson)")
    ap.add_argument("--zones", help="GeoJSON polygons (S2 residential_zones.geojson)")
    ap.add_argument("--junctions", help="S1 junctions.csv for junction names")
    ap.add_argument("--label")
    ap.add_argument("--queue-threshold", type=float, default=5.0)
    ap.add_argument("--no-gzip", action="store_true")
    ap.add_argument("--synthetic", action="store_true", help="mark the run as synthetic test data")
    ap.add_argument("--notes")
    ap.add_argument("--force-network", action="store_true",
                    help="replace an existing networks/<name>.json even if its lanes/edges differ")
    a = ap.parse_args(argv)
    bms = list(a.bookmark) + (json.loads(Path(a.bookmarks).read_text()) if a.bookmarks else [])
    return export(a.net, a.run, a.out, a.scenario, a.condition, a.year, a.growth, seed=a.seed,
                  network_name=a.network_name, begin=a.begin, end=a.end, bookmarks=bms,
                  pois=load_points(a.pois), zones=load_zones(a.zones),
                  junction_names=load_junction_names(a.junctions), label=a.label,
                  queue_threshold=a.queue_threshold, gzip=not a.no_gzip, notes=a.notes, synthetic=a.synthetic,
                  force_network=a.force_network)


if __name__ == "__main__":
    main()
