from pathlib import Path

import pytest


@pytest.fixture(scope="session")
def baseline(tmp_path_factory):
    """Build the real baseline once per session into a temporary directory (slow tests only)."""
    from vhsim.network.build import build

    out = tmp_path_factory.mktemp("networks")
    report = build(out_dir=out)
    return {"dir": Path(out), "net": Path(out) / "baseline.net.xml", "report": report}


@pytest.fixture(scope="session")
def baseline_net(baseline):
    import sumolib

    return sumolib.net.readNet(str(baseline["net"]))
