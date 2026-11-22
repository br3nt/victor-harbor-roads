import pytest

from vhsim.demand import zones as Z
from vhsim.demand.geo import in_bbox
from vhsim.demand.config import Config
from vhsim.demand.params import STUDY_BBOX

CFG = Config.load()
ERP_2025 = CFG["population.erp_2025"]
PERSONS_PER_HOUSEHOLD = CFG["population.persons_per_household"]


@pytest.fixture(scope="module")
def mbs():
    return Z.load_mesh_blocks()


def test_all_332_mesh_blocks_with_polygons(mbs):
    assert len(mbs) == 332
    assert all(m.geometry is not None and m.geometry.area > 0 for m in mbs)


def test_2021_totals_match_s_c30(mbs):
    assert sum(m.dwellings for m in mbs) == 9724
    assert sum(m.persons for m in mbs) == 16113


@pytest.fixture(scope="module")
def base(mbs):
    return Z.base_zones(mbs, year=2025)


def test_base_2025_scaled_to_erp(base):
    assert sum(z.persons for z in base) == pytest.approx(ERP_2025, abs=1)
    factor = ERP_2025 / 16113
    assert sum(z.dwellings for z in base) == pytest.approx(9724 * factor, abs=1)


def test_2021_unscaled(mbs):
    z21 = Z.base_zones(mbs, year=2021)
    assert sum(z.persons for z in z21) == pytest.approx(16113, abs=0.01)
    assert sum(z.dwellings for z in z21) == pytest.approx(9724, abs=0.01)


def test_occupied_households_persons_over_2_1_capped_by_dwellings(base):
    for z in base:
        assert z.occupied_households == pytest.approx(min(z.persons / PERSONS_PER_HOUSEHOLD, z.dwellings))
        assert z.unoccupied == pytest.approx(z.dwellings - z.occupied_households)


def test_every_zone_point_inside_study_bbox(base):
    for z in base:
        assert in_bbox(z.lon, z.lat, STUDY_BBOX), z.zone_id
        assert z.access in ("inside", "gateway")
        if z.access == "gateway":
            assert z.gateway_id.startswith("gw_")


def test_town_zones_are_inside_and_rural_far_ones_use_gateways(base):
    by = {z.zone_id: z for z in base}
    town = [z for z in base if z.suburb in ("Victor Harbor", "Encounter Bay", "McCracken", "Hayborough")]
    assert all(z.access == "inside" for z in town)
    far = [z for z in base if z.suburb in ("Inman Valley", "Mount Jagged")]
    assert far and all(z.access == "gateway" for z in far)
    assert all(zid.startswith("MB") for zid in by)


def test_rural_zones_use_the_gateway_on_their_road(base):
    # Mount Jagged lies along Victor Harbor Rd, Hindmarsh Tiers along Hindmarsh Tiers Rd (S-D05),
    # Inman Valley along Inman Valley Rd.
    gw = {z.suburb: z.gateway_id for z in base if z.access == "gateway"}
    assert gw["Mount Jagged"] == "gw_vhr"
    assert gw["Hindmarsh Tiers"] == "gw_hti"
    assert gw["Inman Valley"] == "gw_ivr"
    assert not {"gw_grn", "gw_wel"} & set(gw.values())


def test_zone_geojson_roundtrip(tmp_path, base):
    p = tmp_path / "z.geojson"
    Z.write_zones_geojson(base, p)
    back = Z.read_zones_geojson(p)
    assert len(back) == len(base)
    assert sum(z.persons for z in back) == pytest.approx(ERP_2025, abs=1)
    import json
    props = json.loads(p.read_text())["features"][0]["properties"]
    for k in ("zone_id", "suburb", "dwellings", "persons", "occupied_households", "source"):
        assert k in props


def test_household_size_override_changes_households(mbs):
    big = Z.base_zones(mbs, cfg=CFG.with_overrides(["population.persons_per_household=2.5"]))
    small = Z.base_zones(mbs)
    assert sum(z.occupied_households for z in big) < sum(z.occupied_households for z in small)
