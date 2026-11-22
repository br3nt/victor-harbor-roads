import json

from vhsim.viewer.jammed import jammed_runs, update_index


def _group(d, key, scenario, condition, year, growth, seeds, errors):
    (d / key).mkdir(parents=True)
    (d / key / "network.json").write_text(json.dumps(dict(
        key=key, scenario=scenario, condition=condition, year=year, growth=growth, seeds=seeds,
        errors=[{"error": e} for e in errors])))


def test_only_groups_where_every_seed_hit_the_cap_are_jammed(tmp_path):
    cap = "sumo did not finish within 2700 s (likely gridlock); see x"
    _group(tmp_path, "cp__weekday_term_2051_high", "cp", "weekday_term", "2051", "high", [], [cap, cap])
    _group(tmp_path, "cp__summer_peak_2041_moderate", "cp", "summer_peak", "2041", "moderate", [1], [cap])   # one seed ran
    _group(tmp_path, "b3__summer_peak_2031_high", "b3", "summer_peak", "2031", "high", [], ["duarouter failed"])  # broken, not jammed
    (tmp_path / "report_2025_base").mkdir()   # not a run group
    assert jammed_runs(tmp_path) == [dict(scenario="cp", condition="weekday_term", year=2051, growth="high")]


def test_update_index_writes_the_list_and_keeps_the_rest(tmp_path):
    res = tmp_path / "results"
    _group(res, "baseline__summer_peak_2051_moderate", "baseline", "summer_peak", "2051", "moderate", [],
           ["sumo did not finish within 2700 s (likely gridlock)"])
    idx = tmp_path / "index.json"
    idx.write_text(json.dumps({"version": 1, "runs": [{"id": "a"}], "networks": {}}))
    n = update_index(idx, res)
    out = json.loads(idx.read_text())
    assert n == 1 and out["runs"] == [{"id": "a"}]
    assert out["jammed"] == [dict(scenario="baseline", condition="summer_peak", year=2051, growth="moderate")]
