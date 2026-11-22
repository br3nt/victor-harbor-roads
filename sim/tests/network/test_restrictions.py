"""OSM turn restrictions survive junction joining (fast, tiny hand-made extract)."""
import sumolib

from vhsim.network.build import import_osm
from vhsim.network.restrictions import banned_movements, parse_restrictions

# A divided road (north carriageway eastbound, south carriageway westbound, ~9 m apart) with a
# median opening (way 30) at x=0 and a side street (way 40) south from the south carriageway.
# OSM bans the westbound right turn into the median opening (a U-turn ban in effect), like the
# Victoria Street relations 17070777-80.
OSM = """<?xml version='1.0' encoding='UTF-8'?>
<osm version="0.6">
  <node id="1" lat="-35.55000" lon="138.61800"/>
  <node id="2" lat="-35.55000" lon="138.62000"/>
  <node id="3" lat="-35.55000" lon="138.62200"/>
  <node id="4" lat="-35.55008" lon="138.62200"/>
  <node id="5" lat="-35.55008" lon="138.62000"/>
  <node id="6" lat="-35.55008" lon="138.61800"/>
  <node id="7" lat="-35.55200" lon="138.62000"/>
  <way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="primary"/><tag k="oneway" v="yes"/><tag k="name" v="Main Street"/></way>
  <way id="11"><nd ref="2"/><nd ref="3"/><tag k="highway" v="primary"/><tag k="oneway" v="yes"/><tag k="name" v="Main Street"/></way>
  <way id="20"><nd ref="4"/><nd ref="5"/><tag k="highway" v="primary"/><tag k="oneway" v="yes"/><tag k="name" v="Main Street"/></way>
  <way id="21"><nd ref="5"/><nd ref="6"/><tag k="highway" v="primary"/><tag k="oneway" v="yes"/><tag k="name" v="Main Street"/></way>
  <way id="30"><nd ref="2"/><nd ref="5"/><tag k="highway" v="primary_link"/><tag k="name" v="Side Street"/></way>
  <way id="40"><nd ref="5"/><nd ref="7"/><tag k="highway" v="residential"/><tag k="name" v="Side Street"/></way>
  <relation id="99">
    <member type="way" ref="20" role="from"/><member type="node" ref="5" role="via"/>
    <member type="way" ref="30" role="to"/>
    <tag k="type" v="restriction"/><tag k="restriction" v="no_right_turn"/>
  </relation>
</osm>
"""


def test_parse_restrictions(tmp_path):
    p = tmp_path / "r.osm"
    p.write_text(OSM)
    [r] = parse_restrictions(p)
    assert (r.rel_id, r.kind, r.from_way, r.via_nodes, r.to_way) == ("99", "no_right_turn", "20", ("5",), "30")


def test_ban_into_absorbed_median_link_becomes_a_uturn_ban(tmp_path):
    osm = tmp_path / "r.osm"
    osm.write_text(OSM)
    net_path = tmp_path / "r.net.xml"
    import_osm(osm, net_path)
    net = sumolib.net.readNet(str(net_path))
    banned, unresolved = banned_movements(osm, net)
    assert not unresolved
    # westbound (way 20) must not continue onto the eastbound carriageway (way 11) through the opening
    assert ("20", "11") in banned["99"]
    # the legal left turn into the side street is not banned
    assert ("20", "40") not in banned["99"]
