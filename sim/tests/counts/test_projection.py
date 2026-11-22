from __future__ import annotations

import csv
import math

import pytest

from vhsim.counts import projection as P


def test_fit_recovers_exponential_growth():
    pts = [(2010, 1000 * 1.02 ** 0), (2015, 1000 * 1.02 ** 5), (2020, 1000 * 1.02 ** 10)]
    assert P.fit_factor(pts, 2010.0, 2020.0) == pytest.approx(1.02 ** 10, rel=1e-9)


def test_history_uses_count_year_not_release_year():
    pts = P.dit_history("04760", 47.66, 49.10)
    # releases 2016-2021 all carried the 2009 count; it must appear once, with its count year
    assert pts == [(2009, 14000), (2021, 18400), (2024, 19300)]
    assert P.dit_history("04760", 50.0, 50.38) == [(2010, 15600), (2021, 15100), (2024, 15500)]


def test_road_factors_in_plausible_bands():
    f = P.road_factors()
    assert 0.97 <= f["Torrens Street"].factor <= 1.04        # DIT: 15,600 -> 15,100 -> 15,500
    assert 1.03 <= f["Hindmarsh Road"].factor <= 1.12        # DIT: 15,800 -> 16,700 -> 17,300
    assert 0.9 <= f["Victoria Street"].factor <= 1.05
    for council in ["Coral Street", "Ocean Street", "Stuart Street", "Crozier Road", "Eyre Terrace",
                    "Seaview Road", "Bridge Terrace", "Grantley Avenue", "Hill Street", "Wills Street"]:
        assert f[council].factor == pytest.approx(f["Coral Street"].factor)
        assert "S-C03" in f[council].basis
    assert 1.12 <= f["Coral Street"].factor <= 1.22          # ERP 2018-2025 ~1.95%/yr over ~8.2 years
    assert "S-D02" in f["Torrens Street"].basis


def test_movement_factor_geometric_mean_and_fallbacks():
    f = P.road_factors()
    both = P.movement_factor("Torrens Street", "Coral Street", f)
    assert both.factor == pytest.approx(math.sqrt(f["Torrens Street"].factor * f["Coral Street"].factor))
    assert "geometric mean" in both.basis
    unresolved = P.movement_factor("Hindmarsh Rd", "Car Park/Bridge Terrace (unresolved)", f)
    assert unresolved.factor == pytest.approx(f["Hindmarsh Road"].factor)
    assert "approach road only" in unresolved.basis
    same = P.movement_factor("Torrens Street", "Torrens Street", f)
    assert same.factor == pytest.approx(f["Torrens Street"].factor)


def test_term_adjustment_is_flagged_assumption():
    assert P.TERM_ADJUSTMENT == 1.0
    assert "assumption" in P.TERM_ADJUSTMENT_BASIS.lower()


def test_projected_csv(tmp_path):
    out = tmp_path / "p.csv"
    n = P.write_csv(out)
    rows = list(csv.DictReader(open(out)))
    assert len(rows) == n == 6000
    assert list(rows[0]) == ["intersection", "approach_road", "approach_dir", "movement", "to_road", "bin_start",
                             "light", "heavy", "cycle", "factor", "factor_basis", "term_adjustment",
                             "light_projected", "heavy_projected", "cycle_projected", "basis", "source"]
    assert {r["basis"] for r in rows} == {"projected"}
    for r in rows[:200]:
        k = float(r["factor"]) * float(r["term_adjustment"])
        assert float(r["light_projected"]) == pytest.approx(int(r["light"]) * k, abs=1e-3)
    tot0 = sum(int(r["light"]) + int(r["heavy"]) + int(r["cycle"]) for r in rows)
    tot1 = sum(float(r["light_projected"]) + float(r["heavy_projected"]) + float(r["cycle_projected"]) for r in rows)
    assert 1.0 < tot1 / tot0 < 1.2
