"""The real Victor Harbor baseline network (slow: builds from S-E01 + S-D05)."""
import csv
import subprocess
import xml.etree.ElementTree as ET

import pytest

from vhsim.network import places
from vhsim.network.build import EDGE_COLUMNS, fringe_nodes
from vhsim.network.checks import check_roundabouts, drivable_edges
from vhsim.network.junctions import SPECS
from vhsim.paths import sumo_bin

pytestmark = pytest.mark.slow

VCLASSES = ("passenger", "truck", "trailer", "delivery", "bus")


def _rows(path):
    with open(path, newline="") as f:
        return list(csv.DictReader(f))


# ---- outputs -------------------------------------------------------------------------------

def test_outputs_exist_and_plain_files_are_small(baseline):
    d = baseline["dir"]
    for name in ("baseline.net.xml", "edge_attributes.csv", "junctions.csv", "build_report.json",
                 "gateway_edges.csv"):
        assert (d / name).exists(), name
    plain = d / "baseline.plain"
    for kind in ("nod", "edg", "con", "typ"):
        assert (plain / f"baseline.{kind}.xml").exists(), kind
    assert sum(p.stat().st_size for p in plain.iterdir()) < 5_000_000


def test_committed_outputs_are_reproducible_text(baseline):
    """No timestamps or temporary paths in the committed files, so rebuilds give clean diffs."""
    d = baseline["dir"]
    files = list((d / "baseline.plain").iterdir()) + [d / n for n in ("edge_attributes.csv", "junctions.csv",
                                                                         "gateway_edges.csv", "build_report.json")]
    assert {p.suffix for p in (d / "baseline.plain").iterdir()} == {".xml"}
    for p in files:
        text = p.read_text()
        assert "generated on" not in text, p.name
        assert "vhsim-net-" not in text and str(d) not in text, p.name


# ---- requirement 1: classes, dropped ways, no traffic lights ------------------------------

def test_lefthand_and_no_traffic_lights(baseline, baseline_net):
    root = ET.parse(baseline["net"]).getroot()
    assert root.get("lefthand") == "true"
    assert root.find("tlLogic") is None
    assert not [n for n in baseline_net.getNodes() if "traffic_light" in n.getType()]


def test_all_edges_carry_the_model_vehicle_classes(baseline_net):
    for e in baseline_net.getEdges():
        for vc in VCLASSES:
            assert e.allows(vc), (e.getID(), vc)


def test_no_footways_cycleways_paths_or_tracks(baseline_net):
    bad = {"highway.footway", "highway.cycleway", "highway.path", "highway.pedestrian", "highway.steps",
           "highway.track", "highway.bridleway", "highway.construction", "highway.proposed"}
    assert not {e.getType() for e in baseline_net.getEdges()} & bad


# ---- requirement 2: speeds ------------------------------------------------------------------

def test_edge_attributes_contract(baseline, baseline_net):
    rows = _rows(baseline["dir"] / "edge_attributes.csv")
    assert list(rows[0].keys()) == EDGE_COLUMNS
    assert {r["edge_id"] for r in rows} == {e.getID() for e in baseline_net.getEdges()}
    assert {r["speed_source"] for r in rows} <= {"S-D05", "OSM", "default", "roundabout"}
    assert {r["lanes_source"] for r in rows} <= {"OSM", "default"}
    for r in rows:
        e = baseline_net.getEdge(r["edge_id"])
        assert float(r["speed_kmh"]) == pytest.approx(e.getSpeed() * 3.6, abs=0.1)
        assert int(r["lanes"]) == e.getLaneNumber()


def test_torrens_street_uses_dit_50_not_osm_60(baseline):
    rows = [r for r in _rows(baseline["dir"] / "edge_attributes.csv") if r["street_name"] == "Torrens Street"]
    assert rows
    for r in rows:
        assert r["speed_source"] == "S-D05" and float(r["speed_kmh"]) == 50, r
    assert any(r["osm_maxspeed"] == "60" for r in rows)


@pytest.mark.parametrize("street,speeds", [
    ("Adelaide Road", {60}), ("Port Elliot Road", {60}), ("Victoria Street", {50, 60}),
    ("Hindmarsh Road", {50, 60}), ("Victor Harbor Road", {60, 80, 100}), ("George Main Road", {60})])
