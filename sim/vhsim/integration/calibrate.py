"""Calibrate demand parameters against DIT daily volumes (S-D01/S-D02) on the town's internal arterials.

Grid search over demand-config overrides; each variant builds its own demand, runs a full day on the
baseline network, and is scored by GEH of simulated vs DIT two-way daily volume on the counted
sections. Results: sim/data/runs/calibration/<variant>/ and calibration.csv.

GEH on daily volumes is not the traffic-engineering hourly criterion; it is used here as a scale-free
ranking score. The hourly check against the 2017 turning counts is done separately
(vhsim.integration.calibration.compare_turning).
"""
from __future__ import annotations

import csv
import itertools
import json
import math
import subprocess
import sys
import xml.etree.ElementTree as ET
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

from vhsim.paths import DATA, SIM

CAL = DATA / "runs" / "calibration"
BASE_BETA = {"default": 1.2, "work": 0.8, "school": 1.5, "supermarket": 1.5, "shops": 1.2, "dining": 1.0,
             "services": 1.2, "medical": 1.0, "gym": 1.5, "recreation": 1.3, "beach_foreshore": 1.0,
             "residential": 1.5, "caravan_park": 1.0, "accommodation": 1.0}
# sections inside the network used for scoring (gateway sections are fitted by construction)
SCORED = {("04760", "43.21"), ("04760", "45.6"), ("04760", "47.66"), ("04760", "49.1"), ("04760", "50"),
          ("04760", "50.38"), ("04793", "30.41"), ("04793", "31.5"), ("04688", "0")}


def overrides(senior_weight: float, beta_mult: float) -> list[str]:
    beta = {k: round(v * beta_mult, 3) for k, v in BASE_BETA.items()}
    return [f"rates.senior_weight={senior_weight}", f"gravity.beta={json.dumps(beta)}"]


def geh(m, c):
    return math.sqrt(2 * (m - c) ** 2 / (m + c)) if m + c else 0.0


def section_volumes(run_dir: Path, net_path: Path) -> list[dict]:
    import sumolib
    net = sumolib.net.readNet(str(net_path))
    ent = defaultdict(float)
    for _, el in ET.iterparse(str(run_dir / "edgedata.xml")):
        if el.tag == "interval":
            for e in el.findall("edge"):
                ent[e.get("id")] += float(e.get("entered", 0) or 0)
            el.clear()
    out = []
    for r in csv.DictReader(open(DATA / "counts" / "aadt.csv")):
        if (r["road_no"], r["section_from_km"]) not in SCORED:
            continue
        x, y = net.convertLonLat2XY(float(r["lon"]), float(r["lat"]))
        near = sorted(((d, e) for e, d in net.getNeighboringEdges(x, y, 60) if not e.getID().startswith(":")),
                      key=lambda t: t[0])
        if not near:
            continue
        e0 = near[0][1]
        (ax, ay), (bx, by) = e0.getShape()[0], e0.getShape()[-1]
        opp = [e for _, e in near if e is not e0 and e.getName() == e0.getName()
               and ((e.getShape()[-1][0] - e.getShape()[0][0]) * (bx - ax)
                    + (e.getShape()[-1][1] - e.getShape()[0][1]) * (by - ay)) < 0]
        v = ent[e0.getID()] + (ent[opp[0].getID()] if opp else 0)
        out.append(dict(road=r["road"], section=f'{r["section_from_km"]}-{r["section_to_km"]}',
                        aadt=float(r["aadt"]), sim=v, geh=geh(v, float(r["aadt"]))))
    return out


def run_variant(name: str, sets: list[str], network: str = "baseline_bays", extra_args=()) -> dict:
    vdir = CAL / name
    vdir.mkdir(parents=True, exist_ok=True)
    py = sys.executable
    cmd = [py, "-W", "ignore", "-m", "vhsim.demand.build", "--condition", "weekday_term", "--year", "2025",
           "--growth", "base", "--out-dir", str(vdir / "demand"), "--no-zones"]
    for s in sets:
        cmd += ["--set", s]
    subprocess.run(cmd, check=True, capture_output=True, cwd=SIM)
    from vhsim.integration.runs import run
    try:
        res, secs = run(network, "weekday_term", 2025, "base", 1, tag=f"cal_{name}", extra_args=extra_args,
                        trips_path=vdir / "demand" / "weekday_term_2025_base.trips.xml")
    except Exception as ex:  # gridlocked variants are a result, not a crash
        out = dict(name=name, sets=sets, mean_geh=999.0, summary={"error": str(ex)[:300]}, sections=[])
        (vdir / "result.json").write_text(json.dumps(out, indent=1))
        return out
    secs_v = section_volumes(res.out_dir, DATA / "networks" / f"{network}.net.xml")
    score = sum(s["geh"] for s in secs_v) / max(len(secs_v), 1)
    out = dict(name=name, sets=sets, mean_geh=round(score, 2), summary=res.summary, run=str(res.out_dir),
               sections=secs_v)
    (vdir / "result.json").write_text(json.dumps(out, indent=1))
    return out


REROUTE = ("--device.rerouting.probability", "1", "--device.rerouting.period", "120",
           "--device.rerouting.adaptation-steps", "18", "--device.rerouting.adaptation-interval", "10")


def grid(senior_weights=(0.42, 0.2, 0.0), beta_mults=(1.0, 0.75, 0.5), workers: int = 9, extra_args=REROUTE,
         prefix: str = "rr_"):
    jobs = {f"{prefix}sw{sw}_b{bm}": overrides(sw, bm) for sw, bm in itertools.product(senior_weights, beta_mults)}
    with ProcessPoolExecutor(workers) as ex:
        futs = {n: ex.submit(run_variant, n, s, "baseline_bays", extra_args) for n, s in jobs.items()}
        results = [f.result() for f in futs.values()]
    results.sort(key=lambda r: r["mean_geh"])
    with open(CAL / "calibration.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["variant", "mean_geh"] + [f'{s["road"]} {s["section"]}' for s in results[0]["sections"]])
        for r in results:
            w.writerow([r["name"], r["mean_geh"]] + [f'{s["sim"]:.0f}/{s["aadt"]:.0f}' for s in r["sections"]])
    return results


if __name__ == "__main__":
    for r in grid():
        print(r["name"], r["mean_geh"], r["summary"].get("teleports", r["summary"].get("error", "")[:60]),
              " ".join(f'{s["road"][:8]}:{s["sim"] / s["aadt"]:.2f}' for s in r["sections"]))
