"""S8 hotspot evidence: area membership, per-vehicle approach waits, queues from laneData, run status."""
import json

import pytest

from vhsim.integration import hotspot_defs as hd
from vhsim.integration import hotspots as hs

# Two-lane-free toy net in plain metres (projParameter "!": lon/lat == x/y). A -> B -> C along x, D -> B from
# the south, C -> E a ring edge of a roundabout.
NET = """<?xml version="1.0"?>
<net version="1.20">
    <location netOffset="0.00,0.00" convBoundary="0,0,300,100" origBoundary="0,0,300,100" projParameter="!"/>
    <edge id=":B_0" function="internal"><lane id=":B_0_0" index="0" speed="10" length="5" shape="100,0 105,0"/></edge>
    <edge id="AB" from="A" to="B" name="Main Street"><lane id="AB_0" index="0" speed="10.00" length="100.00" shape="0,0 100,0"/></edge>
    <edge id="AB.bay" from="AB.mid" to="B" name="Main Street"><lane id="AB.bay_0" index="0" speed="10.00" length="20.00" shape="80,0 100,0"/><lane id="AB.bay_1" index="1" speed="10.00" length="20.00" shape="80,3 100,3"/></edge>
    <edge id="DB" from="D" to="B" name="Side Street"><lane id="DB_0" index="0" speed="10.00" length="100.00" shape="100,-100 100,0"/></edge>
    <edge id="BC" from="B" to="C" name="Main Street"><lane id="BC_0" index="0" speed="10.00" length="100.00" shape="100,0 200,0"/></edge>
    <edge id="CE" from="C" to="E" name=""><lane id="CE_0" index="0" speed="5.00" length="50.00" shape="200,0 250,0"/></edge>
    <roundabout nodes="C E" edges="CE"/>
</net>
"""

VEHROUTE = """<routes>
    <vehicle id="v1" type="car" depart="0.00" arrival="40.00">
        <route edges="AB BC CE" exitTimes="12.00 32.00 40.00"/>
    </vehicle>
    <vehicle id="v2" type="truck" depart="5.00" arrival="60.00">
        <routeDistribution>
            <route replacedOnEdge="DB" edges="DB BC" replacedAtTime="6"/>
            <route edges="X DB BC CE" exitTimes="6.00 40.00 55.00 60.00"/>
        </routeDistribution>
    </vehicle>
    <vehicle id="v3" type="caravan" depart="10.00" arrival="50.00">
        <route edges="DB BC" exitTimes="20.00 50.00"/>
    </vehicle>
</routes>
"""

LANEDATA = """<meandata>
    <interval begin="0.00" end="900.00" id="viewer_lanes">
        <edge id="DB"><lane id="DB_0" waitingTime="450.00"/></edge>
        <edge id="AB.bay"><lane id="AB.bay_0" waitingTime="90.00"/><lane id="AB.bay_1" waitingTime="0.00"/></edge>
        <edge id="ZZ"><lane id="ZZ_0" waitingTime="9000.00"/></edge>
    </interval>
    <interval begin="900.00" end="1800.00" id="viewer_lanes">
        <edge id="DB"><lane id="DB_0" waitingTime="1800.00"/></edge>
    </interval>
</meandata>
"""


@pytest.fixture
def net(tmp_path):
    p = tmp_path / "toy.net.xml"
    p.write_text(NET)
    return p


def test_read_edges_skips_internal_and_marks_roundabout(net):
    e = hs.read_edges(net)
    assert ":B_0" not in e
    assert e["AB"]["end"] == (100.0, 0.0)
    assert e["AB"]["free"] == pytest.approx(10.0)
    assert e["AB.bay"]["lanes"] == ["AB.bay_0", "AB.bay_1"]
    assert e["CE"]["roundabout"] and not e["AB"]["roundabout"]


def test_area_edges_by_stop_line_circle(net):
    e = hs.read_edges(net)
    geo = hs.NetGeo(net)
    # circle of 10 m round B: edges ending at B (incl. the bay), not BC (ends at C)
    assert hs.area_edges(e, geo, {"circles": [(100, 0, 10)]}) == {"AB", "AB.bay", "DB"}


def test_area_edges_by_street_and_longitude(net):
    e = hs.read_edges(net)
    geo = hs.NetGeo(net)
    # nodes on "Main Street" with x in 150..250: only C; edges ending at C
    assert hs.area_edges(e, geo, {"street": {"name": "Main Street", "lon": (150, 250)}}) == {"BC"}


