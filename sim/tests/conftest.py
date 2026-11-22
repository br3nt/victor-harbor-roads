import os
import subprocess
from pathlib import Path

import pytest

from vhsim.paths import sumo_bin


@pytest.fixture
def grid_net(tmp_path: Path) -> Path:
    """A tiny 3x3 grid network (100 m blocks) built with netgenerate, for fast tests."""
    net = tmp_path / "grid.net.xml"
    subprocess.run(
        [sumo_bin("netgenerate"), "--grid", "--grid.number", "3", "--grid.length", "100",
         "--default.lanenumber", "1", "--default.speed", "13.89", "--tls.guess", "false",
         "-o", str(net)],
        check=True, capture_output=True,
    )
    return net
