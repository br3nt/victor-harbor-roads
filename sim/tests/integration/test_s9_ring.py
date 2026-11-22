"""S9 ring-road comparison helpers (vhsim.integration.s9_ring)."""
import pandas as pd
import pytest

from vhsim.integration import s9_ring


def test_run_dirs_takes_finished_seeds_including_the_tagged_extra_seed(tmp_path, monkeypatch):
    monkeypatch.setattr(s9_ring, "RUNS", tmp_path)
    for name, done in (("n7_bays__weekday_term_2041_high__s1", True), ("n7_bays__weekday_term_2041_high__s2", False),
                       ("n7_bays__weekday_term_2041_high__s3__s9", True),
                       ("n7_bays__weekday_term_2041_high__s1__cal_x", True),
                       ("n7_bays__weekday_term_2041_moderate__s1", True)):
        d = tmp_path / name
        d.mkdir()
        (d / "tripinfo.xml").write_text("<tripinfos/>")
        (d / "edgedata.xml").write_text('<meandata><interval begin="82800.00" end="86400.00"/></meandata>')
        if done:
            (d / "teleports.xml").write_text("")
    got = [d.name for d in s9_ring.run_dirs("n7", "weekday_term", "2041", "high")]
    assert got == ["n7_bays__weekday_term_2041_high__s1", "n7_bays__weekday_term_2041_high__s3__s9"]


def test_summarise_seed_means_and_changes_against_today():
    rows = []
    for sc, waits, trip in (("baseline", (100, 120), 6.0), ("c5", (130, 150), 6.1)):
        for k, w in enumerate(waits, 1):
            rows.append(dict(scenario=sc, condition="weekday_term", year="2041", growth="high", seed=k, run=f"r{k}",
                             mean_trip_min=trip, total_waiting_veh_h=w))
    s = s9_ring.summarise(pd.DataFrame(rows)).set_index("scenario")
    assert s.loc["c5", "seeds"] == 2 and s.loc["c5", "total_waiting_veh_h"] == 140
    assert (s.loc["c5", "stopped_min"], s.loc["c5", "stopped_max"]) == (130, 150)
    assert s.loc["c5", "stopped_change_pct"] == pytest.approx(100 * (140 / 110 - 1), abs=0.1)
    assert s.loc["c5", "trip_change_s"] == pytest.approx(6.0)


def test_trucks_counted_from_rerouted_routes(tmp_path, monkeypatch):
    """With en-route rerouting SUMO writes a vehicle's routes inside <routeDistribution>; the truck counts must use
    the last driven route there too."""
    d = tmp_path / "r"
    d.mkdir()
    (d / "vehroute.xml").write_text(
        '<routes><vehicle id="t1" type="truck"><routeDistribution><route edges="a b" exitTimes="1 2"/>'
        '<route edges="a ring" exitTimes="1 3"/></routeDistribution></vehicle>'
        '<vehicle id="t2" type="truck"><route edges="town" exitTimes="5"/></vehicle>'
        '<vehicle id="c1" type="car"><route edges="ring" exitTimes="5"/></vehicle></routes>')
    info = {"length": {"a": 100.0, "b": 100.0, "ring": 1000.0, "town": 500.0},
            "ring": {"ring"}, "outer": set(), "town": {"town"}}
    out = s9_ring.truck_counts(d / "vehroute.xml", info)
    assert out["trucks"] == 2 and out["trucks_ring"] == 1 and out["trucks_town"] == 1
    assert out["vkm_ring"] == 1.0 and out["vkm_town"] == 0.5


def test_run_dirs_skips_a_run_stopped_before_the_end_of_the_day(tmp_path, monkeypatch):
    monkeypatch.setattr(s9_ring, "RUNS", tmp_path)
    d = tmp_path / "c5_bays__summer_peak_2025_base__s2"
    d.mkdir()
    for f in ("tripinfo.xml", "teleports.xml"):
        (d / f).write_text("")
    (d / "edgedata.xml").write_text('<meandata><interval begin="68400.00" end="72000.00"/></meandata>')
    assert s9_ring.run_dirs("c5", "summer_peak", "2025", "base") == []