def test_approach_group_labels_street_and_side_it_comes_from(net):
    e = hs.read_edges(net)
    assert hs.approach_group(e["AB"]) == ("Main Street", "W")      # driving east: arrives from the west
    assert hs.approach_group(e["AB.bay"]) == ("Main Street", "W")  # the bay merges into its approach
    assert hs.approach_group(e["DB"]) == ("Side Street", "S")
    assert hs.approach_group(e["CE"]) == ("roundabout", "W")


def test_split_approach_is_one_group_named_by_its_stop_line_edge():
    # an angled upstream piece (driving north-east) feeding a bay that turns east into the junction: the node
    # between them has no other way out, so both are one approach, named by the bay (from the west)
    edges = {
        "UP": dict(name="Crozier Road", frm="U", to="M", end=(80.0, 0.0), last=((50.0, -50.0), (80.0, 0.0)),
                   roundabout=False),
        "UP.bay": dict(name="Crozier Road", frm="M", to="B", end=(100.0, 0.0), last=((80.0, 0.0), (100.0, 0.0)),
                       roundabout=False),
        "OUT": dict(name="Crozier Road", frm="B", to="C", end=(150.0, 0.0), last=((100.0, 0.0), (150.0, 0.0)),
                    roundabout=False),
        "SIDE": dict(name="Side Street", frm="B", to="D", end=(100.0, 50.0), last=((100.0, 0.0), (100.0, 50.0)),
                     roundabout=False),
    }
    assert hs.approach_group(edges["UP"]) != hs.approach_group(edges["UP.bay"])     # the problem
    g = hs.approach_groups(edges, {"UP", "UP.bay", "OUT", "SIDE"})
    assert g["UP"] == g["UP.bay"] == ("Crozier Road", "W")
    # B has two ways out, so UP.bay is not merged into OUT
    assert g["OUT"] == ("Crozier Road", "W") and g["SIDE"] == ("Side Street", "S")
    # and the merged wait is per vehicle the sum over both pieces
    import pandas as pd
    trav = pd.DataFrame({"veh": ["v", "v"], "vtype": ["car", "car"], "edge": ["UP", "UP.bay"], "t_exit": [10.0, 20.0],
                         "delay": [12.0, 5.0], "seed": [1, 1]})
    lanes = pd.DataFrame({"edge": ["UP"], "t": [0.0], "wait_s": [360.0], "seed": [1]})
    s = hs.summarise({"UP", "UP.bay"}, edges, [trav], [lanes], pd.DataFrame(columns=["hid", "veh", "vtype", "t_in", "t_out", "free"]),
                     hid="h", groups={e: (*g[e], "") for e in ("UP", "UP.bay")})
    (a,) = s["approaches"]
    assert a["mean_wait_s"] == 17.0 and a["veh_per_day"] == 1


def test_traversals_delay_and_passes(net, tmp_path):
    vr = tmp_path / "vehroute.xml"
    vr.write_text(VEHROUTE)
    e = hs.read_edges(net)
    member = {"AB": ["h"], "AB.bay": ["h"], "DB": ["h"], "BC": ["h", "k"]}
    trav, passes = hs.traversals(vr, e, member)
    # v1's first edge (AB) is its insertion edge: no delay counted; BC took 20 s, free 10 -> delay 10
    v1 = trav[trav.veh == "v1"]
    assert list(v1.edge) == ["BC"] and v1.delay.iloc[0] == pytest.approx(10.0)
    # v2 rerouted: the route with exit times is used; DB took 34 s (free 10)
    v2 = trav[(trav.veh == "v2") & (trav.edge == "DB")]
    assert v2.delay.iloc[0] == pytest.approx(24.0) and v2.vtype.iloc[0] == "truck"
    # passes through h: v2 entered DB at 6, left BC at 55 (free 20); v1 started inside h -> no full pass
    p = passes[(passes.hid == "h")]
    assert set(p.veh) == {"v2"}
    row = p.iloc[0]
    assert (row.t_in, row.t_out, row.free) == (6.0, 55.0, pytest.approx(20.0))
    # v3 starts on DB and ends on BC: neither a full pass of h nor of k
    assert "v3" not in set(passes.veh)
    # k = BC only: v1 (12 -> 32) and v2 (40 -> 55) pass
    assert set(passes[passes.hid == "k"].veh) == {"v1", "v2"}


