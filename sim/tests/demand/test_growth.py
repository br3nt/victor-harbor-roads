import pytest

from vhsim.demand import growth as G
from vhsim.demand import zones as Z
from vhsim.demand.geo import in_bbox
from vhsim.demand.config import Config
from vhsim.demand.params import STUDY_BBOX

CFG = Config.load()
OCCUPIED_SHARE_NEW_DWELLINGS = CFG["population.occupied_share_new_dwellings"]
PERSONS_PER_HOUSEHOLD = CFG["population.persons_per_household"]


@pytest.mark.parametrize("growth,year,expected", [
    ("base", 2025, 0),
    ("moderate", 2031, 6 * 185), ("moderate", 2041, 16 * 185), ("moderate", 2051, 26 * 185),
    ("high", 2031, 6 * 318), ("high", 2041, 6 * 318 + 10 * 410), ("high", 2051, 6 * 318 + 10 * 410 + 10 * 475),
])
def test_dwellings_added_since_base(growth, year, expected):
    assert G.dwellings_added(growth, year) == expected


def test_unknown_scenario_rejected():
    with pytest.raises(ValueError):
        G.dwellings_added("base", 2031)
    with pytest.raises(ValueError):
        G.dwellings_added("low", 2031)


def test_growth_area_polygons_plausible():
    polys = G.growth_area_polygons()
    assert set(polys) == {"GA1", "GA2", "GA3", "GARP_IV", "GARP_SW"}
    for name, p in polys.items():
        assert p.is_valid and not p.is_empty, name
        ha = G.area_ha(p)
        assert 30 < ha < 800, (name, ha)
    # Area 1 is next to town: its southern tip is near the Hindmarsh River / Ring Road (~-35.54)
    assert polys["GA1"].bounds[1] < -35.535
    # Area 2 lies north-east of area 3
    assert polys["GA2"].centroid.x > polys["GA3"].centroid.x


@pytest.fixture(scope="module")
def base():
    return Z.base_zones(Z.load_mesh_blocks())


@pytest.mark.parametrize("growth,year", [("moderate", 2031), ("moderate", 2051), ("high", 2041), ("high", 2051)])
def test_growth_adds_right_dwellings_and_people(base, growth, year):
    zs = G.zones_for(base, growth, year)
    added = G.dwellings_added(growth, year)
    assert sum(z.dwellings for z in zs) == pytest.approx(sum(z.dwellings for z in base) + added, abs=0.5)
    new_people = added * OCCUPIED_SHARE_NEW_DWELLINGS * PERSONS_PER_HOUSEHOLD
    assert sum(z.persons for z in zs) == pytest.approx(sum(z.persons for z in base) + new_people, abs=0.5)
    alloc = G.allocation(growth, year)
    assert sum(alloc.values()) == pytest.approx(added)
    assert alloc["infill"] <= 4100 and alloc["GA1"] <= 2400 and alloc["GA2"] + alloc["GA3"] <= 3600 + 1e-6
    for z in zs:
        assert in_bbox(z.lon, z.lat, STUDY_BBOX)


@pytest.mark.parametrize("growth,year", [("moderate", 2051), ("high", 2051)])
def test_growth_zones_load_inside_the_extended_network(base, growth, year):
    zs = G.zones_for(base, growth, year)
    cells = [z for z in zs if z.kind == "growth_area"]
    assert cells and all(z.access == "inside" for z in cells)


def test_allocation_order_moderate_2031():
    a = G.allocation("moderate", 2031)
    assert a["infill"] == pytest.approx(0.4 * 1110)
    assert a["GA1"] == pytest.approx(0.6 * 1110)
    assert a["GA2"] == a["GA3"] == a["GARP_IV"] == a["GARP_SW"] == 0


def test_high_2051_overflows_into_garp_only_parcels():
    a = G.allocation("high", 2051)
    assert a["infill"] == pytest.approx(4100)
    assert a["GA1"] == pytest.approx(2400)
    assert a["GA2"] + a["GA3"] == pytest.approx(3600)
    assert a["GARP_IV"] + a["GARP_SW"] == pytest.approx(10758 - 4100 - 6000)


def test_base_has_no_growth_zones(base):
    zs = G.zones_for(base, "base", 2025)
    assert all(z.kind == "mesh_block" for z in zs)
    assert len(zs) == len(base)


def test_infill_share_override_moves_dwellings_out_of_greenfield():
    lo = G.allocation("moderate", 2041, CFG.with_overrides(["growth.infill_share=0.2"]))
    hi = G.allocation("moderate", 2041, CFG.with_overrides(["growth.infill_share=0.8"]))
    assert hi["infill"] > lo["infill"] and hi["GA1"] < lo["GA1"]
