from __future__ import annotations

import csv

import pytest

from vhsim.counts import aadt
from vhsim.paths import SOURCES

COLS = ["road", "road_no", "section_from_km", "section_to_km", "aadt", "count_year", "cv_pct",
        "lon", "lat", "bearing_deg", "release", "source", "notes"]


@pytest.fixture(scope="module")
def rows(tmp_path_factory):
    out = tmp_path_factory.mktemp("aadt") / "aadt.csv"
    aadt.write_csv(out)
    with open(out) as fh:
        assert next(csv.reader(fh)) == COLS
    with open(out) as fh:
        return list(csv.DictReader(fh))


def _find(rows, road_no, a, b):
    hit = [r for r in rows if r["road_no"] == road_no and float(r["section_from_km"]) == a
           and float(r["section_to_km"]) == b]
    assert len(hit) == 1, (road_no, a, b)
    return hit[0]


@pytest.mark.parametrize("road_no,a,b,v,cy,cv", [
    ("04760", 47.66, 49.10, 19300, 2024, 2.0),     # Hindmarsh Rd
    ("04760", 49.10, 50.0, 17300, 2024, 2.0),
    ("04760", 50.0, 50.38, 15500, 2024, 2.0),      # Torrens St
    ("04760", 50.38, 50.56, 12900, 2024, 2.0),
    ("04760", 28.26, 43.21, 7700, 2025, 12.5),     # Victor Harbor Rd
    ("04760", 43.21, 45.60, 8400, 2025, 16.5),
])
def test_known_sections_match_dit(rows, road_no, a, b, v, cy, cv):
    r = _find(rows, road_no, a, b)
    assert int(r["aadt"]) == v and int(r["count_year"]) == cy and float(r["cv_pct"]) == cv
    assert r["release"] == "2026"
    assert "S-D02" in r["source"]


def test_all_midpoints_in_study_box(rows):
    assert len(rows) >= 12
    for r in rows:
        assert 138.50 <= float(r["lon"]) <= 138.72, r
        assert -35.62 <= float(r["lat"]) <= -35.48, r
        assert 0 <= float(r["bearing_deg"]) < 360


def test_town_midpoints_are_where_the_roads_are(rows):
    t = _find(rows, "04760", 50.0, 50.38)           # Torrens St, runs SW-ish into the CBD
    assert abs(float(t["lon"]) - 138.622) < 0.003 and abs(float(t["lat"]) + 35.553) < 0.004
    assert 180 < float(t["bearing_deg"]) < 270      # heading SW
    v = _find(rows, "04760", 28.26, 43.21)           # clipped to the portion inside the study box
    assert float(v["lat"]) <= -35.48 and "clipped" in v["notes"]


def test_every_in_box_2026_section_is_present(rows):
    src = list(csv.DictReader(open(SOURCES / "D" / "D-tv-selected-roads-by-release.csv")))
    keys = {(r["road_no"], round(float(r["start_rrd"]), 2), round(float(r["end_rrd"]), 2))
            for r in src if r["release_year"] == "2026"}
    got = {(r["road_no"], round(float(r["section_from_km"]), 2), round(float(r["section_to_km"]), 2)) for r in rows}
    assert got <= keys
    missing = keys - got
    # only sections wholly outside the study box (or without geometry) may be absent
    for k in missing:
        assert aadt.section_midpoint(*k) is None or not aadt.in_box(*aadt.section_midpoint(*k)[:2]), k
