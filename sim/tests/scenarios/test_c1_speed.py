"""C1a / C1b (30 km/h town centre) and C2 (20 km/h shared zones) on the real network (slow)."""
import pytest

from vhsim.scenarios.area import edges_inside

pytestmark = pytest.mark.slow

KMH30 = 30 / 3.6
TOWN_STREETS = {"Albert Place", "Coral Street", "Crozier Road", "Esplanade", "Eyre Terrace", "Flinders Parade",
                "McKinlay Street", "Ocean Street", "Railway Terrace", "Stuart Street"}
OUTSIDE_STREETS = {"Seaview Road", "Hindmarsh Road", "Bridge Terrace", "Torrens Lane", "Wills Street",
                   "Acraman Street", "Dennis Place", "Cornhill Road"}


def _base_id(eid: str) -> str:
    return eid.removesuffix(".bay")


def test_area_polygon_covers_the_town_centre_streets(s6_base):
    names = {s6_base.net.getEdge(e).getName() for e in s6_base.inside_town_centre}
    assert TOWN_STREETS <= names
    assert not names & OUTSIDE_STREETS, names & OUTSIDE_STREETS
    # Esplanade only east of Albert Pl (the shading's south-west corner)
    esp = [s6_base.net.getEdge(e) for e in s6_base.inside_town_centre if s6_base.net.getEdge(e).getName() == "Esplanade"]
    assert esp and all(min(s6_base.net.convertXY2LonLat(*e.getFromNode().getCoord())[0],
                           s6_base.net.convertXY2LonLat(*e.getToNode().getCoord())[0]) >= 138.6230 for e in esp)


def test_c1a_every_town_centre_edge_is_30_except_torrens_and_victoria(built, s6_base, baseline_bays):
    summary, net, _ = built("c1a")
    poly = s6_base.town_centre
    checked = 0
    for eid in edges_inside(net, poly):
        e = net.getEdge(eid)
        if e.getName() in ("Torrens Street", "Victoria Street") or e.getType().startswith(("highway.trunk", "highway.primary")):
            continue
        assert e.getSpeed() <= KMH30 + 0.01, (eid, e.getName(), e.getSpeed() * 3.6)
        checked += 1
    assert checked > 50
    changed = summary["speed_changed"]["30"]
    assert set(changed["streets"]) == TOWN_STREETS | {"Victor Harbor Boat Ramp"}
    assert 2.5 < changed["directed_km"] < 5


@pytest.mark.parametrize("scen", ["c1a", "c1b"])
def test_victoria_street_and_everything_outside_unchanged(built, baseline_bays, s6_base, scen):
    summary, net, _ = built(scen)
    inside = set(s6_base.inside_town_centre)
    for e in baseline_bays.getEdges():
        base_id = _base_id(e.getID()).removesuffix(".x")
        if base_id in inside and e.getName() != "Victoria Street":
            continue
        if scen == "c1b" or e.getName() != "Torrens Street":
            assert net.getEdge(e.getID()).getSpeed() == pytest.approx(e.getSpeed()), e.getID()


def test_c1a_leaves_torrens_street_at_its_limit(built, baseline_bays):
    _, net, _ = built("c1a")
    torrens = [e for e in baseline_bays.getEdges() if e.getName() == "Torrens Street"]
    assert len(torrens) > 20
    for e in torrens:
        assert net.getEdge(e.getID()).getSpeed() == pytest.approx(e.getSpeed())
        assert e.getSpeed() * 3.6 == pytest.approx(50, abs=1)


def test_c1b_puts_torrens_street_inside_the_area_at_30(built, s6_base):
    _, net, _ = built("c1b")
    inside = set(s6_base.inside_town_centre)
    torrens = [e for e in net.getEdges() if e.getName() == "Torrens Street" and _base_id(e.getID()) in inside]
    assert len(torrens) >= 12
    assert all(e.getSpeed() <= KMH30 + 0.01 for e in torrens)
    # Torrens St south of the Crozier roundabout (outside the shaded area) keeps 50
    south = [e for e in net.getEdges() if e.getName() == "Torrens Street" and _base_id(e.getID()) not in inside]
    assert south and all(e.getSpeed() * 3.6 == pytest.approx(50, abs=1) for e in south)


def test_c2_shared_zones_are_20(built, s6_base):
    summary, net, _ = built("c2")
    inside = set(s6_base.inside_town_centre)
    zone = [e for e in net.getEdges() if e.getName() in ("Ocean Street", "Albert Place", "Railway Terrace")
            and _base_id(e.getID()) in inside]
    assert len(zone) >= 10
    assert all(e.getSpeed() * 3.6 == pytest.approx(20, abs=0.1) for e in zone)
    assert set(summary["speed_changed"]) == {"20"}


@pytest.mark.parametrize("scen", ["c1a", "c1b", "c2"])
def test_speed_scenarios_stay_connected_and_complete(built, scen):
    summary, net, _ = built(scen)
    assert summary["checks"]["ok"], summary["checks"]
    assert summary["turn_bays"] >= 170