def test_state_roads_take_dit_limits(baseline, street, speeds):
    rows = [r for r in _rows(baseline["dir"] / "edge_attributes.csv")
            if r["street_name"] == street and r["speed_source"] == "S-D05"]
    assert rows
    assert {round(float(r["speed_kmh"])) for r in rows} <= speeds


def test_untagged_council_roads_default_to_50(baseline):
    rows = _rows(baseline["dir"] / "edge_attributes.csv")
    d = [r for r in rows if r["speed_source"] == "default" and r["highway"] != "service"]
    assert d and all(float(r["speed_kmh"]) == 50 for r in d)


# ---- requirement 4: roundabouts -------------------------------------------------------------

def test_every_osm_roundabout_imports_completely(baseline, baseline_net):
    checks = check_roundabouts(baseline["net"])
    bad = [(round(c.lat, 4), round(c.lon, 4), c.problems) for c in checks if not c.complete]
    assert not bad
    # every OSM junction=roundabout way (S-E01) is inside one SUMO roundabout
    from vhsim.network.config import active_extract
    rb_ways = set()
    for w in ET.parse(active_extract().path).getroot().iter("way"):
        tags = {t.get("k"): t.get("v") for t in w.iter("tag")}
        if "highway" in tags and tags.get("junction") in ("roundabout", "circular"):
            rb_ways.add(w.get("id"))
    covered = set()
    for c in checks:
        for eid in c.edges:
            covered.add(eid.split("#")[0].lstrip("-"))
    assert rb_ways <= covered, sorted(rb_ways - covered)


def test_named_roundabouts_have_all_their_approaches(baseline, baseline_net):
    rows = {r["junction_id"]: r for r in _rows(baseline["dir"] / "junctions.csv")}
    checks = check_roundabouts(baseline["net"])
    by_nodes = {frozenset(c.nodes): c for c in checks}
    for spec in SPECS:
        if spec.expected != "roundabout":
            continue
        row = rows[spec.junction_id]
        c = by_nodes[frozenset(row["sumo_nodes"].split())]
        assert c.complete and c.clockwise, (spec.junction_id, c.problems)
        assert c.approaches >= len(spec.streets), spec.junction_id
        # circulating speed from the ring radius (A-S1-05): plausible for single-lane town roundabouts
        speeds = {round(baseline_net.getEdge(e).getSpeed() * 3.6) for e in c.edges}
        assert all(15 <= v <= 35 for v in speeds), (spec.junction_id, c.radius_m, speeds)


# ---- requirement 5: connectivity ------------------------------------------------------------

@pytest.mark.parametrize("vclass", ["passenger", "truck", "trailer"])
def test_network_is_strongly_connected_for(baseline_net, vclass):
    keep = drivable_edges(baseline_net, vclass, fringe_nodes(baseline_net))
    assert keep == {e.getID() for e in baseline_net.getEdges()}


def test_only_boundary_stubs_lie_outside_the_inner_component(baseline_net):
    """Every edge not touching the extract boundary is in the inner strongly connected component,
    so any origin and destination S2 maps by lon/lat can reach each other inside the model."""
    from vhsim.network.checks import largest_scc
    fr = fringe_nodes(baseline_net)
    inner = largest_scc(baseline_net, "passenger")
    outside = [e.getID() for e in baseline_net.getEdges() if e.getID() not in inner
               and e.getFromNode().getID() not in fr and e.getToNode().getID() not in fr]
    assert len(outside) <= 6, outside   # short slip/service stubs at the Victor Harbor Rd / Waterport Rd junction


def test_gateway_edges_resolve(baseline, baseline_net):
    from vhsim.network.config import active_extract
    rows = {r["gateway"]: r for r in _rows(baseline["dir"] / "gateway_edges.csv")}
    for gid in places.REQUIRED_GATEWAYS:
        r = rows[gid]
        assert baseline_net.hasEdge(r["in_edge"]) and baseline_net.hasEdge(r["out_edge"]), gid
    same = rows["hindmarsh_tiers_rd"]["in_edge"] == rows["victor_harbor_rd_north"]["in_edge"]
    if active_extract().source_id == "S-E01":
        assert same     # Hindmarsh Tiers Rd joins Victor Harbor Rd north of S-E01: same gateway edges
    else:
        assert not same and baseline_net.getEdge(rows["hindmarsh_tiers_rd"]["in_edge"]).getName() == "Hindmarsh Tiers Road"


