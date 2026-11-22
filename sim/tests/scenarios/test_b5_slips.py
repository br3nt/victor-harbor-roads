"""B5: left-turn slip lanes at the Torrens/Seaview/Eyre and Torrens/Crozier roundabouts (slow)."""
import math

import pytest
from shapely.geometry import LineString, Point

from vhsim.scenarios.defs import SIGNAL_SITES, left_turns, ring_movements, slip_feeders, slip_onward

pytestmark = pytest.mark.slow


@pytest.mark.parametrize("site", SIGNAL_SITES)
def test_every_left_turn_at_the_site_gets_a_slip_lane(built, s6_base, site):
    summary, net, _ = built("b5")
    lefts = left_turns(s6_base, s6_base.roundabout_at(site))
    assert len(lefts) == 4, lefts                    # both sites are four-leg roundabouts
    for a, x in lefts:
        slip = net.getEdge(f"s6_slip_{a}_{x}")
        approach, exit_ = s6_base.net.getEdge(a), s6_base.net.getEdge(x)
        assert slip.getFromNode().getID() == approach.getFromNode().getID()
        assert slip.getToNode().getID() == exit_.getToNode().getID()
        # everything that fed the approach can take the slip; the slip continues wherever the exit did
        # (U-turns excluded on both sides)
        feeders = set(slip_feeders(approach))
        last = {u: (f"{u}.bay" if net.hasEdge(f"{u}.bay") else u) for u in feeders}   # A-INT-01 bays
        assert feeders and all(slip in net.getEdge(last[u]).getOutgoing() for u in feeders), (a, feeders)
        onward = set(slip_onward(exit_))
        assert onward and {t.getID() for t in slip.getOutgoing()} == onward
        # the slip stays outside the ring
        rb = s6_base.roundabout_at(site)
        ring_xy = [s6_base.net.getNode(n).getCoord() for n in rb.getNodes()]
        cx, cy = sum(q[0] for q in ring_xy) / len(ring_xy), sum(q[1] for q in ring_xy) / len(ring_xy)
        radius = max(math.dist((cx, cy), q) for q in ring_xy)
        line = LineString(slip.getShape())
        assert line.distance(Point(cx, cy)) > radius, (slip.getID(), line.distance(Point(cx, cy)), radius)


@pytest.mark.parametrize("site", SIGNAL_SITES)
def test_roundabouts_keep_every_movement_and_stay_complete(built, s6_base, site):
    summary, net, _ = built("b5")
    assert summary["checks"]["ok"], summary["checks"]
    rb = s6_base.roundabout_at(site)
    assert set(rb.getEdges()) <= {e.getID() for e in net.getEdges()}
    for frm, exits in ring_movements(s6_base, rb).items():
        assert exits <= {t.getID() for t in net.getEdge(frm).getOutgoing()} | _via_ring(net, frm, set(rb.getEdges()))


def _via_ring(net, frm, ring):
    out, todo, seen = set(), [net.getEdge(frm)], set()
    while todo:
        e = todo.pop()
        for t in e.getOutgoing():
            if t.getID() in ring and t.getID() not in seen:
                seen.add(t.getID())
                todo.append(t)
            elif e.getID() in ring:
                out.add(t.getID())
    return out


def test_bp_includes_the_slip_lanes(built):
    summary, net, _ = built("bp")
    assert "b5" in summary["components"]
    assert sum(1 for e in net.getEdges() if e.getID().startswith("s6_slip_")) == 8
