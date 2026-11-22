"""Fixtures for the metrics tests: small hand-built networks (netconvert) and route helpers."""
from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from vhsim.paths import sumo_bin


def netconvert(tmp_path: Path, nodes: str, edges: str, name="net", extra=(), connections: str | None = None) -> Path:
    n, e, out = tmp_path / f"{name}.nod.xml", tmp_path / f"{name}.edg.xml", tmp_path / f"{name}.net.xml"
    n.write_text(f"<nodes>{nodes}</nodes>")
    e.write_text(f"<edges>{edges}</edges>")
    cmd = [sumo_bin("netconvert"), "-n", str(n), "-e", str(e), "-o", str(out), *extra]
    if connections:
        c = tmp_path / f"{name}.con.xml"
        c.write_text(f"<connections>{connections}</connections>")
        cmd += ["-x", str(c)]
    subprocess.run(cmd, check=True, capture_output=True)
    return out


@pytest.fixture
def geo_net(tmp_path: Path) -> Path:
    """Geo-referenced 3-node line near Victor Harbor (UTM 54S, built from lon/lat nodes), edges ab, bc and reverses."""
    nodes = ('<node id="A" x="138.6200" y="-35.5500"/><node id="B" x="138.6255" y="-35.5500"/>'
             '<node id="C" x="138.6310" y="-35.5500"/>')
    edges = ""
    for a, b in (("A", "B"), ("B", "C")):
        edges += (f'<edge id="{a}{b}" from="{a}" to="{b}" numLanes="1" speed="13.89"/>'
                  f'<edge id="{b}{a}" from="{b}" to="{a}" numLanes="1" speed="13.89"/>')
    return netconvert(tmp_path, nodes, edges, "geo", extra=["--proj.utm", "--proj.plain-geo"])


@pytest.fixture
def cross_net(tmp_path: Path) -> Path:
    """4-leg priority crossing at X. Major W-E (priority 9), minor S-N (priority 1), all 13.89 m/s.

    Per leg L in W,E,S,N: nodes L (300 m from X) and L0 (600 m); edges ``Lin0`` (L0->L), ``LX`` (L->X),
    ``XL`` (X->L), ``Lout0`` (L->L0). The approach edges LX are never first on a route when vehicles start
    on ``Lin0``.
    """
    pos = {"W": (-1, 0), "E": (1, 0), "S": (0, -1), "N": (0, 1)}
    nodes = '<node id="X" x="0" y="0" type="priority"/>'
    edges = ""
    for L, (dx, dy) in pos.items():
        prio = 9 if L in "WE" else 1
        nodes += f'<node id="{L}" x="{300 * dx}" y="{300 * dy}"/><node id="{L}0" x="{600 * dx}" y="{600 * dy}"/>'
        for a, b, eid in ((f"{L}0", L, f"{L}in0"), (L, "X", f"{L}X"), ("X", L, f"X{L}"), (L, f"{L}0", f"{L}out0")):
            edges += f'<edge id="{eid}" from="{a}" to="{b}" numLanes="1" speed="13.89" priority="{prio}"/>'
    return netconvert(tmp_path, nodes, edges, "cross")
