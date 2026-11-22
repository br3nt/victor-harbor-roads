"""S9: C5 outer freight ring road, council Option 1 (sim/SCENARIOS.md; sim/assumptions/S9-ring-road.md)."""
import subprocess
import xml.etree.ElementTree as ET

import pytest

from vhsim.scenarios.defs import (C5_LINK_ROUTING_TYPE, C5_VARIANTS, RING_ROAD, SCENARIOS, c5_new_edges,
                                  c5_route)

KMH = 3.6


@pytest.mark.parametrize("variant", sorted(C5_VARIANTS))
def test_c5_route_follows_the_named_streets_both_ways(s6_base, variant):
    route = c5_route(s6_base, variant)
    for (a, b, street), (fwd, rev) in zip(C5_VARIANTS[variant]["existing"], route["existing"]):
        assert fwd and rev, (a, b, street)
        for e in fwd + rev:
            assert s6_base.net.getEdge(e).getName() == street, (e, street)
        # forward chain starts at a and ends at b; reverse chain the other way
        assert s6_base.net.getEdge(fwd[0]).getFromNode().getID() == a
        assert s6_base.net.getEdge(fwd[-1]).getToNode().getID() == b
        assert s6_base.net.getEdge(rev[0]).getFromNode().getID() == b
        assert s6_base.net.getEdge(rev[-1]).getToNode().getID() == a


def test_c5_variants_registered():
    assert "c5" in SCENARIOS and "c5b" in SCENARIOS
    assert set(C5_VARIANTS) == {"c5", "c5b"}


@pytest.mark.slow
@pytest.mark.parametrize("variant", ["c5", "c5b"])
def test_c5_network(built, s6_base, variant):
    summary, net, root = built(variant)
    assert summary["checks"]["ok"], summary["checks"]
    assert not summary["movements_missing"], summary["movements_missing"]
    route = c5_route(s6_base, variant)
    # existing roads on the outer road: 100 km/h, priority 11; new sections two-lane (one each way), 100 km/h
    outer = [e for fwd, rev in route["existing"] for e in fwd + rev] + route["new"]
    assert route["new"]
    for e in outer:
        edge = net.getEdge(e) if net.hasEdge(e) else None
        assert edge is not None, e
        assert edge.getSpeed() * KMH == pytest.approx(100, abs=0.5), e
        assert edge.getPriority() == 11, e
    for e in route["new"]:
        assert net.getEdge(e).getLaneNumber() == 1
        assert net.hasEdge(e[1:] if e.startswith("-") else "-" + e)      # both directions
    # the existing ring road: 60 km/h, routingType for the truck preference (bays included)
    ring = [e for e in net.getEdges() if e.getName() in RING_ROAD]
    assert ring
    for e in ring:
        assert e.getSpeed() * KMH <= 60.5, e.getID()
        assert e.getRoutingType() == C5_LINK_ROUTING_TYPE, e.getID()
    prefs = ET.parse(root / f"{variant}_bays.prefs.add.xml").getroot()
    p = prefs.find("preference")
    assert p.get("routingType") == C5_LINK_ROUTING_TYPE and p.get("vClasses") == "truck"
    assert 0 < float(p.get("priority")) < 1
    # the outer road is the major road where it joins Greenhills Rd / Hutchinson Rd / Hindmarsh Tiers Rd:
    # every other leg there has a lower priority
    for nid in C5_VARIANTS[variant]["major_at"]:
        for e in list(net.getNode(nid).getIncoming()) + list(net.getNode(nid).getOutgoing()):
            if e.getFunction() == "internal" or e.getID().split(".")[0] in outer:
                continue
            assert e.getPriority() < 11, (nid, e.getID(), e.getPriority())


@pytest.mark.slow
@pytest.mark.parametrize("variant", ["c5", "c5b"])
def test_c5_through_trucks_take_the_outer_road(built, variant, tmp_path):
    """Trucks from Inman Valley Rd (west gateway) to Victor Harbor Rd north and to Waterport Rd route round the
    outer road, not Armstrong / Welch Rd (with the preference, the Waterport Rd truck takes the outer road although
    the link road is shorter); a truck to Port Elliot Rd avoids the link road too (today it does not use the ring)."""
    from vhsim.paths import sumo_bin

    _, net, root = built(variant)
    trips = tmp_path / "t.rou.xml"
    trips.write_text('<routes><vType id="truck" vClass="truck" maxSpeed="27.78"/>'
                     '<trip id="north" type="truck" depart="0" from="138404394#0" to="33914372"/>'
                     '<trip id="waterport" type="truck" depart="0" from="138404394#0" to="-388250466#0"/>'
                     '<trip id="east" type="truck" depart="0" from="138404394#0" to="601834298#3"/></routes>')
    out = tmp_path / "r.rou.xml"
    subprocess.run([sumo_bin("duarouter"), "-n", str(root / f"{variant}_bays.net.xml"), "-r", str(trips),
                    "-a", str(root / f"{variant}_bays.prefs.add.xml"), "-o", str(out), "--no-step-log"],
                   check=True, capture_output=True)
    routes = {v.get("id"): v.find("route").get("edges").split() for v in ET.parse(out).getroot().iter("vehicle")}
    new = set(c5_new_edges(variant))
    for vid, edges in routes.items():
        names = {net.getEdge(e).getName() for e in edges}
        assert not names & set(RING_ROAD), (vid, sorted(names))
        if vid != "east":
            assert set(edges) & new, vid


@pytest.mark.slow
@pytest.mark.parametrize("variant", ["c5", "c5b"])
def test_c5_smoke_run_clean(built, variant, tmp_path):
    from vhsim.network.smoke import run_smoke
    from vhsim.scenarios.build import SMOKE_END_S, SMOKE_TRIPS

    _, _, root = built(variant)
    res = run_smoke(root / f"{variant}_bays.net.xml", tmp_path, n_trips=SMOKE_TRIPS, seed=7, end=SMOKE_END_S, mode="town")
    assert res["arrived"] == res["inserted"] == SMOKE_TRIPS, res
    assert res["teleports_jam"] == 0, res["teleport_locations"]


@pytest.mark.slow
def test_c5s_sensitivity_keeps_the_ring_road_speed(built, s6_base):
    """C5s (sensitivity): the C5 outer road and truck preference, but Welch / Armstrong Rd keep today's limits."""
    assert "c5s" in SCENARIOS
    summary, net, _ = built("c5s")
    assert summary["checks"]["ok"], summary["checks"]
    for e in net.getEdges():
        if e.getName() in RING_ROAD:
            base_id = e.getID().removesuffix(".bay")
            assert e.getSpeed() == pytest.approx(s6_base.net.getEdge(base_id).getSpeed(), abs=0.01), e.getID()
            assert e.getRoutingType() == C5_LINK_ROUTING_TYPE
    assert all(net.hasEdge(e) for e in c5_new_edges("c5"))


def test_run_loads_a_networks_routing_preferences(tmp_path, monkeypatch):
    from vhsim.integration import runs

    monkeypatch.setattr(runs, "NETWORKS", tmp_path)
    assert runs.routing_preferences("x_bays") is None
    (tmp_path / "x_bays.prefs.add.xml").write_text("<additional/>")
    assert runs.routing_preferences("x_bays") == tmp_path / "x_bays.prefs.add.xml"
