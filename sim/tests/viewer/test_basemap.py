import io
import json
from pathlib import Path

import numpy as np
import pytest
import shapely
from shapely.geometry import LineString, Point, shape

from vhsim.viewer import basemap as B

BOX = (138.600, -35.600, 138.620, -35.580)   # (w, s, e, n), about 1.8 x 2.2 km


def _osm(coast_reversed: bool = False) -> str:
    """A tiny extract: a coastline crossing the box west->east at lat -35.590 (land north, sea south), split in
    two ways; a CCW island ring in the sea; an untagged-coastline islet; a lake; a residential multipolygon with
    a hole; a park; buildings; a river leaving the box; a tram line; a pier; a footbridge; a few points."""
    nodes, ways, rels = {}, [], []

    def n(i, lon, lat, **tags):
        nodes[i] = (lon, lat, tags)
        return i

    coast_a = [n(1, 138.595, -35.5900), n(2, 138.605, -35.5905), n(3, 138.610, -35.5900)]
    coast_b = [3, n(4, 138.615, -35.5895), n(5, 138.625, -35.5900)]
    if coast_reversed:
        coast_a, coast_b = coast_b[::-1], coast_a[::-1]
    ways.append((100, coast_a, dict(natural="coastline")))
    ways.append((101, coast_b, dict(natural="coastline")))
    isl = [n(10, 138.608, -35.596), n(11, 138.612, -35.596), n(12, 138.612, -35.594), n(13, 138.608, -35.594)]
    ways.append((102, isl + [10], dict(natural="coastline", place="island", name="Test Island")))
    islet = [n(14, 138.6150, -35.5970), n(15, 138.6153, -35.5970), n(16, 138.6153, -35.5967)]
    ways.append((103, islet + [14], dict(place="islet")))
    lake = [n(20, 138.602, -35.584), n(21, 138.604, -35.584), n(22, 138.604, -35.582), n(23, 138.602, -35.582)]
    ways.append((110, lake + [20], dict(natural="water", water="lake", name="Test Lake")))
    # residential multipolygon: outer in two open ways, one inner
    o1 = [n(30, 138.606, -35.588), n(31, 138.612, -35.588), n(32, 138.612, -35.582)]
    o2 = [32, n(33, 138.606, -35.582), 30]
    inner = [n(34, 138.608, -35.586), n(35, 138.610, -35.586), n(36, 138.610, -35.584), n(37, 138.608, -35.584)]
    ways += [(120, o1, {}), (121, o2, {}), (122, inner + [34], {})]
    rels.append((500, [("way", 120, "outer"), ("way", 121, "outer"), ("way", 122, "inner")],
                 dict(type="multipolygon", landuse="residential")))
    park = [n(40, 138.614, -35.586), n(41, 138.618, -35.586), n(42, 138.618, -35.582), n(43, 138.614, -35.582)]
    ways.append((130, park + [40], dict(leisure="park", name="Test Reserve")))
    golf = [n(44, 138.6005, -35.5895), n(45, 138.6015, -35.5895), n(46, 138.6015, -35.5885)]
    ways.append((131, golf + [44], dict(leisure="golf_course", landuse="grass", name="Test Golf Club")))

    def rect(i0, lon, lat, w_m, h_m):
        dx, dy = w_m / 90_600, h_m / 110_950
        return [n(i0, lon, lat), n(i0 + 1, lon + dx, lat), n(i0 + 2, lon + dx, lat + dy), n(i0 + 3, lon, lat + dy), i0]

    ways.append((200, rect(60, 138.6070, -35.5870, 10, 12), dict(building="yes")))            # 120 m2 house-ish
    ways.append((201, rect(64, 138.6080, -35.5870, 3, 3), dict(building="garage")))           # 9 m2: dropped
    ways.append((202, rect(68, 138.6090, -35.5870, 40, 40), dict(building="yes")))            # 1600 m2: big
    ways.append((203, rect(72, 138.6100, -35.5870, 12, 20), {"building": "yes", "building:levels": "3"}))
    ways.append((204, rect(76, 138.6110, -35.5870, 15, 25), dict(building="church", height="12 m")))
    ways.append((205, rect(80, 138.6120, -35.5870, 6, 5), dict(building="shed")))
    river = [n(90, 138.6190, -35.5850), n(91, 138.6195, -35.5860), n(92, 138.6230, -35.5870)]
    ways.append((300, river, dict(waterway="river", name="Test River")))
    tram = [n(93, 138.6060, -35.5895), n(94, 138.6100, -35.5950)]
    ways.append((301, tram, dict(railway="tram", bridge="yes", name="Test Tram")))
    pier = [n(95, 138.6062, -35.5895), n(96, 138.6102, -35.5950)]
    ways.append((302, pier, dict(man_made="pier", highway="pedestrian", bridge="yes", name="Test Causeway")))
    fb = [n(97, 138.6191, -35.5855), n(98, 138.6196, -35.5853)]
    ways.append((303, fb, dict(highway="footway", bridge="yes")))
    n(150, 138.6100, -35.5830, place="town", name="Testville")
    n(151, 138.6010, -35.5860, natural="peak", name="Test Hill", ele="64")

    out = ['<?xml version="1.0" encoding="UTF-8"?>\n<osm version="0.6">']
    for i, (lon, lat, tags) in sorted(nodes.items()):
        t = "".join(f'<tag k="{k}" v="{v}"/>' for k, v in tags.items())
        out.append(f'<node id="{i}" lat="{lat}" lon="{lon}">{t}</node>')
    for i, nds, tags in ways:
        body = "".join(f'<nd ref="{r}"/>' for r in nds) + "".join(f'<tag k="{k}" v="{v}"/>' for k, v in tags.items())
        out.append(f'<way id="{i}">{body}</way>')
    for i, mem, tags in rels:
        body = "".join(f'<member type="{t}" ref="{r}" role="{ro}"/>' for t, r, ro in mem)
        body += "".join(f'<tag k="{k}" v="{v}"/>' for k, v in tags.items())
        out.append(f'<relation id="{i}">{body}</relation>')
    out.append("</osm>")
    return "\n".join(out)


