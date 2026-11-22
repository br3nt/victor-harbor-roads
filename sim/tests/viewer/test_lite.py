import json

from vhsim.viewer import export, lite


def test_export_writes_a_routing_only_network(town_net, town_run, tmp_path):
    export.main(["--net", str(town_net), "--network-name", "town", "--run", str(town_run.out_dir), "--out", str(tmp_path),
                 "--scenario", "baseline", "--condition", "weekday_term", "--year", "2025", "--growth", "base",
                 "--begin", "0", "--end", "3600"])
    full = json.loads((tmp_path / "networks" / "town.json").read_text())
    small = json.loads((tmp_path / "networks" / "town.lite.json").read_text())
    assert "lanes" not in small
    assert small["hash"] == full["hash"] and small["n_lanes"] == len(full["lanes"]["id"])
    assert small["edges"]["id"] == full["edges"]["id"] and small["edges"]["next"] == full["edges"]["next"]
    assert "lanes" not in small["edges"] and "slot" in small["edges"]
    assert all(abs(a - b) < 6e-6 for a, b in zip(small["edges"]["shape"][0], full["edges"]["shape"][0]))
    assert small["pois"] == full["pois"]


def test_lite_cli_backfills_an_existing_folder(town_net, town_run, tmp_path):
    export.main(["--net", str(town_net), "--network-name", "town", "--run", str(town_run.out_dir), "--out", str(tmp_path),
                 "--scenario", "baseline", "--condition", "weekday_term", "--year", "2025", "--growth", "base",
                 "--begin", "0", "--end", "3600"])
    (tmp_path / "networks" / "town.lite.json").unlink()
    lite.main(["--data", str(tmp_path)])
    assert (tmp_path / "networks" / "town.lite.json").exists()
    full = (tmp_path / "networks" / "town.json").stat().st_size
    assert (tmp_path / "networks" / "town.lite.json").stat().st_size < 0.8 * full
