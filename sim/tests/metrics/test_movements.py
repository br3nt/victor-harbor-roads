import random

import pytest

from vhsim.metrics import movements as mv
from vhsim.metrics import run


# ---------- pure geometry ----------
@pytest.mark.parametrize("deg,name", [(0, "N"), (22.4, "N"), (22.6, "NE"), (90, "E"), (135, "SE"), (180, "S"),
                                      (225, "SW"), (270, "W"), (315, "NW"), (350, "N"), (-90, "W")])
def test_compass(deg, name):
    assert mv.compass(deg) == name


def test_bearing_is_clockwise_from_north():
    assert mv.bearing((0, 0), (0, 1)) == pytest.approx(0)
    assert mv.bearing((0, 0), (1, 0)) == pytest.approx(90)
    assert mv.bearing((0, 0), (0, -1)) == pytest.approx(180)
    assert mv.bearing((0, 0), (-1, 0)) == pytest.approx(270)


@pytest.mark.parametrize("a,t", [(0, "T"), (29.9, "T"), (-29.9, "T"), (30, "R"), (-30, "L"), (90, "R"), (-90, "L"),
                                 (149.9, "R"), (-149.9, "L"), (150, "U"), (-150, "U"), (180, "U")])
def test_turn_type_thresholds(a, t):
    assert mv.turn_type(a) == t


def test_signed_turn_wraps():
    assert mv.signed_turn(350, 10) == pytest.approx(20)
    assert mv.signed_turn(10, 350) == pytest.approx(-20)
    assert mv.signed_turn(90, 270) == pytest.approx(180)


def test_labels_on_known_crossing(cross_net):
    lab = mv.labels(cross_net).set_index(["from_edge", "to_edge"])
    # from the west (heading east): straight to XE, left (north) to XN, right (south) to XS, U-turn to XW
    expect = {("WX", "XE"): "T", ("WX", "XN"): "L", ("WX", "XS"): "R", ("WX", "XW"): "U",
              ("SX", "XN"): "T", ("SX", "XW"): "L", ("SX", "XE"): "R", ("SX", "XS"): "U",
              ("EX", "XW"): "T", ("EX", "XS"): "L", ("EX", "XN"): "R",
              ("NX", "XS"): "T", ("NX", "XE"): "L", ("NX", "XW"): "R"}
    for k, t in expect.items():
        assert lab.loc[k, "turn"] == t, k
    assert lab.loc[("WX", "XE"), "approach_dir"] == "W" and lab.loc[("WX", "XE"), "heading_dir"] == "E"
    assert lab.loc[("SX", "XN"), "approach_dir"] == "S" and lab.loc[("SX", "XN"), "heading_dir"] == "N"
    assert lab.loc[("NX", "XS"), "approach_dir"] == "N"
    assert (lab.junction_id == "X").all() or set(lab.junction_id) >= {"X"}


# ---------- hand-computed delay on synthetic vehroute ----------
def write_vehroute(path, vehicles):
    out = ["<routes>"]
    for vid, depart, edges, exits in vehicles:
        out.append(f'<vehicle id="{vid}" depart="{depart}" arrival="{exits[-1]}">'
                   f'<route edges="{" ".join(edges)}" exitTimes="{" ".join(map(str, exits))}"/></vehicle>')
    out.append("</routes>")
    path.write_text("\n".join(out))
    return path


def edge_free_time(net_path, eid):
    e = mv.read_net_edges(net_path)[eid]
    return e["length"] / e["speed"]


def test_delay_hand_computed(cross_net, tmp_path):
    ff = edge_free_time(cross_net, "WX")
    # vehicle: first edge Win0 exits at 100 (excluded), WX exits at 100+ff+10 -> delay 10, then XE, then end edge
    r = []
    for i, extra in enumerate([10, 20, 30, 40, 50]):
        t0 = 8 * 3600 + 100 * i
        r.append((f"v{i}", t0, ["Win0", "WX", "XE", "Eout0"], [t0 + 20, t0 + 20 + ff + extra, t0 + 60 + ff + extra,
                                                             t0 + 100 + ff + extra]))
    df = mv.table(write_vehroute(tmp_path / "vr.xml", r), cross_net)
    row = df[(df.from_edge == "WX") & (df.to_edge == "XE") & (df.hour_band == "06-09")].iloc[0]
    assert row.n == 5 and row.mean_delay == pytest.approx(30.0, abs=1e-6)
    assert row.median_delay == pytest.approx(30.0)
    assert row.p95_delay == pytest.approx(48.0)          # numpy linear: 40 + .8 * 10 = 48
    assert row.flow_per_hour == pytest.approx(5 / 3)     # 3 h band
    assert (row.junction_id, row.approach_dir, row.heading_dir, row.turn) == ("X", "W", "E", "T")
    allrow = df[(df.from_edge == "WX") & (df.hour_band == "all")].iloc[0]
    assert allrow.n == 5 and allrow.flow_per_hour == pytest.approx(5 / 24)


