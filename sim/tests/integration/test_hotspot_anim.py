"""S8 animations: replaying a batch run with FCD output, and the compact track encoding."""
import gzip
import json

import pytest

from vhsim.integration import hotspot_anim as an

LOG = ("$ /x/sumo -n /d/net.xml -r /d/run/routes.rou.xml -a /d/run/edgedata.add.xml,/d/run/viewer.add.xml "
       "--seed 1 -b 0 -e 93600 --tripinfo-output /d/run/tripinfo.xml --vehroute-output /d/run/vehroute.xml "
       "--vehroute-output.exit-times true --statistic-output /d/run/statistic.xml --no-step-log true "
       "--duration-log.disable true --time-to-teleport 300 --ignore-route-errors true --ignore-junction-blocker 15 "
       "--time-to-impatience 60 --device.rerouting.probability 1\n--- stdout\n")


def test_replay_cmd_keeps_the_model_and_swaps_the_outputs(tmp_path):
    cmd = an.replay_cmd(LOG, end=45900, fcd="/o/fcd.xml.gz", fcd_begin=44100, shapes_add="/o/shapes.add.xml",
                        shape_ids=["a", "b"], tripinfo="/o/tripinfo.xml.gz")
    s = " ".join(cmd)
    assert cmd[0] == "/x/sumo" and "-n /d/net.xml" in s and "-r /d/run/routes.rou.xml" in s
    # same seed and behaviour settings as the batch run
    for keep in ["--seed 1", "-b 0", "--time-to-teleport 300", "--ignore-junction-blocker 15",
                 "--time-to-impatience 60", "--device.rerouting.probability 1"]:
        assert keep in s
    # batch outputs and meandata dropped; ends at the window end; fcd restricted to the shapes
    for gone in ["vehroute", "statistic-output", "edgedata.add.xml", "/d/run/tripinfo.xml", "-e 93600"]:
        assert gone not in s
    assert "-e 45900" in s and "-a /o/shapes.add.xml" in s
    assert "--fcd-output /o/fcd.xml.gz" in s and "--fcd-output.filter-shapes a,b" in s
    assert "--fcd-output.geo true" in s and "--device.fcd.begin 44100" in s
    assert "--tripinfo-output /o/tripinfo.xml.gz" in s


def test_check_same_compares_the_arrivals_near_the_window(tmp_path):
    orig = tmp_path / "tripinfo.xml"
    orig.write_text('<tripinfos><tripinfo id="a" arrival="100.00" routeLength="5"/>'
                    '<tripinfo id="b" arrival="44000.00" routeLength="7"/><tripinfo id="c" arrival="44500.00" routeLength="9"/>'
                    '<tripinfo id="d" arrival="80000.00" routeLength="1"/></tripinfos>')
    rep = tmp_path / "rep.xml.gz"
    with gzip.open(rep, "wt") as f:
        f.write('<tripinfos><tripinfo id="a" arrival="100.00" routeLength="5"/>'
                '<tripinfo id="b" arrival="44000.00" routeLength="7"/><tripinfo id="c" arrival="44501.00" routeLength="9"/></tripinfos>')
    # only arrivals from t_from on count: b same, c differs (a, early in the day, is ignored)
    assert an.check_same(orig, rep, t_from=43200) == 0.5


def test_square_polygon_in_lon_lat():
    poly = an.square_lonlat((138.6, -35.55), 100)
    assert len(poly) == 5 and poly[0] == poly[-1]
    xs = [p[0] for p in poly]
    # 200 m wide at this latitude is about 0.0022 degrees of longitude
    assert max(xs) - min(xs) == pytest.approx(200 / (111320 * 0.8141), rel=0.01)


def test_encode_track_round_trip_with_stopped_runs():
    pts = [(0, 0), (2, 0), (4, 1), (4, 1), (4, 1), (4, 1), (5, 1)]
    enc = an.encode_track(pts)
    assert an.decode_track(enc) == pts
    # four frames standing still are one run marker, not three (0, 0) pairs
    pairs = list(zip(enc[2::2], enc[3::2]))
    assert (an.STOP, 3) in pairs and (0, 0) not in pairs


