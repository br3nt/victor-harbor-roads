"""HTML fragments for the knowledge base: tables + JSON data + inline SVG. No external JS/CSS/resources.

Each fragment is well-formed XML-style markup (so it can be parsed and embedded anywhere):

* a plain ``<table>`` -- headers are ``<th scope="col">``, numeric cells carry ``data-sort-value`` with the raw
  number, rows come pre-sorted, so it is readable with no script and any sorter can be bolted on later;
* one ``<script type="application/json" id="{fragment_id}-data">`` block with the full data (NaN -> null,
  infinity -> null, ``<``/``>``/``&`` escaped as unicode escapes so it can never close the script element);
* inline SVG per row: a fixed-bin histogram of travel times (accessibility) or a median/mean/p95/p99 range
  summary, scaled to the group maximum.

All text is HTML-escaped.
"""
from __future__ import annotations

import html as _html
import json
import math
from pathlib import Path

import pandas as pd

from . import accessibility as _acc
from .compare import MIN_N


def esc(x) -> str:
    return _html.escape("" if x is None else str(x), quote=True)


def _clean(v):
    """Convert numpy / NaN / inf values into JSON-safe Python values."""
    if isinstance(v, (list, tuple)):
        return [_clean(x) for x in v]
    if hasattr(v, "item") and not isinstance(v, (str, bytes)):
        try:
            v = v.item()
        except (ValueError, AttributeError):
            pass
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return None
    if v is pd.NA or v is None:
        return None
    return v


def records(df: pd.DataFrame) -> list[dict]:
    return [{c: _clean(r[c]) for c in df.columns} for _, r in df.iterrows()]


def json_block(data, block_id: str) -> str:
    text = json.dumps(data, allow_nan=False, ensure_ascii=True, separators=(",", ":"))
    text = text.replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
    return f'<script type="application/json" id="{esc(block_id)}">{text}</script>'


def _num(v, nd=1) -> str:
    v = _clean(v)
    return "" if v is None else f"{v:,.{nd}f}"


# ---------------------------------------------------------------- SVG primitives
def hist_svg(counts, bins, width=132, height=30) -> str:
    """Histogram of ``counts`` per bin (bar height proportional to the largest count in this row)."""
    counts = [int(c) for c in counts]
    top = max(counts) if counts and max(counts) > 0 else 1
    bw = width / max(len(counts), 1)
    bars = []
    for i, c in enumerate(counts):
        h = round((height - 2) * c / top, 2)
        lo, hi = bins[i], bins[i + 1] if i + 1 < len(bins) else math.inf
        label = f"{lo:g}+ s" if math.isinf(hi) else f"{lo:g}-{hi:g} s"
        bars.append(f'<rect x="{round(i * bw + 0.5, 2)}" y="{round(height - 1 - h, 2)}" width="{round(bw - 1, 2)}" '
                    f'height="{h}" fill="currentColor"><title>{esc(label)}: {c}</title></rect>')
    return (f'<svg class="hist" width="{width}" height="{height}" '
            f'viewBox="0 0 {width} {height}" role="img" aria-label="travel time histogram">{"".join(bars)}</svg>')


def box_svg(median, mean, p95, p99, scale_max, width=140, height=16) -> str:
    """Range summary: line 0..p99, thick bar median..p95, dot at the mean. Scale: 0..scale_max."""
    sm = scale_max if scale_max and scale_max > 0 else 1.0

    def x(v):
        return round(4 + (width - 8) * min(max(float(v), 0.0), sm) / sm, 2)

    mid = height / 2
    title = f"median {_num(median, 0)}, mean {_num(mean, 0)}, p95 {_num(p95, 0)}, p99 {_num(p99, 0)}"
    return (f'<svg class="box" width="{width}" height="{height}" '
            f'viewBox="0 0 {width} {height}" role="img" aria-label="{esc(title)}"><title>{esc(title)}</title>'
            f'<line x1="{x(0)}" y1="{mid}" x2="{x(p99)}" y2="{mid}" stroke="currentColor" stroke-width="1"/>'
            f'<rect x="{x(median)}" y="{mid - 3}" width="{max(round(x(p95) - x(median), 2), 1)}" height="6" '
            f'fill="currentColor" opacity="0.45"/>'
            f'<line x1="{x(median)}" y1="{mid - 5}" x2="{x(median)}" y2="{mid + 5}" stroke="currentColor" '
            f'stroke-width="2"/><circle cx="{x(mean)}" cy="{mid}" r="2.5" fill="none" stroke="currentColor"/></svg>')


# ---------------------------------------------------------------- table assembly
def _td(value, text=None, numeric=False, cls=None) -> str:
    attrs = ""
    if numeric and _clean(value) is not None:
        attrs += f' data-sort-value="{esc(_clean(value))}"'
    if cls:
        attrs += f' class="{esc(cls)}"'
    return f"<td{attrs}>{esc(text if text is not None else value)}</td>"


def _row(cells, low: bool) -> str:
    return ('<tr class="low-n">' if low else "<tr>") + "".join(cells) + "</tr>\n"


def _wrap(title, fragment_id, table_html, data) -> str:
    return (f'<div class="vhsim-report" id="{esc(fragment_id)}">\n<h3>{esc(title)}</h3>\n{table_html}\n'
            f'{json_block(data, fragment_id + "-data")}\n</div>\n')


