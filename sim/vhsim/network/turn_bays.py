"""Add short right-turn bays on arterial approaches to give-way (priority) junctions.

Why: the OSM import gives every arterial one lane per direction with no turning pockets, so a car
waiting to turn right across oncoming traffic blocks everyone behind it. On Victor Harbor's
arterials (Torrens St, Victoria St, Bay Rd, Hindmarsh Rd, Port Elliot Rd, Adelaide Rd, George
Main Rd ...) right-turners can usually wait in a median opening, a marked turn lane or a wide
carriageway. Without this the baseline gridlocks at a few hundred vehicles per hour — far below
the DIT-counted volumes (S-D01) — which is a modelling artefact, not Victor Harbor's reality.
Assumption A-INT-01 in sim/assumptions/integration.md.

Method: for each qualifying edge, split it so the last ``bay_m`` metres have two lanes. Lane 0
(kerb side, left-hand traffic) keeps left turns and straight-on; lane 1 (median side) takes right
turns and U-turns. All existing connections, including the turn bans S1 applied by omitting
connections, are carried over to the bay edge.
"""
from __future__ import annotations

import re
import subprocess
from pathlib import Path
from xml.etree import ElementTree as ET

import sumolib

from vhsim.paths import DATA, sumo_bin

ARTERIAL_TYPES = {"highway.trunk", "highway.primary", "highway.secondary", "highway.tertiary"}
MIN_EDGE_M = 50.0
BAY_M = 40.0
CROSS_TRAFFIC_TURNS = {"r", "R", "t", "T"}      # right turns and U-turns (left-hand traffic)


def qualifying_edges(net) -> dict[str, float]:
    """edge id -> bay length for arterial one-lane edges ending at a priority junction with a right turn."""
    out = {}
    for e in net.getEdges():
        if e.getFunction() == "internal" or e.getType() not in ARTERIAL_TYPES or e.getLaneNumber() != 1:
            continue
        if e.getLength() < MIN_EDGE_M or e.getToNode().getType() not in ("priority", "priority_stop"):
            continue
        if e.getToNode().getID().startswith(":"):
            continue
        dirs = {c.getDirection() for conns in e.getOutgoing().values() for c in conns}
        if dirs & {"r", "R"} and len(e.getToNode().getOutgoing()) >= 3:
            out[e.getID()] = round(min(BAY_M, 0.4 * e.getLength()), 1)
    return out


def build(plain_dir: Path = DATA / "networks" / "baseline.plain", prefix: str = "baseline",
          base_net: Path = DATA / "networks" / "baseline.net.xml",
          out_net: Path = DATA / "networks" / "baseline_bays.net.xml", workdir: Path | None = None) -> dict:
    net = sumolib.net.readNet(str(base_net))
    bays = qualifying_edges(net)
    workdir = Path(workdir or out_net.parent / (out_net.name.replace(".net.xml", "") + ".work"))
    workdir.mkdir(parents=True, exist_ok=True)
    # 1. edge patch: split each qualifying edge into 1-lane approach + 2-lane bay
    with open(workdir / "bays.edg.xml", "w") as f:
        f.write("<edges>\n")
        for eid, L in sorted(bays.items()):
            f.write(f'  <edge id="{eid}" numLanes="2"><split pos="0" lanes="0" idBefore="{eid}.x" idAfter="{eid}"/>'
                    f'<split pos="-{L}" lanes="0 1" idBefore="{eid}" idAfter="{eid}.bay"/></edge>\n')
        f.write("</edges>\n")
    # 2. connections: move every connection from a split edge onto its bay, right/U turns from lane 1
    dirs = {}
    for e in net.getEdges():
        for tgt, conns in e.getOutgoing().items():
            for c in conns:
                dirs[(e.getID(), tgt.getID())] = c.getDirection()
    src = (plain_dir / f"{prefix}.con.xml").read_text()
    moved = 0

    def sub(m):
        nonlocal moved
        tag = m.group(0)
        a = dict(re.findall(r'(\w+)="([^"]*)"', tag))
        frm = a.get("from")
        if frm in bays:
            moved += 1
            lane = "1" if dirs.get((frm, a.get("to")), "s") in CROSS_TRAFFIC_TURNS else "0"
            tag = tag.replace(f'from="{frm}"', f'from="{frm}.bay"').replace(
                f'fromLane="{a.get("fromLane", "0")}"', f'fromLane="{lane}"')
        if a.get("to") in bays:
            pass  # the upstream part keeps the original id, so connections INTO it are unchanged
        return tag

    con = re.sub(r"<connection\b[^>]*/>", sub, src)
    extra = "".join(f'    <connection from="{e}" to="{e}.bay" fromLane="0" toLane="{k}"/>\n'
                    for e in sorted(bays) for k in (0, 1))
    con = con.replace("</connections>", extra + "</connections>")
    (workdir / "bays.con.xml").write_text(con)
    # 3. rebuild
    cmd = [sumo_bin("netconvert"), "-n", str(plain_dir / f"{prefix}.nod.xml"),
           "-e", f"{plain_dir / f'{prefix}.edg.xml'},{workdir / 'bays.edg.xml'}",
           "-x", str(workdir / "bays.con.xml"), "-t", str(plain_dir / f"{prefix}.typ.xml"),
           "--lefthand", "true", "--output.street-names", "true", "--tls.discard-loaded", "true",
           "-o", str(out_net)]
    tll = plain_dir / f"{prefix}.tll.xml"
    if tll.exists() and "<tlLogic" in tll.read_text():
        cmd += ["-i", str(tll)]
    p = subprocess.run(cmd, capture_output=True, text=True)
    (workdir / "netconvert.log").write_text(p.stdout + p.stderr)
    if p.returncode != 0:
        raise RuntimeError(f"netconvert failed: {p.stderr[-2000:]}")
    restore_routing_types(plain_dir / f"{prefix}.edg.xml", out_net)
    return {"bays": len(bays), "connections_moved": moved, "net": str(out_net)}


def restore_routing_types(plain_edges: Path, net_path: Path) -> int:
    """netconvert's <split> drops an edge's routingType (S9: C5 marks the old ring road for the truck routing
    preference), so give the split parts (`<id>`, `<id>.bay`, `<id>.x`) their original edge's routingType.
    Returns the number of edges changed."""
    rtypes = {e.get("id"): e.get("routingType") for e in ET.parse(plain_edges).getroot().iter("edge")
              if e.get("routingType")}
    if not rtypes:
        return 0
    changed = 0

    def sub(m):
        nonlocal changed
        tag, eid = m.group(0), m.group(1)
        base = eid[:-4] if eid.endswith(".bay") else eid[:-2] if eid.endswith(".x") else eid
        if base not in rtypes or "routingType=" in tag:
            return tag
        changed += 1
        return tag.replace(f'id="{eid}"', f'id="{eid}" routingType="{rtypes[base]}"', 1)

    net_path = Path(net_path)
    text = re.sub(r'<edge id="([^"]+)"[^>]*>', sub, net_path.read_text())
    net_path.write_text(text)
    return changed


if __name__ == "__main__":
    print(build())
