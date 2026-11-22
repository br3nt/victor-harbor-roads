import csv

import pytest

from vhsim.demand import validate as V


@pytest.fixture(scope="module")
def out(tmp_path_factory):
    d = tmp_path_factory.mktemp("val")
    rc = V.main(["--condition", "weekday_term", "--condition", "summer_peak", "--out-dir", str(d)])
    assert rc == 0
    with open(d / "validation.csv") as f:
        rows = list(csv.DictReader(f))
    return d, rows


def test_files_and_columns(out):
    d, rows = out
    assert (d / "VALIDATION.md").exists()
    assert {"condition", "check", "item", "value", "reference", "reference_basis", "status", "note"} <= set(rows[0])
    assert {r["status"] for r in rows} <= {"ok", "warn", "info"}


def test_all_check_families_present(out):
    _, rows = out
    checks = {r["check"] for r in rows}
    assert {"supermarket_attraction", "spatial_pattern", "trip_length", "vkt_per_household",
            "gateway_vs_aadt", "hourly_shape", "town_centre_entries_2017"} <= checks


def test_gateway_check_uses_dit_aadt(out):
    _, rows = out
    r = [r for r in rows if r["check"] == "gateway_vs_aadt" and r["item"] == "gw_vhr"
         and r["condition"] == "weekday_term"][0]
    assert float(r["reference"]) == 7700
    assert r["status"] == "ok"
    s = [r for r in rows if r["check"] == "gateway_vs_aadt" and r["item"] == "gw_vhr"
         and r["condition"] == "summer_peak"][0]
    assert float(s["value"]) >= 11000 and "S-D18" in s["reference_basis"]


def test_hourly_shape_close_to_s3_profile(out):
    _, rows = out
    r = [r for r in rows if r["check"] == "hourly_shape" and r["item"] == "all_trips_tv_distance"
         and r["condition"] == "weekday_term"][0]
    assert float(r["value"]) < 0.10
    assert "hourly_profile.csv" in r["reference_basis"]


def test_supermarket_rows(out):
    _, rows = out
    names = {r["item"] for r in rows if r["check"] == "supermarket_attraction"}
    assert {"Woolworths", "Coles", "Aldi", "Drakes", "IGA"} <= names


def test_markdown_mentions_every_check(out):
    d, _ = out
    md = (d / "VALIDATION.md").read_text()
    for h in ("Supermarket attraction", "Spatial pattern", "Trip length", "Vehicle-km", "Gateway volumes",
              "Hourly shape", "Town-centre entries"):
        assert h in md
