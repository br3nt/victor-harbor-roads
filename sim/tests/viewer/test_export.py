import json
import shutil

import numpy as np
import pytest

from vhsim.viewer import export, formats


@pytest.fixture(scope="module")
def exported(town_net, town_run, tmp_path_factory):
    out = tmp_path_factory.mktemp("viewer")
    export.main(["--net", str(town_net), "--network-name", "town", "--run", str(town_run.out_dir),
                 "--out", str(out), "--scenario", "baseline", "--condition", "weekday_term", "--year", "2025",
                 "--growth", "base", "--seed", "1", "--begin", "0", "--end", "3600",
                 "--bookmark", "00:20=School bell"])
    return out


def test_index_lists_run_and_network(exported):
    idx = json.loads((exported / "index.json").read_text())
    assert idx["version"] == 1
    assert idx["networks"] == {"town": "networks/town.json"}
    (run,) = idx["runs"]
    assert run["id"] == "baseline__weekday_term__2025-base__s1"
    assert run["network"] == "town" and run["path"] == f"runs/{run['id']}/meta.json"
    for k in ("scenario", "condition", "year", "growth", "seed"):
        assert k in run


def test_meta_contract(exported):
    meta = json.loads((exported / "runs" / "baseline__weekday_term__2025-base__s1" / "meta.json").read_text())
    assert meta["interval_s"] == 900 and meta["n_intervals"] == 4 and meta["begin_s"] == 0
    assert meta["network"] == "town" and meta["year"] == 2025 and meta["growth"] == "base"
    assert meta["n_lanes"] > 0 and meta["n_edges"] > 0
    kinds = {b["kind"] for b in meta["bookmarks"]}
    assert kinds == {"auto", "scenario"}
    assert any(b["label"] == "School bell (12:20 am)" for b in meta["bookmarks"])
    assert any(b["detail"].get("type") == "queue" for b in meta["bookmarks"])
    assert len(meta["series"]["delay_veh_h"]) == 4
    assert meta["summary"]["inserted"] > 0
    assert meta["files"]["lanes"]["path"] == "lanes.bin.gz"
    assert meta["sources"] and meta["sources"][0].endswith("out")


def test_binaries_decode_with_meta_layout(exported):
    d = exported / "runs" / "baseline__weekday_term__2025-base__s1"
    meta = json.loads((d / "meta.json").read_text())
    net = json.loads((exported / "networks" / "town.json").read_text())
    T, N, E = meta["n_intervals"], meta["n_lanes"], meta["n_edges"]
    assert N == len(net["lanes"]["id"]) and E == len(net["edges"]["id"])
    lanes = formats.read_lanes(d / meta["files"]["lanes"]["path"], meta["files"]["lanes"], T, N)
    tt = formats.read_edge_times(d / meta["files"]["edge_times"]["path"], meta["files"]["edge_times"], T, E)
    assert tt.shape == (T, E) and np.all(np.isfinite(tt)) and np.all(tt > 0)
    assert np.nanmax(lanes["speed_ratio"]) <= 1.0


def test_seed_mean_from_two_runs(town_net, town_run, tmp_path):
    second = tmp_path / "seed2"
    shutil.copytree(town_run.out_dir, second)
    # make seed 2 differ: every measured edge travel time doubled
    import re
    p = second / "viewer_edgedata.xml"
    p.write_text(re.sub(r' traveltime="([0-9.]+)"', lambda m: f' traveltime="{2 * float(m.group(1)):.2f}"', p.read_text()))
    out = tmp_path / "v"
    export.main(["--net", str(town_net), "--network-name", "town", "--run", str(town_run.out_dir),
                 "--run", str(second), "--out", str(out), "--scenario", "baseline", "--condition", "saturday",
                 "--year", "2031", "--growth", "high", "--begin", "0", "--end", "3600"])
    idx = json.loads((out / "index.json").read_text())
    (run,) = idx["runs"]
    assert run["seed"] == "mean" and run["id"].endswith("__mean")
    meta = json.loads((out / run["path"]).read_text())
    assert len(meta["sources"]) == 2
    one = tmp_path / "one"
    export.main(["--net", str(town_net), "--network-name", "town", "--run", str(town_run.out_dir), "--out", str(one),
                 "--scenario", "baseline", "--condition", "saturday", "--year", "2031", "--growth", "high",
                 "--seed", "1", "--begin", "0", "--end", "3600"])
    m1 = json.loads((one / "runs" / "baseline__saturday__2031-high__s1" / "meta.json").read_text())
    rd1, rdm = one / "runs" / "baseline__saturday__2031-high__s1", out / "runs" / run["id"]
    t1 = formats.read_edge_times(rd1 / m1["files"]["edge_times"]["path"], m1["files"]["edge_times"], 4, m1["n_edges"])
    tm = formats.read_edge_times(rdm / meta["files"]["edge_times"]["path"], meta["files"]["edge_times"], 4, meta["n_edges"])
    nj = json.loads((out / "networks" / "town.json").read_text())
    e = nj["edges"]["id"].index("n01n11")
    assert tm[1, e] == pytest.approx(1.5 * t1[1, e], rel=0.01)       # mean of x and 2x


