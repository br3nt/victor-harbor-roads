import numpy as np
import pytest

from vhsim.demand import generate as GEN
from vhsim.demand.config import Config
from vhsim.demand.geo import in_bbox
from vhsim.demand.ids import parse_id
from vhsim.demand.params import STUDY_BBOX

CFG = Config.load()


@pytest.fixture(scope="module")
def inputs():
    return GEN.Inputs.load(CFG)


@pytest.fixture(scope="module")
def weekday(inputs):
    return GEN.generate(CFG, "weekday_term", 2025, "base", seed=1, inputs=inputs)


@pytest.fixture(scope="module")
def summer(inputs):
    return GEN.generate(CFG, "summer_peak", 2025, "base", seed=1, inputs=inputs)


@pytest.fixture(scope="module")
def nye(inputs):
    return GEN.generate(CFG, "event_nye", 2025, "base", seed=1, inputs=inputs)


def test_ids_parse_and_are_unique(weekday):
    ids = [t.id for t in weekday.trips]
    assert len(ids) == len(set(ids))
    for t in weekday.trips:
        tid = parse_id(t.id)
        assert tid.stratum == t.stratum


def test_all_strata_present(summer):
    assert {t.stratum for t in summer.trips} == {"res", "vis", "thr", "ext"}


def test_every_trip_inside_study_bbox(weekday, summer, nye):
    for res in (weekday, summer, nye):
        for t in res.trips:
            assert in_bbox(t.from_lon, t.from_lat, STUDY_BBOX), t
            assert in_bbox(t.to_lon, t.to_lat, STUDY_BBOX), t
            assert (t.from_lon, t.from_lat) != (t.to_lon, t.to_lat), t


def test_vtypes_and_departures(weekday, nye):
    for res in (weekday, nye):
        assert {t.vtype for t in res.trips} <= {"car", "truck", "caravan"}
        deps = [t.depart for t in res.trips]
        assert deps == sorted(deps)
        assert 0 <= min(deps) and max(deps) <= CFG["time.max_depart_s"]


def test_through_balancing_converges_for_a_feasible_split(inputs):
    # review must-fix: k = 1/tot oscillated when no gateway's thr exceeds the others' sum
    # feasible = no gateway's through volume exceeds the sum of the others'
    c = CFG.with_overrides(['gateways.split.gw_per={"thr": 0.1, "ext": 0.75, "vis": 0.15}',
                            'gateways.split.gw_vhr={"thr": 0.15, "ext": 0.60, "vis": 0.25}'])
    r = GEN.generate(c, "weekday_term", 2025, "base", seed=1, inputs=inputs)
    tgt = r.meta["thr_target"]
    big = max(tgt, key=tgt.get)
    assert tgt[big] <= sum(v for k, v in tgt.items() if k != big)
    for gid, t in tgt.items():
        assert r.meta["thr_paired"][gid] <= t * (1 + 1e-6) + 1e-6, gid
        assert r.meta["thr_paired"][gid] == pytest.approx(t, rel=0.05, abs=1.0), gid
    assert r.meta["gateway_crossings"]["gw_vhr"] == pytest.approx(7700, rel=0.05)


def test_nye_adds_to_summer_at_every_gateway(nye, summer):
    # same day-tripper factor; the event adds on top (2% allowance for sampling noise per gateway;
    # before the review fix NYE was ~3% below summer at every gateway)
    s, n = summer.meta["gateway_crossings"], nye.meta["gateway_crossings"]
    for gid in s:
        assert n[gid] >= 0.98 * s[gid], gid
    assert sum(n.values()) > sum(s.values())
    assert n["gw_vhr"] > s["gw_vhr"]
    assert nye.meta["summer_factor"] == summer.meta["summer_factor"]


