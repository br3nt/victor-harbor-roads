"""C4: the Torrens/Seaview/Eyre/Hindmarsh and Torrens/Crozier roundabouts become actuated signals (slow)."""
import math

import pytest

from vhsim.scenarios.defs import SIGNAL_SITES, ring_movements

pytestmark = pytest.mark.slow


def _site_xy(net, s6_base, site):
    row = s6_base.junctions[site]
    return net.convertLonLat2XY(float(row["lon"]), float(row["lat"]))


@pytest.mark.parametrize("site", SIGNAL_SITES)
def test_site_is_an_actuated_signal_with_cycle_at_most_90s(built, s6_base, site):
    summary, net, _ = built("c4")
    node = net.getNode(f"s6_signal_{site}")
    assert node.getType() == "traffic_light"
    tls = net.getTLS(f"s6_signal_{site}")
    programs = tls.getPrograms()
    assert len(programs) == 1
    prog = next(iter(programs.values()))
    assert prog.getType() == "actuated"
    phases = prog.getPhases()
    assert sum(p.duration for p in phases) <= 90
    assert sum(max(p.duration, p.maxDur if p.maxDur >= 0 else p.duration) for p in phases) <= 90
    assert math.dist(node.getCoord(), _site_xy(net, s6_base, site)) < 30


@pytest.mark.parametrize("site", SIGNAL_SITES)
def test_no_roundabout_remains_at_the_site(built, s6_base, site):
    _, net, _ = built("c4")
    xy = _site_xy(net, s6_base, site)
    for rb in net.getRoundabouts():
        for n in rb.getNodes():
            assert math.dist(net.getNode(n).getCoord(), xy) > 60, (site, rb.getNodes())


@pytest.mark.parametrize("site", SIGNAL_SITES)
def test_every_roundabout_movement_still_exists(built, s6_base, site):
    _, net, _ = built("c4")
    wanted = ring_movements(s6_base, s6_base.roundabout_at(site))
    assert len(wanted) >= 4
    for frm, exits in wanted.items():
        have = {t.getID() for t in net.getEdge(frm).getOutgoing()}
        assert exits <= have, (frm, exits - have)
        assert net.getEdge(frm).getToNode().getID() == f"s6_signal_{site}"


def test_other_roundabouts_untouched_and_network_connected(built, s6_base):
    summary, net, _ = built("c4")
    assert summary["checks"]["ok"], summary["checks"]
    assert len(net.getRoundabouts()) == len(s6_base.net.getRoundabouts()) - 2
    assert summary["checks"]["traffic_lights"] == 2