def test_meta_carries_the_network_hash(exported):
    meta = json.loads((exported / "runs" / "baseline__weekday_term__2025-base__s1" / "meta.json").read_text())
    net = json.loads((exported / "networks" / "town.json").read_text())
    assert meta["network_hash"] == net["hash"]


def test_refuses_to_replace_a_network_with_a_different_one(exported, town_run, tmp_path):
    from tests.viewer.conftest import build_net
    other = build_net(tmp_path, centre_oneway=False)
    args = ["--net", str(other), "--network-name", "town", "--run", str(town_run.out_dir), "--out", str(exported),
            "--scenario", "x", "--condition", "weekday_term", "--year", "2025", "--growth", "base",
            "--begin", "0", "--end", "3600"]
    with pytest.raises(ValueError, match="different network"):
        export.main(args)


def test_wrong_net_for_the_run_fails_loudly(town_run, tmp_path):
    from vhsim.paths import sumo_bin
    import subprocess
    (tmp_path / "w.nod.xml").write_text('<nodes><node id="p" x="138.60" y="-35.53"/><node id="q" x="138.61" y="-35.53"/></nodes>')
    (tmp_path / "w.edg.xml").write_text('<edges><edge id="pq" from="p" to="q"/><edge id="qp" from="q" to="p"/></edges>')
    grid = tmp_path / "w.net.xml"
    subprocess.run([sumo_bin("netconvert"), "-n", str(tmp_path / "w.nod.xml"), "-e", str(tmp_path / "w.edg.xml"),
                    "--proj.utm", "--proj.plain-geo", "-o", str(grid)], check=True, capture_output=True)
    with pytest.raises(ValueError, match="not in the network"):
        export.main(["--net", str(grid), "--run", str(town_run.out_dir), "--out", str(tmp_path / "o"),
                     "--scenario", "x", "--condition", "c", "--year", "2025", "--growth", "base"])


def test_committed_sample_is_small_and_consistent():
    from vhsim.paths import DATA

    d = DATA / "viewer" / "sample"
    assert sum(p.stat().st_size for p in d.rglob("*") if p.is_file()) < 3_000_000
    idx = json.loads((d / "index.json").read_text())
    assert {r["scenario"] for r in idx["runs"]} >= {"baseline", "test_variant"}
    for r in idx["runs"]:
        meta = json.loads((d / r["path"]).read_text())
        assert meta["synthetic"] is True and "/Users/" not in json.dumps(meta)
        net = json.loads((d / idx["networks"][meta["network"]]).read_text())
        assert meta["n_lanes"] == len(net["lanes"]["id"]) and meta["n_edges"] == len(net["edges"]["id"])
        rd = (d / r["path"]).parent
        formats.read_lanes(rd / meta["files"]["lanes"]["path"], meta["files"]["lanes"], meta["n_intervals"],
                           meta["n_lanes"])


def test_index_merges_runs(exported, town_net, town_run):
    export.main(["--net", str(town_net), "--network-name", "town", "--run", str(town_run.out_dir),
                 "--out", str(exported), "--scenario", "test_variant", "--condition", "weekday_term",
                 "--year", "2025", "--growth", "base", "--seed", "1", "--begin", "0", "--end", "3600"])
    idx = json.loads((exported / "index.json").read_text())
    assert sorted(r["scenario"] for r in idx["runs"]) == ["baseline", "test_variant"]