def test_lane_waits_only_member_edges(tmp_path):
    p = tmp_path / "lanes.xml"
    p.write_text(LANEDATA)
    w = hs.lane_waits(p, {"DB", "AB.bay"})
    assert set(w.edge) == {"DB", "AB.bay"}
    assert w[(w.edge == "DB") & (w.t == 900)].wait_s.iloc[0] == 1800.0


def test_summarise_waits_queues_and_peak(net, tmp_path):
    vr = tmp_path / "vehroute.xml"
    vr.write_text(VEHROUTE)
    lp = tmp_path / "lanes.xml"
    lp.write_text(LANEDATA)
    e = hs.read_edges(net)
    edges = {"AB", "AB.bay", "DB", "BC"}
    trav, passes = hs.traversals(vr, e, {x: ["h"] for x in edges})
    lanes = hs.lane_waits(lp, edges)
    s = hs.summarise(edges, e, [trav.assign(seed=1)], [lanes.assign(seed=1)], passes.assign(seed=1), hid="h")
    side = next(a for a in s["approaches"] if a["street"] == "Side Street")
    # v2 (24 s) and v3 (first edge, not counted) -> one vehicle with a wait on DB
    assert side["veh_per_day"] == 1 and side["mean_wait_s"] == pytest.approx(24.0)
    assert side["trucks_per_day"] == 1
    # peak 15 min = 900-1800 (DB 1800 vehicle-seconds stopped -> 2 vehicles queued on average)
    assert s["peak15"]["start"] == "00:15"
    assert side["peak15_queue_veh"] == pytest.approx(2.0)
    assert side["peak15_queue_m"] == pytest.approx(2.0 * hs.QUEUE_SPACING_M)
    assert s["stopped_veh_h"] == pytest.approx((450 + 90 + 1800) / 3600, abs=0.01)
    assert s["through"]["n_per_day"] == 1 and s["through"]["mean_s"] == pytest.approx(49.0)


def test_run_status(tmp_path):
    ok = tmp_path / "ok"
    ok.mkdir()
    (ok / "sumo.log").write_text("$ sumo ...\n")
    (ok / "statistic.xml").write_text('<statistics><vehicles loaded="100" inserted="100" running="0" waiting="0"/>'
                                      '<teleports total="1"/><vehicleTripStatistics count="100"/></statistics>')
    assert hs.run_status(ok) == ("ok", "")
    jam = tmp_path / "jam"
    jam.mkdir()
    (jam / "sumo.log").write_text("$ sumo ...\n--- gave up after 2700 s (VHSIM_SUMO_TIMEOUT): likely gridlock\n")
    assert hs.run_status(jam)[0] == "jammed"
    stopped = tmp_path / "stopped"
    stopped.mkdir()
    assert hs.run_status(stopped)[0] == "jammed"          # no log: stopped by hand (A-INT-05)
    tele = tmp_path / "tele"
    tele.mkdir()
    (tele / "sumo.log").write_text("$ sumo\n")
    (tele / "statistic.xml").write_text('<statistics><vehicles loaded="100" inserted="100"/><teleports total="9"/>'
                                        '<vehicleTripStatistics count="90"/></statistics>')
    assert hs.run_status(tele)[0] == "jammed"             # over the batch's 5% teleport limit


def test_find_runs_ignores_tagged_variants(tmp_path):
    for name in ["n3_bays__summer_peak_2031_high__s1", "n3_bays__summer_peak_2031_high__s2",
                 "n3_bays__summer_peak_2031_high__s1__fcd", "n3_bays__summer_peak_2031_moderate__s1"]:
        (tmp_path / name).mkdir()
    got = hs.find_runs("n3", "summer_peak", 2031, "high", tmp_path)
    assert [s for s, _ in got] == [1, 2]


def test_year_labels_use_this_year():
    assert hd.year_label(2025) == "now (2025 data)"
    assert hd.year_label(2031, "moderate") == "2031 (in about 5 years), moderate growth"
    assert hd.year_label(2041, "high") == "2041 (in about 15 years), high growth"


def test_every_hotspot_has_roles_and_a_place():
    ids = [h["id"] for h in hd.HOTSPOTS]
    assert len(ids) == len(set(ids))
    for h in hd.HOTSPOTS:
        assert h["roles"]["today"] == "baseline" and h["roles"]["council"] == "cp"
        assert h.get("circles") or h.get("street")
        for a in h["animate"]:
            assert len(a["scenarios"]) == 3 and a["scenarios"][0] == "baseline"
        json.dumps(h)