def _table(fragment_id, headers, rows_html, caption=None) -> str:
    head = "".join(f'<th scope="col">{esc(h)}</th>' for h in headers)
    cap = f"<caption>{esc(caption)}</caption>" if caption else ""
    return (f'<table class="vhsim-table" id="{esc(fragment_id)}-table">{cap}\n<thead><tr>{head}</tr></thead>\n'
            f'<tbody>\n{rows_html}</tbody>\n</table>')


def accessibility_fragment(df: pd.DataFrame, title: str, fragment_id: str, min_n: int = MIN_N) -> str:
    """R14 table: one row per (origin_area, dest_category, hour_band) with histogram and range summary."""
    d = df.sort_values(["origin_area", "dest_category", "hour_band"], ignore_index=True)
    scale = float(d["p99"].max()) if len(d) else 1.0
    rows = []
    for _, r in d.iterrows():
        low = r["n"] < min_n
        cells = [_td(r["origin_area"]), _td(r["dest_category"]), _td(r["hour_band"]),
                 _td(r["n"], f"{int(r['n'])}" + (" †" if low else ""), True)]
        cells += [_td(r[k], _num(r[k], 0), True) for k in ("mean", "median", "p95", "p99")]
        cells.append(f'<td>{hist_svg(r["hist"], _acc.HIST_BINS)}</td>')
        cells.append(f'<td>{box_svg(r["median"], r["mean"], r["p95"], r["p99"], scale)}</td>')
        rows.append(_row(cells, low))
    headers = ["Origin area", "Destination", "Hour band", "n", "Mean (s)", "Median (s)", "p95 (s)", "p99 (s)",
               "Histogram", "Median-p95 / p99"]
    data = {"kind": "accessibility", "title": title, "min_n": min_n, "bins": _clean(list(_acc.HIST_BINS)),
            "rows": records(d)}
    return _wrap(title, fragment_id, _table(fragment_id, headers, "".join(rows),
                                            caption=f"Travel times; † = fewer than {min_n} trips"), data)


def movements_fragment(df: pd.DataFrame, title: str, fragment_id: str, min_n: int = MIN_N) -> str:
    """R15 table: one row per movement (and hour band), pre-sorted by descending mean delay."""
    d = df.sort_values(["mean_delay", "junction_id", "from_edge", "to_edge"], ascending=[False, True, True, True],
                       ignore_index=True)
    scale = float(d["p95_delay"].max()) if len(d) else 1.0
    rows = []
    for _, r in d.iterrows():
        low = r["n"] < min_n
        cells = [_td(r["junction_id"]), _td(r["from_edge"]), _td(r["from_name"]), _td(r["approach_dir"]),
                 _td(r["turn"]), _td(r["to_edge"]), _td(r["hour_band"]),
                 _td(r["n"], f"{int(r['n'])}" + (" †" if low else ""), True),
                 _td(r["flow_per_hour"], _num(r["flow_per_hour"], 1), True)]
        cells += [_td(r[k], _num(r[k], 1), True) for k in ("mean_delay", "median_delay", "p95_delay")]
        cells.append(f'<td>{box_svg(r["median_delay"], r["mean_delay"], r["p95_delay"], r["p95_delay"], scale)}</td>')
        rows.append(_row(cells, low))
    headers = ["Junction", "Approach edge", "Street", "From", "Turn", "To edge", "Hour band", "n", "Flow (veh/h)",
               "Mean delay (s)", "Median delay (s)", "p95 delay (s)", "Median-p95"]
    data = {"kind": "movements", "title": title, "min_n": min_n, "rows": records(d)}
    return _wrap(title, fragment_id, _table(fragment_id, headers, "".join(rows),
                                            caption=f"Approach delay by movement; † = fewer than {min_n} vehicles"),
                 data)


def comparison_fragment(diff_df: pd.DataFrame, keys, title: str, fragment_id: str, value_cols=None) -> str:
    """Scenario-vs-baseline table from :func:`vhsim.metrics.compare.diff` (base, scenario, delta, % per column)."""
    keys = list(keys)
    if value_cols is None:
        value_cols = [c[:-6] for c in diff_df.columns if c.endswith("_delta") and c != "n_delta"]
    rows = []
    for _, r in diff_df.iterrows():
        cells = [_td(r[k]) for k in keys] + [_td(r["status"])]
        for c in ["n"] + list(value_cols):
            if f"{c}_base" not in diff_df.columns:
                continue
            nd = 0 if c == "n" else 1
            cells += [_td(r[f"{c}_base"], _num(r[f"{c}_base"], nd), True),
                      _td(r[f"{c}_scen"], _num(r[f"{c}_scen"], nd), True),
                      _td(r[f"{c}_delta"], _signed(r[f"{c}_delta"], nd), True)]
            pct = _clean(r[f"{c}_pct"])
            cells.append(_td(r[f"{c}_pct"], "" if pct is None else f"{pct:+.1f}%", True))
        low = bool(r["low_n"])
        rows.append(_row(cells, low))
    headers = list(keys) + ["Status"]
    for c in ["n"] + list(value_cols):
        if f"{c}_base" in diff_df.columns:
            headers += [f"{c} base", f"{c} scenario", f"{c} change", f"{c} %"]
    data = {"kind": "comparison", "title": title, "keys": keys, "rows": records(diff_df)}
    return _wrap(title, fragment_id, _table(fragment_id, headers, "".join(rows),
                                            caption="Scenario minus baseline; shaded rows have small n"), data)


def _signed(v, nd) -> str:
    v = _clean(v)
    return "" if v is None else f"{v:+,.{nd}f}"


def write(path, fragment: str) -> Path:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(fragment, encoding="utf-8")
    return p
