from __future__ import annotations

import csv
import hashlib
from collections import defaultdict

import pytest

from vhsim.counts import profile, turning
from vhsim.paths import DATA


@pytest.fixture(scope="module")
def rows(tmp_path_factory):
    out = tmp_path_factory.mktemp("prof") / "hourly_profile.csv"
    profile.write_csv(out)
    with open(out) as fh:
        assert next(csv.reader(fh)) == ["hour", "share", "basis", "source", "notes"]
    return list(csv.DictReader(open(out)))


def test_24_hours_sum_to_one(rows):
    assert [int(r["hour"]) for r in rows] == list(range(24))
    assert abs(sum(float(r["share"]) for r in rows) - 1.0) < 1e-6


def test_observed_hours_follow_2017_counts(rows):
    recs, _ = turning.parse_report()
    per_hour = defaultdict(int)
    for r in recs:
        per_hour[int(r["bin_start"][:2])] += r["light"] + r["heavy"] + r["cycle"]
    by_hour = {int(r["hour"]): r for r in rows}
    ref = float(by_hour[12]["share"]) / per_hour[12]
    for h in range(7, 19):
        assert by_hour[h]["basis"] == "observed"
        assert by_hour[h]["source"].startswith("S-D19")
        assert float(by_hour[h]["share"]) == pytest.approx(per_hour[h] * ref, rel=1e-3)
    for h in list(range(0, 7)) + list(range(19, 24)):
        assert by_hour[h]["basis"] == "assumed"
        assert "S-S3-01" in by_hour[h]["source"]


def test_night_is_quiet_and_midday_is_peak(rows):
    s = {int(r["hour"]): float(r["share"]) for r in rows}
    assert max(s, key=s.get) in (11, 12, 13)
    assert sum(s[h] for h in range(0, 5)) < 0.03


def test_reference_archived_and_hashed():
    raw = DATA / "profiles" / "raw"
    lines = (raw / "SOURCES.tsv").read_text().splitlines()
    assert lines[0].split("\t") == ["id", "title", "publisher", "url", "retrieved_at", "local_path", "sha256", "notes"]
    cols = lines[1].split("\t")
    assert cols[0] == "S-S3-01"
    f = raw / cols[5].split("/")[-1]
    assert hashlib.sha256(f.read_bytes()).hexdigest() == cols[6]
