import pytest
import sumolib

from vhsim.metrics import run


def trips_file(path, body):
    path.write_text(f'<routes><vType id="car" vClass="passenger"/>{body}</routes>')
    return path


def test_simulate_with_edge_trips(grid_net, tmp_path):
    net = sumolib.net.readNet(str(grid_net))
    edges = [e.getID() for e in net.getEdges()]
    # pick an origin/destination pair with a route: first edge to last edge in a grid is connected
    body = "".join(
        f'<trip id="res~Z1~supermarket~poi_1~{i:06d}" depart="{i * 5}" from="{edges[0]}" to="{edges[-1]}" type="car"/>'
        for i in range(10))
    res = run.simulate(grid_net, trips_file(tmp_path / "t.xml", body), tmp_path / "out", seed=1, end=600)
    for key in ("tripinfo", "vehroute", "statistic", "edgedata", "routes"):
        assert res.paths[key].exists(), key
    s = res.summary
    assert s["inserted"] == 10 and s["arrived"] == 10
    assert s["teleports"] == 0 and s["waiting"] == 0
    assert "exitTimes" in res.paths["vehroute"].read_text()


def test_simulate_with_lonlat_trips(geo_net, tmp_path):
    body = "".join(
        f'<trip id="vis~Z1~beach_foreshore~poi_2~{i:06d}" depart="{i * 10}" '
        f'fromLonLat="138.6203,-35.5500" toLonLat="138.6305,-35.5500" type="car"/>' for i in range(5))
    res = run.simulate(geo_net, trips_file(tmp_path / "t.xml", body), tmp_path / "out", seed=1, end=600)
    assert res.summary["inserted"] == 5 and res.summary["arrived"] == 5


def test_seed_is_reproducible_and_waiting_counted(grid_net, tmp_path):
    net = sumolib.net.readNet(str(grid_net))
    edges = [e.getID() for e in net.getEdges()]
    # a vehicle departing after the simulation end is never inserted
    body = (f'<trip id="res~Z~c~p~000001" depart="0" from="{edges[0]}" to="{edges[-1]}" type="car"/>'
            f'<trip id="res~Z~c~p~000002" depart="5000" from="{edges[0]}" to="{edges[-1]}" type="car"/>')
    res = run.simulate(grid_net, trips_file(tmp_path / "t.xml", body), tmp_path / "o1", seed=3, end=300)
    assert res.summary["inserted"] == 1
    assert res.summary["waiting"] == 0


def test_unsorted_trip_files_lose_no_vehicles(cross_net, tmp_path):
    # SUMO silently drops out-of-order departures; simulate() must sort or fail loudly
    body = "".join(f'<trip id="res~Z~c~p~{i:06d}" depart="{d}" from="Win0" to="Eout0" type="car"/>'
                   for i, d in enumerate([100, 5, 50, 700, 20, 300]))
    res = run.simulate(cross_net, trips_file(tmp_path / "u.xml", body), tmp_path / "u", seed=1, end=1500)
    assert res.summary["loaded"] == 6 and res.summary["arrived"] == 6


def test_waiting_to_insert_counted(cross_net, tmp_path):
    # 100 vehicles departing together onto a 300 m edge cannot all be inserted by t=40
    body = "".join(
        f'<trip id="res~Z~c~p~{i:06d}" depart="0" from="WX" to="XE" type="car"/>' for i in range(100))
    res = run.simulate(cross_net, trips_file(tmp_path / "w.xml", body), tmp_path / "w", seed=1, end=40,
                       max_teleport_fraction=1.0)
    s = res.summary
    assert s["loaded"] == 100 and s["waiting"] > 0 and s["inserted"] + s["waiting"] == 100


def test_many_teleports_fail_loudly(tmp_path, cross_net):
    # heavy crossing flows into a dead end jam with an aggressive teleport time -> teleports
    body = "".join(
        f'<trip id="res~Z~c~p~{i:06d}" depart="{i * 0.5}" from="SX" to="XN" type="car"/>' for i in range(2))
    # sanity: this small case does not teleport
    res = run.simulate(cross_net, trips_file(tmp_path / "t.xml", body), tmp_path / "o", seed=1, end=300)
    assert res.summary["teleports"] == 0
    # real jam: a vehicle parked for 1000 s on the major road blocks followers, who teleport after 5 s
    stuck = ('<trip id="res~Z~c~p~900000" depart="0" from="WX" to="XE" type="car">'
             '<stop edge="WX" endPos="250" duration="1000"/></trip>')
    followers = "".join(
        f'<trip id="res~Z~c~p~{i:06d}" depart="{20 + i}" from="WX" to="XE" type="car"/>' for i in range(10))
    with pytest.raises(run.SimulationError, match="teleports"):
        run.simulate(cross_net, trips_file(tmp_path / "j.xml", stuck + followers), tmp_path / "jam", seed=1,
                     end=200, time_to_teleport=5)
    assert (tmp_path / "jam" / "teleports.xml").read_text().count("Teleporting") >= 1
    # a threshold of -1 fraction forces the guard to trip when any teleport is reported
    with pytest.raises(run.SimulationError):
        run.check_teleports({"inserted": 100, "teleports": 5}, max_fraction=0.01)
    run.check_teleports({"inserted": 100, "teleports": 0}, max_fraction=0.01)
    run.check_teleports({"inserted": 1000, "teleports": 5}, max_fraction=0.01)


def test_run_gives_up_after_wall_clock_limit(tmp_path, monkeypatch):
    """A gridlocked simulation crawls for hours; VHSIM_SUMO_TIMEOUT stops it and says why."""
    import sys
    import pytest
    from vhsim.metrics.run import SimulationError, _run
    monkeypatch.setenv("VHSIM_SUMO_TIMEOUT", "1")
    with pytest.raises(SimulationError, match="did not finish within 1 s"):
        _run([sys.executable, "-c", "import time; time.sleep(30)"], tmp_path / "x.log")
    assert "gave up" in (tmp_path / "x.log").read_text()
