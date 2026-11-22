import subprocess

from vhsim.paths import SOURCES, sumo_bin


def test_sumo_runs_on_grid(grid_net, tmp_path):
    trips = tmp_path / "t.trips.xml"
    edges = [l for l in grid_net.read_text().splitlines() if '<edge id="' in l and 'function="internal"' not in l]
    first, last = edges[0].split('"')[1], edges[-1].split('"')[1]
    trips.write_text(f'<routes><trip id="v0" depart="0" from="{first}" to="{last}"/></routes>')
    out = tmp_path / "tripinfo.xml"
    subprocess.run([sumo_bin("sumo"), "-n", str(grid_net), "-r", str(trips), "--tripinfo-output", str(out),
                    "--no-step-log", "true"], check=True, capture_output=True)
    assert '<tripinfo id="v0"' in out.read_text()


def test_sources_reachable():
    assert (SOURCES / "E" / "S-E01-overpass-victor-harbor.osm").exists()
