import pytest

from vhsim.demand import gateways as gw
from vhsim.demand.geo import in_bbox
from vhsim.demand.params import STUDY_BBOX


@pytest.fixture(scope="module")
def table():
    return gw.build_gateways()


def test_expected_gateways_present(table):
    ids = {g.gateway_id for g in table}
    assert {"gw_vhr", "gw_hti", "gw_per", "gw_ivr", "gw_wai", "gw_rng", "gw_bvr"} == ids
    # Greenhills Rd and Welch Rd lie wholly inside the extended network (S-S1-01)
    assert not ids & {"gw_grn", "gw_wel"}


def test_gateways_inside_study_bbox_and_near_edge(table):
    for g in table:
        if g.merged_into:
            continue
        assert in_bbox(g.lon, g.lat, STUDY_BBOX), g
        lo0, la0, lo1, la1 = STUDY_BBOX
        edge_dist = min(g.lon - lo0, lo1 - g.lon, g.lat - la0, la1 - g.lat)
        assert edge_dist < 0.005, g


def test_state_road_aadt_from_dit(table):
    by = {g.gateway_id: g for g in table}
    assert by["gw_vhr"].aadt == 7700 and by["gw_vhr"].cv_pct == 12.5 and by["gw_vhr"].source.startswith("S-D02")
    assert by["gw_hti"].aadt == 1200 and by["gw_hti"].cv_pct == 12.5
    assert by["gw_per"].aadt == 9500 and by["gw_per"].cv_pct == 9.0
    assert by["gw_ivr"].aadt == 1700 and by["gw_ivr"].cv_pct == 8.0


def test_north_edge_gateways_at_the_extended_extract(table):
    from vhsim.demand.params import OSM_EXTRACT
    assert OSM_EXTRACT.name == "S-S1-01-overpass-victor-harbor-north.osm"
    assert STUDY_BBOX[3] == -35.46
    by = {g.gateway_id: g for g in table}
    assert not by["gw_hti"].merged_into
    assert (by["gw_vhr"].lon, by["gw_vhr"].lat) == pytest.approx((138.649, -35.462), abs=0.002)
    assert (by["gw_hti"].lon, by["gw_hti"].lat) == pytest.approx((138.6053, -35.462), abs=0.002)
    assert (by["gw_ivr"].lon, by["gw_ivr"].lat) == pytest.approx((138.552, -35.5143), abs=0.002)


def test_council_roads_are_marked_assumption(table):
    by = {g.gateway_id: g for g in table}
    assert by["gw_wai"].source.startswith("assumption")


def test_counts_stream_aadt_preferred_when_present(tmp_path):
    p = tmp_path / "aadt.csv"
    p.write_text("road,road_no,section_from_km,section_to_km,aadt,count_year,cv_pct,lon,lat\n"
                 "Port Elliot Rd,04688,0,3.9,9600,2025,9.5,138.655,-35.534\n"
                 "Adelaide Rd,04760,45.6,47.66,7300,2025,11,138.6345,-35.53\n")
    assert gw.counts_stream_aadt("04688", 0.0, 3.9, p)[:3] == (9600, 9.5, "2025")
    assert gw.counts_stream_aadt("04793", 21.38, 30.41, p) is None


def test_gateways_use_s3_aadt_csv_now_on_develop(table):
    by = {g.gateway_id: g for g in table}
    assert "aadt.csv" in by["gw_vhr"].source


def test_dit_lookup():
    assert gw.dit_aadt("04760", 45.6, 47.66) == (7200, 11.0)
    assert gw.dit_aadt("04760", 43.21, 45.6) == (8400, 16.5)
