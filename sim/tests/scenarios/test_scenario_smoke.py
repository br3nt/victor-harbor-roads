"""Every scenario network: a 30-minute smoke run (1,500 trips/h on the town centre and gateways)
finishes without deadlock (slow)."""
import pytest

from vhsim.scenarios.build import SMOKE_END_S, SMOKE_TRIPS

pytestmark = pytest.mark.slow

SCENARIOS_UNDER_TEST = ["c1a", "c1b", "c2", "c3", "c3b", "c4", "cp", "b3", "b4", "bp", "n1", "b5"]


@pytest.mark.parametrize("scen", SCENARIOS_UNDER_TEST)
def test_thirty_minute_smoke_run_has_no_deadlock(built, scen, tmp_path):
    from vhsim.network.smoke import run_smoke

    _, _, root = built(scen)
    res = run_smoke(root / f"{scen}_bays.net.xml", tmp_path, n_trips=SMOKE_TRIPS, seed=7, end=SMOKE_END_S, mode="town")
    assert res["inserted"] == SMOKE_TRIPS
    assert res["arrived"] == res["inserted"], res
    assert res["teleports_jam"] == 0, res["teleport_locations"]