@pytest.fixture(scope="module")
def osm():
    return B.parse_osm(io.StringIO(_osm()))


def test_parse_reads_nodes_ways_relations(osm):
    assert osm.nodes[1] == (138.595, -35.59)
    assert osm.ways[102][1]["name"] == "Test Island"
    assert osm.rels[500][0][0] == ("way", 120, "outer")
    assert osm.node_tags[150]["place"] == "town"


def test_sea_is_on_the_right_of_the_coastline_and_islands_are_holes(osm):
    sea = B.sea_polygon(osm, BOX)
    assert sea.contains(Point(138.603, -35.598))         # south of the coast
    assert not sea.contains(Point(138.610, -35.585))     # land
    assert not sea.contains(Point(138.610, -35.595))     # Test Island
    assert not sea.contains(Point(138.6152, -35.5969))   # islet (place=islet, not coastline)
    frac = sea.area / ((BOX[2] - BOX[0]) * (BOX[3] - BOX[1]))
    assert 0.44 < frac < 0.50                            # about half the box, minus the island


def test_sea_follows_coastline_direction():
    rev = B.parse_osm(io.StringIO(_osm(coast_reversed=True)))
    sea = B.sea_polygon(rev, BOX)
    # reversed mainland coast: the sea is now north. The island ring keeps its own direction, so it is land
    # inside the "land" now; the sea is the north half only.
    assert sea.contains(Point(138.610, -35.585))
    assert not sea.contains(Point(138.603, -35.598))


def test_a_coastline_ending_inside_the_box_is_an_error():
    # drop the eastern half of the mainland coast: the coastline now stops inside the box
    broken = B.parse_osm(io.StringIO(_osm()))
    del broken.ways[101]
    with pytest.raises(ValueError, match="coastline"):
        B.sea_polygon(broken, BOX)


