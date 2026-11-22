import numpy as np
import pandas as pd
import pytest

from vhsim.metrics import compare


def frame(rows):
    return pd.DataFrame(rows, columns=["area", "cat", "n", "mean", "p95"])


def test_deltas_and_percent():
    base = frame([("A", "shops", 100, 200.0, 400.0), ("B", "shops", 100, 100.0, 300.0)])
    scen = frame([("A", "shops", 120, 150.0, 500.0), ("B", "shops", 90, 100.0, 330.0)])
    d = compare.diff(base, scen, keys=["area", "cat"]).set_index("area")
    assert d.loc["A", "mean_base"] == 200 and d.loc["A", "mean_scen"] == 150
    assert d.loc["A", "mean_delta"] == -50 and d.loc["A", "mean_pct"] == pytest.approx(-25.0)
    assert d.loc["A", "p95_delta"] == 100 and d.loc["A", "p95_pct"] == pytest.approx(25.0)
    assert d.loc["B", "mean_delta"] == 0 and d.loc["B", "mean_pct"] == 0
    assert d.loc["A", "n_base"] == 100 and d.loc["A", "n_scen"] == 120
    assert d.loc["A", "n_delta"] == 20
    assert (d.status == "both").all()


def test_small_n_flagged_either_side():
    base = frame([("A", "c", 100, 1.0, 1.0), ("B", "c", 5, 1.0, 1.0), ("C", "c", 100, 1.0, 1.0)])
    scen = frame([("A", "c", 100, 2.0, 2.0), ("B", "c", 100, 2.0, 2.0), ("C", "c", 29, 2.0, 2.0)])
    d = compare.diff(base, scen, keys=["area", "cat"]).set_index("area")
    assert not d.loc["A", "low_n"] and d.loc["B", "low_n"] and d.loc["C", "low_n"]
    d2 = compare.diff(base, scen, keys=["area", "cat"], min_n=3).set_index("area")
    assert not d2.low_n.any()


def test_missing_cells_and_zero_base():
    base = frame([("A", "c", 100, 0.0, 10.0), ("X", "c", 100, 5.0, 5.0)])
    scen = frame([("A", "c", 100, 3.0, 10.0), ("Y", "c", 100, 5.0, 5.0)])
    d = compare.diff(base, scen, keys=["area", "cat"]).set_index("area")
    assert np.isnan(d.loc["A", "mean_pct"]) and d.loc["A", "mean_delta"] == 3.0
    assert d.loc["X", "status"] == "baseline_only" and d.loc["Y", "status"] == "scenario_only"
    assert d.loc["X", "low_n"] and d.loc["Y", "low_n"]          # absent on one side counts as n=0
    assert np.isnan(d.loc["X", "mean_delta"])


def test_non_numeric_and_list_columns_ignored():
    base = frame([("A", "c", 50, 1.0, 1.0)]).assign(hist=[[1, 2]])
    scen = frame([("A", "c", 50, 2.0, 2.0)]).assign(hist=[[3, 4]])
    d = compare.diff(base, scen, keys=["area", "cat"])
    assert "hist_delta" not in d.columns and "mean_delta" in d.columns


def test_explicit_value_cols_and_works_on_real_tables():
    base = frame([("A", "c", 50, 1.0, 1.0)])
    scen = frame([("A", "c", 50, 2.0, 5.0)])
    d = compare.diff(base, scen, keys=["area", "cat"], value_cols=["p95"])
    assert "p95_delta" in d.columns and "mean_delta" not in d.columns
