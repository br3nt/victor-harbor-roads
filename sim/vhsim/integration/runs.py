"""Integration: assemble a scenario run (network + demand + vehicle types) and simulate it.

Run outputs go to sim/data/runs/<run_id>/ (git-ignored).
"""
from __future__ import annotations

import re
import time
from pathlib import Path

from vhsim.integration.snap import snap_trips_taz
from vhsim.metrics.run import RunResult, simulate
from vhsim.viewer.additional import viewer_additional
from vhsim.paths import DATA

NETWORKS = DATA / "networks"
DEMAND = DATA / "demand"
RUNS = DATA / "runs"
# A-INT-02: driver behaviour at give-way junctions (see sim/assumptions/integration.md)
DEFAULT_SUMO_ARGS = ("--ignore-junction-blocker", "15", "--time-to-impatience", "60",
                     # A-INT-03: drivers re-check travel times en route and avoid congestion
                     "--device.rerouting.probability", "1", "--device.rerouting.period", "120",
                     "--device.rerouting.adaptation-steps", "18", "--device.rerouting.adaptation-interval", "10")


def combined_trips(trips: Path, vtypes: Path, out: Path) -> Path:
    """duarouter needs vType definitions before the trips: write them into one route file."""
    types = re.findall(r"<vType\b[^>]*/>|<vType\b.*?</vType>", vtypes.read_text(), flags=re.S)
    body = trips.read_text()
    start = body.index("<routes")
    start = body.index(">", start) + 1
    out.write_text(body[:start] + "\n" + "\n".join(types) + body[start:])
    return out


def run_id(network: str, condition: str, year: int | str, growth: str, seed: int, tag: str = "") -> str:
    return f"{network}__{condition}_{year}_{growth}__s{seed}" + (f"__{tag}" if tag else "")


def routing_preferences(network: str) -> Path | None:
    """The network's SUMO routing-preference file (written by vhsim.scenarios.build, e.g. C5's truck
    preference for the outer ring road), if it has one."""
    p = NETWORKS / f"{network}.prefs.add.xml"
    return p if p.exists() else None


def run(network: str = "baseline_bays", condition: str = "weekday_term", year: int | str = 2025,
        growth: str = "base", seed: int = 1, end: int | None = None, additional=None,
        extra_args=(), max_teleport_fraction: float = 0.01, tag: str = "",
        trips_path: Path | None = None) -> tuple[RunResult, float]:
    """Simulate one (network, demand) combination; returns (result, wall seconds)."""
    rid = run_id(network, condition, year, growth, seed, tag)
    out = RUNS / rid
    out.mkdir(parents=True, exist_ok=True)
    net = NETWORKS / f"{network}.net.xml"
    snapped = out / "trips.snapped.xml"
    taz = out / "taz.add.xml"
    stats = snap_trips_taz(trips_path or DEMAND / f"{condition}_{year}_{growth}.trips.xml", net, snapped, taz)
    (out / "snap_stats.json").write_text(__import__("json").dumps(stats, indent=1))
    trips = combined_trips(snapped, DEMAND / "vtypes.add.xml", out / "trips.xml")
    end = end or (100800 if condition == "event_nye" else 93600)
    add = [viewer_additional(out / "viewer.add.xml", period=900)] + (list(additional) if additional else [])
    prefs = routing_preferences(network)
    if prefs:
        add.append(prefs)
    t0 = time.time()
    res = simulate(net, trips, out, seed=seed, begin=0, end=end,
                   additional=add, extra_args=(*DEFAULT_SUMO_ARGS, *extra_args),
                   max_teleport_fraction=max_teleport_fraction,
                   router_additional=",".join(str(p) for p in (taz, prefs) if p),
                   router_args=("--with-taz", "true"))
    return res, time.time() - t0


if __name__ == "__main__":
    import argparse
    import json

    ap = argparse.ArgumentParser()
    ap.add_argument("--network", default="baseline")
    ap.add_argument("--condition", default="weekday_term")
    ap.add_argument("--year", default="2025")
    ap.add_argument("--growth", default="base")
    ap.add_argument("--seed", type=int, default=1)
    a = ap.parse_args()
    res, secs = run(a.network, a.condition, a.year, a.growth, a.seed)
    print(json.dumps({"run": str(res.out_dir), "seconds": round(secs, 1), **res.summary}, indent=1))