def test_first_and_last_edges_excluded_and_internal_ignored(cross_net, tmp_path):
    r = [("a", 0, ["WX", "XE"], [50, 90]),                       # WX is first: no approach delay
         ("b", 0, ["Win0", "WX"], [20, 60]),                     # WX is last: no onward movement
         ("c", 0, ["Win0", ":X_0", "XE"], [20, 25, 60]),          # internal edge in route: ignored
         ("d", 0, ["Win0", "Nout0", "XE"], [20, 40, 60])]         # non-adjacent pair: ignored
    df = mv.table(write_vehroute(tmp_path / "vr.xml", r), cross_net)
    assert df.empty or not ((df.from_edge == "WX") & (df.n > 0)).any()


def test_hour_bands_split_by_exit_time(cross_net, tmp_path):
    ff = edge_free_time(cross_net, "WX")
    r = [("a", 0, ["Win0", "WX", "XE"], [10, 10 + ff, 100]),                       # exits WX at ~ 0 h -> 00-06
         ("b", 8 * 3600, ["Win0", "WX", "XE"], [8 * 3600 + 10, 8 * 3600 + 10 + ff + 5, 8 * 3600 + 100])]
    df = mv.table(write_vehroute(tmp_path / "vr.xml", r), cross_net)
    bands = df[df.from_edge == "WX"].set_index("hour_band")
    assert bands.loc["00-06", "n"] == 1 and bands.loc["06-09", "n"] == 1
    assert bands.loc["06-09", "mean_delay"] == pytest.approx(5, abs=1e-6)
    assert bands.loc["all", "n"] == 2


def test_u_turn_detected_from_vehroute(cross_net, tmp_path):
    r = [("u", 0, ["Win0", "WX", "XW", "Wout0"], [10, 40, 80, 100])]
    df = mv.table(write_vehroute(tmp_path / "vr.xml", r), cross_net)
    assert df[(df.from_edge == "WX") & (df.to_edge == "XW")].iloc[0].turn == "U"


# ---------- real simulation: forced conflict ----------
def test_minor_approach_waits_more_than_major(cross_net, tmp_path):
    rng = random.Random(7)
    trips = []
    # heavy major stream W -> E (about 900 veh/h) plus a crossing minor stream S -> N (about 240 veh/h)
    t = 0.0
    while t < 1200:
        t += rng.expovariate(900 / 3600)
        trips.append(f'<trip id="res~Z~c~p~{len(trips):06d}" depart="{t:.1f}" from="Win0" to="Eout0" type="car"/>')
    t = 0.0
    while t < 1200:
        t += rng.expovariate(240 / 3600)
        trips.append(f'<trip id="res~Z~c~p~{len(trips):06d}" depart="{t:.1f}" from="Sin0" to="Nout0" type="car"/>')
    f = tmp_path / "t.xml"
    f.write_text('<routes><vType id="car" vClass="passenger"/>' + "".join(trips) + "</routes>")
    res = run.simulate(cross_net, f, tmp_path / "out", seed=2, end=2400)
    df = mv.table(res.paths["vehroute"], cross_net, hour_bands={"day": (0, 24)}, include_all=False)
    major = df[(df.from_edge == "WX") & (df.to_edge == "XE")].iloc[0]
    minor = df[(df.from_edge == "SX") & (df.to_edge == "XN")].iloc[0]
    assert major.n > 100 and minor.n > 30
    assert minor.mean_delay > major.mean_delay + 2.0
    assert minor.p95_delay > major.p95_delay
    assert (minor.turn, major.turn) == ("T", "T")
    assert (minor.approach_dir, major.approach_dir) == ("S", "W")


# ---------- performance ----------
@pytest.mark.slow
def test_200k_trips_well_under_a_minute(cross_net, tmp_path):
    import time
    rng = random.Random(1)
    paths = [["Win0", "WX", "XE", "Eout0"], ["Sin0", "SX", "XN", "Nout0"], ["Ein0", "EX", "XW", "Wout0"],
             ["Nin0", "NX", "XS", "Sout0"], ["Win0", "WX", "XN", "Nout0"]]
    p = tmp_path / "big.vehroute.xml"
    with open(p, "w") as fh:
        fh.write("<routes>\n")
        for i in range(200_000):
            es = paths[i % len(paths)]
            t = rng.uniform(0, 86000)
            ex = [t + 20, t + 55 + rng.random() * 10, t + 90, t + 120]
            fh.write(f'<vehicle id="res~Z~c~p~{i:06d}" depart="{t:.2f}" arrival="{ex[-1]:.2f}">'
                     f'<route edges="{" ".join(es)}" exitTimes="{" ".join(f"{x:.2f}" for x in ex)}"/></vehicle>\n')
        fh.write("</routes>\n")
    t0 = time.time()
    df = mv.table(p, cross_net)
    dt = time.time() - t0
    assert dt < 30, dt
    assert df[df.hour_band == "all"].n.sum() == 400_000
