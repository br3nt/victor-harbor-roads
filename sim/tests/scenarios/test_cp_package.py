"""CP council package = C1a + C2 + C3 + C4 (slow)."""
import pytest

from vhsim.scenarios.area import edges_inside
from vhsim.scenarios.defs import SIGNAL_SITES, ring_movements

pytestmark = pytest.mark.slow


def test_cp_combines_speed_limits_with_shared_zones_winning(built, s6_base):
    summary, net, _ = built("cp")
    for eid in edges_inside(net, s6_base.town_centre):
        e = net.getEdge(eid)
        if e.getName() in ("Torrens Street", "Victoria Street") or e.getType().startswith(("highway.trunk", "highway.primary")):
            continue
        limit = 20 if e.getName() in ("Ocean Street", "Albert Place", "Railway Terrace") else 30
        assert e.getSpeed() * 3.6 <= limit + 0.1, (eid, e.getName(), e.getSpeed() * 3.6)
    assert set(summary["speed_changed"]) == {"20", "30"}
    assert set(summary["components"]) == {"c1a", "c2", "c3", "c4"}


def test_cp_has_the_one_way_loop(built):
    cp, net, _ = built("cp")
    c3, _, _ = built("c3")
    assert set(c3["removed"]["ids"]) <= set(cp["removed"]["ids"])
    for eid in c3["removed"]["ids"]:
        assert not net.hasEdge(eid)


@pytest.mark.parametrize("site", SIGNAL_SITES)
def test_cp_signals_keep_every_movement_the_loop_leaves(built, s6_base, site):
    summary, net, _ = built("cp")
    assert f"s6_signal_{site}" in {t.getID() for t in net.getTrafficLights()}
    for frm, exits in ring_movements(s6_base, s6_base.roundabout_at(site)).items():
        if not net.hasEdge(frm):
            continue                                   # approach removed by the loop
        live = {x for x in exits if net.hasEdge(x)}
        assert live <= {t.getID() for t in net.getEdge(frm).getOutgoing()}, (frm, live)
    assert not summary["movements_missing"]


def test_cp_connected(built):
    summary, _, _ = built("cp")
    assert summary["checks"]["ok"], summary["checks"]
    assert summary["checks"]["traffic_lights"] == 2
