"""Run scenario x condition x seed batches and aggregate results.

    python -m vhsim.integration.batch --scenarios baseline c1a c3 ... --conditions weekday_term summer_peak \
        --year 2025 --growth base --seeds 1 2 3 [--workers 12]

Per (scenario, condition, year, growth) writes sim/data/results/<key>/:
  accessibility.csv  travel time from residential areas to POI categories (pooled over seeds)
  movements.csv      approach delay per junction movement (pooled over seeds)
  network.json       totals (trips, mean/median duration, total delay, teleports) per seed and mean
and exports the seed-mean run to the viewer (sim/data/viewer).
"""
from __future__ import annotations

import argparse
import csv
import json
import subprocess
import sys
import xml.etree.ElementTree as ET
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

import pandas as pd

from vhsim.paths import DATA, SIM

RESULTS = DATA / "results"
NETWORK_NAME = {"baseline": "baseline_bays"}


def net_for(scenario: str) -> str:
    return NETWORK_NAME.get(scenario, f"{scenario}_bays")


def _one(scenario, condition, year, growth, seed):
    from vhsim.integration.runs import run
    try:
        res, secs = run(net_for(scenario), condition, year, growth, seed, max_teleport_fraction=0.05)
        return dict(scenario=scenario, condition=condition, year=year, growth=growth, seed=seed,
                    run=str(res.out_dir), secs=round(secs), **res.summary)
    except Exception as ex:
        return dict(scenario=scenario, condition=condition, year=year, growth=growth, seed=seed,
                    error=str(ex)[:500])


def pooled_xml(paths: list[Path], out: Path, root_tag: str, item_tag: str):
    """Concatenate the <item_tag> elements of several SUMO output files into one file."""
    with open(out, "w") as f:
        f.write(f"<{root_tag}>\n")
        for p in paths:
            for _, el in ET.iterparse(str(p)):
                if el.tag == item_tag:
                    f.write(ET.tostring(el, encoding="unicode"))
                    el.clear()
        f.write(f"</{root_tag}>\n")
    return out


