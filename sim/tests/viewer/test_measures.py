import numpy as np
import pytest

from vhsim.viewer import formats
from vhsim.viewer.additional import viewer_additional
from vhsim.viewer.measures import MeanData, edge_times, lane_measures, network_series, read_meandata
from vhsim.viewer.network import network_json


def test_viewer_additional_file(tmp_path):
    p = viewer_additional(tmp_path / "v.add.xml", period=900)
    text = p.read_text()
    assert 'laneData id="viewer_lanes"' in text and 'edgeData id="viewer_edges"' in text
    assert text.count('period="900"') == 2
    assert 'file="viewer_lanedata.xml"' in text and 'file="viewer_edgedata.xml"' in text


def test_simulation_writes_viewer_outputs(town_run):
    out = town_run.out_dir
    assert (out / "viewer_lanedata.xml").exists() and (out / "viewer_edgedata.xml").exists()
    data = read_meandata(out / "viewer_lanedata.xml", level="lane")
    assert data.begins[:3] == [0.0, 900.0, 1800.0] and data.period == 900
    assert "n10n11_0" in data.values[1]


@pytest.fixture(scope="module")
def nj(town_net):
    return network_json(town_net, name="town")


def test_edge_times_free_flow_fill_and_congestion(nj, town_run):
    ed = read_meandata(town_run.out_dir / "viewer_edgedata.xml", level="edge")
    tt = edge_times(nj, ed, begin=0, n_intervals=4)
    assert tt.shape == (4, len(nj["edges"]["id"])) and tt.dtype == np.float64
    e = nj["edges"]["id"].index("n01n11")         # Centre St approach that gives way to Main Rd
    ff = nj["edges"]["length"][e] / (nj["edges"]["speed_kmh"][e] / 3.6)
    unused = nj["edges"]["id"].index("n22n21")      # South St westbound: never used
    assert tt[0, unused] == pytest.approx(nj["edges"]["length"][unused] / (13.89), rel=0.01)
    # interval 0 has no traffic there (free flow); the rush in interval 1 queues behind Main Rd traffic
    assert tt[0, e] == pytest.approx(ff, rel=0.01)
    assert tt[1, e] > 1.5 * ff


def _one_edge_nj(length=194.0, speed_kmh=50.0):
    return {"edges": {"id": ["e"], "length": [length], "speed_kmh": [speed_kmh]}}


def test_edge_time_capped_at_observed_vehicle_seconds():
    """SUMO's edgeData traveltime is length x vehicle-seconds / distance the vehicles' fronts travelled. When the
    only sample is a vehicle already waiting at the stop line as the interval starts (it moves a few centimetres,
    then leaves), that extrapolates to hours: Grantley Ave, 2025 summer baseline seed 2, 12:15-12:30, 19,308 s from
    11.8 vehicle-seconds (the vehicle's whole traversal took 40 s). With less than one edge length travelled, the
    time is the vehicle-seconds observed plus free flow over the part of the edge not covered."""
    ed = MeanData(period=900.0, begins=[0.0, 900.0, 1800.0], values=[
        {"e": {"sampledSeconds": 11.77, "traveltime": 19307.72, "speed": 0.40}},     # one vehicle leaving the stop line
        {"e": {"sampledSeconds": 320.29, "traveltime": 51.90, "speed": 3.71}},       # a normal busy interval
        {"e": {"sampledSeconds": 4500.0, "traveltime": 30000.0, "speed": 0.02}},     # a real jam: 5 vehicles stuck
    ])
    tt = edge_times(_one_edge_nj(), ed, begin=0, n_intervals=3)
    ff = 194.0 / (50 / 3.6)
    # 11.77 s observed + free flow over the 193.9 m the vehicle front did not cover
    assert tt[0, 0] == pytest.approx(11.77 + ff * (1 - 11.77 / 19307.72), abs=0.01)
    assert tt[1, 0] == pytest.approx(51.90)                # unchanged when the vehicles covered the edge
    assert tt[2, 0] == pytest.approx(4500.0 + ff * (1 - 4500 / 30000))   # a jam stays long


