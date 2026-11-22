import json

import pytest
from shapely.geometry import LineString

from vhsim.network.speeds import (DitSection, choose_speed, load_dit_sections, match_section,
                                  normalise_name, parse_maxspeed, ring_radius_m, roundabout_speed_kmh)


def _sec(name, speed, coords, road_no="04760"):
    return DitSection(road_no=road_no, rdname=name, start_rrd=0.0, end_rrd=1.0, speed_kmh=speed,
                      line=LineString(coords))


SECTIONS = [
    _sec("TORRENS ST", 50, [(0, 0), (0, 500)]),
    _sec("HINDMARSH RD", 60, [(0, 500), (0, 1500)]),
    _sec("VICTORIA ST", 50, [(0, 0), (-500, 0)], road_no="04793"),
]


@pytest.mark.parametrize("osm,dit", [("Torrens Street", "TORRENS ST"), ("Hindmarsh Road", "HINDMARSH RD"),
                                     ("North Terrace", "NORTH TCE"), ("Victor Harbor Road", "VICTOR HARBOR RD")])
def test_normalise_name_matches_dit_abbreviations(osm, dit):
    assert normalise_name(osm) == normalise_name(dit)


def test_parallel_carriageway_with_same_name_matches():
    # one carriageway of a divided road, 8 m off the DIT centreline
    sec = match_section([(8, 50), (8, 450)], "Torrens Street", "trunk", SECTIONS)
    assert sec is not None and sec.rdname == "TORRENS ST"


def test_crossing_side_street_does_not_match():
    assert match_section([(-100, 250), (100, 250)], "Coral Street", "residential", SECTIONS) is None


def test_parallel_street_with_unrelated_name_does_not_match():
    assert match_section([(10, 50), (10, 450)], "Railway Terrace", "unclassified", SECTIONS) is None


def test_same_route_other_name_matches_at_section_boundaries():
    # OSM calls this end "Torrens Street" but DIT already starts Hindmarsh Rd: same road number 04760
    sec = match_section([(5, 600), (5, 900)], "Torrens Street", "trunk", SECTIONS)
    assert sec is not None and sec.rdname == "HINDMARSH RD"


def test_edge_spanning_two_sections_takes_the_majority():
    sec = match_section([(0, 400), (0, 800)], "Hindmarsh Road", "trunk", SECTIONS)
    assert sec.rdname == "HINDMARSH RD"


def test_far_away_edge_does_not_match():
    assert match_section([(200, 50), (200, 450)], "Torrens Street", "trunk", SECTIONS) is None


@pytest.mark.parametrize("value,expected", [("60", 60), ("50 km/h", 50), ("80;100", 80), ("none", None),
                                            ("signals", None), (None, None), ("", None)])
def test_parse_maxspeed(value, expected):
    assert parse_maxspeed(value) == expected


def test_speed_priority_dit_then_osm_then_default():
    dit = SECTIONS[0]
    assert choose_speed("highway.trunk", "60", dit) == (50, "S-D05")
    assert choose_speed("highway.residential", "40", None) == (40, "OSM")
    assert choose_speed("highway.residential", None, None) == (50, "default")
    assert choose_speed("highway.service", None, None) == (20, "default")
    assert choose_speed("highway.service", "10", None) == (10, "OSM")


def test_roundabout_speed_follows_radius_and_never_exceeds_limit():
    small = roundabout_speed_kmh(radius_m=10, limit_kmh=60)
    large = roundabout_speed_kmh(radius_m=40, limit_kmh=60)
    assert 18 <= small < large <= 60
    assert roundabout_speed_kmh(radius_m=200, limit_kmh=50) == 50


def test_ring_radius_from_node_positions():
    import math
    nodes = [(100 + 12 * math.cos(a), 50 + 12 * math.sin(a)) for a in (0, 1.6, 3.1, 4.7)]
    assert ring_radius_m(nodes) == pytest.approx(12, abs=0.01)


def test_load_dit_sections_projects_and_keeps_attributes(tmp_path):
    gj = {"type": "FeatureCollection", "features": [{
        "type": "Feature",
        "properties": {"crrs_road_no": "04760", "start_rrd": 50.0, "end_rrd": 50.56, "rdname": "TORRENS ST",
                       "speed_limit": 50},
        "geometry": {"type": "MultiLineString", "coordinates": [[[138.623, -35.5517], [138.6207, -35.5559]]]}}]}
    p = tmp_path / "d.geojson"
    p.write_text(json.dumps(gj))
    secs = load_dit_sections(p, to_xy=lambda lon, lat: (lon * 1000, lat * 1000))
    assert len(secs) == 1
    s = secs[0]
    assert (s.road_no, s.rdname, s.speed_kmh, s.start_rrd, s.end_rrd) == ("04760", "TORRENS ST", 50, 50.0, 50.56)
    assert s.line.coords[0] == pytest.approx((138623.0, -35551.7))
