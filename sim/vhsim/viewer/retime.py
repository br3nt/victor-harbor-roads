"""Recompute the edge travel times of already-exported viewer runs with the current rule (assumption V1/V1a),
without re-reading the lane data: only ``edge_times.bin.gz`` and its layout in ``meta.json`` change.

    python -m vhsim.viewer.retime                       # every run in sim/data/viewer
    python -m vhsim.viewer.retime --data DIR --runs ID [ID ...]

Written for the sparse-sample fix (22 Nov 2026): runs exported before it carry SUMO's raw ``traveltime`` where the
only sample of an interval was a vehicle leaving the stop line (e.g. Grantley Ave, 2025 summer baseline, 12:15:
6,553 s, the format's cap, for a 40 s traversal). Runs whose source run directories are gone are skipped.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

from vhsim.viewer import formats
from vhsim.viewer.additional import EDGEDATA_FILE
from vhsim.viewer.export import _mean
from vhsim.viewer.measures import edge_times, read_meandata

RULE = "V1a"     # sim/assumptions/S5-viewer.md: sparse samples (less than one edge length travelled)


def retime_run(data: Path, run_id: str, dry_run: bool = False) -> dict:
    """Recompute one run's edge times. Returns {run_id, changed, over_300s, max_drop_s} or {run_id, skipped}."""
    data = Path(data)
    rdir = data / "runs" / run_id
    meta = json.loads((rdir / "meta.json").read_text())
    sources = [Path(s) for s in meta.get("sources") or []]
    if meta.get("synthetic") or not sources or not all((s / EDGEDATA_FILE).exists() for s in sources):
        return {"run_id": run_id, "skipped": "synthetic or source runs missing"}
    nj = json.loads((data / "networks" / f"{meta['network']}.json").read_text())
    if len(nj["edges"]["id"]) != meta["n_edges"]:
        return {"run_id": run_id, "skipped": "network edge count differs"}
    T, E = meta["n_intervals"], meta["n_edges"]
    layout = meta["files"]["edge_times"]
    old = formats.read_edge_times(rdir / layout["path"], layout, T, E)
    new = _mean([edge_times(nj, read_meandata(s / EDGEDATA_FILE, "edge"), meta["begin_s"], T) for s in sources])
    stored = np.minimum(new, formats.EDGE_TIME_CAP * formats.EDGE_TIME_SCALE)
    diff = np.where(np.isfinite(old) & np.isfinite(stored), old - stored, 0.0)
    res = {"run_id": run_id, "changed": int((np.abs(diff) > 1.0).sum()), "over_300s": int((diff > 300).sum()),
           "max_drop_s": round(float(diff.max()), 1)}
    if not dry_run:
        meta["files"]["edge_times"] = formats.write_edge_times(rdir / layout["path"], new)
        meta["edge_time_rule"] = RULE
        (rdir / "meta.json").write_text(json.dumps(meta, indent=1))
    return res


def main(argv: list[str] | None = None) -> int:
    from vhsim.paths import DATA

    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--data", type=Path, default=DATA / "viewer")
    ap.add_argument("--runs", nargs="*", help="run ids (default: every run in the index)")
    ap.add_argument("--dry-run", action="store_true", help="report the changes without writing")
    a = ap.parse_args(argv)
    ids = a.runs or [r["id"] for r in json.loads((a.data / "index.json").read_text())["runs"]]
    for rid in ids:
        print(json.dumps(retime_run(a.data, rid, dry_run=a.dry_run)), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
