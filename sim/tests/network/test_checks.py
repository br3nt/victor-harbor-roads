"""Network checks on small hand-made plain-XML networks (fast)."""
import math
import subprocess

import pytest
import sumolib

from vhsim.network.checks import boundary_uturns, check_roundabouts, drivable_edges, largest_scc
from vhsim.paths import sumo_bin


def _plain_net(tmp_path, nodes, edges, extra_edg="", lefthand=True, con=""):
    nod = tmp_path / "n.nod.xml"
    edg = tmp_path / "n.edg.xml"
    nod.write_text("<nodes>" + "".join(
        f'<node id="{i}" x="{x}" y="{y}" type="{t}"/>' for i, x, y, t in nodes) + "</nodes>")
    edg.write_text("<edges>" + "".join(
        f'<edge id="{i}" from="{a}" to="{b}" numLanes="1" speed="13.89" priority="{p}"/>'
        for i, a, b, p in edges) + extra_edg + "</edges>")
    net = tmp_path / "n.net.xml"
    args = [sumo_bin("netconvert"), "-n", str(nod), "-e", str(edg), "-o", str(net)]
    if con:
        (tmp_path / "n.con.xml").write_text(f"<connections>{con}</connections>")
        args += ["-x", str(tmp_path / "n.con.xml")]
    if lefthand:
        args += ["--lefthand", "true"]
    subprocess.run(args, check=True, capture_output=True)
    return net


def _roundabout(tmp_path, declare_all=True, clockwise=True):
    r = 20.0
    ring = []
    for k in range(4):  # nodes at E, N, W, S
        ang = math.radians(90 * k)
        ring.append((f"r{k}", round(r * math.cos(ang), 2), round(r * math.sin(ang), 2), "priority"))
    outer = []
    for k in range(4):
        ang = math.radians(90 * k)
        outer.append((f"o{k}", round(120 * math.cos(ang), 2), round(120 * math.sin(ang), 2), "priority"))
    order = [0, 3, 2, 1] if clockwise else [0, 1, 2, 3]   # E->S->W->N is clockwise
    ring_edges = [(f"c{order[k]}", f"r{order[k]}", f"r{order[(k + 1) % 4]}", 5) for k in range(4)]
    arms = []
    for k in range(4):
        arms += [(f"in{k}", f"o{k}", f"r{k}", 3), (f"out{k}", f"r{k}", f"o{k}", 3)]
    declared = [e[0] for e in ring_edges] if declare_all else [e[0] for e in ring_edges][:-1]
    extra = f'<roundabout nodes="r0 r1 r2 r3" edges="{" ".join(declared)}"/>'
    return _plain_net(tmp_path, ring + outer, ring_edges + arms, extra)


def test_complete_clockwise_roundabout_passes(tmp_path):
    [rb] = check_roundabouts(_roundabout(tmp_path))
    assert rb.complete, rb.problems
    assert rb.clockwise
    assert rb.approaches == 4


def test_roundabout_with_undeclared_ring_edge_fails(tmp_path):
    [rb] = check_roundabouts(_roundabout(tmp_path, declare_all=False))
    assert not rb.complete
    assert any("cycle" in p or "yield" in p or "priority" in p for p in rb.problems)


def test_anticlockwise_roundabout_is_flagged_for_lefthand(tmp_path):
    [rb] = check_roundabouts(_roundabout(tmp_path, clockwise=False))
    assert not rb.clockwise
    assert not rb.complete


def test_largest_scc_drops_one_way_spur(tmp_path):
    nodes = [("a", 0, 0, "priority"), ("b", 100, 0, "priority"), ("c", 100, 100, "priority"),
             ("d", 200, 0, "priority")]
    edges = [("ab", "a", "b", 1), ("ba", "b", "a", 1), ("bc", "b", "c", 1), ("cb", "c", "b", 1),
             ("bd", "b", "d", 1)]  # one-way into d: d is a dead end with no way out
    net = sumolib.net.readNet(str(_plain_net(tmp_path, nodes, edges)))
    scc = largest_scc(net, "passenger")
    assert scc == {"ab", "ba", "bc", "cb"}


def test_drivable_edges_keep_one_way_gateway_carriageways(tmp_path):
    # inner two-way street a-b; a divided gateway road leaves b to fringe node f1 and
    # comes back from fringe node f2; an inner one-way spur b->d is a dead end.
    nodes = [("a", 0, 0, "priority"), ("b", 100, 0, "priority"), ("d", 100, -100, "priority"),
             ("f1", 300, 10, "priority"), ("f2", 300, -10, "priority"), ("c", 0, 100, "priority")]
    edges = [("ab", "a", "b", 1), ("ba", "b", "a", 1), ("ac", "a", "c", 1), ("ca", "c", "a", 1),
             ("out", "b", "f1", 1), ("in", "f2", "b", 1), ("bd", "b", "d", 1)]
    net = sumolib.net.readNet(str(_plain_net(tmp_path, nodes, edges)))
    keep = drivable_edges(net, "passenger", fringe_nodes={"f1", "f2"})
    assert keep == {"ab", "ba", "ac", "ca", "out", "in"}


def test_boundary_uturns_close_two_way_roads_that_only_lead_out(tmp_path):
    # inner loop a-c; two-way road a-b; at b the road splits into an exit b->f1 and an entry f2->b,
    # and there is no turnaround at b, so a->b can only leave the area and b->a only be reached
    # from outside. A U-turn b (ab -> ba) puts the two-way road back into the inner component.
    nodes = [("a", 0, 0, "priority"), ("b", 200, 0, "priority"), ("c", 0, 100, "priority"),
             ("d", -100, 50, "priority"), ("f1", 400, 10, "priority"), ("f2", 400, -10, "priority")]
    two_way = [("a", "c"), ("c", "d"), ("d", "a"), ("a", "b")]
    edges = [(f"{x}{y}", x, y, 1) for x, y in two_way] + [(f"{y}{x}", y, x, 1) for x, y in two_way]
    edges += [("out", "b", "f1", 1), ("in", "f2", "b", 1)]
    net = sumolib.net.readNet(str(_plain_net(tmp_path, nodes, edges, con='<delete from="ab" to="ba"/>')))
    assert net.getEdge("ba") not in net.getEdge("ab").getOutgoing()
    assert "ab" not in largest_scc(net, "passenger")
    assert boundary_uturns(net, "passenger", fringe_nodes={"f1", "f2"}) == [("ab", "ba")]


def test_largest_scc_on_grid_is_everything(grid_net):
    net = sumolib.net.readNet(str(grid_net))
    assert largest_scc(net, "passenger") == {e.getID() for e in net.getEdges()}
