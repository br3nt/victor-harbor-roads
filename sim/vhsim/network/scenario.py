"""Scenario networks: netconvert patch files applied over the baseline plain files.

    from vhsim.network import scenario
    scenario.build("c3_one_way_loop", Path("sim/data/networks/patches/c3_one_way_loop"))

A patch directory holds any of `*.nod.xml`, `*.edg.xml`, `*.con.xml`, `*.tll.xml` (and
`*.typ.xml`). They are loaded after the baseline file of the same kind, so an element with an
existing id updates it, a new id adds it, and `<delete .../>` removes it (netconvert plain-XML
patch semantics). Files load in name order. The baseline itself is built the same way with no
patches, so baseline and scenario nets differ only by their patches.
"""
from __future__ import annotations

import argparse
import re
import xml.etree.ElementTree as ET
from pathlib import Path

from vhsim.network import config
from vhsim.network.netconvert import run_netconvert

KINDS = {"nod": "--node-files", "edg": "--edge-files", "con": "--connection-files",
         "tll": "--tllogic-files", "typ": "--type-files"}


def _patch_files(patches_dir: Path | None) -> dict[str, list[Path]]:
    found: dict[str, list[Path]] = {k: [] for k in KINDS}
    if patches_dir is None:
        return found
    for p in sorted(Path(patches_dir).iterdir()):
        if p.name.startswith(".") or p.is_dir():
            continue
        parts = p.name.split(".")
        if len(parts) < 3 or parts[-1] != "xml" or parts[-2] not in KINDS:
            raise ValueError(f"unrecognised patch file {p.name} (want *.nod|edg|con|tll|typ.xml)")
        found[parts[-2]].append(p)
    return found


def _deleted_edges(edge_patches: list[Path]) -> set[str]:
    return {d.get("id") for p in edge_patches for d in ET.parse(p).getroot().iter("delete")}


def _relaned_edges(edge_patches: list[Path]) -> set[str]:
    return {e.get("id") for p in edge_patches for e in ET.parse(p).getroot().iter("edge") if e.get("numLanes")}


def _rejoined_edges(edge_patches: list[Path], base_edges: Path | None = None) -> tuple[set[str], set[str]]:
    """(existing edges a patch gives a different end node, existing edges it gives a different start node).
    New edges and patches that restate an unchanged node are not moves."""
    base = {}
    if base_edges is not None and base_edges.exists():
        base = {e.get("id"): (e.get("from"), e.get("to")) for e in ET.parse(base_edges).getroot().iter("edge")}
    ends, starts = set(), set()
    for p in edge_patches:
        for e in ET.parse(p).getroot().iter("edge"):
            eid = e.get("id")
            if eid not in base:
                continue
            if e.get("to") and e.get("to") != base[eid][1]:
                ends.add(eid)
            if e.get("from") and e.get("from") != base[eid][0]:
                starts.add(eid)
    return ends, starts


def _drop_connections(con_file: Path, deleted: set[str], out: Path, relaned: frozenset[str] = frozenset(),
                      new_end: frozenset[str] = frozenset(), new_start: frozenset[str] = frozenset()) -> Path:
    """Copy of `con_file` without connections from/to a deleted edge (netconvert errors on them),
    without connections from an edge whose lane count a patch changes (they are lane-specific, so
    netconvert recomputes them for every lane), and without connections from an edge that a patch
    moves to a new end node or into an edge it moves to a new start node (they no longer meet at the
    old junction; netconvert computes the new junction's connections)."""
    src = con_file.read_text()

    def keep(m: re.Match) -> str:
        a = dict(re.findall(r'(\w+)="([^"]*)"', m.group(0)))
        drop = (a.get("from") in deleted or a.get("to") in deleted or a.get("from") in relaned
                or a.get("from") in new_end or a.get("to") in new_start)
        return "" if drop else m.group(0)

    out.write_text(re.sub(r"<connection\b[^>]*/>", keep, src))
    return out


def build(name: str, patches_dir: Path | None, *, base_dir: Path = config.BASELINE_PLAIN_DIR,
          prefix: str = config.PLAIN_PREFIX, out_dir: Path = config.NETWORKS,
          extra_args: list[str] | None = None, log: Path | None = None,
          plain_output: bool = False) -> Path:
    """Write `<out_dir>/<name>.net.xml` = baseline plain files + patches. Returns its path.

    Base connections that use an edge a patch deletes, leave an edge whose lane count a patch
    changes, leave an edge a patch moves to a different end node, or enter an edge it moves to a
    different start node, are dropped first (written to `<out_dir>/<name>.work/`); netconvert
    recomputes them, so re-apply any turn bans on such edges with a connection patch. With `plain_output`, the scenario's own plain files are written to
    `<out_dir>/<name>.plain/<name>.*.xml` (input for vhsim.network.turn_bays)."""
    base_dir = Path(base_dir)
    base = {k: base_dir / f"{prefix}.{k}.xml" for k in KINDS}
    for k in ("nod", "edg"):
        if not base[k].exists():
            raise FileNotFoundError(f"baseline plain file missing: {base[k]} (run python -m vhsim.network.build)")
    patches = _patch_files(patches_dir)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    deleted = _deleted_edges(patches["edg"])
    relaned = frozenset(_relaned_edges(patches["edg"]))
    new_end, new_start = (frozenset(x) for x in _rejoined_edges(patches["edg"], base["edg"]))
    if (deleted or relaned or new_end or new_start) and base["con"].exists():
        work = out_dir / f"{name}.work"
        work.mkdir(exist_ok=True)
        base["con"] = _drop_connections(base["con"], deleted, work / f"{prefix}.con.xml", relaned, new_end, new_start)
    args: list[str] = []
    for kind, opt in KINDS.items():
        files = ([base[kind]] if base[kind].exists() else []) + patches[kind]
        if files:
            args += [opt, ",".join(str(f) for f in files)]
    out = out_dir / f"{name}.net.xml"
    if plain_output:
        plain = out_dir / f"{name}.plain"
        plain.mkdir(exist_ok=True)
        args += ["--plain-output-prefix", str(plain / name)]
    run_netconvert([*args, *config.NETCONVERT_PATCH_OPTIONS, *(extra_args or []), "-o", str(out)], log=log)
    return out


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("name")
    ap.add_argument("patches_dir", type=Path)
    a = ap.parse_args(argv)
    print(build(a.name, a.patches_dir))


if __name__ == "__main__":
    main()
