"""SUMO accepts the demand files: duarouter routes a sample of trips on a quick OSM import."""
import subprocess
import xml.etree.ElementTree as ET

import pytest

from vhsim.demand import build
from vhsim.demand.params import OSM_EXTRACT
from vhsim.paths import sumo_bin


@pytest.mark.slow
def test_duarouter_routes_sample_trips(tmp_path):
    net = tmp_path / "vh.net.xml"
    subprocess.run([sumo_bin("netconvert"), "--osm-files", str(OSM_EXTRACT), "-o", str(net),
                    "--geometry.remove", "--roundabouts.guess", "--junctions.join", "--no-warnings",
                    "--keep-edges.by-vclass", "passenger,truck"], check=True, capture_output=True)
    build.main(["--condition", "event_nye", "--year", "2025", "--growth", "base", "--out-dir", str(tmp_path),
                "--no-zones"])
    src = (tmp_path / "event_nye_2025_base.trips.xml").read_text().splitlines()
    head = [ln for ln in src if not ln.strip().startswith("<trip")][:-1]
    body = [ln for ln in src if ln.strip().startswith("<trip")]
    sample = body[::60]                      # every 60th trip: all strata and types appear
    (tmp_path / "sample.trips.xml").write_text("\n".join(head + sample + ["</routes>"]) + "\n")
    out = tmp_path / "sample.rou.xml"
    r = subprocess.run([sumo_bin("duarouter"), "-n", str(net), "--route-files", str(tmp_path / "sample.trips.xml"),
                        "--additional-files", str(tmp_path / "vtypes.add.xml"), "-o", str(out),
                        "--mapmatch.distance", "200", "--ignore-errors", "--no-step-log"],
                       capture_output=True, text=True)
    assert r.returncode == 0, r.stderr[-2000:]
    assert "Invalid" not in r.stderr, r.stderr[-2000:]
    routed = ET.parse(out).getroot().findall("vehicle")
    types = {v.get("type") for v in routed}
    assert len(routed) >= 0.9 * len(sample), r.stderr[-2000:]
    assert {"car", "caravan"} <= types
