from pathlib import Path

import numpy as np
import pytest

from vhsim.metrics import accessibility as acc


def write_tripinfo(path: Path, rows):
    """rows: (id, depart, duration[, departDelay])"""
    lines = ['<?xml version="1.0"?>', "<tripinfos>"]
    for r in rows:
        dd = r[3] if len(r) > 3 else 0
        lines.append(
            f'  <tripinfo id="{r[0]}" depart="{r[1]}" departDelay="{dd}" arrival="{r[1] + r[2]}" '
            f'duration="{r[2]}" routeLength="100" waitingTime="0" timeLoss="0"/>'
        )
    lines.append("</tripinfos>")
    path.write_text("\n".join(lines))
    return path


Z2A = {"Z1": "Victor Harbor", "Z2": "Hayborough"}


@pytest.fixture
def tripinfo(tmp_path):
    rows = []
    # Z1 -> supermarket, AM band (06-09): durations 100..500 step 100 -> mean 300, median 300
    for i, d in enumerate([100, 200, 300, 400, 500]):
        rows.append((f"res|Z1|supermarket|poi_1|{i:06d}", 7 * 3600 + i, d))
    # Z1 -> supermarket in mid band (09-15)
    rows.append(("res|Z1|supermarket|poi_1|000100", 10 * 3600, 1000))
    # Z2 visitors -> beach
    rows.append(("vis|Z2|beach_foreshore|poi_9|000200", 7 * 3600, 60))
    # excluded strata
    rows.append(("thr|Z1|supermarket|poi_1|000300", 7 * 3600, 999))
    rows.append(("ext|Z1|supermarket|poi_1|000301", 7 * 3600, 999))
    # not contract shaped
    rows.append(("foreign1", 7 * 3600, 5))
    # suffix on id still counts
    rows.append(("res|Z1|supermarket|poi_1|000400.0", 7 * 3600, 600))
    return write_tripinfo(tmp_path / "tripinfo.xml", rows)


def test_stats_hand_computed(tripinfo):
    df = acc.table(tripinfo, Z2A)
    row = df[(df.origin_area == "Victor Harbor") & (df.dest_category == "supermarket")
             & (df.hour_band == "06-09")].iloc[0]
    # durations 100,200,300,400,500,600
    d = np.array([100, 200, 300, 400, 500, 600.0])
    assert row.n == 6
    assert row["mean"] == pytest.approx(350.0)
    assert row["median"] == pytest.approx(350.0)
    # numpy linear: index 0.95*5 = 4.75 -> 500 + .75*100 = 575
    assert row.p95 == pytest.approx(575.0)
    assert row.p99 == pytest.approx(595.0)
    assert row.p95 == pytest.approx(np.percentile(d, 95))


def test_only_res_and_vis_by_default_and_foreign_skipped(tripinfo):
    df = acc.table(tripinfo, Z2A)
    assert df[df.hour_band != "all"].n.sum() == 6 + 1 + 1  # 6 AM + 1 mid + 1 vis
    df2 = acc.table(tripinfo, Z2A, strata=("res", "vis", "thr", "ext"))
    assert df2[df2.hour_band != "all"].n.sum() == 10


def test_groups_and_all_band(tripinfo):
    df = acc.table(tripinfo, Z2A)
    keys = set(zip(df.origin_area, df.dest_category, df.hour_band))
    assert ("Victor Harbor", "supermarket", "09-15") in keys
    assert ("Hayborough", "beach_foreshore", "06-09") in keys
    allrow = df[(df.origin_area == "Victor Harbor") & (df.hour_band == "all")].iloc[0]
    assert allrow.n == 7
    assert allrow["median"] == pytest.approx(400.0)


def test_unmapped_zone_goes_to_unmapped_area(tripinfo):
    df = acc.table(tripinfo, {"Z1": "Victor Harbor"})
    assert "unmapped" in set(df.origin_area)


def test_histogram_fixed_bins(tripinfo):
    df = acc.table(tripinfo, Z2A)
    row = df[(df.origin_area == "Victor Harbor") & (df.dest_category == "supermarket")
             & (df.hour_band == "06-09")].iloc[0]
    assert len(row["hist"]) == len(acc.HIST_BINS) - 1
    assert sum(row["hist"]) == 6
    # 100,200 -> [60,120)=idx1 and [180,240)=idx3 ; check by edges
    edges = acc.HIST_BINS
    for d in (100, 200, 300, 400, 500, 600):
        i = np.searchsorted(edges, d, side="right") - 1
        assert row["hist"][i] >= 1
    assert edges[0] == 0 and edges[-1] == float("inf")


def test_custom_hour_bands_and_depart_delay(tmp_path):
    p = write_tripinfo(tmp_path / "t.xml", [("res|Z1|c|p|1", 100, 50, 25), ("res|Z1|c|p|2", 200, 70, 0)])
    df = acc.table(p, Z2A, hour_bands={"day": (0, 24)}, include_all=False, include_depart_delay=True)
    assert list(df.hour_band) == ["day"]
    assert df.iloc[0]["mean"] == pytest.approx((75 + 70) / 2)


def test_band_boundary_uses_depart_time(tmp_path):
    p = write_tripinfo(tmp_path / "t.xml", [("res|Z1|c|p|1", 6 * 3600, 10), ("res|Z1|c|p|2", 6 * 3600 - 1, 10)])
    df = acc.table(p, Z2A, include_all=False)
    assert set(df.hour_band) == {"00-06", "06-09"}