def test_multipolygon_relation_is_assembled_with_its_hole(osm):
    poly = B.relation_polygon(osm, 500)
    assert poly.is_valid and len(poly.interiors) == 1
    assert poly.contains(Point(138.607, -35.587)) and not poly.contains(Point(138.609, -35.585))


@pytest.mark.parametrize("tags,cls", [
    (dict(landuse="farmland"), "farmland"), (dict(landuse="meadow"), "grass"),
    (dict(landuse="recreation_ground"), "grass"), (dict(leisure="park"), "park"), (dict(leisure="pitch"), "pitch"),
    (dict(leisure="golf_course", landuse="grass"), "golf"), (dict(landuse="forest"), "wood"),
    (dict(natural="wood"), "wood"), (dict(natural="heath"), "scrub"), (dict(natural="beach"), "sand"),
    (dict(natural="shingle"), "sand"), (dict(natural="bare_rock"), "rock"), (dict(landuse="residential"), "residential"),
    (dict(landuse="retail"), "commercial"), (dict(landuse="industrial"), "commercial"),
    (dict(amenity="grave_yard"), "cemetery"), (dict(landuse="cemetery"), "cemetery"),
    (dict(natural="wetland"), "wetland"), (dict(tourism="caravan_site"), "caravan"), (dict(tourism="camp_site"), "caravan"),
    (dict(natural="water"), None), (dict(building="yes"), None), (dict(landuse="construction"), None),
])
def test_landuse_class(tags, cls):
    assert B.landuse_class(tags) == cls


@pytest.mark.parametrize("tags,area,h,c", [
    (dict(building="yes"), 120, 4.5, "other"),
    (dict(building="house"), 150, 4.5, "house"),
    (dict(building="yes"), 1600, 6.5, "other"),
    ({"building": "yes", "building:levels": "3"}, 240, 10.0, "other"),
    (dict(building="church", height="12 m"), 375, 12.0, "civic"),
    (dict(building="garage"), 30, 3.0, "shed"),          # 2.8 rounded to 0.5
    (dict(building="apartments"), 400, 10.0, "apartments"),
    (dict(building="retail"), 400, 6.5, "commercial"),
    (dict(building="school"), 400, 7.0, "civic"),
    (dict(building="yes", amenity="school"), 400, 7.0, "civic"),
    (dict(building="yes", amenity="hospital"), 3000, 9.0, "civic"),
    (dict(building="yes", amenity="place_of_worship"), 200, 10.0, "civic"),
    (dict(building="warehouse"), 900, 7.0, "industrial"),
    (dict(building="hotel"), 900, 10.0, "commercial"),
    (dict(building="yes", shop="supermarket"), 2000, 6.5, "commercial"),
    ({"building": "yes", "height": "7.3"}, 100, 7.5, "other"),
])
def test_building_height_and_class(tags, area, h, c):
    assert B.building_height(tags, area) == h
    assert B.building_class(tags) == c


@pytest.fixture(scope="module")
def baked(osm, tmp_path_factory):
    out = tmp_path_factory.mktemp("bm")
    B.bake(osm, out, bbox=BOX, addresses=None, terrain_dir=None)
    return out


def _feats(path: Path, layer=None):
    fc = json.loads(path.read_text())
    assert fc["type"] == "FeatureCollection"
    return [f for f in fc["features"] if layer is None or f["properties"].get("l") == layer]


def _coords(geom):
    """All positions of a GeoJSON geometry as a flat list of [x, y]."""
    c = geom["coordinates"]
    if not isinstance(c[0], list):
        return [c]
    while isinstance(c[0][0], list):
        c = [x for part in c for x in part]
    return c