def _route_all(net_path, trips_xml, tmp_path, name):
    trips = tmp_path / f"{name}.trips.xml"
    trips.write_text(trips_xml)
    routes = tmp_path / f"{name}.rou.xml"
    res = subprocess.run([sumo_bin("duarouter"), "-n", str(net_path), "--route-files", str(trips),
                          "-o", str(routes), "--no-step-log", "true", "--ignore-errors", "true"],
                         capture_output=True, text=True)
    routed = {v.get("id") for v in ET.parse(routes).getroot().iter("vehicle")}
    return routed, res.stderr


def test_cars_and_trucks_route_between_gateways_and_town_centre(baseline, tmp_path):
    rows = {r["gateway"]: r for r in _rows(baseline["dir"] / "gateway_edges.csv") if r["in_edge"] and r["out_edge"]}
    lon, lat = places.TOWN_CENTRE
    vtypes = '<vType id="car" vClass="passenger"/><vType id="truck" vClass="truck"/><vType id="caravan" vClass="trailer"/>'
    trips, want = [], set()
    for gid, r in rows.items():
        for vt in ("car", "truck", "caravan"):
            trips.append(f'<trip id="in_{gid}_{vt}" type="{vt}" depart="0" from="{r["in_edge"]}" toLonLat="{lon},{lat}"/>')
            trips.append(f'<trip id="out_{gid}_{vt}" type="{vt}" depart="0" fromLonLat="{lon},{lat}" to="{r["out_edge"]}"/>')
            want |= {f"in_{gid}_{vt}", f"out_{gid}_{vt}"}
    for a, ra in rows.items():
        for b, rb in rows.items():
            if ra["in_edge"] != rb["in_edge"]:
                trips.append(f'<trip id="thr_{a}_{b}" type="truck" depart="0" from="{ra["in_edge"]}" to="{rb["out_edge"]}"/>')
                want.add(f"thr_{a}_{b}")
    routed, err = _route_all(baseline["net"], "<routes>" + vtypes + "".join(trips) + "</routes>", tmp_path, "gw")
    assert want <= routed, (sorted(want - routed), err[-2000:])


def test_every_suburb_routes_to_and_from_town_centre(baseline, tmp_path):
    clon, clat = places.TOWN_CENTRE
    trips, want = [], set()
    for sub, (lon, lat) in places.SUBURB_POINTS.items():
        key = sub.replace(" ", "_")
        trips.append(f'<trip id="to_{key}" depart="0" fromLonLat="{lon},{lat}" toLonLat="{clon},{clat}"/>')
        trips.append(f'<trip id="from_{key}" depart="0" fromLonLat="{clon},{clat}" toLonLat="{lon},{lat}"/>')
        want |= {f"to_{key}", f"from_{key}"}
    routed, err = _route_all(baseline["net"], "<routes>" + "".join(trips) + "</routes>", tmp_path, "sub")
    assert want <= routed, (sorted(want - routed), err[-2000:])


# ---- requirement 6: named junctions ---------------------------------------------------------

REQUIRED = ["torrens_victoria_wills", "torrens_crozier", "torrens_eyre_seaview_hindmarsh", "bay_victoria_georgemain",
            "esplanade_king", "adelaide_hindmarsh_portelliot", "torrens_coral", "torrens_hill", "torrens_ocean",
            "torrens_stuart", "victoria_burke", "victoria_king", "victoria_island", "victoria_granite",
            "crozier_acraman_lindsay", "seaview_acraman_carlyle",
            # ring road (Armstrong Rd / Welch Rd)
            "armstrong_georgemain_inmanvalley", "armstrong_crozier", "armstrong_greenhills", "armstrong_welch_waggon"]


