"""S7 improvement options N2-N6 (sim/SCENARIOS.md; sim/assumptions/S7-improvements.md) (slow)."""
import math

import pytest

from vhsim.scenarios.defs import (N2_NODE, N3_APPROACH, N4_NODE, N5_NODE, N8_LEFT_TURN_LANES, NO_RIGHT_OUT,
                                  SCENARIOS)

pytestmark = pytest.mark.slow


def _baseline_movements(s6_base, node_id):
    """(approach, exit) pairs through a priority node in the baseline."""
    node = s6_base.net.getNode(node_id)
    return {(a.getID(), t.getID()) for a in node.getIncoming() for t in a.getOutgoing()}


def _reachable_through_ring(net, approach, ring):
    out, todo, seen = set(), [net.getEdge(approach)], set()
    while todo:
        e = todo.pop()
        for t in e.getOutgoing():
            if t.getID() in ring:
                if t.getID() not in seen:
                    seen.add(t.getID())
                    todo.append(t)
            elif e.getID() in ring:
                out.add(t.getID())
    return out


def _new_roundabout(net, s6_base, node_id):
    xy = s6_base.net.getNode(node_id).getCoord()
    near = [rb for rb in net.getRoundabouts()
            if min(math.dist(net.getNode(n).getCoord(), xy) for n in rb.getNodes()) < 40]
    assert len(near) == 1, [rb.getNodes() for rb in near]
    return near[0]


@pytest.mark.parametrize("scen,node_id,radius", [("n2", N2_NODE, 20.0), ("n4", N4_NODE, 12.0),
                                                 ("n5", N2_NODE, 20.0), ("n5", N5_NODE, 15.0),
                                                 ("n7", N2_NODE, 20.0), ("n7", N5_NODE, 15.0), ("n7", N4_NODE, 12.0),
                                                 ("n9", N4_NODE, 12.0)])
def test_priority_junction_becomes_a_single_lane_roundabout_keeping_every_movement(built, s6_base, scen, node_id, radius):
    summary, net, root = built(scen)
    assert summary["checks"]["ok"], summary["checks"]
    rb = _new_roundabout(net, s6_base, node_id)
    ring = set(rb.getEdges())
    legs = {e.getID() for e in s6_base.net.getNode(node_id).getIncoming()}
    assert len(rb.getNodes()) == len(legs) >= 3
    xy = s6_base.net.getNode(node_id).getCoord()     # the centre may be shifted up to 10 m (N4)
    for n in rb.getNodes():
        assert abs(math.dist(net.getNode(n).getCoord(), xy) - radius) <= 10.5
    assert all(net.getEdge(e).getLaneNumber() == 1 for e in ring)
    from vhsim.network.checks import check_roundabouts
    found = [c for c in check_roundabouts(root / f"{scen}_bays.net.xml") if set(c.nodes) & set(rb.getNodes())]
    assert found and found[0].complete, found[0].problems if found else "missing"
    for frm, to in _baseline_movements(s6_base, node_id):
        assert to in _reachable_through_ring(net, frm, ring), (frm, to)
    # ring nodes are aliases of the named junction (for the R15 tables)
    aliased = {k for k, v in summary["junction_aliases"].items() if v["kind"] == "roundabout ring node"}
    assert set(rb.getNodes()) <= aliased
    # clockwise circulation (left-hand traffic): ring polygon in driving order has negative signed area
    order, e = [], net.getEdge(sorted(ring)[0])
    for _ in ring:
        order.append(e.getFromNode().getCoord())
        e = next(t for t in e.getOutgoing() if t.getID() in ring)
    area = sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(order, order[1:] + order[:1])) / 2
    assert area < 0, area


def test_n4_centre_moved_away_from_the_rail_crossing(built, s6_base):
    import numpy as np

    from vhsim.scenarios.defs import N4_CROSSING_IN, N4_SHIFT_M
    from vhsim.scenarios.s7 import bearing

    _, net, _ = built("n4")
    rb = _new_roundabout(net, s6_base, N4_NODE)
    pts = [net.getNode(n).getCoord() for n in rb.getNodes()]
    old = s6_base.net.getNode(N4_NODE).getCoord()
    # the ring nodes lie on a circle round the shifted centre: fit it (least squares)
    A = np.array([[2 * x, 2 * y, 1] for x, y in pts])
    b = np.array([x * x + y * y for x, y in pts])
    cx, cy, _ = np.linalg.lstsq(A, b, rcond=None)[0]
    assert math.dist((cx, cy), old) == pytest.approx(N4_SHIFT_M, abs=1.5)
    crossing_far = s6_base.net.getEdge(N4_CROSSING_IN).getFromNode().getCoord()
    away = (bearing(old, crossing_far) + 180) % 360
    assert abs(((bearing(old, (cx, cy)) - away) + 180) % 360 - 180) < 15
    assert net.getEdge(N4_CROSSING_IN).getLength() >= 10      # link to Bridge Tce keeps room for two cars


