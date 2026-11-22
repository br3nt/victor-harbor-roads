"""Re-timing exported runs with the sparse-sample rule (vhsim.viewer.retime; assumption V1a)."""
import json

import numpy as np
import pytest

from vhsim.viewer import formats
from vhsim.viewer.retime import retime_run

EDGEDATA = """<meandata>
  <interval begin="0.00" end="900.00" id="viewer_edges">
    <edge id="e" sampledSeconds="320.29" traveltime="51.90" speed="3.71"/>
  </interval>
  <interval begin="900.00" end="1800.00" id="viewer_edges">
    <edge id="e" sampledSeconds="11.77" traveltime="19307.72" speed="0.40"/>
  </interval>
</meandata>
"""


def _data(tmp_path, seeds=2):
    data = tmp_path / "viewer"
    (data / "networks").mkdir(parents=True)
    (data / "networks" / "n.json").write_text(json.dumps({"edges": {"id": ["e"], "length": [194.0],
                                                                      "speed_kmh": [50.0]}}))
    sources = []
    for s in range(seeds):
        d = tmp_path / f"run_s{s}"
        d.mkdir()
        (d / "viewer_edgedata.xml").write_text(EDGEDATA)
        sources.append(str(d))
    rdir = data / "runs" / "r"
    rdir.mkdir(parents=True)
    old = np.array([[51.9], [6553.4]])                           # as exported before the fix (capped)
    layout = formats.write_edge_times(rdir / "edge_times.bin.gz", old)
    meta = {"run_id": "r", "network": "n", "begin_s": 0.0, "interval_s": 900.0, "n_intervals": 2, "n_edges": 1,
            "files": {"edge_times": layout}, "sources": sources, "synthetic": False}
    (rdir / "meta.json").write_text(json.dumps(meta))
    return data


def test_retime_replaces_the_sparse_sample_spike(tmp_path):
    data = _data(tmp_path)
    res = retime_run(data, "r")
    assert res["changed"] == 1 and res["over_300s"] == 1
    meta = json.loads((data / "runs" / "r" / "meta.json").read_text())
    tt = formats.read_edge_times(data / "runs" / "r" / "edge_times.bin.gz", meta["files"]["edge_times"], 2, 1)
    ff = 194.0 / (50 / 3.6)
    assert tt[0, 0] == pytest.approx(51.9, abs=0.05)
    assert tt[1, 0] == pytest.approx(11.77 + ff * (1 - 11.77 / 19307.72), abs=0.05)
    assert meta["edge_time_rule"] == "V1a"


def test_retime_dry_run_and_missing_sources(tmp_path):
    data = _data(tmp_path)
    before = (data / "runs" / "r" / "edge_times.bin.gz").read_bytes()
    assert retime_run(data, "r", dry_run=True)["over_300s"] == 1
    assert (data / "runs" / "r" / "edge_times.bin.gz").read_bytes() == before
    (tmp_path / "run_s0" / "viewer_edgedata.xml").unlink()
    assert "skipped" in retime_run(data, "r")