def _entry(approaches):
    return {"seeds": [1], "jammed": False, "stopped_veh_h": 1.0, "mean_wait_s": 5.0, "approaches": approaches}


def _ap(street, site, veh, w):
    return {"street": street, "from_side": "N", "site": site, "veh_per_day": veh, "mean_wait_s": w,
            "p95_wait_s": w * 2, "label": f"{street} ({site})"}


def test_site_checks_give_the_worst_busy_approach_per_site_and_role():
    h = {"id": "x", "roles": {"today": "baseline", "council": "cp", "brent": "bp", "alternative": "n9"},
         "sites": [{"id": "a", "name": "Site A", "circle": (0, 0, 1)}, {"id": "b", "name": "Site B", "circle": (0, 0, 1)}]}
    res = {"baseline": {"summer_peak_2025_base": _entry([_ap("Q St", "a", 500, 9), _ap("R St", "a", 10, 90),
                                                         _ap("S St", "b", 200, 4)])},
           "cp": {"summer_peak_2025_base": _entry([_ap("Q St", "a", 500, 30), _ap("S St", "b", 200, 5)])},
           "bp": {"summer_peak_2025_base": {"seeds": [], "jammed": True, "jammed_seeds": []}}}
    checks = hs.site_checks(h, res, periods=["summer_peak_2025_base"])
    a = next(c for c in checks if c["site"] == "a")
    today = a["periods"]["summer_peak_2025_base"]["baseline"]
    assert today["approach"] == "Q St (a)" and today["mean_wait_s"] == 9      # R St has too few vehicles
    assert a["periods"]["summer_peak_2025_base"]["cp"]["mean_wait_s"] == 30
    assert a["periods"]["summer_peak_2025_base"]["bp"] == {"jammed": True}
    assert a["name"] == "Site A"


def test_doc_keeps_only_the_hotspots_scenarios_and_drops_edge_lists():
    h = hd.BY_ID["lindsay-st"]
    res = {sc: {"summer_peak_2025_base": _entry([{"street": "Lindsay Street", "from_side": "SW", "site": "",
                                                  "veh_per_day": 900, "mean_wait_s": 14.0, "p95_wait_s": 40.0,
                                                  "stopped_veh_h": 1.0, "edges": ["e1"]}])}
           for sc in ["baseline", "cp", "c3", "bp", "n9", "n7", "b4", "n8"]}
    doc = hs.hotspot_doc(h, res)
    assert set(doc["results"]) == {"baseline", "cp", "c3", "bp", "n9", "n7"}
    assert "edges" not in doc["results"]["baseline"]["summer_peak_2025_base"]["approaches"][0]


def test_chart_rows_flatten_each_hotspots_chart():
    doc = {"id": "x", "short": "X", "chart": {"key_approach": "Q St from the north", "periods": ["p1", "p2"],
                                             "period_labels": {"p1": "Summer, now", "p2": "Summer 2031"},
                                             "series": [{"role": "today", "scenario": "baseline", "label": "Today",
                                                         "key_wait_s": {"p1": 14.5}, "stopped_veh_h": {"p1": 5.0},
                                                         "mean_wait_s": {"p1": 3.0}, "jammed": ["p2"]}]}}
    rows = hs.chart_rows({"x": doc})
    assert rows[0] == dict(hotspot="x", hotspot_name="X", key_approach="Q St from the north", role="today",
                           scenario="baseline", scenario_label="Today", period="p1", period_label="Summer, now",
                           key_wait_s=14.5, stopped_veh_h=5.0, jammed=False)
    assert rows[1]["jammed"] is True and rows[1]["key_wait_s"] is None


def test_trimming_keeps_the_top_approaches_of_every_site():
    big = [dict(_ap(f"S{i}", "main", 1000, 5), stopped_veh_h=10.0 - i * 0.1) for i in range(20)]
    small = [dict(_ap("Antrim Street", "Antrim St", 120, 56), stopped_veh_h=0.3)]
    kept = hs.trim_approaches(big + small)
    assert len([a for a in kept if a["site"] == "main"]) == hs.TOP_APPROACHES
    assert any(a["street"] == "Antrim Street" for a in kept)