def test_short_street_names():
    assert an.short_name("Crozier Road") == "Crozier Rd"
    assert an.short_name("Eyre Terrace") == "Eyre Tce"
    assert an.short_name("Flinders Parade") == "Flinders Pde"
    assert an.short_name("Bartel Boulevard") == "Bartel Blvd"


def test_street_labels_sit_on_the_street_away_from_the_junction():
    # two streets crossing at the centre (lon/lat == x/y in degrees for this test's geo stub)
    class Geo:
        def to_lonlat(self, x, y):
            return x, y
    edges = {
        "a": dict(name="Long Street", end=(0.0, 0.0), shape=[(-100.0, 0.0), (0.0, 0.0)]),
        "b": dict(name="Long Street", end=(100.0, 0.0), shape=[(0.0, 0.0), (100.0, 0.0)]),
        "c": dict(name="Cross Road", end=(0.0, 0.0), shape=[(0.0, -100.0), (0.0, 0.0)]),
        "d": dict(name="", end=(0.0, 0.0), shape=[(5.0, 5.0), (0.0, 0.0)]),
    }
    labs = an.street_labels(edges, Geo(), centre=(0.0, 0.0), half=100.0, metres=lambda lon, lat: (lon, lat))
    names = {t for t, _, _ in labs}
    assert names == {"Long St", "Cross Rd"}
    for t, x, y in labs:
        assert 30 <= abs(x) + abs(y) <= 90       # along the street, not on the junction or at the edge


def test_point_back_from_the_stop_line():
    shape = [(0.0, 0.0), (0.0, 10.0), (30.0, 10.0)]       # ends at (30, 10), driving east
    assert an.point_back(shape, 20) == pytest.approx((10.0, 10.0))
    assert an.point_back(shape, 35) == pytest.approx((0.0, 5.0))
    assert an.point_back(shape, 500) == pytest.approx((0.0, 0.0))   # shorter than asked: its start


def test_window_from_seed_one_quarters():
    import pandas as pd
    # two scenarios' seed-1 stopped vehicle-seconds per quarter on the hotspot's edges
    lanes = {"baseline": pd.DataFrame({"edge": ["a", "a", "z"], "t": [43200.0, 44100.0, 45000.0], "wait_s": [100.0, 50.0, 9e9]}),
             "cp": pd.DataFrame({"edge": ["b", "b"], "t": [43200.0, 44100.0], "wait_s": [10.0, 900.0]})}
    edges = {"baseline": {"a"}, "cp": {"b"}}
    start, why = an.window_from_quarters(lanes, edges)
    assert start == 44100 and "12:15" in why            # z is not a hotspot edge


def test_split_tracks_on_gaps():
    samples = [(10, 0, 0), (11, 1, 0), (12, 2, 0), (20, 9, 9), (21, 9, 9)]
    parts = an.split_on_gaps(samples)
    assert [p[0][0] for p in parts] == [10, 20] and [len(p) for p in parts] == [3, 2]


def test_export_from_fcd(tmp_path):
    fcd = tmp_path / "fcd.xml.gz"
    with gzip.open(fcd, "wt") as f:
        f.write('<fcd-export>\n')
        for t in range(100, 106):
            f.write(f'<timestep time="{t}.00">')
            f.write(f'<vehicle id="a" x="{138.6 + 0.00001 * (t - 100):.6f}" y="-35.55" angle="90.00" type="car" '
                    f'speed="0.9" lane="E1_0"/>')
            if t >= 103:
                f.write('<vehicle id="b" x="138.6002" y="-35.5501" angle="180.00" type="truck" speed="0.00" lane="Q_0"/>')
            f.write('<vehicle id="far" x="139.0" y="-35.0" angle="0" type="car" speed="5" lane="Z_0"/>')
            f.write('</timestep>\n')
        f.write('</fcd-export>\n')
    view = {"centre": (138.6, -35.55), "half": 100}
    out = an.tracks_from_fcd(fcd, view, t0=100, t1=106, queue_lanes={"Q_0": 0})
    assert out["frames"] == 6
    kinds = sorted(t["k"] for t in out["tracks"])
    assert kinds == [0, 1]                       # 'far' is outside the view
    truck = next(t for t in out["tracks"] if t["k"] == 1)
    assert truck["f"] == 3 and truck["h"] == 180
    assert out["queues"][0] == [0, 0, 0, 1, 1, 1]    # the stopped truck is counted on approach 0
    json.dumps(out)
