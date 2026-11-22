"""Scenario patch mechanism on the 3x3 grid (fast)."""
import subprocess

import pytest
import sumolib

from vhsim.network import scenario
from vhsim.paths import sumo_bin


@pytest.fixture
def grid_plain(grid_net, tmp_path):
    base = tmp_path / "base.plain"
    base.mkdir()
    subprocess.run([sumo_bin("netconvert"), "-s", str(grid_net), "--plain-output-prefix", str(base / "baseline")],
                   check=True, capture_output=True)
    return base


def test_speed_patch_changes_only_the_patched_edge(grid_plain, grid_net, tmp_path):
    patches = tmp_path / "patches"
    patches.mkdir()
    (patches / "slow.edg.xml").write_text('<edges><edge id="A0A1" speed="5.00"/></edges>')
    out = scenario.build("slow_a0a1", patches, base_dir=grid_plain, out_dir=tmp_path)
    assert out == tmp_path / "slow_a0a1.net.xml"
    net = sumolib.net.readNet(str(out))
    base = sumolib.net.readNet(str(grid_net))
    assert net.getEdge("A0A1").getSpeed() == pytest.approx(5.0)
    for e in base.getEdges():
        if e.getID() != "A0A1":
            assert net.getEdge(e.getID()).getSpeed() == pytest.approx(e.getSpeed())


def test_no_patches_reproduces_the_base(grid_plain, grid_net, tmp_path):
    patches = tmp_path / "none"
    patches.mkdir()
    out = scenario.build("same", patches, base_dir=grid_plain, out_dir=tmp_path)
    net = sumolib.net.readNet(str(out))
    base = sumolib.net.readNet(str(grid_net))
    assert {e.getID() for e in net.getEdges()} == {e.getID() for e in base.getEdges()}
    assert sum(len(e.getOutgoing()) for e in net.getEdges()) == sum(len(e.getOutgoing()) for e in base.getEdges())


def test_connection_delete_patch_removes_a_turn(grid_plain, tmp_path):
    patches = tmp_path / "p"
    patches.mkdir()
    (patches / "ban.con.xml").write_text('<connections><delete from="A0A1" to="A1B1"/></connections>')
    out = scenario.build("ban", patches, base_dir=grid_plain, out_dir=tmp_path)
    net = sumolib.net.readNet(str(out))
    assert net.getEdge("A1B1") not in net.getEdge("A0A1").getOutgoing()


def test_unknown_patch_files_are_rejected(grid_plain, tmp_path):
    patches = tmp_path / "bad"
    patches.mkdir()
    (patches / "notes.txt").write_text("x")
    with pytest.raises(ValueError):
        scenario.build("bad", patches, base_dir=grid_plain, out_dir=tmp_path)


def test_missing_base_is_an_error(tmp_path):
    with pytest.raises(FileNotFoundError):
        scenario.build("x", tmp_path, base_dir=tmp_path / "nope", out_dir=tmp_path)


def test_plain_output_is_written_next_to_the_net(grid_plain, tmp_path):
    patches = tmp_path / "p"
    patches.mkdir()
    (patches / "slow.edg.xml").write_text('<edges><edge id="A0A1" speed="5.00"/></edges>')
    out = scenario.build("slow", patches, base_dir=grid_plain, out_dir=tmp_path, plain_output=True)
    plain = tmp_path / "slow.plain"
    for kind in ("nod", "edg", "con"):
        assert (plain / f"slow.{kind}.xml").exists()
    assert 'speed="5.00"' in (plain / "slow.edg.xml").read_text()
    assert out.exists()


def test_deleting_an_edge_drops_base_connections_that_use_it(grid_plain, tmp_path):
    # the base con file lists connections into and out of A0A1; deleting the edge must not make
    # netconvert fail on those now-dangling connections
    assert 'from="A0A1"' in (grid_plain / "baseline.con.xml").read_text()
    patches = tmp_path / "p"
    patches.mkdir()
    (patches / "gone.edg.xml").write_text('<edges><delete id="A0A1"/></edges>')
    out = scenario.build("gone", patches, base_dir=grid_plain, out_dir=tmp_path)
    net = sumolib.net.readNet(str(out))
    assert not net.hasEdge("A0A1")
    assert net.hasEdge("A1A0")


def test_widening_an_edge_recomputes_its_connections_for_every_lane(grid_plain, tmp_path):
    # base connections are lane-specific (fromLane 0 only); a widened edge's new lane must not be a dead end
    patches = tmp_path / "p"
    patches.mkdir()
    (patches / "wide.edg.xml").write_text('<edges><edge id="A0A1" numLanes="2"/></edges>')
    out = scenario.build("wide", patches, base_dir=grid_plain, out_dir=tmp_path)
    net = sumolib.net.readNet(str(out))
    lanes = net.getEdge("A0A1").getLanes()
    assert len(lanes) == 2
    assert all(lane.getOutgoing() for lane in lanes)
    # movements are kept (connections into the widened edge are untouched)
    assert {e.getID() for e in net.getEdge("A0A1").getOutgoing()} >= {"A1A2"}


def test_moving_an_edge_to_a_new_node_drops_its_old_junction_connections(grid_plain, tmp_path):
    # S7 roundabouts re-end approach edges at new ring nodes: the base connections at the old junction
    # (A0A1 -> A1*) no longer apply and must not make netconvert fail
    patches = tmp_path / "p"
    patches.mkdir()
    (patches / "move.edg.xml").write_text('<edges><edge id="A0A1" to="B1"/><edge id="A1B1" from="A0"/></edges>')
    out = scenario.build("move", patches, base_dir=grid_plain, out_dir=tmp_path)
    net = sumolib.net.readNet(str(out))
    assert net.getEdge("A0A1").getToNode().getID() == "B1"
    assert net.getEdge("A0A1").getOutgoing()                      # recomputed at B1
    assert net.getEdge("A1B1").getFromNode().getID() == "A0"


def test_restating_an_unchanged_end_node_is_not_a_move(grid_plain, tmp_path):
    # only a real move drops an edge's baseline connections (and with them any turn bans)
    patch = tmp_path / "same.edg.xml"
    patch.write_text('<edges><edge id="A0A1" to="A1"/><edge id="A1B1" from="A0"/></edges>')
    ends, starts = scenario._rejoined_edges([patch], grid_plain / "baseline.edg.xml")
    assert ends == set() and starts == {"A1B1"}
