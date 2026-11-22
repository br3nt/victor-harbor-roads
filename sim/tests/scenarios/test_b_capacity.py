"""B3 (four-lane ring route), B4 (two-lane McCracken roundabout) and BP (B3 + B4) (slow)."""
import pytest

from vhsim.scenarios.defs import B4_SITE

pytestmark = pytest.mark.slow

RING_ROAD = ("Welch Road", "Armstrong Road")


def _ring_road(net):
    return [e for e in net.getEdges() if e.getName() in RING_ROAD]


@pytest.mark.parametrize("scen", ["b3", "bp"])
def test_ring_road_has_two_lanes_each_way_at_unchanged_speed(built, s6_base, scen):
    _, net, _ = built(scen)
    base = _ring_road(s6_base.net)
    assert len(base) >= 30
    for e in base:
        new = net.getEdge(e.getID())
        assert new.getLaneNumber() == 2, e.getID()
        assert new.getSpeed() == pytest.approx(e.getSpeed())


@pytest.mark.parametrize("scen", ["b3", "bp"])
def test_widened_lanes_all_lead_somewhere_and_movements_are_kept(built, s6_base, scen):
    from vhsim.network.build import fringe_nodes

    _, net, _ = built(scen)
    fringe = fringe_nodes(net)
    for e in _ring_road(s6_base.net):
        new = net.getEdge(e.getID())
        if new.getToNode().getID() in fringe:
            continue
        lane_drop = all(t.getLaneNumber() == 1 and t.getName() not in RING_ROAD for t in new.getOutgoing())
        if not lane_drop:      # at the ends of the four-lane section the second lane may merge (lane drop)
            assert all(lane.getOutgoing() for lane in new.getLanes()), e.getID()
        assert {t.getID() for t in new.getOutgoing()} == {t.getID() for t in e.getOutgoing()}, e.getID()


def _mccracken(net, s6_base):
    nodes = set(s6_base.roundabout_at(B4_SITE).getNodes())
    return next(rb for rb in net.getRoundabouts() if set(rb.getNodes()) & nodes)


@pytest.mark.parametrize("scen", ["b4", "bp"])
def test_mccracken_roundabout_two_circulating_lanes_and_two_lane_entries(built, s6_base, scen):
    summary, net, root = built(scen)
    rb = _mccracken(net, s6_base)
    assert all(net.getEdge(e).getLaneNumber() == 2 for e in rb.getEdges())
    from vhsim.network.checks import check_roundabouts
    rbs = [c for c in check_roundabouts(root / f"{scen}_bays.net.xml") if set(c.nodes) & set(rb.getNodes())]
    assert rbs and rbs[0].complete, rbs[0].problems if rbs else "missing"
    ring = set(rb.getEdges())
    entries = {}
    for nid in rb.getNodes():
        for a in net.getNode(nid).getIncoming():
            if a.getID() not in ring:
                entries[a.getName()] = a
    for road in ("Adelaide Road", "Hindmarsh Road"):
        a = entries[road]
        assert a.getLaneNumber() == 2, road
        assert all(lane.getOutgoing() for lane in a.getLanes()), road
        # two lanes for at least 100 m back from the give-way line
        length, e = 0.0, a
        while e is not None and e.getLaneNumber() == 2 and length < 100:
            length += e.getLength()
            preds = [p for p in e.getIncoming() if p.getName() == road and p.getLaneNumber() == 2]
            e = preds[0] if preds else None
        assert length >= 100, (road, length)
    # the other entries (Port Elliot Rd) keep one lane
    assert entries["Port Elliot Road"].getLaneNumber() == 1


@pytest.mark.parametrize("scen", ["b4", "bp"])
def test_mccracken_movements_kept(built, s6_base, scen):
    from vhsim.scenarios.defs import ring_movements

    summary, net, _ = built(scen)
    for frm, exits in ring_movements(s6_base, s6_base.roundabout_at(B4_SITE)).items():
        rb = _mccracken(net, s6_base)
        ring = set(rb.getEdges())
        reach, todo, seen = set(), [net.getEdge(frm)], set()
        while todo:
            e = todo.pop()
            for t in e.getOutgoing():
                if t.getID() in ring and t.getID() not in seen:
                    seen.add(t.getID())
                    todo.append(t)
                elif t.getID() not in ring and e.getID() in ring:
                    reach.add(t.getID())
        assert exits <= reach, (frm, exits - reach)
    assert not summary["movements_missing"]


@pytest.mark.parametrize("scen", ["b3", "b4", "bp"])
def test_capacity_scenarios_connected(built, scen):
    summary, _, _ = built(scen)
    assert summary["checks"]["ok"], summary["checks"]