def test_no_pile_up_at_the_departure_cap(summer, weekday):
    tmax = CFG["time.max_depart_s"]
    assert sum(t.depart >= tmax - 1 for t in summer.trips) < 20
    trucks = [t for t in weekday.trips if t.vtype == "truck"]
    late = sum(t.depart >= 19 * 3600 for t in trucks) / len(trucks)
    assert late < 0.15


def test_weekday_rural_gateways_close_to_aadt(weekday):
    cross = weekday.meta["gateway_crossings"]
    assert cross["gw_ivr"] == pytest.approx(1700, rel=0.03)
    assert cross["gw_vhr"] == pytest.approx(7700, rel=0.03)
    assert cross["gw_hti"] == pytest.approx(1200, rel=0.05)


def test_resident_rate_is_the_documented_blend(weekday, inputs):
    m = weekday.meta
    w = CFG["rates.senior_weight"]
    assert m["resident_rate"] == pytest.approx((1 - w) * 7.53 + w * 2.39, abs=1e-3)   # S-S2-03
    exp = sum(z.occupied_households * m["resident_rate"] *
              (CFG["rates.rural_inbound_share"] if z.access == "gateway" else 1.0) for z in inputs.base_zones)
    assert m["resident_trips_expected"] == pytest.approx(exp, rel=1e-6)


def test_daily_resident_trips_match_documented_rate(weekday):
    m = weekday.meta
    # resident trips (res + residents' external trips) vs households x blended rate
    assert m["resident_trips"] == pytest.approx(m["resident_trips_expected"], rel=0.02)
    per_hh = m["resident_trips"] / m["occupied_households"]
    rate = GEN.blended_rate(CFG, "weekday_term")
    assert per_hh == pytest.approx(rate * m["resident_rate_factor"], rel=0.03)
    # blended rate lies between the seniors and the low-density rates (S-S2-03)
    assert CFG["rates.seniors"]["weekday"] < rate < CFG["rates.low_density"]["weekday"]


def test_weekday_gateway_volume_near_aadt(weekday):
    cross = weekday.meta["gateway_crossings"]
    assert cross["gw_vhr"] == pytest.approx(7700, rel=0.05)
    assert cross["gw_per"] == pytest.approx(9500, rel=0.05)


def test_summer_victor_harbor_rd_reaches_dit_figure(summer, weekday):
    assert summer.meta["gateway_crossings"]["gw_vhr"] >= 11000     # S-D18
    n_vis_s = sum(t.stratum == "vis" for t in summer.trips)
    n_vis_w = sum(t.stratum == "vis" for t in weekday.trips)
    assert n_vis_s > 2 * n_vis_w


def test_trucks_follow_gateway_cv_share(weekday):
    trucks = weekday.meta["gateway_trucks"]["gw_vhr"]
    assert trucks == pytest.approx(0.125 * 7700, rel=0.1)


def test_summer_has_caravans_and_holiday_home_trips(summer):
    assert sum(t.vtype == "caravan" for t in summer.trips) > 100
    assert any(t.dest_category == "holiday_home" for t in summer.trips)


def test_nye_evening_surge_to_warland_reserve(nye, summer):
    def evening_to_venue(res):
        return sum(1 for t in res.trips if t.purpose == "event" and t.dest_category == "beach_foreshore"
                   and 18 * 3600 <= t.depart <= 22 * 3600)
    n = evening_to_venue(nye)
    cars = CFG["event.attendees"] * CFG["event.car_share"] / CFG["event.persons_per_car"]
    assert n == pytest.approx(cars, rel=0.05)
    assert evening_to_venue(summer) == 0
    assert any(t.depart > 24 * 3600 for t in nye.trips)


def test_determinism_same_seed_same_trips(inputs, weekday):
    again = GEN.generate(CFG, "weekday_term", 2025, "base", seed=1, inputs=inputs)
    assert [(t.id, t.depart, t.from_lon, t.to_lon, t.vtype) for t in again.trips] == \
           [(t.id, t.depart, t.from_lon, t.to_lon, t.vtype) for t in weekday.trips]
    other = GEN.generate(CFG, "weekday_term", 2025, "base", seed=2, inputs=inputs)
    assert [t.id for t in other.trips] != [t.id for t in weekday.trips]


