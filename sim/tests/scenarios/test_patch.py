"""Patch composition rules (fast)."""
from vhsim.scenarios.patch import Patch


def test_merge_keeps_the_lower_speed():
    a, b = Patch(), Patch()
    a.set_edge("e1", speed="8.33")
    b.set_edge("e1", speed="5.56")
    b.set_edge("e2", speed="5.56")
    m = a.merge(b)
    assert m.edges["e1"]["speed"] == "5.56"
    m2 = b.merge(a)
    assert m2.edges["e1"]["speed"] == "5.56"


def test_a_deleted_edge_loses_its_other_changes_and_movements():
    a = Patch()
    a.set_edge("e1", speed="8.33")
    a.movements["e1"] = {"e2"}
    a.movements["e3"] = {"e1", "e4"}
    b = Patch(edge_deletes={"e1"})
    m = a.merge(b)
    assert "e1" not in m.edges and "e1" in m.edge_deletes
    assert "e1" not in m.movements and m.movements["e3"] == {"e4"}


def test_write_produces_netconvert_patch_files(tmp_path):
    p = Patch(edge_deletes={"gone"}, con_deletes={("a", "b")})
    p.set_edge("e1", speed="8.33")
    p.nodes["n"] = {"x": "1.00", "y": "2.00", "type": "traffic_light"}
    (tmp_path / "old.edg.xml").write_text("<edges/>")
    files = sorted(f.name for f in p.write(tmp_path))
    assert files == ["s6.con.xml", "s6.edg.xml", "s6.nod.xml"]
    assert not (tmp_path / "old.edg.xml").exists()
    edg = (tmp_path / "s6.edg.xml").read_text()
    assert '<delete id="gone"/>' in edg and '<edge id="e1" speed="8.33"/>' in edg
    assert '<delete from="a" to="b"/>' in (tmp_path / "s6.con.xml").read_text()


def test_conflicting_netconvert_options_are_an_error():
    import pytest

    a = Patch(netconvert_options={"--tls.cycle.time": "90"})
    b = Patch(netconvert_options={"--tls.cycle.time": "120"})
    with pytest.raises(ValueError):
        a.merge(b)
    assert a.merge(Patch(netconvert_options={"--tls.cycle.time": "90"})).netconvert_args == ["--tls.cycle.time", "90"]


def test_roundabouts_splits_and_lane_connections_are_written_and_merged(tmp_path):
    a = Patch(roundabouts=[(("r1", "r2", "r3"), ("e12", "e23", "e31"))])
    a.set_edge("crz", numLanes="2")
    a.splits["crz"] = [{"pos": "0", "lanes": "0", "idBefore": "crz.x", "idAfter": "crz"},
                       {"pos": "-40.0", "lanes": "0 1", "idBefore": "crz", "idAfter": "crz.bay"}]
    a.con_lane_adds |= {("crz", "crz.bay", 0, 1), ("crz.bay", "right", 1, 0)}
    b = Patch(edge_deletes={"gone"}, roundabouts=[(("q1", "q2", "q3"), ("f1", "f2", "f3"))])
    m = a.merge(b)
    assert len(m.roundabouts) == 2 and m.splits["crz"][1]["idAfter"] == "crz.bay"
    m.write(tmp_path)
    edg = (tmp_path / "s6.edg.xml").read_text()
    assert '<roundabout nodes="r1 r2 r3" edges="e12 e23 e31"/>' in edg
    assert ('<edge id="crz" numLanes="2"><split pos="0" lanes="0" idBefore="crz.x" idAfter="crz"/>'
            '<split pos="-40.0" lanes="0 1" idBefore="crz" idAfter="crz.bay"/></edge>') in edg
    con = (tmp_path / "s6.con.xml").read_text()
    assert '<connection from="crz" to="crz.bay" fromLane="0" toLane="1"/>' in con
    assert '<connection from="crz.bay" to="right" fromLane="1" toLane="0"/>' in con


def test_a_deleted_edge_drops_its_lane_connections_and_roundabouts_referring_to_it():
    a = Patch(roundabouts=[(("r1", "r2"), ("e1", "e2"))], con_lane_adds={("e1", "x", 0, 0), ("y", "z", 0, 0)})
    m = a.merge(Patch(edge_deletes={"e1"}))
    assert m.con_lane_adds == {("y", "z", 0, 0)}
    assert m.roundabouts == []


def test_conflicting_splits_of_one_edge_are_an_error():
    import pytest

    a, b = Patch(), Patch()
    a.splits["e"] = [{"pos": "-40", "lanes": "0 1", "idBefore": "e", "idAfter": "e.bay"}]
    b.splits["e"] = [{"pos": "-30", "lanes": "0 1", "idBefore": "e", "idAfter": "e.bay"}]
    with pytest.raises(ValueError):
        a.merge(b)
