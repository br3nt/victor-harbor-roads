"""N1: the Grantley Ave rail crossing (Hindmarsh Rd to Bridge Tce) closed to motor vehicles (slow)."""
import pytest

pytestmark = pytest.mark.slow

CROSSING = {"184390360#0", "-184390360#1"}     # OSM way 184390360 with level-crossing node 1948692262
HINDMARSH_NODE, BRIDGE_NODE = "1948692238", "1948692242"


def test_crossing_link_is_removed(built, s6_base):
    summary, net, _ = built("n1")
    assert CROSSING <= {e.getID() for e in s6_base.net.getEdges()}
    assert set(summary["removed"]["ids"]) == CROSSING
    for e in net.getNode(HINDMARSH_NODE).getOutgoing():
        assert e.getToNode().getID() != BRIDGE_NODE
    for e in net.getNode(BRIDGE_NODE).getOutgoing():
        assert e.getToNode().getID() != HINDMARSH_NODE


def test_grantley_avenue_and_bridge_terrace_stay_reachable(built):
    summary, net, _ = built("n1")
    assert summary["checks"]["ok"], summary["checks"]
    assert net.getEdge("42530401#0") in net.getEdge("-50904904#7").getOutgoing()   # Hindmarsh Rd -> Grantley Ave
    path, _ = net.getShortestPath(net.getEdge("-217056482#2"), net.getEdge("50904904#7"), vClass="passenger")
    assert path    # Bridge Tce traffic still reaches Hindmarsh Rd, by another way
    assert "184390360#0" not in {e.getID() for e in path} and "-184390360#1" not in {e.getID() for e in path}
