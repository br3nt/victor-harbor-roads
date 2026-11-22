import csv
import json
import xml.etree.ElementTree as ET

import pytest

from vhsim.demand import build
from vhsim.demand.geo import in_bbox
from vhsim.demand.ids import parse_id
from vhsim.demand.params import STUDY_BBOX


@pytest.fixture(scope="module")
def out(tmp_path_factory):
    d = tmp_path_factory.mktemp("demand")
    z = tmp_path_factory.mktemp("zones")
    rc = build.main(["--condition", "weekday_term", "--year", "2025", "--growth", "base", "--seed", "7",
                     "--out-dir", str(d), "--zones-dir", str(z)])
    assert rc == 0
    return d, z


def test_files_written(out):
    d, z = out
    stem = "weekday_term_2025_base"
    for name in (f"{stem}.trips.xml", f"{stem}.summary.csv", f"{stem}.meta.json", "vtypes.add.xml"):
        assert (d / name).exists(), name
    for name in ("residential_zones.geojson", "pois.geojson", "gateways.csv", "zone_areas.csv",
                 "growth_areas.geojson"):
        assert (z / name).exists(), name


def test_trips_xml_contract(out):
    d, _ = out
    root = ET.parse(d / "weekday_term_2025_base.trips.xml").getroot()
    trips = root.findall("trip")
    assert len(trips) > 40000
    last = -1
    for t in trips:
        parse_id(t.get("id"))
        assert t.get("type") in ("car", "truck", "caravan")
        dep = float(t.get("depart"))
        assert dep >= last
        last = dep
        for key in ("fromLonLat", "toLonLat"):
            lon, lat = map(float, t.get(key).split(","))
            assert in_bbox(lon, lat, STUDY_BBOX)


def test_vtypes(out):
    d, _ = out
    vt = {v.get("id"): v for v in ET.parse(d / "vtypes.add.xml").getroot().findall("vType")}
    assert set(vt) == {"car", "truck", "caravan"}
    assert float(vt["truck"].get("length")) > float(vt["car"].get("length"))
    assert float(vt["caravan"].get("maxSpeed")) < float(vt["car"].get("maxSpeed"))
    for v in vt.values():
        for a in ("length", "accel", "decel", "maxSpeed", "vClass"):
            assert v.get(a)


def test_summary_sums_to_trip_count(out):
    d, _ = out
    with open(d / "weekday_term_2025_base.summary.csv") as f:
        rows = list(csv.DictReader(f))
    assert {"stratum", "purpose", "hour", "vtype", "trips"} <= set(rows[0])
    n = sum(int(r["trips"]) for r in rows)
    meta = json.loads((d / "weekday_term_2025_base.meta.json").read_text())
    assert n == meta["trips"]


def test_deterministic_bytes(tmp_path, out):
    d, _ = out
    build.main(["--condition", "weekday_term", "--year", "2025", "--growth", "base", "--seed", "7",
                "--out-dir", str(tmp_path), "--no-zones"])
    a = (d / "weekday_term_2025_base.trips.xml").read_bytes()
    b = (tmp_path / "weekday_term_2025_base.trips.xml").read_bytes()
    assert a == b


def test_set_override_recorded_and_changes_output(tmp_path, out):
    d, _ = out
    build.main(["--condition", "weekday_term", "--year", "2025", "--growth", "base", "--seed", "7",
                "--out-dir", str(tmp_path), "--no-zones", "--set", "rates.senior_weight=0.8"])
    meta = json.loads((tmp_path / "weekday_term_2025_base.meta.json").read_text())
    base = json.loads((d / "weekday_term_2025_base.meta.json").read_text())
    assert meta["overrides"] == ["rates.senior_weight=0.8"]
    assert meta["resident_trips"] < base["resident_trips"]
    head = (tmp_path / "weekday_term_2025_base.trips.xml").read_text()[:3000]
    assert "rates.senior_weight=0.8" in head


def test_config_file_option(tmp_path):
    from vhsim.demand.config import Config
    c = Config.load().with_overrides(["event.attendees=1234"])
    p = tmp_path / "my.json"
    c.dump(p)
    rc = build.main(["--condition", "event_nye", "--year", "2025", "--growth", "base", "--config", str(p),
                     "--out-dir", str(tmp_path), "--no-zones"])
    assert rc == 0
    meta = json.loads((tmp_path / "event_nye_2025_base.meta.json").read_text())
    assert meta["config"].endswith("my.json")


def test_invalid_year_growth_combination(tmp_path):
    with pytest.raises(SystemExit):
        build.main(["--condition", "weekday_term", "--year", "2031", "--growth", "base", "--out-dir", str(tmp_path)])