def test_junctions_csv_has_every_named_junction_with_expected_control(baseline, baseline_net):
    from vhsim.network.config import active_extract
    rows = {r["junction_id"]: r for r in _rows(baseline["dir"] / "junctions.csv")}
    assert set(REQUIRED) <= set(rows)
    for spec in SPECS:
        r = rows[spec.junction_id]
        assert r["control"] == spec.expected, (spec.junction_id, r["control"])
        nodes = r["sumo_nodes"].split()
        assert nodes and all(baseline_net.getNode(n) for n in nodes)
        names = {e.getName() for n in nodes for e in baseline_net.getNode(n).getIncoming() + baseline_net.getNode(n).getOutgoing()}
        assert set(spec.streets) <= names, spec.junction_id
        assert int(r["legs"]) >= len(spec.streets), spec.junction_id
        south, west, north, east = active_extract().bbox
        assert south < float(r["lat"]) < north and west < float(r["lon"]) < east


def test_every_osm_turn_restriction_is_enforced(baseline_net):
    from vhsim.network.config import active_extract
    from vhsim.network.restrictions import banned_movements, violations

    banned, unresolved = banned_movements(active_extract().path, baseline_net)
    assert not unresolved
    assert len(banned) >= 16      # 16 in S-E01
    assert violations(baseline_net, banned) == []


@pytest.mark.parametrize("rel,frm,to", [("17070777", "1242247850", "1242247846"),
                                        ("17070778", "1242247846", "1242247850"),
                                        ("17070779", "1242247854#1", "1242247852"),
                                        ("17070780", "1242247852", "1242247854#0")])
def test_victoria_street_median_openings_ban_uturns(baseline_net, rel, frm, to):
    """OSM no_right_turn relations 17070777-80 ban turning into a median opening from one
    carriageway. With both carriageways joined into one junction the opening disappears and
    netconvert built a U-turn instead; the build deletes it again."""
    assert baseline_net.getEdge(frm).getName() == baseline_net.getEdge(to).getName() == "Victoria Street"
    assert baseline_net.getEdge(to) not in baseline_net.getEdge(frm).getOutgoing()


def test_right_turn_from_torrens_street_into_ocean_street_exists(baseline_net, tmp_path):
    """S-D19 s3: ~700 vehicles/day turn right from Torrens St into Ocean St (a ~50 m right-turn
    lane). OSM has no median opening there, so the build adds one (baseline fix F1)."""
    ocean = baseline_net.getEdge("60269598#0")
    link = [e for e in ocean.getIncoming() if e.getID().startswith("vhfix_")]
    assert len(link) == 1
    link = link[0]
    assert set(o.getID() for o in link.getOutgoing()) == {"60269598#0"}    # only into Ocean St
    feeders = [e for e in link.getIncoming() if e.getName() == "Torrens Street"]
    assert feeders and all(c.getDirection() in ("r", "R") for e in feeders for c in e.getOutgoing()[link])


def test_priority_junctions_give_torrens_street_priority(baseline):
    rows = {r["junction_id"]: r for r in _rows(baseline["dir"] / "junctions.csv")}
    for jid in ("torrens_coral", "torrens_hill", "torrens_ocean", "torrens_stuart"):
        assert rows[jid]["major_road"] == "Torrens Street", jid


# ---- requirement 7: scenario patches on the baseline -----------------------------------------

def test_test_scenario_changes_one_named_edge_speed(baseline, baseline_net, tmp_path):
    from vhsim.network import scenario
    from vhsim.network.config import NETWORKS

    patches = NETWORKS / "patches" / "test_torrens_40"
    [edge_id] = [el.get("id") for el in ET.parse(next(patches.glob("*.edg.xml"))).getroot().iter("edge")]
    assert baseline_net.getEdge(edge_id).getName() == "Torrens Street"
    out = scenario.build("test_torrens_40", patches, base_dir=baseline["dir"] / "baseline.plain", out_dir=tmp_path)
    import sumolib
    net = sumolib.net.readNet(str(out))
    assert net.getEdge(edge_id).getSpeed() * 3.6 == pytest.approx(40, abs=0.1)
    changed = [e.getID() for e in baseline_net.getEdges()
               if abs(net.getEdge(e.getID()).getSpeed() - e.getSpeed()) > 1e-6]
    assert changed == [edge_id]