def test_basemap_layers_and_properties(baked):
    feats = _feats(baked / "basemap.json")
    layers = {f["properties"]["l"] for f in feats}
    assert {"sea", "water", "landuse", "waterway", "rail", "pier", "bridge", "label"} <= layers
    lu = {(f["properties"]["c"], f["properties"].get("name")) for f in _feats(baked / "basemap.json", "landuse")}
    assert ("residential", None) in lu and ("park", "Test Reserve") in lu and ("golf", "Test Golf Club") in lu
    (water,) = _feats(baked / "basemap.json", "water")
    assert water["properties"] == {"l": "water", "c": "lake", "name": "Test Lake"}
    (river,) = _feats(baked / "basemap.json", "waterway")
    assert river["properties"] == {"l": "waterway", "c": "river", "name": "Test River"}
    assert max(x for x, _ in _coords(river["geometry"])) <= BOX[2]     # clipped to the box
    (tram,) = _feats(baked / "basemap.json", "rail")
    assert tram["properties"]["c"] == "tram"
    (pier,) = _feats(baked / "basemap.json", "pier")
    assert pier["properties"] == {"l": "pier", "c": "pier", "name": "Test Causeway"}
    bridges = {f["properties"]["c"] for f in _feats(baked / "basemap.json", "bridge")}
    assert bridges == {"rail", "foot"}
    sea = _feats(baked / "basemap.json", "sea")
    assert len(sea) == 1 and shape(sea[0]["geometry"]).contains(Point(138.603, -35.598))


def test_coordinates_are_rounded_to_five_decimals(baked):
    for name in ("basemap.json", "buildings.json"):
        for f in _feats(baked / name):
            for x, y in _coords(f["geometry"]):
                assert round(x, 5) == x and round(y, 5) == y


def test_buildings_heights_and_tiny_ones_dropped(baked):
    bs = _feats(baked / "buildings.json")
    assert len(bs) == 5                     # the 9 m2 garage is dropped
    hs = sorted(f["properties"]["h"] for f in bs)
    assert hs == [3.0, 4.5, 6.5, 10.0, 12.0]
    assert all(set(f["properties"]) == {"h", "c"} for f in bs)
    assert all(f["geometry"]["type"] == "Polygon" for f in bs)


def test_labels(baked):
    labels = {f["properties"]["name"]: f for f in _feats(baked / "basemap.json", "label")}
    isl = labels["Test Island"]
    assert isl["properties"]["c"] == "island" and shape(isl["geometry"]).within(
        shape({"type": "Polygon", "coordinates": [[[138.608, -35.596], [138.612, -35.596], [138.612, -35.594],
                                                  [138.608, -35.594], [138.608, -35.596]]]}))
    park = labels["Test Reserve"]
    assert park["properties"]["c"] == "park" and park["properties"]["z"] == 14.5
    assert labels["Test Golf Club"]["properties"]["c"] == "park"
    riv = labels["Test River"]
    assert riv["properties"]["c"] == "water"
    river_line = shape(_feats(baked / "basemap.json", "waterway")[0]["geometry"])
    assert river_line.distance(shape(riv["geometry"])) < 2e-5          # on the line (to the rounding)
    hill = labels["Test Hill"]
    assert hill["properties"]["c"] == "peak" and hill["properties"]["ele"] == 64
    assert all(isinstance(f["properties"]["z"], (int, float)) for f in labels.values())


def test_output_is_deterministic(osm, baked, tmp_path):
    B.bake(osm, tmp_path, bbox=BOX, addresses=None, terrain_dir=None)
    for name in ("basemap.json", "buildings.json"):
        assert (tmp_path / name).read_bytes() == (baked / name).read_bytes()


