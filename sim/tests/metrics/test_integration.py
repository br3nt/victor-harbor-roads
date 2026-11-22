"""End-to-end (simulate -> tables -> report) and performance tests."""
import random
import time

import pytest
import sumolib

from vhsim.metrics import accessibility as acc
from vhsim.metrics import movements as mv
from vhsim.metrics import report, run

Z2A = {"Z1": "Victor Harbor"}


def test_end_to_end_accessibility_and_report(grid_net, tmp_path):
    edges = [e.getID() for e in sumolib.net.readNet(str(grid_net)).getEdges()]
    body = "".join(f'<trip id="res~Z1~shops~poi_1~{i:06d}" depart="{i * 5}" from="{edges[0]}" to="{edges[-1]}"/>'
                   for i in range(8))
    f = tmp_path / "t.xml"
    f.write_text(f"<routes>{body}</routes>")
    res = run.simulate(grid_net, f, tmp_path / "o", seed=1, end=900)
    df = acc.table(res.paths["tripinfo"], Z2A)
    row = df[df.hour_band == "all"].iloc[0]
    assert row.n == 8 and row.origin_area == "Victor Harbor" and row["mean"] > 10
    mdf = mv.table(res.paths["vehroute"], grid_net)
    assert (mdf.n > 0).all() and set(mdf.turn) <= {"L", "T", "R", "U"}
    out = report.write(tmp_path / "acc.html", report.accessibility_fragment(df, "grid", "g"))
    assert "Victor Harbor" in out.read_text()


@pytest.mark.slow
def test_accessibility_200k_trips_well_under_a_minute(tmp_path):
    rng = random.Random(3)
    p = tmp_path / "big.xml"
    cats = ["supermarket", "shops", "dining", "medical", "beach_foreshore"]
    with open(p, "w") as fh:
        fh.write("<tripinfos>\n")
        for i in range(200_000):
            t = rng.uniform(0, 86000)
            d = rng.lognormvariate(5.5, 0.6)
            fh.write(f'<tripinfo id="{rng.choice(["res", "vis"])}~Z{i % 40}~{cats[i % 5]}~poi_{i % 17}~{i:06d}" '
                     f'depart="{t:.2f}" departDelay="0.00" arrival="{t + d:.2f}" duration="{d:.2f}"/>\n')
        fh.write("</tripinfos>\n")
    t0 = time.time()
    df = acc.table(p, {f"Z{k}": f"Area{k % 8}" for k in range(40)})
    assert time.time() - t0 < 30
    assert df[df.hour_band == "all"].n.sum() == 200_000
