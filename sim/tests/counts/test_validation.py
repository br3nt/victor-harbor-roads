from __future__ import annotations

import csv
import math

import pytest

from vhsim.counts import profile, projection, turning, validation


@pytest.fixture(scope="module")
def rows(tmp_path_factory):
    out = tmp_path_factory.mktemp("val") / "v.csv"
    validation.write_csv(out)
    return {r["comparison_id"]: r for r in csv.DictReader(open(out))}


def test_geh_formula():
    assert validation.geh(100, 100) == 0
    assert validation.geh(110, 90) == pytest.approx(math.sqrt(2 * 400 / 200))


def test_leg_flow_counts_inbound_and_outbound():
    recs, _ = turning.parse_report()
    # Torrens/Ocean E leg (Ocean Street): inbound movements 4,5,6 + outbound from S right (3) and N left (7)
    want = sum(r["light"] + r["heavy"] + r["cycle"] for r in recs if r["intersection"] == "Torrens/Ocean" and (
        r["approach_dir"] == "E" or (r["approach_dir"], r["movement"]) in {("S", "R"), ("N", "L"), ("W", "T")}))
    assert validation.leg_flow(recs, "Torrens/Ocean", "E") == want


def test_daily_conversion_uses_hourly_profile():
    share = sum(r["share"] for r in profile.build_rows() if 7 <= r["hour"] <= 18)
    assert validation.twelve_hour_share() == pytest.approx(share)
    assert 0.8 < share < 0.9


def test_dit_comparisons_present_and_arithmetic(rows):
    r = rows["dit_torrens_ocean"]
    assert float(r["reference_value"]) == 15500 and "S-D02" in r["reference_source"]
    proj12 = float(r["projected_2025_12h"])
    daily = proj12 / validation.twelve_hour_share()
    assert float(r["projected_2025_daily"]) == pytest.approx(daily, abs=1)
    assert float(r["ratio"]) == pytest.approx(daily / 15500, abs=1e-3)
    assert float(r["geh_mean_hour"]) == pytest.approx(validation.geh(daily / 24, 15500 / 24), abs=0.01)
    for cid in ["dit_torrens_coral", "dit_torrens_stuart", "dit_hindmarsh_seaview_n", "dit_torrens_seaview_s",
                "dit_hindmarsh_grantley_through"]:
        assert cid in rows


def test_newer_data_rows_have_sources(rows):
    for cid in ["smec_coral_street", "smec_seaview_road", "smec_eyre_terrace", "armstrong_2018_vs_2026"]:
        assert cid in rows
    assert "S-B04" in rows["smec_coral_street"]["reference_source"]
    assert "S-B34" in rows["armstrong_2018_vs_2026"]["reference_source"]
    assert float(rows["armstrong_2018_vs_2026"]["reference_value"]) == 6000
