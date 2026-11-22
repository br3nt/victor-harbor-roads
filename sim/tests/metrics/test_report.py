import json
import re
from pathlib import Path
from xml.etree import ElementTree as ET

import numpy as np
import pandas as pd
import pytest

from vhsim.metrics import accessibility as acc
from vhsim.metrics import compare, report

SNAP = Path(__file__).parent / "snapshots"


def access_df():
    h1 = [0, 2, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    h2 = [0, 0, 0, 0, 0, 0, 5, 0, 0, 0, 0, 0]
    return pd.DataFrame([
        ("Victor Harbor", "supermarket", "all", 5, 130.0, 120.0, 170.0, 174.0, h1),
        ("Encounter <Bay> & Co", 'shops "x"', "06-09", 5, 500.0, 480.0, 560.0, 590.0, h2),
    ], columns=acc.COLUMNS)


def moves_df():
    return pd.DataFrame([
        ("X", "WX", "XE", "all", "W", "E", "T", "Main Rd", "Main Rd", 40, 5.0, 4.0, 12.0, 1.7),
        ("X", "SX", "XN", "all", "S", "N", "T", "Side <St>", "Side <St>", 10, 25.0, 20.0, 60.0, 0.4),
    ], columns=["junction_id", "from_edge", "to_edge", "hour_band", "approach_dir", "heading_dir", "turn",
                "from_name", "to_name", "n", "mean_delay", "median_delay", "p95_delay", "flow_per_hour"])


def parse_fragment(html: str):
    # fragments must be well-formed (XHTML-style) so they can be embedded anywhere
    return ET.fromstring(f"<root>{html}</root>")


def test_accessibility_fragment_structure_and_no_external_resources():
    html = report.accessibility_fragment(access_df(), title="Weekday term", fragment_id="acc1")
    root = parse_fragment(html)
    assert len(root.findall(".//table")) == 1
    assert len(root.findall(".//tbody/tr")) == 2
    assert len(root.findall(".//tbody/tr//svg")) >= 4       # histogram + box per row
    scripts = root.findall(".//script")
    assert len(scripts) == 1 and scripts[0].get("type") == "application/json"
    for bad in ("src=", "href=", "http://", "https://", "<link", "@import", "onclick"):
        assert bad not in html, bad
    assert "<script src" not in html


def test_escaping_everywhere():
    html = report.accessibility_fragment(access_df(), title="<b>T&C</b>", fragment_id='a"b')
    assert "<b>" not in html and "&lt;b&gt;T&amp;C&lt;/b&gt;" in html
    assert "Encounter &lt;Bay&gt; &amp; Co" in html
    assert "shops &quot;x&quot;" in html
    parse_fragment(html)
    mh = report.movements_fragment(moves_df(), title="t", fragment_id="m")
    assert "Side &lt;St&gt;" in mh and "Side <St>" not in mh.split("<script")[0]
    parse_fragment(mh)


def test_json_block_is_full_data_and_cannot_break_out():
    df = access_df()
    html = report.accessibility_fragment(df, title="t", fragment_id="acc1")
    m = re.search(r'<script type="application/json" id="acc1-data">(.*?)</script>', html, re.S)
    assert m
    assert "</script" not in m.group(1) and "<" not in m.group(1)
    data = json.loads(m.group(1))
    assert data["kind"] == "accessibility" and len(data["rows"]) == 2
    by_area = {r["origin_area"]: r for r in data["rows"]}
    assert "Encounter <Bay> & Co" in by_area
    assert by_area["Victor Harbor"]["hist"] == [0, 2, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    assert data["bins"][-1] is None                         # open-ended last bin
    assert by_area["Victor Harbor"]["p95"] == 170.0


def test_nan_becomes_null_in_json():
    df = access_df()
    df.loc[0, "p99"] = np.nan
    html = report.accessibility_fragment(df, title="t", fragment_id="n")
    data = json.loads(re.search(r'id="n-data">(.*?)</script>', html, re.S).group(1))
    assert {r["origin_area"]: r["p99"] for r in data["rows"]}["Victor Harbor"] is None


def test_table_is_sortable_without_js():
    html = report.movements_fragment(moves_df(), title="t", fragment_id="m")
    root = parse_fragment(html)
    ths = root.findall(".//thead//th")
    assert all(th.get("scope") == "col" for th in ths)
    # numeric cells carry the raw value for sorters; default order is by descending mean delay
    cells = root.findall(".//tbody/tr")[0].findall("td")
    assert any(c.get("data-sort-value") == "25.0" for c in cells)
    assert "<script" in html and html.count("<script") == 1  # only the JSON block


def test_low_n_rows_are_marked():
    html = report.movements_fragment(moves_df(), title="t", fragment_id="m", min_n=30)
    root = parse_fragment(html)
    rows = root.findall(".//tbody/tr")
    # default order is descending mean delay: the n=10 row (mean 25) first, flagged; the n=40 row is not
    assert rows[0].get("class") == "low-n" and rows[1].get("class") is None


def test_comparison_fragment():
    base, scen = access_df(), access_df().assign(mean=lambda d: d["mean"] * 1.1)
    d = compare.diff(base.drop(columns="hist"), scen.drop(columns="hist"),
                     keys=["origin_area", "dest_category", "hour_band"])
    html = report.comparison_fragment(d, keys=["origin_area", "dest_category", "hour_band"],
                                      title="scenario vs base", fragment_id="cmp")
    root = parse_fragment(html)
    assert len(root.findall(".//tbody/tr")) == 2
    assert "+10.0%" in html
    assert json.loads(re.search(r'id="cmp-data">(.*?)</script>', html, re.S).group(1))["kind"] == "comparison"


def test_svg_primitives():
    svg = report.hist_svg([0, 2, 3, 0], [0, 60, 120, 180, float("inf")])
    root = parse_fragment(svg)
    rects = root.findall(".//rect")
    assert len(rects) == 4
    heights = [float(r.get("height")) for r in rects]
    assert heights[2] == max(heights) and heights[0] == 0 and heights[1] < heights[2]
    assert report.hist_svg([0, 0], [0, 1, 2]).count("<rect") == 2          # all-zero still renders
    box = report.box_svg(median=100, mean=110, p95=300, p99=400, scale_max=500)
    parse_fragment(box)
    assert "median 100" in box


@pytest.mark.parametrize("name,build", [
    ("accessibility", lambda: report.accessibility_fragment(access_df(), title="Weekday term", fragment_id="acc")),
    ("movements", lambda: report.movements_fragment(moves_df(), title="Intersections", fragment_id="mov")),
])
def test_snapshots(name, build):
    path = SNAP / f"{name}.html"
    html = build()
    if not path.exists():       # first run writes the golden file; review it by eye, then commit
        SNAP.mkdir(exist_ok=True)
        path.write_text(html)
    assert html == path.read_text()


def test_write_fragment(tmp_path):
    p = report.write(tmp_path / "sub" / "f.html", "<p>x</p>")
    assert p.read_text() == "<p>x</p>"
