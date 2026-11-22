import pytest

from vhsim.metrics.ids import VehicleId, parse


def test_parse_contract_example():
    v = parse("res|MB40123450000|supermarket|poi_17|000042")
    assert v == VehicleId("res", "MB40123450000", "supermarket", "poi_17", "000042", "")
    assert v.seq_int == 42


@pytest.mark.parametrize("suffix", [".0", ".12", "_1", "#2", "!reroute"])
def test_parse_tolerates_suffixes(suffix):
    v = parse("vis|Z1|beach_foreshore|poi_3|000007" + suffix)
    assert (v.stratum, v.dest_poi, v.seq) == ("vis", "poi_3", "000007")
    assert v.suffix == suffix


def test_parse_ignores_whitespace():
    assert parse("  res|Z|c|p|1 ").seq == "1"


@pytest.mark.parametrize("bad", ["", "car42", "res|Z|c|p", "res|Z|c|p|x1", "res|Z|c|p|1|extra", "|Z|c|p|1"])
def test_parse_returns_none_for_non_contract_ids(bad):
    assert parse(bad) is None


def test_parse_tilde_separator_and_no_mixing():
    # SUMO rejects "|" in vehicle ids (verified with duarouter 1.28), so "~" is the on-the-wire separator.
    v = parse("res~MB1~supermarket~poi_17~000042.1")
    assert v == VehicleId("res", "MB1", "supermarket", "poi_17", "000042", ".1")
    assert parse("res~MB1|supermarket~poi_17~000042") is None


def test_parse_strict_raises():
    with pytest.raises(ValueError):
        parse("bogus", strict=True)
