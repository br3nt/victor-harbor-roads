import json

import pytest

from vhsim.demand.config import DEFAULT_CONFIG, Config, ConfigError


@pytest.fixture(scope="module")
def cfg():
    return Config.load()


def test_default_config_file_location():
    assert DEFAULT_CONFIG.name == "default.json"
    assert DEFAULT_CONFIG.parent.name == "config"
    assert DEFAULT_CONFIG.parent.parent.name == "demand"


def test_every_parameter_has_value_unit_basis_note(cfg):
    assert len(cfg.keys()) > 40
    for key in cfg.keys():
        e = cfg.entry(key)
        assert set(e) >= {"value", "unit", "basis", "note"}, key
        assert e["note"].strip(), key
        assert e["unit"].strip(), key
        b = e["basis"]
        assert b == "assumption" or b.startswith("assumption;") or "S-" in b, (key, b)


def test_assumptions_carry_a_sensitivity(cfg):
    for key in cfg.keys():
        e = cfg.entry(key)
        if e["basis"].startswith("assumption"):
            assert e.get("sensitivity") in ("low", "medium", "high"), key


def test_default_roundtrip(tmp_path, cfg):
    p = tmp_path / "c.json"
    cfg.dump(p)
    again = Config.load(p)
    assert again.to_dict() == cfg.to_dict()
    assert json.loads(p.read_text()) == json.loads(DEFAULT_CONFIG.read_text())


def test_override_top_level_and_nested(cfg):
    c2 = cfg.with_overrides(["rates.senior_weight=0.5", "purpose.shares.weekday_term.work=0.2",
                             'gravity.beta={"default": 2.0}'])
    assert c2["rates.senior_weight"] == 0.5
    assert c2["purpose.shares.weekday_term"]["work"] == 0.2
    assert c2["gravity.beta"] == {"default": 2.0}
    # original untouched
    assert cfg["rates.senior_weight"] != 0.5
    assert c2.overrides == ["rates.senior_weight=0.5", "purpose.shares.weekday_term.work=0.2",
                            'gravity.beta={"default": 2.0}']


def test_override_value_parsing(cfg):
    c2 = cfg.with_overrides(["event.venue=Kent Reserve"])
    assert c2["event.venue"] == "Kent Reserve"


@pytest.mark.parametrize("bad", ["no_equals", "not.a.key=1", "purpose.shares.weekday_term.nosuch=0.1"])
def test_bad_overrides_rejected(cfg, bad):
    with pytest.raises(ConfigError):
        cfg.with_overrides([bad])


def test_shares_sum_to_one(cfg):
    for cond, shares in cfg["purpose.shares"].items():
        assert sum(shares.values()) == pytest.approx(1.0), cond
    assert sum(cfg["visitors.purpose_shares"].values()) == pytest.approx(1.0)
    for gid, split in cfg["gateways.split"].items():
        assert sum(split.values()) == pytest.approx(1.0), gid


def test_formerly_hard_coded_values_are_config(cfg):
    for k in ("event.early_departure_window_h", "event.min_stay_s", "work.town_centre_location",
              "gravity.same_point_km"):
        assert k in cfg.keys(), k
    assert "truck" in cfg["time.dwell_minutes"]


def test_hourly_profiles_have_24_values(cfg):
    for purpose, prof in cfg["time.purpose_profiles"].items():
        assert len(prof) == 24 and sum(prof) > 0, purpose