def test_a_leg_shorter_than_the_ring_radius_is_refused(s6_base):
    from vhsim.scenarios.defs import roundabout

    with pytest.raises(ValueError):
        roundabout(s6_base, N5_NODE, "too_big", 30.0)     # the next node on Armstrong Rd north is 29.6 m away


def test_n2_ring_speed_follows_the_baseline_rule(built):
    from vhsim.scenarios.s7 import ring_speed_ms

    summary, net, _ = built("n2")
    ring = [net.getEdge(e) for e in summary["added"]["ids"] if e.startswith("s7_ring_")]
    assert len(ring) == 3
    for e in ring:
        assert e.getSpeed() == pytest.approx(ring_speed_ms(20.0), abs=0.05)


def test_n3_crozier_rd_flare_separates_left_and_right_turns(built, s6_base):
    summary, net, _ = built("n3")
    assert summary["checks"]["ok"], summary["checks"]
    base = s6_base.net.getEdge(N3_APPROACH)
    flare = net.getEdge(f"{N3_APPROACH}.bay")
    assert flare.getLaneNumber() == 2
    assert 25 <= flare.getLength() <= 45      # 40 m from the junction centre, less the junction area
    assert net.getEdge(N3_APPROACH).getLaneNumber() == 1
    assert flare.getToNode().getID() == N2_NODE
    turns = {}
    for t, conns in base.getOutgoing().items():
        turns[t.getID()] = conns[0].getDirection()
    assert set(turns.values()) >= {"l", "r"}
    for t, conns in flare.getOutgoing().items():
        lanes = {c.getFromLane().getIndex() for c in conns}
        assert lanes == ({0} if turns[t.getID()] in ("l", "L", "s") else {1}), (t.getID(), lanes)
    assert {t.getID() for t in flare.getOutgoing()} == set(turns)
    # upstream traffic still reaches the approach
    assert {u.getID() for u in base.getIncoming()} <= {u.getID() for u in net.getEdge(N3_APPROACH).getIncoming()}


@pytest.mark.parametrize("approach", N8_LEFT_TURN_LANES)
def test_n8_victoria_st_left_turn_lanes(built, s6_base, approach):
    summary, net, _ = built("n8")
    assert summary["checks"]["ok"], summary["checks"]
    base = s6_base.net.getEdge(approach)
    assert base.getName() == "Victoria Street"
    bay = net.getEdge(f"{approach}.bay")
    assert bay.getLaneNumber() == 2 and bay.getToNode().getID() == base.getToNode().getID()
    turns = {t.getID(): conns[0].getDirection() for t, conns in base.getOutgoing().items()}
    assert "l" in turns.values() or "L" in turns.values()
    for t, conns in bay.getOutgoing().items():
        lanes = {c.getFromLane().getIndex() for c in conns}
        # kerb lane (0) only for the left turn; everything else from the median-side lane (1)
        assert lanes == ({0} if turns[t.getID()] in ("l", "L") else {1}), (t.getID(), lanes)
    assert {t.getID() for t in bay.getOutgoing()} == set(turns)


@pytest.mark.parametrize("approach,street", sorted(NO_RIGHT_OUT.items()))
def test_n6_bans_only_the_right_turn_out_of_each_side_street(built, s6_base, approach, street):
    summary, net, _ = built("n6")
    assert summary["checks"]["ok"], summary["checks"]
    e0 = s6_base.net.getEdge(approach)
    assert e0.getName() == street
    before = {t.getID(): conns[0].getDirection() for t, conns in e0.getOutgoing().items()}
    after = {t.getID() for t in net.getEdge(approach).getOutgoing()}
    rights = {t for t, d in before.items() if d in ("r", "R")}
    assert rights and not rights & after
    assert after == set(before) - rights


@pytest.mark.parametrize("scen", ["n2", "n3", "n4", "n5", "n6", "n7", "n8", "n9"])
def test_registered_and_smoke_run_clean(built, scen, tmp_path):
    from vhsim.network.smoke import run_smoke
    from vhsim.scenarios.build import SMOKE_END_S, SMOKE_TRIPS

    assert scen in SCENARIOS
    _, _, root = built(scen)
    res = run_smoke(root / f"{scen}_bays.net.xml", tmp_path, n_trips=SMOKE_TRIPS, seed=7, end=SMOKE_END_S, mode="town")
    assert res["arrived"] == res["inserted"] == SMOKE_TRIPS, res
    assert res["teleports_jam"] == 0, res["teleport_locations"]