def test_suburb_labels_from_addresses(tmp_path):
    addr = {"loc": ["Alpha", "Beta"], "streets": [
        ["A St", 0, 138.610, -35.585, [["1", 0, 0], ["2", 10, 0], ["3", 20, 0], ["4", 30, 0], ["5", 1000, 0]]],
        ["B St", 1, 138.700, -35.500, [["1", 0, 0], ["2", 0, 10]]],
    ]}
    p = tmp_path / "addresses.json"
    p.write_text(json.dumps(addr))
    labs = B.suburb_labels(p, min_addresses=3, town_min=5)
    by = {f["properties"]["name"]: f for f in labs}
    assert set(by) == {"Alpha"}                              # Beta has too few addresses
    assert by["Alpha"]["geometry"]["coordinates"] == [138.6102, -35.585]  # the address nearest the median
    assert by["Alpha"]["properties"] == {"l": "label", "c": "suburb", "name": "Alpha", "z": 12}
    # fewer than town_min addresses: a rural locality, shown from z 11
    assert B.suburb_labels(p, min_addresses=2, town_min=6)[0]["properties"]["z"] == 11


REAL_OSM = B.DEFAULT_OSM


@pytest.mark.slow
@pytest.mark.skipif(not REAL_OSM.exists(), reason="G-01 extract not on this machine")
def test_real_sea_and_causeway():
    osm = B.parse_osm(REAL_OSM)
    sea = B.sea_polygon(osm, B.OSM_BBOX)
    assert sea.contains(Point(138.615, -35.575))          # Encounter Bay
    assert not sea.contains(Point(138.6175, -35.553))     # town centre
    assert not sea.contains(Point(138.6313, -35.5641))    # Granite Island (its top)
    granite = B.way_polygon(osm, 493570777)
    causeway = B.way_line(osm, 1004582502)
    land = shape({"type": "Polygon", "coordinates": [[[138.57, -35.598], [138.66, -35.598], [138.66, -35.53],
                                                     [138.57, -35.53], [138.57, -35.598]]]}).difference(sea)
    assert causeway.distance(granite) < 1e-4 and causeway.distance(land.difference(granite.buffer(1e-4))) < 2e-4


# ---- sea outside the OSM box, from the terrain tiles ---------------------------------------------------------

EXT = (138.580, -35.610, 138.650, -35.560)
LAKE = (138.640, -35.570, 138.645, -35.565)   # an inland 0 m patch, not connected to the sea


NOISE = (138.585, -35.605, 138.590, -35.600)  # sea with small positive values (as in the real source tiles)
ISLE = (138.586, -35.6045, 138.589, -35.6015)    # a 30 m island inside it (about 9 ha)
REEF = (138.630, -35.607, 138.6335, -35.6035)     # a 9 ha blob of 3 m offshore (source noise, not an island)
SPECK = (138.6395, -35.6004, 138.6405, -35.5996)  # a 90 m speck of 20 m "land" offshore (noise)
GULF = (EXT[0], -35.575, 138.585, EXT[3])     # sea reaching only the west edge of the extent


def _dem(lon, lat):
    """Synthetic terrain: sea (0 m after clamping) south of -35.59, land at 50 m north of it, an inland 0 m patch
    (LAKE), a noisy 0.5 m sea patch with an island, and a gulf open only to the west edge."""
    def inside(b):
        return (lon > b[0]) & (lon < b[2]) & (lat > b[1]) & (lat < b[3])

    e = np.where(lat < -35.59, -20.0, 50.0)
    e = np.where(inside(LAKE), 0.0, e)
    e = np.where(inside(NOISE), 0.5, e)
    e = np.where(inside(ISLE), 30.0, e)
    e = np.where(inside(SPECK), 20.0, e)
    e = np.where(inside(REEF), 3.0, e)
    return np.where(inside(GULF), -10.0, e)


@pytest.fixture(scope="module")
def dem_dir(tmp_path_factory):
    from vhsim.viewer import terrain as T
    from vhsim.viewer.png import encode_png

    def fetch(z, x, y):
        lon = np.array([T.pixel_to_lonlat(z, x, y, i + 0.5, 0, 256)[0] for i in range(256)])
        lat = np.array([T.pixel_to_lonlat(z, x, y, 0, j + 0.5, 256)[1] for j in range(256)])
        return encode_png(T.terrarium_encode(_dem(lon[None, :], lat[:, None])))

    d = tmp_path_factory.mktemp("dem")
    T.build(d, fetch, plan=[(12, EXT), (11, EXT)])
    return d


