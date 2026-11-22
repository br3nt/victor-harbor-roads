"""Routing-only copies of viewer networks (``networks/<name>.lite.json``) for the residents' site.

    python -m vhsim.viewer.lite --data sim/data/viewer      # backfill every network listed in index.json

A lite network is the full ``networks/<name>.json`` without the per-lane columns (about 40% of the file) and
with shapes rounded to 5 decimals (about 1 m). It keeps ``hash`` and ``n_lanes`` so the viewer can still check
that a run belongs to it. ``vhsim.viewer.export`` writes one next to every network it exports.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path


def lite_network(doc: dict, precision: int = 5) -> dict:
    out = {k: v for k, v in doc.items() if k != "lanes"}
    out["n_lanes"] = len(doc["lanes"]["id"])
    edges = {k: v for k, v in doc["edges"].items() if k != "lanes"}
    edges["shape"] = [[round(x, precision) for x in s] for s in doc["edges"]["shape"]]
    edges["n_lanes"] = [len(x) for x in doc["edges"]["lanes"]]
    out["edges"] = edges
    out["lite"] = True
    return out


def lite_path(network_path: Path) -> Path:
    p = Path(network_path)
    return p.with_name(p.name[: -len(".json")] + ".lite.json")


def write_lite(network_path: Path) -> Path:
    doc = json.loads(Path(network_path).read_text())
    out = lite_path(network_path)
    out.write_text(json.dumps(lite_network(doc), separators=(",", ":")))
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(prog="python -m vhsim.viewer.lite", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", required=True, help="viewer data folder with index.json")
    a = ap.parse_args(argv)
    d = Path(a.data)
    idx = json.loads((d / "index.json").read_text())
    for name, rel in idx["networks"].items():
        out = write_lite(d / rel)
        print(f"{name}: {out} ({out.stat().st_size / 1e6:.2f} MB)")


if __name__ == "__main__":
    main()