def test_baseline_rebuilt_from_plain_matches(baseline, baseline_net, tmp_path):
    from vhsim.network import scenario
    out = scenario.build("again", None, base_dir=baseline["dir"] / "baseline.plain", out_dir=tmp_path)
    import sumolib
    net = sumolib.net.readNet(str(out))
    assert {e.getID() for e in net.getEdges()} == {e.getID() for e in baseline_net.getEdges()}
    assert len(net.getRoundabouts()) == len(baseline_net.getRoundabouts())


# ---- requirement 8: smoke simulation -------------------------------------------------------------

def test_smoke_simulation_has_no_roundabout_deadlocks(baseline, tmp_path):
    from vhsim.network.smoke import run_smoke

    res = run_smoke(baseline["net"], tmp_path, n_trips=400, seed=42)
    assert res["inserted"] >= 350
    assert res["arrived"] >= 0.95 * res["inserted"]
    assert res["teleports_jam_at_roundabouts"] == 0, res
    assert res["teleports_total"] <= 2, res


def test_town_centre_smoke_simulation_runs_clean(baseline, tmp_path):
    """1,500 trips/h concentrated on the town centre and gateways: no teleports at all."""
    from vhsim.network.smoke import run_smoke

    res = run_smoke(baseline["net"], tmp_path, n_trips=1500, seed=7, mode="town")
    assert res["arrived"] == res["inserted"] == 1500
    assert res["teleports_total"] == 0, res["teleport_locations"]


# ---- northern extension (S-S1-01) -----------------------------------------------------------------

def _needs_supplement():
    from vhsim.network.config import active_extract
    if active_extract().source_id != "S-S1-01":
        pytest.skip("S-S1-01 not fetched (python -m vhsim.network.fetch_osm); baseline built from S-E01")


NORTHERN_ROADS = ["Hutchinson Road", "Hindmarsh Tiers Road", "Waggon Road", "Day Road", "Greenhills Road",
                  "Victor Harbor Road", "Waterport Road", "Welch Road"]


def test_northern_roads_route_to_and_from_town_centre(baseline, baseline_net, tmp_path):
    _needs_supplement()
    from vhsim.network.checks import largest_scc
    inner = largest_scc(baseline_net, "passenger")
    clon, clat = places.TOWN_CENTRE
    trips, want = [], set()
    for road in NORTHERN_ROADS:
        # the road's northernmost connected edge (Day Rd lies wholly south of -35.52, so no fixed cut-off)
        named = [e for e in baseline_net.getEdges() if e.getName() == road and e.getID() in inner]
        assert named, f"{road}: not in the connected network"
        e = max(named, key=lambda e: baseline_net.convertXY2LonLat(*e.getFromNode().getCoord())[1])
        key = road.replace(" ", "_")
        trips.append(f'<trip id="to_{key}" depart="0" from="{e.getID()}" toLonLat="{clon},{clat}"/>')
        trips.append(f'<trip id="from_{key}" depart="0" fromLonLat="{clon},{clat}" to="{e.getID()}"/>')
        want |= {f"to_{key}", f"from_{key}"}
    routed, err = _route_all(baseline["net"], "<routes>" + "".join(trips) + "</routes>", tmp_path, "north")
    assert want <= routed, (sorted(want - routed), err[-2000:])


def test_ring_road_reaches_victor_harbor_road(baseline, baseline_net, tmp_path):
    """With the extract extended north, Welch Rd meets Victor Harbor Rd inside the model, so a truck
    from Victor Harbor Rd north to Inman Valley Rd can take the ring road (Welch Rd / Armstrong Rd)."""
    _needs_supplement()
    rows = {r["gateway"]: r for r in _rows(baseline["dir"] / "gateway_edges.csv")}
    trip = (f'<routes><vType id="truck" vClass="truck"/><trip id="ring" type="truck" depart="0" '
            f'from="{rows["victor_harbor_rd_north"]["in_edge"]}" to="{rows["inman_valley_rd_west"]["out_edge"]}"/></routes>')
    routed, err = _route_all(baseline["net"], trip, tmp_path, "ring")
    assert "ring" in routed, err[-2000:]
    route = next(ET.parse(tmp_path / "ring.rou.xml").getroot().iter("route")).get("edges").split()
    names = {baseline_net.getEdge(e).getName() for e in route}
    assert {"Welch Road", "Armstrong Road"} <= names, names
