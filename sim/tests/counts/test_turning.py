"""The 2017 turning counts must reproduce the Tonkin report's own stated figures (S-D19)."""
from __future__ import annotations

import csv
from collections import defaultdict

import pytest

from vhsim.counts import turning

INTERSECTIONS = [
    "Torrens/Victoria", "Torrens/Crozier", "Torrens/Coral", "Torrens/Stuart",
    "Torrens/Ocean", "Torrens/Seaview/Eyre", "Hindmarsh/Grantley/Bridge Tce",
]

# 12-hour totals: the "Total" cell of the report's own totals row (read from the PDF).
STATED_TOTAL = {
    "Torrens/Coral": 12195, "Torrens/Crozier": 13055, "Torrens/Stuart": 13175,
    "Torrens/Victoria": 12557, "Torrens/Seaview/Eyre": 17550,
    "Torrens/Ocean": 15468, "Hindmarsh/Grantley/Bridge Tce": 15469,
}
# busiest rolling hour (the report's "PM Peak" cell) and its start time.
STATED_PEAK = {
    "Torrens/Coral": (1281, "13:15"), "Torrens/Crozier": (1431, "11:45"),
    "Hindmarsh/Grantley/Bridge Tce": (1624, "11:15"), "Torrens/Ocean": (1606, "11:45"),
    "Torrens/Seaview/Eyre": (1823, "11:45"), "Torrens/Stuart": (1367, "11:45"),
    "Torrens/Victoria": (1410, "12:00"),
}


@pytest.fixture(scope="module")
def parsed():
    return turning.parse_report()


def _bins(records):
    out = defaultdict(lambda: defaultdict(int))
    for r in records:
        out[r["intersection"]][r["bin_start"]] += r["light"] + r["heavy"] + r["cycle"]
    return out


def test_seven_intersections_48_bins(parsed):
    records, _ = parsed
    per = _bins(records)
    assert sorted(per) == sorted(INTERSECTIONS)
    for name in INTERSECTIONS:
        assert len(per[name]) == 48
        assert min(per[name]) == "07:00" and max(per[name]) == "18:45"


def test_columns(tmp_path):
    out = tmp_path / "t.csv"
    turning.write_csv(out)
    with open(out) as fh:
        header = next(csv.reader(fh))
    assert header == ["intersection", "approach_road", "approach_dir", "movement",
                      "to_road", "bin_start", "light", "heavy", "cycle", "source", "notes"]


@pytest.mark.parametrize("name", INTERSECTIONS)
def test_twelve_hour_total_matches_report(parsed, name):
    records, stated = parsed
    total = sum(_bins(records)[name].values())
    assert total == STATED_TOTAL[name]
    # and the report's own row-by-row "total of all movements" column sums to the same
    assert sum(stated[name]["row_totals"].values()) == STATED_TOTAL[name]
    assert stated[name]["totals_row"] == STATED_TOTAL[name]


@pytest.mark.parametrize("name", INTERSECTIONS)
def test_peak_hour_matches_report(parsed, name):
    records, stated = parsed
    bins = _bins(records)[name]
    times = sorted(bins)
    best = max(
        ((sum(bins[t] for t in times[i:i + 4]), times[i]) for i in range(len(times) - 3)),
    )
    vol, start = STATED_PEAK[name]
    assert best == (vol, start)
    assert stated[name]["pm_peak"] == vol
    # every rolling-hour volume the report prints must equal ours
    for t, v in stated[name]["rolling"].items():
        i = times.index(t)
        assert sum(bins[x] for x in times[i:i + 4]) == v, (name, t)


def test_per_bin_totals_equal_report_column(parsed):
    records, stated = parsed
    for name, per in _bins(records).items():
        assert dict(per) == stated[name]["row_totals"], name


def _sum(records, intersection, approach_dir, movement):
    return sum(r["light"] + r["heavy"] + r["cycle"] for r in records
               if r["intersection"] == intersection and r["approach_dir"] == approach_dir
               and r["movement"] == movement)


def test_ocean_right_turn_about_700(parsed):
    records, _ = parsed
    # report s3: "around 25% of traffic that enters Ocean Street turns right from Torrens St (around 700/day)"
    assert 650 <= _sum(records, "Torrens/Ocean", "S", "R") <= 750


def test_stuart_530_left_180_right(parsed):
    records, _ = parsed
    assert 500 <= _sum(records, "Torrens/Stuart", "N", "L") <= 560
    assert 160 <= _sum(records, "Torrens/Stuart", "S", "R") <= 200


def test_heavy_share_on_torrens_through(parsed):
    records, _ = parsed
    sel = [r for r in records if r["movement"] == "T" and r["approach_road"] == "Torrens Street"]
    heavy = sum(r["heavy"] for r in sel)
    motor = sum(r["light"] + r["heavy"] for r in sel)
    assert 0.013 <= heavy / motor <= 0.016


def test_committed_csv_matches_parser(parsed, tmp_path):
    records, _ = parsed
    out = tmp_path / "t.csv"
    turning.write_csv(out)
    with open(out) as fh:
        rows = list(csv.DictReader(fh))
    assert len(rows) == len(records)
    assert sum(int(r["light"]) + int(r["heavy"]) + int(r["cycle"]) for r in rows) == sum(STATED_TOTAL.values())
    assert {r["source"] for r in rows} == {"S-D19"}


def test_movement_totals_row_matches_bins(parsed):
    records, stated = parsed
    for name in INTERSECTIONS:
        per_mov = defaultdict(int)
        for r in records:
            if r["intersection"] == name:
                rid = r["notes"].split(";")[0].replace("report movement ", "")
                per_mov[rid] += r["light"] + r["heavy"] + r["cycle"]
        assert dict(per_mov) == stated[name]["movement_totals"], name


def test_pdf_itself_gives_same_numbers(parsed, tmp_path):
    """Re-extract the PDF with pdftotext and check the parse is identical (not just the archived txt)."""
    import shutil
    import subprocess

    if shutil.which("pdftotext") is None:
        pytest.skip("pdftotext not installed")
    pdf = turning.TXT.with_suffix(".pdf")
    txt = tmp_path / "from_pdf.txt"
    subprocess.run(["pdftotext", "-layout", str(pdf), str(txt)], check=True, capture_output=True)
    records, stated = parsed
    records2, stated2 = turning.parse_report(txt)
    assert records2 == records
    assert stated2 == stated


def test_stated_csv(tmp_path):
    out = tmp_path / "s.csv"
    turning.write_stated_csv(out)
    rows = {r["intersection"]: r for r in csv.DictReader(open(out))}
    assert sorted(rows) == sorted(INTERSECTIONS)
    for name, (vol, start) in STATED_PEAK.items():
        assert int(rows[name]["pm_peak_stated"]) == vol
        assert rows[name]["busiest_hour_start"] == start
        assert int(rows[name]["total_12h_stated"]) == STATED_TOTAL[name]
