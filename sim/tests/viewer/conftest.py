"""Fixtures for the viewer exporter tests: a small geo-referenced, left-hand-traffic test town."""
from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from vhsim.paths import sumo_bin

LONS = (138.600, 138.602, 138.604)        # ~181 m apart at this latitude
LATS = (-35.5300, -35.5318, -35.5336)     # ~200 m apart (row 0 is the northern row)
ROW_NAMES = ("North St", "Main Rd", "South St")
COL_NAMES = ("West Tce", "Centre St", "East Tce")


def node_id(r: int, c: int) -> str:
    return f"n{r}{c}"


def town_xml(main_lanes: int = 2, centre_oneway: bool = True, main_speed: float = 16.67) -> tuple[str, str]:
    """Nodes/edges of a 3x3 grid. Middle row = Main Rd (``main_lanes`` per direction, 60 km/h); others
    1 lane, 50 km/h. Centre St between rows 0 and 1 is one-way southbound when ``centre_oneway``."""
    nodes = "".join(f'<node id="{node_id(r, c)}" x="{LONS[c]}" y="{LATS[r]}" type="priority"/>'
                    for r in range(3) for c in range(3))
    edges = []

    def both(a, b, name, lanes, speed, prio, oneway=False):
        edges.append(f'<edge id="{a}{b}" from="{a}" to="{b}" numLanes="{lanes}" speed="{speed}" '
                     f'name="{name}" priority="{prio}"/>')
        if not oneway:
            edges.append(f'<edge id="{b}{a}" from="{b}" to="{a}" numLanes="{lanes}" speed="{speed}" '
                         f'name="{name}" priority="{prio}"/>')

    for r in range(3):
        main = r == 1
        for c in range(2):
            both(node_id(r, c), node_id(r, c + 1), ROW_NAMES[r], main_lanes if main else 1,
                 main_speed if main else 13.89, 9 if main else 3)
    for c in range(3):
        for r in range(2):
            oneway = centre_oneway and c == 1 and r == 0
            both(node_id(r, c), node_id(r + 1, c), COL_NAMES[c], 1, 13.89, 3, oneway=oneway)
    return nodes, "".join(edges)


def build_net(out: Path, name: str = "town", **kw) -> Path:
    nodes, edges = town_xml(**kw)
    n, e, net = out / f"{name}.nod.xml", out / f"{name}.edg.xml", out / f"{name}.net.xml"
    n.write_text(f"<nodes>{nodes}</nodes>")
    e.write_text(f"<edges>{edges}</edges>")
    subprocess.run([sumo_bin("netconvert"), "-n", str(n), "-e", str(e), "-o", str(net),
                    "--proj.utm", "--proj.plain-geo", "--lefthand", "--no-turnarounds", "true",
                    "--output.street-names", "true"], check=True, capture_output=True)
    return net


@pytest.fixture(scope="module")
def town_net(tmp_path_factory) -> Path:
    return build_net(tmp_path_factory.mktemp("town"))


def trips_file(path: Path, trips: list[tuple[float, str, str]]) -> Path:
    """``trips``: (depart, from_edge, to_edge); ids follow the S2 contract."""
    body = "".join(f'<trip id="res~Z1~shops~poi_1~{i:06d}" depart="{d:.1f}" from="{a}" to="{b}" type="car"/>'
                   for i, (d, a, b) in enumerate(sorted(trips)))
    path.write_text(f'<routes><vType id="car" vClass="passenger"/>{body}</routes>')
    return path


def rush(n: int, start: float, spacing: float) -> list[tuple[float, str, str]]:
    """``n`` west->east trips along Main Rd ``spacing`` s apart, crossed by Centre St southbound traffic
    (half as many) that must give way at n11: the Centre St approach ``n01n11`` queues."""
    out = []
    for i in range(n):
        out.append((start + i * spacing, "n10n11", "n11n12"))
        if i % 2 == 0:
            out.append((start + i * spacing + 1, "n01n11", "n11n21"))
    return out


@pytest.fixture(scope="module")
def town_run(town_net, tmp_path_factory):
    """One simulated hour on the test town: quiet first 15 min, a rush in 900-1800 s, then quiet."""
    from vhsim.metrics.run import simulate
    from vhsim.viewer.additional import viewer_additional

    d = tmp_path_factory.mktemp("run")
    trips = [(i * 60.0, "n10n11", "n11n12") for i in range(10)]  # light traffic in interval 0
    trips += rush(240, 900.0, 3.0)
    trips += [(2700.0 + i * 60.0, "n12n11", "n11n10") for i in range(5)]
    out = d / "out"
    out.mkdir()
    add = viewer_additional(out / "viewer.add.xml", period=900)
    res = simulate(town_net, trips_file(d / "t.xml", trips), out, seed=1, end=3600, additional=add,
                   max_teleport_fraction=0.2)
    return res
