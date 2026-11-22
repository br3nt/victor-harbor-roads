"""Which (scenario, condition, year, growth) combinations jammed: every seed hit the wall-clock cap
(VHSIM_SUMO_TIMEOUT, A-INT-05), so there is no run to show, only the fact that the roads could not carry
the traffic. Written into the viewer's index.json as ``jammed`` so the residents' site can say so instead of
"not simulated yet".

    python -m vhsim.viewer.jammed      # updates sim/data/viewer/index.json from sim/data/results
"""
from __future__ import annotations

import json
from pathlib import Path

CAP_MARK = "did not finish within"


def jammed_runs(results: Path) -> list[dict]:
    out = []
    for f in sorted(Path(results).glob("*/network.json")):
        m = json.loads(f.read_text())
        errs = [e.get("error", "") if isinstance(e, dict) else str(e) for e in m.get("errors") or []]
        if m.get("seeds") or not errs or not all(CAP_MARK in e for e in errs):
            continue
        out.append(dict(scenario=m["scenario"], condition=m["condition"], year=int(m["year"]), growth=m["growth"]))
    return out


def update_index(index: Path, results: Path) -> int:
    idx = json.loads(Path(index).read_text())
    idx["jammed"] = jammed_runs(results)
    Path(index).write_text(json.dumps(idx, indent=1))
    return len(idx["jammed"])


if __name__ == "__main__":
    from vhsim.paths import DATA
    print(update_index(DATA / "viewer" / "index.json", DATA / "results"), "jammed combinations")
