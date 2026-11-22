"""Scenario-vs-baseline comparison of accessibility or movements tables."""
from __future__ import annotations

import numpy as np
import pandas as pd

MIN_N = 30   # cells with fewer samples on either side are flagged ``low_n`` (see assumptions/S4-metrics.md)


def diff(baseline_df: pd.DataFrame, scenario_df: pd.DataFrame, keys, value_cols=None,
         min_n: int = MIN_N, n_col: str = "n") -> pd.DataFrame:
    """Outer-join two tables on ``keys`` and compute changes.

    For every value column ``c`` (default: all numeric non-key columns, including ``n``) the result has
    ``c_base``, ``c_scen``, ``c_delta`` (= scenario - baseline) and ``c_pct`` (= 100 * delta / baseline, NaN when
    the baseline is 0 or the cell is missing on one side). ``status`` is ``both`` / ``baseline_only`` /
    ``scenario_only``. ``low_n`` is True when either side's ``n`` is below ``min_n`` (a missing side counts as
    n = 0), so those cells should be read as indicative only.
    """
    keys = list(keys)
    if value_cols is None:
        value_cols = [c for c in baseline_df.columns
                      if c not in keys and pd.api.types.is_numeric_dtype(baseline_df[c])
                      and not pd.api.types.is_bool_dtype(baseline_df[c]) and c in scenario_df.columns]
    value_cols = list(value_cols)
    b = baseline_df[keys + value_cols].rename(columns={c: f"{c}_base" for c in value_cols})
    s = scenario_df[keys + value_cols].rename(columns={c: f"{c}_scen" for c in value_cols})
    m = b.merge(s, on=keys, how="outer", indicator=True)
    m["status"] = m.pop("_merge").map({"both": "both", "left_only": "baseline_only", "right_only": "scenario_only"})
    cols = []
    for c in value_cols:
        base, scen = m[f"{c}_base"].astype(float), m[f"{c}_scen"].astype(float)
        m[f"{c}_delta"] = scen - base
        with np.errstate(divide="ignore", invalid="ignore"):
            m[f"{c}_pct"] = np.where(base != 0, 100.0 * (scen - base) / base, np.nan)
        cols += [f"{c}_base", f"{c}_scen", f"{c}_delta", f"{c}_pct"]
    if n_col in value_cols:
        nb, ns = m[f"{n_col}_base"].fillna(0), m[f"{n_col}_scen"].fillna(0)
        m["low_n"] = (nb < min_n) | (ns < min_n)
    else:
        m["low_n"] = False
    return m[keys + cols + ["status", "low_n"]].sort_values(keys, ignore_index=True)
