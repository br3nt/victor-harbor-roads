"""Pass-1 OSM import on a tiny hand-made extract (fast)."""
import xml.etree.ElementTree as ET

import sumolib

from vhsim.network.build import import_osm

# A plus-shaped set of ways around one centre node (lon/lat near Victor Harbor).
OSM = """<?xml version='1.0' encoding='UTF-8'?>
<osm version="0.6">
  <node id="1" lat="-35.5500" lon="138.6200"/>
  <node id="2" lat="-35.5450" lon="138.6200"/>
  <node id="3" lat="-35.5550" lon="138.6200"/>
  <node id="4" lat="-35.5500" lon="138.6150"/>
  <node id="5" lat="-35.5500" lon="138.6250"/>
  <node id="6" lat="-35.5500" lon="138.6300"/>
  <node id="7" lat="-35.5520" lon="138.6250"/>
  <way id="100"><nd ref="2"/><nd ref="1"/><nd ref="3"/><tag k="highway" v="trunk"/><tag k="name" v="Trunk Road"/></way>
  <way id="101"><nd ref="4"/><nd ref="1"/><tag k="highway" v="residential"/><tag k="name" v="West Street"/></way>
  <way id="102"><nd ref="1"/><nd ref="5"/><tag k="highway" v="primary"/><tag k="oneway" v="yes"/><tag k="name" v="East Street"/></way>
  <way id="103"><nd ref="5"/><nd ref="6"/><nd ref="7"/><nd ref="5"/><tag k="highway" v="service"/></way>
  <way id="104"><nd ref="4"/><nd ref="3"/><tag k="highway" v="footway"/></way>
  <way id="105"><nd ref="2"/><nd ref="4"/><tag k="highway" v="trunk"/><tag k="lanes" v="4"/><tag k="name" v="Wide Road"/></way>
</osm>
"""


def _net(tmp_path):
    osm = tmp_path / "t.osm"
    osm.write_text(OSM)
    out = tmp_path / "t.net.xml"
    import_osm(osm, out, log=tmp_path / "t.log")
    return out


def test_import_is_lefthand_without_traffic_lights(tmp_path):
    out = _net(tmp_path)
    root = ET.parse(out).getroot()
    assert root.get("lefthand") == "true"
    assert root.find("tlLogic") is None


def test_untagged_arterials_get_one_lane_per_direction(tmp_path):
    net = sumolib.net.readNet(str(_net(tmp_path)))
    trunk = [e for e in net.getEdges() if e.getName() == "Trunk Road"]
    assert trunk and all(e.getLaneNumber() == 1 for e in trunk)
    oneway = [e for e in net.getEdges() if e.getName() == "East Street"]
    assert oneway and all(e.getLaneNumber() == 1 for e in oneway)
    wide = [e for e in net.getEdges() if e.getName() == "Wide Road"]
    assert len(wide) == 2 and all(e.getLaneNumber() == 2 for e in wide)


def test_service_roads_carry_cars_and_footways_are_dropped(tmp_path):
    net = sumolib.net.readNet(str(_net(tmp_path)))
    service = [e for e in net.getEdges() if e.getType() == "highway.service"]
    assert service and all(e.allows("passenger") and e.allows("truck") for e in service)
    assert not [e for e in net.getEdges() if e.getType() == "highway.footway"]
    for e in net.getEdges():
        if e.getType().startswith("highway."):
            for vc in ("passenger", "truck", "trailer", "delivery", "bus"):
                assert e.allows(vc), (e.getID(), vc)


def test_osm_tags_are_kept_as_edge_params(tmp_path):
    net = sumolib.net.readNet(str(_net(tmp_path)))
    wide = [e for e in net.getEdges() if e.getName() == "Wide Road"][0]
    assert wide.getParam("lanes") == "4"
    assert wide.getParam("highway") == "trunk"