def test_growth_adds_trips_from_growth_areas(inputs, weekday):
    hi = GEN.generate(CFG, "weekday_term", 2051, "high", seed=1, inputs=inputs)
    assert hi.meta["resident_trips"] > 1.3 * weekday.meta["resident_trips"]
    assert any(t.origin_zone.startswith("GA1_") for t in hi.trips)


@pytest.mark.parametrize("growth,year", [("high", 2041), ("high", 2051), ("moderate", 2051)])
def test_growth_years_keep_external_layers_and_summer_target(inputs, weekday, growth, year):
    # Non-resident volumes are sized on the base year, so new households add to gateway
    # traffic instead of displacing external traffic; summer stays >= the DIT figure.
    wk = GEN.generate(CFG, "weekday_term", year, growth, seed=1, inputs=inputs)
    for s in ("thr", "ext"):
        n_base = sum(t.stratum == s and not t.resident for t in weekday.trips)
        n_grow = sum(t.stratum == s and not t.resident for t in wk.trips)
        assert n_grow == pytest.approx(n_base, rel=0.05), s
    su = GEN.generate(CFG, "summer_peak", year, growth, seed=1, inputs=inputs)
    assert su.meta["gateway_crossings"]["gw_vhr"] >= 11000


def test_external_growth_factor_override(inputs, weekday):
    c = CFG.with_overrides(["gateways.growth_per_year=0.02"])
    r = GEN.generate(c, "weekday_term", 2041, "moderate", seed=1, inputs=inputs)
    n_base = sum(t.stratum == "thr" for t in weekday.trips)
    assert sum(t.stratum == "thr" for t in r.trips) > 1.2 * n_base


# ---- configurable: overriding a parameter moves output in the expected direction
def _mean_len(res, cat):
    d = [t.dist_km for t in res.trips if t.stratum == "res" and t.dest_category == cat]
    return float(np.mean(d))


def test_more_seniors_fewer_resident_trips(inputs, weekday):
    c = CFG.with_overrides(["rates.senior_weight=0.7"])
    r = GEN.generate(c, "weekday_term", 2025, "base", seed=1, inputs=inputs)
    assert r.meta["resident_trips"] < weekday.meta["resident_trips"]


def test_higher_beta_shorter_supermarket_trips(inputs, weekday):
    c = CFG.with_overrides(["gravity.beta.supermarket=3.0"])
    r = GEN.generate(c, "weekday_term", 2025, "base", seed=1, inputs=inputs)
    assert _mean_len(r, "supermarket") < _mean_len(weekday, "supermarket")


def test_heavier_store_attracts_more(inputs, weekday):
    woolies = [p.poi_id for p in inputs.pois if p.name == "Woolworths"][0]
    c = CFG.with_overrides(["poi.named_weight.Woolworths=12"])
    r = GEN.generate(c, "weekday_term", 2025, "base", seed=1, inputs=GEN.Inputs.load(c))
    def n(res):
        return sum(t.dest_poi == woolies for t in res.trips)
    assert n(r) > n(weekday)


def test_bigger_event_more_cars(inputs, nye):
    c = CFG.with_overrides([f"event.attendees={2 * CFG['event.attendees']}"])
    r = GEN.generate(c, "event_nye", 2025, "base", seed=1, inputs=inputs)
    def n(res):
        return sum(t.purpose == "event" for t in res.trips)
    assert n(r) > 1.8 * n(nye)


def test_higher_summer_target_more_visitors(inputs, summer):
    c = CFG.with_overrides(["visitors.summer_vhr_target=13000"])
    r = GEN.generate(c, "summer_peak", 2025, "base", seed=1, inputs=inputs)
    assert r.meta["gateway_crossings"]["gw_vhr"] >= 13000
