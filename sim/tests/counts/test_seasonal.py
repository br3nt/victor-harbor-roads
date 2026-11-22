import csv

from vhsim.counts import aadt, seasonal


def _rows(tmp_path):
    out = tmp_path / "s.csv"
    seasonal.write_csv(out)
    return list(csv.DictReader(open(out)))


def test_summer_peak_factor_from_dit_and_aadt(tmp_path):
    rows = {r["factor_id"]: r for r in _rows(tmp_path)}
    r = rows["summer_peak_victor_harbor_rd"]
    assert r["basis"] == "observed_lower_bound"
    assert int(r["summer_peak_vpd"]) == 11000
    by = {(x["section_from_km"], x["section_to_km"]): int(x["aadt"]) for x in aadt.build_rows() if x["road_no"] == "04760"}
    lo_aadt, hi_aadt = by[("28.26", "43.21")], by[("43.21", "45.6")]
    assert (lo_aadt, hi_aadt) == (7700, 8400)
    assert abs(float(r["factor_min"]) - 11000 / 8400) < 0.005
    assert abs(float(r["factor_max"]) - 11000 / 7700) < 0.005
    assert 1.30 <= float(r["factor_min"]) < float(r["factor_max"]) <= 1.43
    assert "S-D18" in r["source"] and "S-D02" in r["source"]


def test_parking_is_supporting_only_with_no_ratio(tmp_path):
    rows = {r["factor_id"]: r for r in _rows(tmp_path)}
    r = rows["parking_2015_cbd"]
    assert r["basis"] == "supporting_only"
    assert r["factor_min"] == "" and r["factor_max"] == ""
    assert "S-D21" in r["source"]
    assert "2 Dec" in r["notes"] and "80%" in r["notes"]
