import xml.etree.ElementTree as ET

from vhsim.network.osmfilter import filter_osm

OSM = """<?xml version='1.0' encoding='UTF-8'?>
<osm version="0.6">
  <node id="1" lat="-35.55" lon="138.62"/>
  <node id="2" lat="-35.551" lon="138.62"/>
  <way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="residential"/></way>
  <way id="11"><nd ref="1"/><nd ref="2"/><tag k="highway" v="service"/></way>
  <way id="12"><nd ref="1"/><nd ref="2"/><tag k="highway" v="service"/><tag k="service" v="driveway"/></way>
  <way id="13"><nd ref="1"/><nd ref="2"/><tag k="highway" v="service"/><tag k="service" v="parking_aisle"/></way>
  <way id="14"><nd ref="1"/><nd ref="2"/><tag k="highway" v="service"/><tag k="access" v="private"/></way>
  <way id="15"><nd ref="1"/><nd ref="2"/><tag k="highway" v="service"/><tag k="access" v="no"/><tag k="bus" v="yes"/></way>
  <way id="16"><nd ref="1"/><nd ref="2"/><tag k="highway" v="residential"/><tag k="access" v="private"/></way>
  <way id="17"><nd ref="1"/><nd ref="2"/><tag k="landuse" v="residential"/></way>
  <relation id="99"><member type="way" ref="12" role="from"/><tag k="type" v="restriction"/></relation>
</osm>
"""


def test_filter_drops_private_and_driveway_service_ways(tmp_path):
    src = tmp_path / "in.osm"
    src.write_text(OSM)
    dst = tmp_path / "out.osm"
    dropped = filter_osm(src, dst)
    kept = {w.get("id") for w in ET.parse(dst).getroot().iter("way")}
    assert kept == {"10", "11", "16", "17"}
    assert dropped == {"12": "service=driveway", "13": "service=parking_aisle",
                       "14": "service access=private", "15": "service access=no"}


def test_filter_keeps_nodes_and_relations(tmp_path):
    src = tmp_path / "in.osm"
    src.write_text(OSM)
    dst = tmp_path / "out.osm"
    filter_osm(src, dst)
    root = ET.parse(dst).getroot()
    assert len(list(root.iter("node"))) == 2
    assert len(list(root.iter("relation"))) == 1
