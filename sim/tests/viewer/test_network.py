import math

import pytest

LONS = (138.600, 138.602, 138.604)
LATS = (-35.5300, -35.5318, -35.5336)

from vhsim.viewer.network import network_json


@pytest.fixture(scope="module")
def nj(town_net):
    return network_json(town_net, name="town")


def edge_index(nj, eid):
    return nj["edges"]["id"].index(eid)


def lanes_of(nj, eid):
    e = edge_index(nj, eid)
    return [i for i, le in enumerate(nj["lanes"]["edge"]) if le == e]


def test_header(nj):
    assert nj["version"] == 1 and nj["name"] == "town"
    assert nj["lefthand"] is True
    w, s, e, n = nj["bbox"]
    assert w == pytest.approx(LONS[0], abs=0.001) and e == pytest.approx(LONS[2], abs=0.001)
    assert s == pytest.approx(LATS[2], abs=0.001) and n == pytest.approx(LATS[0], abs=0.001)


def test_lanes_columns_and_lonlat_shapes(nj):
    lanes = nj["lanes"]
    n = len(lanes["id"])
    for col in ("id", "edge", "index", "bearing", "name", "speed_kmh", "length", "slot", "shape"):
        assert len(lanes[col]) == n, col
    # Main Rd eastbound has 2 lanes
    main_e = lanes_of(nj, "n10n11")
    assert sorted(lanes["index"][i] for i in main_e) == [0, 1]
    i0 = main_e[0]
    assert lanes["id"][i0].startswith("n10n11_")
    assert lanes["name"][i0] == "Main Rd"
    assert lanes["speed_kmh"][i0] == pytest.approx(60.0, abs=0.1)
    assert lanes["bearing"][i0] == pytest.approx(90, abs=3)       # eastbound
    shape = lanes["shape"][i0]                                     # flat [lon, lat, lon, lat, ...]
    assert len(shape) % 2 == 0 and len(shape) >= 4
    assert LONS[0] - 0.001 < shape[0] < LONS[1] and shape[1] == pytest.approx(LATS[1], abs=0.0002)
    assert lanes["length"][i0] > 100


def test_slots_put_each_direction_on_the_left_in_lefthand_traffic(nj):
    lanes = nj["lanes"]
    east = {lanes["index"][i]: lanes["slot"][i] for i in lanes_of(nj, "n10n11")}
    west = {lanes["index"][i]: lanes["slot"][i] for i in lanes_of(nj, "n11n10")}
    # MapLibre line-offset: positive = right of the line direction. Left-hand traffic -> negative slots,
    # kerb lane (index 0) furthest from the centre line.
    assert all(s < 0 for s in east.values()) and all(s < 0 for s in west.values())
    assert abs(east[0]) > abs(east[1])
    # one-way Centre St (north block) is centred on its line
    (only,) = lanes_of(nj, "n01n11")
    assert lanes["slot"][only] == 0


def test_edges_routing_successors(nj):
    edges = nj["edges"]
    for col in ("id", "from", "to", "length", "speed_kmh", "name", "lanes", "shape", "routable", "next", "via_s",
                "bearing", "slot"):
        assert len(edges[col]) == len(edges["id"]), col
    e = edge_index(nj, "n10n11")
    nxt = {edges["id"][j] for j in edges["next"][e]}
    assert nxt == {"n11n12", "n11n21"}     # straight, or right into Centre St south; Centre St north is one-way
    assert "n11n10" not in nxt             # no U-turns
    assert all(v >= 0 for v in edges["via_s"][e]) and len(edges["via_s"][e]) == len(edges["next"][e])
    assert edges["routable"][e] == 1
    # node indices point at the right nodes
    nodes = nj["nodes"]
    assert nodes["id"][edges["from"][e]] == "n10" and nodes["id"][edges["to"][e]] == "n11"
    assert nodes["lon"][edges["to"][e]] == pytest.approx(LONS[1], abs=1e-4)


def test_edges_slot_used_for_accessibility_drawing(nj):
    edges = nj["edges"]
    assert edges["slot"][edge_index(nj, "n10n11")] < 0
    assert edges["slot"][edge_index(nj, "n01n11")] == 0


def test_free_flow_time_derivable(nj):
    edges = nj["edges"]
    e = edge_index(nj, "n10n11")
    ff = edges["length"][e] / (edges["speed_kmh"][e] / 3.6)
    assert 8 < ff < 14


def test_pois_and_zones_attached(town_net):
    pois = [{"poi_id": "p1", "category": "supermarket", "name": "Test Mart", "lon": LONS[2], "lat": LATS[1]}]
    zones = [{"zone_id": "z1", "name": "North-west block",
              "polygon": [[LONS[0] - 0.0005, LATS[0] + 0.0005], [LONS[1] + 0.0002, LATS[0] + 0.0005],
                          [LONS[1] + 0.0002, LATS[1] + 0.0002], [LONS[0] - 0.0005, LATS[1] + 0.0002]]}]
    nj = network_json(town_net, name="town", pois=pois, zones=zones)
    (p,) = nj["pois"]
    assert nj["nodes"]["id"][p["node"]] == "n12"
    (z,) = nj["zones"]
    names = {nj["edges"]["id"][e] for e in z["edges"]}
    assert "n00n01" in names and "n12n22" not in names


def test_small_zone_without_roads_uses_nearest_edges(town_net):
    # a tiny block between the roads: no edge midpoint inside -> nearest routable edges to its centroid
    c = (LONS[0] + LONS[1]) / 2, (LATS[0] + LATS[1]) / 2
    d = 0.0001
    zones = [{"zone_id": "MB1", "suburb": "Testville",
              "geometry": {"type": "Polygon", "coordinates": [[[c[0] - d, c[1] - d], [c[0] + d, c[1] - d],
                                                               [c[0] + d, c[1] + d], [c[0] - d, c[1] + d],
                                                               [c[0] - d, c[1] - d]]]}}]
    nj = network_json(town_net, name="town", zones=zones)
    (z,) = nj["zones"]
    assert z["name"] == "Testville MB1"
    assert z["edges_nearest"] is True and 1 <= len(z["edges"]) <= 3
    assert all(nj["edges"]["routable"][e] for e in z["edges"])
    # a zone far from any road (an island) gets none rather than a misleading median
    far = [{"zone_id": "MB2", "geometry": {"type": "Polygon", "coordinates": [[[138.62, -35.54], [138.621, -35.54],
                                                                                 [138.621, -35.541], [138.62, -35.54]]]}}]
    (zf,) = network_json(town_net, name="town", zones=far)["zones"]
    assert zf["edges"] == []


def test_hash_identifies_the_lane_and_edge_order(town_net, tmp_path):
    from tests.viewer.conftest import build_net
    a = network_json(town_net, name="town")
    assert len(a["hash"]) == 16 and a["hash"] == network_json(town_net, name="town")["hash"]
    other = build_net(tmp_path, centre_oneway=False)          # one more edge
    assert network_json(other, name="town")["hash"] != a["hash"]


def test_compass_helper():
    from vhsim.viewer.network import bearing_deg
    assert bearing_deg(138.6, -35.53, 138.6, -35.52) == pytest.approx(0, abs=0.5)
    assert bearing_deg(138.6, -35.53, 138.61, -35.53) == pytest.approx(90, abs=0.5)
    assert math.isclose(bearing_deg(138.6, -35.53, 138.6, -35.54), 180, abs_tol=0.5)