def test_outer_sea_follows_the_terrain_and_skips_inland_zero_patches(osm, dem_dir):
    inner = B.sea_polygon(osm, BOX)
    outer = B.outer_sea(dem_dir, inner, inner_box=BOX, extent=EXT)
    assert outer.contains(Point(138.590, -35.605)) and outer.contains(Point(138.640, -35.605))
    assert not outer.contains(Point(138.590, -35.585))           # land west of the box
    assert not outer.contains(Point(138.6425, -35.5675))         # inland 0 m patch
    assert outer.contains(Point(138.5855, -35.6045))             # noisy sea below 1 m is still sea
    assert not outer.contains(Point(138.5875, -35.6025))         # the island in it is not
    assert outer.contains(Point(138.582, -35.565))               # gulf open to the west edge
    assert outer.contains(Point(138.6400, -35.6000))             # an offshore speck is not an island
    assert outer.contains(Point(138.6318, -35.6052))             # nor is a low (3 m) offshore blob
    assert outer.intersection(shapely.box(*BOX)).area < 1e-12    # nothing inside the OSM box
    assert outer.bounds[0] >= EXT[0] - 1e-9 and outer.bounds[2] <= EXT[2] + 1e-9


def test_baked_sea_has_no_gap_at_the_box_edge(osm, dem_dir, tmp_path):
    B.bake(osm, tmp_path, bbox=BOX, terrain_dir=dem_dir, sea_extent=EXT)
    (sea,) = _feats(tmp_path / "basemap.json", "sea")
    g = shape(sea["geometry"])
    assert g.is_valid
    for a, b in [((138.610, -35.5995), (138.610, -35.6005)),      # across the south edge
                 ((138.5995, -35.597), (138.6005, -35.597)),      # across the west edge
                 ((138.6195, -35.598), (138.6205, -35.598))]:     # across the east edge
        assert LineString([a, b]).within(g.buffer(1e-9)), (a, b)
    assert g.contains(Point(138.590, -35.605)) and not g.contains(Point(138.6425, -35.5675))


@pytest.mark.slow
@pytest.mark.skipif(not REAL_OSM.exists(), reason="G-01 extract not on this machine")
def test_real_sea_outside_the_box():
    terrain = B.REPO / "viewer" / "basemap" / "terrain"
    osm = B.parse_osm(REAL_OSM)
    outer = B.outer_sea(terrain, B.sea_polygon(osm, B.OSM_BBOX))
    assert outer.contains(Point(138.600, -35.620))      # south of The Bluff
    assert outer.contains(Point(138.680, -35.550))      # east of the box, towards Port Elliot
    assert not outer.contains(Point(138.500, -35.500))  # inland
    assert not outer.contains(Point(138.550, -35.600))  # Waitpinga, coastal land west of the box (113 m)


@pytest.mark.slow
@pytest.mark.skipif(not REAL_OSM.exists(), reason="G-01 extract not on this machine")
def test_real_baked_sea_has_no_seam_on_the_south_and_east_edges(tmp_path):
    B.bake(B.parse_osm(REAL_OSM), tmp_path, terrain_dir=B.REPO / "viewer" / "basemap" / "terrain")
    (sea,) = _feats(tmp_path / "basemap.json", "sea")
    g = shape(sea["geometry"]).buffer(1e-9)
    w, s, e, n = B.OSM_BBOX
    for lon in np.arange(138.605, 138.66, 0.005):        # south edge, east of The Bluff
        assert LineString([(lon, s + 2e-4), (lon, s - 2e-4)]).within(g), lon
    for lat in np.arange(-35.597, -35.545, 0.005):       # east edge, in the bay
        assert LineString([(e - 2e-4, lat), (e + 2e-4, lat)]).within(g), lat