def network_totals(run_dir: Path) -> dict:
    tot = dict(trips=0, dur_sum=0.0, timeloss_sum=0.0, wait_sum=0.0)
    durs = []
    for _, el in ET.iterparse(str(run_dir / "tripinfo.xml")):
        if el.tag == "tripinfo":
            d = float(el.get("duration")); durs.append(d)
            tot["trips"] += 1; tot["dur_sum"] += d
            tot["timeloss_sum"] += float(el.get("timeLoss", 0)); tot["wait_sum"] += float(el.get("waitingTime", 0))
            el.clear()
    durs.sort()
    n = max(tot["trips"], 1)
    return dict(trips=tot["trips"], mean_trip_min=round(tot["dur_sum"] / n / 60, 2),
                median_trip_min=round(durs[len(durs) // 2] / 60, 2) if durs else 0,
                p95_trip_min=round(durs[int(len(durs) * 0.95)] / 60, 2) if durs else 0,
                total_delay_veh_h=round(tot["timeloss_sum"] / 3600, 1),
                total_waiting_veh_h=round(tot["wait_sum"] / 3600, 1))


def zone_areas() -> dict:
    with open(DATA / "zones" / "zone_areas.csv") as f:
        r = csv.DictReader(f)
        cols = r.fieldnames
        zc, ac = cols[0], ("suburb" if "suburb" in cols else cols[1])
        return {row[zc]: row[ac] for row in r}


def aggregate(scenario, condition, year, growth, runs: list[dict]) -> dict:
    from vhsim.metrics import accessibility, movements
    key = f"{scenario}__{condition}_{year}_{growth}"
    out = RESULTS / key
    out.mkdir(parents=True, exist_ok=True)
    ok = [r for r in runs if "error" not in r]
    dirs = [Path(r["run"]) for r in ok]
    meta = dict(key=key, scenario=scenario, condition=condition, year=year, growth=growth,
                network=net_for(scenario), seeds=[r["seed"] for r in ok], errors=[r for r in runs if "error" in r])
    if not dirs:
        (out / "network.json").write_text(json.dumps(meta, indent=1))
        return meta
    totals = [dict(seed=r["seed"], teleports=r.get("teleports"), **network_totals(Path(r["run"]))) for r in ok]
    meta["per_seed"] = totals
    meta["mean"] = {k: round(sum(t[k] for t in totals) / len(totals), 2)
                    for k in totals[0] if k not in ("seed",) and isinstance(totals[0][k], (int, float))}
    ti = pooled_xml([d / "tripinfo.xml" for d in dirs], out / "tripinfo.pooled.xml", "tripinfos", "tripinfo")
    acc = accessibility.table(ti, zone_areas())
    acc["seeds"] = len(dirs)
    acc.to_csv(out / "accessibility.csv", index=False)
    vr = pooled_xml([d / "vehroute.xml" for d in dirs], out / "vehroute.pooled.xml", "routes", "vehicle")
    mov = movements.table(vr, DATA / "networks" / f"{net_for(scenario)}.net.xml", duration_hours=24 * len(dirs))
    # pooled over seeds: banded rows were divided by the band's hours only, so divide by the seed count too
    # (the "all" row already used duration_hours = 24 x seeds)
    banded = mov["hour_band"] != "all"
    mov.loc[banded, "flow_per_hour"] = mov.loc[banded, "flow_per_hour"] / len(dirs)
    mov.to_csv(out / "movements.csv", index=False)
    for p in (ti, vr):
        p.unlink()
    (out / "network.json").write_text(json.dumps(meta, indent=1, default=str))
    # viewer export (seed mean)
    cmd = [sys.executable, "-W", "ignore", "-m", "vhsim.viewer.export",
           "--net", str(DATA / "networks" / f"{net_for(scenario)}.net.xml"), "--network-name", scenario,
           "--out", str(DATA / "viewer"), "--scenario", scenario, "--condition", condition,
           "--year", str(year), "--growth", growth, "--pois", str(DATA / "zones" / "pois.geojson"),
           "--zones", str(DATA / "zones" / "residential_zones.geojson"),
           "--junctions", str(DATA / "networks" / "junctions.csv"), "--begin", "0", "--end", "86400"]
    for d in dirs:
        cmd += ["--run", str(d)]
    p = subprocess.run(cmd, capture_output=True, text=True, cwd=SIM)
    meta["viewer_export"] = "ok" if p.returncode == 0 else p.stderr[-500:]
    (out / "network.json").write_text(json.dumps(meta, indent=1, default=str))
    return meta


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--scenarios", nargs="+", required=True)
    ap.add_argument("--conditions", nargs="+", default=["weekday_term", "summer_peak"])
    ap.add_argument("--year", default="2025")
    ap.add_argument("--growth", default="base")
    ap.add_argument("--seeds", nargs="+", type=int, default=[1, 2, 3])
    ap.add_argument("--workers", type=int, default=12)
    a = ap.parse_args(argv)
    jobs = [(s, c, a.year, a.growth, seed) for s in a.scenarios for c in a.conditions for seed in a.seeds]
    results = []
    with ProcessPoolExecutor(a.workers) as ex:
        futs = [ex.submit(_one, *j) for j in jobs]
        for f in as_completed(futs):
            r = f.result(); results.append(r)
            print(json.dumps({k: r.get(k) for k in ("scenario", "condition", "seed", "secs", "teleports", "error")}),
                  flush=True)
    groups = {}
    for r in results:
        groups.setdefault((r["scenario"], r["condition"]), []).append(r)
    with ProcessPoolExecutor(min(a.workers, 6)) as ex:
        futs = {ex.submit(aggregate, s, c, a.year, a.growth, rs): (s, c) for (s, c), rs in groups.items()}
        for f in as_completed(futs):
            m = f.result()
            print("aggregated", m["key"], m.get("mean", {}), m.get("viewer_export"), flush=True)
    # combinations where every seed jammed (hit VHSIM_SUMO_TIMEOUT) are listed for the residents' site
    from vhsim.viewer.jammed import update_index
    if (DATA / "viewer" / "index.json").exists():
        print("jammed combinations:", update_index(DATA / "viewer" / "index.json", RESULTS), flush=True)


if __name__ == "__main__":
    main()