def test_lane_measures_shapes_and_ranges(nj, town_run):
    ld = read_meandata(town_run.out_dir / "viewer_lanedata.xml", level="lane")
    m = lane_measures(nj, ld, begin=0, n_intervals=4)
    n = len(nj["lanes"]["id"])
    for k in ("speed_ratio", "waiting_s", "vehicles", "density"):
        assert m[k].shape == (4, n), k
    i = nj["lanes"]["id"].index("n01n11_0")
    unused = nj["lanes"]["id"].index("n22n21_0")
    assert np.isnan(m["speed_ratio"][0, unused])               # no vehicles -> missing
    assert 0 < m["speed_ratio"][1, i] <= 1.3
    assert m["vehicles"][1].sum() > m["vehicles"][0].sum()
    assert m["waiting_s"][1].sum() > 0


def test_network_series(nj, town_run):
    ed = read_meandata(town_run.out_dir / "viewer_edgedata.xml", level="edge")
    s = network_series(nj, ed, begin=0, n_intervals=4)
    assert len(s["delay_veh_h"]) == 4 and s["delay_veh_h"][1] == max(s["delay_veh_h"])
    assert s["vehicles_mean"][1] > s["vehicles_mean"][0]


def test_binary_round_trip(tmp_path):
    rng = np.random.default_rng(1)
    T, N, E = 3, 5, 4
    m = {"speed_ratio": rng.uniform(0, 1.2, (T, N)), "waiting_s": rng.uniform(0, 70000, (T, N)),
         "vehicles": rng.integers(0, 300, (T, N)).astype(float), "density": rng.uniform(0, 300, (T, N))}
    m["speed_ratio"][0, 0] = np.nan
    m["density"][0, 0] = np.nan
    m["waiting_s"][1, 1] = 70000
    layout = formats.write_lanes(tmp_path / "lanes.bin.gz", m)
    back = formats.read_lanes(tmp_path / "lanes.bin.gz", layout, T, N)
    assert np.isnan(back["speed_ratio"][0, 0]) and np.isnan(back["density"][0, 0])
    ok = ~np.isnan(m["speed_ratio"])
    assert np.allclose(back["speed_ratio"][ok], np.minimum(m["speed_ratio"][ok], 1.0), atol=0.5 / 254)
    # waiting is stored in 2 s steps: 70000 s fits, the cap is 131070 s (~145 vehicles halted all interval)
    assert back["waiting_s"][1, 1] == 70000 and np.all(back["waiting_s"] <= 131070)
    assert np.allclose(back["vehicles"], m["vehicles"])
    assert np.all(back["density"][~np.isnan(back["density"])] <= 254)
    # every plane starts on a 4-byte boundary so the browser can view it as a typed array
    assert all(p["offset"] % 4 == 0 for p in layout["planes"])

    tt = rng.uniform(1, 9000, (T, E))
    tt[2, 3] = np.inf
    tl = formats.write_edge_times(tmp_path / "edge_times.bin.gz", tt)
    back_tt = formats.read_edge_times(tmp_path / "edge_times.bin.gz", tl, T, E)
    assert np.isinf(back_tt[2, 3])
    fin = np.isfinite(tt)
    assert np.allclose(back_tt[fin], np.minimum(tt[fin], 6553.4), atol=0.051)


def test_gzip_is_deterministic(tmp_path):
    m = {"speed_ratio": np.zeros((2, 2)), "waiting_s": np.zeros((2, 2)), "vehicles": np.zeros((2, 2)),
         "density": np.zeros((2, 2))}
    formats.write_lanes(tmp_path / "a.bin.gz", m)
    formats.write_lanes(tmp_path / "b.bin.gz", m)
    assert (tmp_path / "a.bin.gz").read_bytes() == (tmp_path / "b.bin.gz").read_bytes()
