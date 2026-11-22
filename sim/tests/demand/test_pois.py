import json

import pytest

from vhsim.demand import pois as PO
from vhsim.demand.config import Config
from vhsim.demand.geo import in_bbox
from vhsim.demand.ids import format_id
from vhsim.demand.params import STUDY_BBOX

CATEGORIES = {"supermarket", "shops", "dining", "services", "medical", "gym", "school", "beach_foreshore",
              "recreation", "caravan_park", "accommodation", "work"}
CFG = Config.load()


@pytest.fixture(scope="module")
def pois():
    return PO.build_pois(CFG)


def test_all_design_categories_present(pois):
    assert {p.category for p in pois} == CATEGORIES


def test_ids_unique_stable_and_id_safe(pois):
    ids = [p.poi_id for p in pois]
    assert len(ids) == len(set(ids))
    for p in pois:
        assert p.poi_id.startswith("poi_")
        format_id("res", "MB1", p.category, p.poi_id, 1)   # raises if unsafe
    assert PO.build_pois(CFG)[0].poi_id == pois[0].poi_id


def test_inside_study_area_with_positive_weight_and_source(pois):
    for p in pois:
        assert in_bbox(p.lon, p.lat, STUDY_BBOX), p
        assert p.weight > 0, p
        assert p.source, p


def test_private_pools_dropped_and_real_gym_kept(pois):
    gyms = [p for p in pois if p.category == "gym"]
    assert any(p.name == "Anytime Fitness" for p in gyms)
    assert len(gyms) < 10
    assert all(p.name for p in gyms)


def test_supermarket_weights_are_floor_area_proxies(pois):
    by = {p.name: p for p in pois if p.category == "supermarket"}
    assert by["Woolworths"].weight > by["IGA"].weight
    assert by["Coles"].weight > by["Aldi"].weight
    assert {"Woolworths", "Coles", "Aldi", "Drakes", "IGA"} <= set(by)


def test_malls_are_shops_not_supermarkets(pois):
    # Victor Central (mall) contains Woolworths, which is its own POI: counting the mall as a
    # supermarket too would double its pull.
    cat = {p.name: p.category for p in pois}
    assert cat["Victor Central Shopping Centre"] == "shops"
    assert cat["The Centre"] == "shops"


def test_override_changes_named_weight():
    c2 = CFG.with_overrides(["poi.named_weight.Woolworths=10"])
    w = {p.name: p.weight for p in PO.build_pois(c2) if p.category == "supermarket"}
    assert w["Woolworths"] == 10


def test_foreshore_and_schools(pois):
    names = {p.name for p in pois if p.category == "beach_foreshore"}
    assert "Warland Reserve" in names
    schools = [p for p in pois if p.category == "school"]
    assert len(schools) >= 3     # 2 OSM schools + ABS Education mesh blocks not duplicating them


def test_work_from_non_residential_mesh_blocks(pois):
    work = [p for p in pois if p.category == "work"]
    assert len(work) >= 15
    assert all("S-C30" in p.source or "assumption" in p.source for p in work)


def test_employment_growth_added_only_in_growth_years():
    base = PO.pois_for(CFG, "base", 2025)
    grown = PO.pois_for(CFG, "high", 2051)
    assert not any(p.poi_id.startswith("poi_emp_") for p in base)
    emp = [p for p in grown if p.poi_id.startswith("poi_emp_")]
    assert emp and all(p.category == "work" for p in emp)


def test_geojson_written(tmp_path, pois):
    p = tmp_path / "pois.geojson"
    PO.write_pois_geojson(pois, p)
    props = json.loads(p.read_text())["features"][0]["properties"]
    assert {"poi_id", "category", "name", "weight", "source"} <= set(props)
