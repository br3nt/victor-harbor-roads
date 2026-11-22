"""SUMO additional file that makes a run produce what the viewer needs."""
from __future__ import annotations

from pathlib import Path

LANEDATA_FILE = "viewer_lanedata.xml"
EDGEDATA_FILE = "viewer_edgedata.xml"


def viewer_additional(path, period: int = 900) -> Path:
    """Write an additional file with laneData + edgeData (``period`` seconds) and return its path.

    Pass it to ``vhsim.metrics.run.simulate(..., additional=path)``. SUMO resolves the output file names
    relative to the additional file, so put it in the run's ``out_dir``: the outputs then land next to the
    other run outputs as ``viewer_lanedata.xml`` and ``viewer_edgedata.xml``, which is where
    ``python -m vhsim.viewer.export --run <out_dir>`` looks for them.
    """
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(
        "<additional>\n"
        f'  <laneData id="viewer_lanes" file="{LANEDATA_FILE}" period="{int(period)}" excludeEmpty="true"/>\n'
        f'  <edgeData id="viewer_edges" file="{EDGEDATA_FILE}" period="{int(period)}" excludeEmpty="true"/>\n'
        "</additional>\n")
    return p
