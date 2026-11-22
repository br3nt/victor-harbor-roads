"""C3 one-way outer loop (clockwise) and C3b (anticlockwise) on the real network (slow)."""
import math
import subprocess
import xml.etree.ElementTree as ET

import pytest

from vhsim.paths import sumo_bin

pytestmark = pytest.mark.slow

LOOP = ("Torrens Street", "Eyre Terrace", "Flinders Parade", "Esplanade")
HINDMARSH_SOUTHBOUND = "50904904#12"     # Hindmarsh Rd into the Seaview/Eyre roundabout from the north
OCEAN_ST = "60269598#4"                  # Ocean St, Coral St to Albert Pl
OCEAN_ST_NORTH = "60269598#0"            # Ocean St, Torrens St to Coral St (main street)
VICTORIA_WESTBOUND = "173449385#1"       # Victoria St west of Torrens St, towards Encounter Bay


def _heading(net, e):
    (x0, y0), (x1, y1) = e.getFromNode().getCoord(), e.getToNode().getCoord()
    b = math.atan2(x1 - x0, y1 - y0)
    return math.sin(b), math.cos(b)      # east, north


def _loop_edges(net, s6_base, name):
    inside = set(s6_base.inside_town_centre)
    return [e for e in net.getEdges() if e.getName() == name and not e.getID().endswith(".x")
            and (name == "Torrens Street" or e.getID().removesuffix(".bay") in inside)]


@pytest.mark.parametrize("scen,sign", [("c3", 1), ("c3b", -1)])
def test_loop_streets_run_one_way_in_the_loop_direction(built, s6_base, scen, sign):
    _, net, _ = built(scen)
    want = {"Torrens Street": lambda ex, no: sign * no > 0,     # clockwise: north-east
            "Eyre Terrace": lambda ex, no: sign * no < 0,       # south-east
            "Flinders Parade": lambda ex, no: sign * no < 0,    # south
            "Esplanade": lambda ex, no: sign * ex < 0}          # west
    for name, ok in want.items():
        edges = _loop_edges(net, s6_base, name)
        assert len(edges) >= 2, name
        wrong = [e.getID() for e in edges if not ok(*_heading(net, e))]
        assert not wrong, (name, wrong)


@pytest.mark.parametrize("scen", ["c3", "c3b"])
def test_victoria_street_stays_two_way_and_internal_streets_keep_direction(built, baseline_bays, scen):
    summary, net, _ = built(scen)
    vic = {e.getID() for e in baseline_bays.getEdges() if e.getName() == "Victoria Street"}
    assert vic <= {e.getID() for e in net.getEdges()}
    for eid in summary["removed"]["ids"]:
        e = baseline_bays.getEdge(eid)
        # loop carriageways, plus car-park stubs / median links reachable only from a removed carriageway
        assert e.getName() in LOOP or e.getType() in ("highway.service", "highway.trunk_link"), (eid, e.getName())
    # Ocean St, Railway Tce, McKinlay St, Stuart St keep their one-way direction (all edges present)
    for name in ("Ocean Street", "Railway Terrace", "McKinlay Street", "Stuart Street", "Coral Street", "Albert Place"):
        assert {e.getID() for e in baseline_bays.getEdges() if e.getName() == name} <= {e.getID() for e in net.getEdges()}


@pytest.mark.parametrize("scen", ["c3", "c3b"])
def test_loop_network_stays_connected(built, scen):
    summary, _, _ = built(scen)
    assert summary["checks"]["ok"], summary["checks"]


@pytest.mark.parametrize("scen", ["c3", "c3b"])
def test_car_from_hindmarsh_road_reaches_ocean_street_and_leaves_to_encounter_bay(built, scen):
    _, net, _ = built(scen)
    for a, b in ((HINDMARSH_SOUTHBOUND, OCEAN_ST_NORTH), (HINDMARSH_SOUTHBOUND, OCEAN_ST), (OCEAN_ST, VICTORIA_WESTBOUND)):
        path, cost = net.getShortestPath(net.getEdge(a), net.getEdge(b), vClass="passenger")
        assert path, (a, b)


def _route(net_path, frm, to, vclass, tmp_path):
    trips = tmp_path / "t.trips.xml"
    trips.write_text(f'<routes><vType id="v" vClass="{vclass}"/>'
                     f'<trip id="t" type="v" depart="0" from="{frm}" to="{to}"/></routes>')
    out = tmp_path / "t.rou.xml"
    subprocess.run([sumo_bin("duarouter"), "-n", str(net_path), "--route-files", str(trips), "-o", str(out),
                    "--no-step-log", "true"], check=True, capture_output=True)
    return next(ET.parse(out).getroot().iter("route")).get("edges").split()


@pytest.mark.parametrize("scen", ["c3", "c3b"])
def test_trucks_victor_harbor_road_to_inman_valley_use_the_ring_road_not_the_loop(built, scen, tmp_path):
    import csv

    from vhsim.network import config

    _, net, root = built(scen)
    with open(config.NETWORKS / "gateway_edges.csv", newline="") as f:
        gw = {r["gateway"]: r for r in csv.DictReader(f)}
    route = _route(root / f"{scen}_bays.net.xml", gw["victor_harbor_rd_north"]["in_edge"],
                   gw["inman_valley_rd_west"]["out_edge"], "truck", tmp_path)
    names = {net.getEdge(e).getName() for e in route}
    assert {"Welch Road", "Armstrong Road"} <= names, names
    assert not names & set(LOOP), names & set(LOOP)


# independent of the implementation's direction rule: the ids listed in S6-scenarios.md (S6-04)
C3_REMOVED = {"576495725#0", "576495725#2", "576495721#0", "576495721#1", "50904910#0", "50904910#2",
              "1202918967#0", "1202918967#1", "-173449378", "50904911",          # Torrens St SW-bound
              "184390356", "-50904907#1", "-50904907#5",                          # Eyre Tce NW-bound
              "23075179#5", "23075179#1", "23075179#0",                           # Flinders Pde N-bound
              "-184389891#1", "-184389891#2",                                     # Esplanade E-bound
              "173449330", "1204648898", "-1204648898"}                           # left without access


def test_c3_removes_exactly_the_documented_edges_and_keeps_their_twins(built, s6_base):
    summary, net, _ = built("c3")
    assert set(summary["removed"]["ids"]) == C3_REMOVED
    # every removed loop edge whose node pair also has an opposite edge keeps that opposite edge
    for eid in C3_REMOVED:
        e = s6_base.net.getEdge(eid)
        if e.getName() not in LOOP:
            continue
        a = e.getFromNode().getID()
        twins = [r for r in e.getToNode().getOutgoing() if r.getToNode().getID() == a]
        assert all(net.hasEdge(r.getID()) for r in twins), (eid, [r.getID() for r in twins])


def test_a_car_can_drive_the_clockwise_loop(built, tmp_path):
    _, net, root = built("c3")
    # from the Seaview roundabout exit onto Eyre Tce to the Esplanade leg that ends at Albert Pl: the only way is round the loop
    route = _route(root / "c3_bays.net.xml", "23075173", "184389891#2", "passenger", tmp_path)
    names = [net.getEdge(e).getName() for e in route]
    order = [n for i, n in enumerate(names) if n in LOOP and (i == 0 or names[i - 1] != n)]
    assert order == ["Eyre Terrace", "Flinders Parade", "Esplanade"], names
