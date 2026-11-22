import pytest

from vhsim.demand.ids import SEP, STRATA, TripId, format_id, parse_id


def test_separator_is_tilde():
    # SUMO 1.28 rejects '|' in trip ids; the contract uses '~' (coordinator change).
    assert SEP == "~"


def test_format_matches_design_example():
    assert format_id("res", "MB40123450000", "supermarket", "poi_17", 42) == \
        "res~MB40123450000~supermarket~poi_17~000042"


def test_parse_roundtrip():
    tid = parse_id("vis~gw_vhr~beach_foreshore~poi_3~001234")
    assert tid == TripId("vis", "gw_vhr", "beach_foreshore", "poi_3", 1234)
    assert format_id(*tid) == "vis~gw_vhr~beach_foreshore~poi_3~001234"


@pytest.mark.parametrize("bad", [
    "res~a~b~c",                 # too few fields
    "xxx~a~b~c~000001",          # unknown stratum
    "res~a~b~c~12",              # seq not 6 digits
    "res~a~~c~000001",           # empty field
    "res|a|b|c|000001",          # old '|' separator
])
def test_parse_rejects_malformed(bad):
    with pytest.raises(ValueError):
        parse_id(bad)


@pytest.mark.parametrize("field", ["a~b", "a|b", "a,b", "a;b", "a&b", "a<b", "a>b", 'a"b', "a'b", "a\\b", "a b"])
def test_format_rejects_forbidden_characters(field):
    with pytest.raises(ValueError):
        format_id("res", field, "shops", "poi_1", 1)


def test_seq_wider_than_six_digits_is_allowed_but_padded_to_six():
    assert format_id("thr", "gw_vhr", "gateway", "gw_per", 7).endswith("~000007")
    assert parse_id("thr~gw_vhr~gateway~gw_per~1234567").seq == 1234567


def test_strata():
    assert set(STRATA) == {"res", "vis", "thr", "ext"}
