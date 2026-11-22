"""S7 diagnosis: vehicle-hours stopped per approach and hotspot from hourly edgeData (fast)."""
import pandas as pd
import pytest
import sumolib

from vhsim.integration import bottlenecks as bn

EDGEDATA = """<?xml version="1.0"?>
<meandata>
    <interval begin="0.00" end="3600.00" id="edgedata">
        <edge id="A0A1" waitingTime="0.00" timeLoss="1.0" entered="10" departed="2"/>
        <edge id="A1A2" waitingTime="360.00" timeLoss="400.0" entered="20" departed="0"/>
    </interval>
    <interval begin="3600.00" end="7200.00" id="edgedata">
        <edge id="A1A2" waitingTime="720.00" timeLoss="800.0" entered="10" departed="0"/>
        <edge id="A1A2.bay" waitingTime="1800.00" timeLoss="1900.0" entered="30" departed="0"/>
        <edge id="s7_ring_x_0_1" waitingTime="36.00" timeLoss="40.0" entered="5" departed="0"/>
    </interval>
</meandata>
"""


@pytest.fixture
def run_dir(tmp_path):
    d = tmp_path / "run"
    d.mkdir()
    (d / "edgedata.xml").write_text(EDGEDATA)
    return d


def test_edge_hourly_reads_waiting_and_vehicles_per_hour(run_dir):
    h = bn.edge_hourly(run_dir)
    row = h[(h.edge == "A0A1") & (h.hour == 0)].iloc[0]
    assert row.veh == 12 and row.wait_s == 0
    assert set(h[h.edge == "A1A2"].hour) == {0, 1}


def test_seed_mean_averages_over_runs(run_dir, tmp_path):
    other = tmp_path / "run2"
    other.mkdir()
    (other / "edgedata.xml").write_text(EDGEDATA.replace('waitingTime="360.00"', 'waitingTime="0.00"'))
    m = bn.seed_mean([run_dir, other])
    assert m[(m.edge == "A1A2") & (m.hour == 0)].wait_s.iloc[0] == pytest.approx(180.0)


def test_approaches_merge_the_bay_and_charge_the_junction_at_its_end(run_dir, grid_net):
    net = sumolib.net.readNet(str(grid_net))
    labels = bn.edge_labels(net, {"A2": "named_a2"})
    # pretend A1A2 has a bay: the bay edge ends where A1A2 ends (A2)
    bay = labels[labels.edge == "A1A2"].copy()
    bay["edge"] = "A1A2.bay"
    labels = pd.concat([labels, bay])
    labels.loc[labels.edge == "A1A2", ["node", "junction"]] = ["A1A2.mid", "A1A2.mid"]
    tab = bn.approaches(bn.edge_hourly(run_dir), labels)
    a = tab[tab.approach == "A1A2"].iloc[0]
    assert a.junction == "named_a2"
    assert a.wait_veh_h == pytest.approx((360 + 720 + 1800) / 3600, abs=0.01)
    assert a.veh_per_day == 30                    # vehicles on the approach itself, not counted again on the bay
    assert a.wait_s_per_veh == pytest.approx(2880 / 30, abs=0.1)
    assert a.peak_hour == 1
    assert tab.iloc[0].approach == "A1A2"         # sorted by vehicle-hours stopped


def test_hotspot_members_and_wait_include_bays_and_ring_edges(run_dir, grid_net):
    net = sumolib.net.readNet(str(grid_net))
    labels = bn.edge_labels(net)
    members = bn.hotspot_members("t", labels, {"nodes": ["A2"]})
    assert "A1A2" in members and "A0A1" not in members
    w = bn.hotspot_wait(bn.edge_hourly(run_dir), members, ring_prefix="s7_ring_x")
    assert w.sum() == pytest.approx((360 + 720 + 1800 + 36) / 3600)
    assert w.loc[1] == pytest.approx((720 + 1800 + 36) / 3600)
