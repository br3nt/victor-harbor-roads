"""Trip generation for one condition / year / growth scenario.

Layers (stratum in the vehicle id):
- res: home-based tours of resident households (rate x occupied households), purpose by
  config shares, destination by gravity (weight / distance^beta), plus non-home-based trips.
- ext: residents' trips to places outside the study area (home <-> gateway) and non-residents
  entering through a gateway (gateway <-> POI). Trucks come from here and from thr.
- thr: through traffic between gateways (both ends outside).
- vis: staying visitors (holiday homes, caravan parks, accommodation), their arrivals and
  departures, day-trippers through the gateways (scaled in summer to the DIT Victor Harbor Rd
  figure, S-D18), and the NYE event layer (residents attending the event stay 'res').

Every number comes from the Config; see sim/assumptions/S2-demand.md.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

from .config import Config
from .gateways import Gateway, active, build_gateways
from .growth import zones_for
from .ids import format_id
from .pois import POI, pois_for
from .profiles import fit_outbound, target_profile
from .zones import Zone, base_zones, load_mesh_blocks

KM_LAT = 110.95


@dataclass
class Trip:
    depart: float
    from_lon: float
    from_lat: float
    to_lon: float
    to_lat: float
    vtype: str
    stratum: str
    origin_zone: str
    dest_category: str
    dest_poi: str
    purpose: str
    dist_km: float
    resident: bool = False
    id: str = ""


@dataclass
class Result:
    trips: list[Trip]
    meta: dict = field(default_factory=dict)


@dataclass
class Inputs:
    """Base-year inputs (built once, reused across conditions)."""
    cfg: Config
    mesh_blocks: list
    gateways: list[Gateway]
    base_zones: list[Zone]
    pois: list[POI]

    @classmethod
    def load(cls, cfg: Config) -> "Inputs":
        gws = build_gateways(cfg=cfg)
        mbs = load_mesh_blocks()
        zs = base_zones(mbs, cfg["growth.base_year"], gws, cfg)
        return cls(cfg, mbs, gws, zs, pois_for(cfg, "base", cfg["growth.base_year"]))


def _rural(z: Zone) -> bool:
    """A rural mesh block outside the study area (its trips partly stay rural)."""
    return z.access == "gateway" and z.kind == "mesh_block"


def blended_rate(cfg: Config, condition: str) -> float:
    col = cfg["rates.day_type"][condition]
    w = cfg["rates.senior_weight"]
    return (1 - w) * cfg["rates.low_density"][col] + w * cfg["rates.seniors"][col]


# ------------------------------------------------------------------ helpers
class _Dests:
    def __init__(self, ids, lons, lats, weights, cat):
        self.ids = list(ids)
        self.lons = np.asarray(lons, float)
        self.lats = np.asarray(lats, float)
        self.w = np.asarray(weights, float)
        self.cat = cat


class _Gravity:
    def __init__(self, cfg: Config):
        self.beta = cfg["gravity.beta"]
        self.detour = cfg["gravity.detour_factor"]
        self.dmin = cfg["gravity.min_distance_km"]
        self.same = cfg["gravity.same_point_km"]
        self._cache = {}

    def dist(self, olon, olat, lons, lats):
        kx = KM_LAT * math.cos(math.radians(olat))
        return np.hypot((lons - olon) * kx, (lats - olat) * KM_LAT) * self.detour

    def cdf(self, olon, olat, dests: _Dests):
        key = (olon, olat, dests.cat, id(dests))
        c = self._cache.get(key)
        if c is None:
            d = self.dist(olon, olat, dests.lons, dests.lats)
            beta = self.beta.get(dests.cat, self.beta["default"])
            w = dests.w / np.maximum(d, self.dmin) ** beta
            w[d < self.same * self.detour] = 0.0    # never a trip to (almost) the same point
            s = w.sum()
            c = (np.cumsum(w) / s, d) if s > 0 else (None, d)
            self._cache[key] = c
        return c

    def sample(self, rng, olon, olat, dests: _Dests):
        cdf, d = self.cdf(olon, olat, dests)
        if cdf is None:
            return None, 0.0
        i = int(np.searchsorted(cdf, rng.random(), side="right"))
        i = min(i, len(cdf) - 1)
        return i, float(d[i])


def _sround(rng, x: float) -> int:
    f = math.floor(x)
    return int(f + (rng.random() < x - f))


def _cdf(p):
    p = np.asarray(p, float)
    return np.cumsum(p / p.sum())


def _pick(rng, cdf):
    return min(int(np.searchsorted(cdf, rng.random(), side="right")), len(cdf) - 1)


def _choice(rng, shares: dict):
    keys = [k for k, v in shares.items() if v > 0]
    vals = [shares[k] for k in keys]
    return keys[_pick(rng, _cdf(vals))]


class _Clock:
    def __init__(self, cfg, profiles: dict):
        self.cdfs = {k: _cdf(v) for k, v in profiles.items()}
        self.speed = cfg["time.speed_kmh"]
        self.dwell = cfg["time.dwell_minutes"]
        self.tmax = cfg["time.max_depart_s"]

    def depart(self, rng, profile: str) -> float:
        h = _pick(rng, self.cdfs[profile])
        return h * 3600 + rng.uniform(0, 3600)

    def back(self, rng, t_out: float, dist_km: float, dwell_key: str) -> float:
        travel = dist_km / self.speed * 3600
        dwell = self.dwell[dwell_key] * 60 * rng.uniform(0.5, 1.5)
        room = self.tmax - t_out - travel
        if dwell > room:   # would leave after the end of the day: shorten the stay, do not pile up at tmax
            dwell = rng.uniform(0, max(0.0, room))
        return min(t_out + travel + dwell, self.tmax)


# ------------------------------------------------------------------ main
def generate(cfg: Config, condition: str, year: int, growth: str, seed: int = 1,
             inputs: Inputs | None = None) -> Result:
    if condition not in cfg["rates.day_type"]:
        raise ValueError(f"unknown condition {condition!r}")
    inputs = inputs or Inputs.load(cfg)
    rng = np.random.default_rng(seed)
    gws = active(inputs.gateways)
    gw_by = {g.gateway_id: g for g in gws}
    zones = zones_for(inputs.base_zones, growth, year, cfg, inputs.gateways) if growth != "base" else list(inputs.base_zones)
    pois = inputs.pois if growth == "base" else pois_for(cfg, growth, year)
    zones = sorted(zones, key=lambda z: z.zone_id)

    grav = _Gravity(cfg)
    by_cat: dict[str, list[POI]] = {}
    for p in pois:
        by_cat.setdefault(p.category, []).append(p)
    dests = {c: _Dests([p.poi_id for p in ps], [p.lon for p in ps], [p.lat for p in ps],
                       [p.weight for p in ps], c) for c, ps in by_cat.items()}
    poi_by_id = {p.poi_id: p for p in pois}
    homes = [z for z in zones if z.occupied_households > 0]
    dests["residential"] = _Dests([z.zone_id for z in homes], [z.lon for z in homes], [z.lat for z in homes],
                                  [z.occupied_households for z in homes], "residential")
    zone_pt = {z.zone_id: (z.lon, z.lat) for z in zones}

    def pt(dest_id):
        if dest_id in poi_by_id:
            p = poi_by_id[dest_id]
            return p.lon, p.lat
        return zone_pt[dest_id]

    shares = cfg[f"purpose.shares.{condition}"]
    ext_share, nhb_share = cfg["rates.external_share"], cfg["rates.nhb_share"]
    fitted, _ = fit_outbound(cfg, shares, ext_share, nhb_share)
    target, target_label = target_profile(cfg)
    profiles = dict(fitted)
    profiles["target"] = target
    for k in ("visitor_local", "visitor_arrival", "lodging_arrival", "lodging_departure"):
        profiles[k] = np.asarray(cfg["time.purpose_profiles"][k], float)
    clock = _Clock(cfg, profiles)
    trips: list[Trip] = []

    def add(t_dep, a, b, vtype, stratum, origin, dcat, dpoi, purpose, dist, resident=False):
        trips.append(Trip(round(t_dep, 2), a[0], a[1], b[0], b[1], vtype, stratum, origin, dcat, dpoi,
                          purpose, round(dist, 3), resident))

    # ---------------------------------------------------------------- residents
    rate = blended_rate(cfg, condition) * cfg["rates.condition_factor"][condition]
    rural_share = cfg["rates.rural_inbound_share"]
    hb_purposes = {k: v for k, v in shares.items() if v > 0}
    nhb_shares = {k: v for k, v in hb_purposes.items() if k not in ("school", "residential", "work")}
    ext_split = cfg["rates.external_gateway_split"]
    expected_res = 0.0
    occ_total = 0.0
    for z in zones:
        if z.occupied_households <= 0:
            continue
        occ_total += z.occupied_households
        n_exp = z.occupied_households * rate * (rural_share if _rural(z) else 1.0)
        expected_res += n_exp
        home = (z.lon, z.lat)
        e_share = ext_share if z.access == "inside" else 0.0
        n_ext_tours = _sround(rng, n_exp * e_share / 2)
        n_nhb = _sround(rng, n_exp * nhb_share)
        n_hb_tours = _sround(rng, n_exp * (1 - e_share - nhb_share) / 2)
        for _ in range(n_hb_tours):
            purpose = _choice(rng, hb_purposes)
            i, d = grav.sample(rng, home[0], home[1], dests[purpose])
            if i is None:
                continue
            did = dests[purpose].ids[i]
            dpt = pt(did)
            t1 = clock.depart(rng, purpose)
            add(t1, home, dpt, "car", "res", z.zone_id, purpose, did, purpose, d, True)
            t2 = clock.back(rng, t1, d, purpose)
            add(t2, dpt, home, "car", "res", did, "home", z.zone_id, purpose, d, True)
        for _ in range(n_ext_tours):
            gid = _choice(rng, ext_split)
            g = gw_by[gid]
            gpt = (g.lon, g.lat)
            d = grav.dist(home[0], home[1], np.array([g.lon]), np.array([g.lat]))[0]
            t1 = clock.depart(rng, "external")
            add(t1, home, gpt, "car", "ext", z.zone_id, "gateway", gid, "external", d, True)
            t2 = clock.back(rng, t1, d, "external")
            add(t2, gpt, home, "car", "ext", gid, "home", z.zone_id, "external", d, True)
        for _ in range(n_nhb):
            c1 = _choice(rng, nhb_shares)
            i, _d = grav.sample(rng, home[0], home[1], dests[c1])
            if i is None:
                continue
            oid = dests[c1].ids[i]
            opt = pt(oid)
            c2 = _choice(rng, nhb_shares)
            j, d = grav.sample(rng, opt[0], opt[1], dests[c2])
            if j is None:
                continue
            did = dests[c2].ids[j]
            add(clock.depart(rng, "target"), opt, pt(did), "car", "res", oid, c2, did, c2, d, True)
    n_res = sum(1 for t in trips if t.resident)

    # expected residents' crossings per gateway on a base-year term weekday: AADT minus these is
    # the non-resident volume. Base-year zones, so new households ADD to gateway traffic.
    base_zs = inputs.base_zones
    wk_rate = blended_rate(cfg, "weekday_term") * cfg["rates.condition_factor"]["weekday_term"]
    res_cross = {g.gateway_id: 0.0 for g in gws}
    for z in base_zs:
        if z.occupied_households <= 0:
            continue
        if z.access == "gateway":   # all their trips except NHB (POI to POI inside the area) cross
            res_cross[z.gateway_id] += (z.occupied_households * wk_rate * (rural_share if _rural(z) else 1.0)
                                        * (1 - nhb_share))
        else:
            for gid, s in ext_split.items():
                res_cross[gid] += z.occupied_households * wk_rate * ext_share * s

    # staying visitors' arrivals/departures on a term weekday also use the AADT
    hh_occ_wk = cfg["visitors.holiday_home_occupancy"]["weekday_term"]
    lodge_occ_wk = cfg["visitors.lodging_occupancy"]["weekday_term"]
    parties_wk = sum(z.unoccupied for z in base_zs) * hh_occ_wk + sum(
        p.weight for p in inputs.pois if p.category in ("caravan_park", "accommodation")) * lodge_occ_wk
    for gid, s in cfg["visitors.arrival_gateway_split"].items():
        res_cross[gid] += parties_wk * cfg["visitors.turnover_per_day"] * 2 * s

    # ---------------------------------------------------------------- non-resident gateway layers
    split_cfg = cfg["gateways.split"]
    grow_f = (1 + cfg["gateways.growth_per_year"]) ** max(0, year - cfg["growth.base_year"])
    day_f = cfg["gateways.day_factor"][condition] * grow_f
    vis_f = cfg["visitors.vis_day_factor"][condition] * grow_f
    thr_cross, ext_cross, vis_cross, cv_target = {}, {}, {}, {}
    for g in gws:
        m = max(0.0, g.aadt - res_cross[g.gateway_id])
        sp = split_cfg.get(g.gateway_id, split_cfg["default"])
        thr_cross[g.gateway_id] = m * sp["thr"] * day_f
        ext_cross[g.gateway_id] = m * sp["ext"] * day_f
        vis_cross[g.gateway_id] = m * sp["vis"] * vis_f
        cv_target[g.gateway_id] = g.aadt * g.cv_pct / 100 * cfg["gateways.truck_cv_factor"] * day_f

    # through traffic: unordered-pair volumes X_ab = k_a k_b T_a T_b, sum_b X_ab = T_a
    ids_ = [g.gateway_id for g in gws]
    T = np.array([thr_cross[i] for i in ids_])
    k = np.ones(len(ids_))
    n_g = len(ids_)

    def _paired(kk):
        return np.array([sum(kk[a] * kk[b] * T[a] * T[b] for b in range(n_g) if b != a) for a in range(n_g)])

    for _ in range(500):   # damped (geometric-mean) update: the plain k = 1/tot update oscillates
        tot = np.array([sum(k[b] * T[b] for b in range(n_g) if b != a) for a in range(n_g)])
        new_k = np.where((T > 0) & (tot > 0), 1.0 / np.maximum(tot, 1e-12), 0.0)
        k = np.sqrt(k * new_k)
    for _ in range(100):   # never pair more than a gateway's target
        got = _paired(k)
        over = (got > T * (1 + 1e-9)) & (got > 0)
        if not over.any():
            break
        k = np.where(over, k * T / np.maximum(got, 1e-12), k)
    if (_paired(k) > T * (1 + 1e-6) + 1e-6).any():
        raise RuntimeError("through-traffic balancing exceeded a gateway target")
    achieved = {i: 0.0 for i in ids_}
    for a in range(len(ids_)):
        for b in range(len(ids_)):
            if a != b:
                achieved[ids_[a]] += k[a] * k[b] * T[a] * T[b]
    for gid in ids_:    # through volume a gateway cannot pair off becomes external-with-local-end
        ext_cross[gid] += max(0.0, thr_cross[gid] - achieved[gid])
    # trucks: CV% x AADT per gateway. A through trip is a truck with prob min(p_a, p_b) where
    # p = CV / (paired thr + ext); ext trips at g then carry the rest of g's CV target.
    p_all = {gid: min(1.0, cv_target[gid] / max(1e-9, achieved[gid] + ext_cross[gid])) for gid in ids_}
    thr_trucks = {gid: 0.0 for gid in ids_}
    for a in range(len(ids_)):
        for b in range(len(ids_)):
            if a != b:
                thr_trucks[ids_[a]] += k[a] * k[b] * T[a] * T[b] * min(p_all[ids_[a]], p_all[ids_[b]])
    p_ext_truck = {gid: min(1.0, max(0.0, cv_target[gid] - thr_trucks[gid]) / max(1e-9, ext_cross[gid]))
                   for gid in ids_}
    for a in range(len(ids_)):
        for b in range(a + 1, len(ids_)):
            x = k[a] * k[b] * T[a] * T[b]
            if x <= 0:
                continue
            ga, gb = gw_by[ids_[a]], gw_by[ids_[b]]
            d = grav.dist(ga.lon, ga.lat, np.array([gb.lon]), np.array([gb.lat]))[0]
            for (g1, g2) in ((ga, gb), (gb, ga)):
                for _ in range(_sround(rng, x / 2)):
                    pr = min(p_all[g1.gateway_id], p_all[g2.gateway_id])
                    vt = "truck" if rng.random() < pr else "car"
                    add(clock.depart(rng, "target"), (g1.lon, g1.lat), (g2.lon, g2.lat), vt, "thr",
                        g1.gateway_id, "gateway", g2.gateway_id, "through", d)

    ext_shares = cfg["ext.purpose_shares"]
    for g in gws:
        gpt = (g.lon, g.lat)
        for _ in range(_sround(rng, ext_cross[g.gateway_id] / 2)):
            truck = rng.random() < p_ext_truck[g.gateway_id]
            cat = "work" if truck else _choice(rng, ext_shares)
            i, d = grav.sample(rng, g.lon, g.lat, dests[cat])
            if i is None:
                continue
            did = dests[cat].ids[i]
            dpt = pt(did)
            vt = "truck" if truck else "car"
            t1 = clock.depart(rng, "target")
            add(t1, gpt, dpt, vt, "ext", g.gateway_id, cat, did, "external_in", d)
            t2 = clock.back(rng, t1, d, "truck" if truck else ("work" if cat == "work" else "ext_visit"))
            add(t2, dpt, gpt, vt, "ext", did, "gateway", g.gateway_id, "external_in", d)

    # ---------------------------------------------------------------- staying visitors
    vis_shares = cfg["visitors.purpose_shares"]
    hh_occ = cfg["visitors.holiday_home_occupancy"][condition]
    lodge_occ = cfg["visitors.lodging_occupancy"][condition]
    per_party = cfg["visitors.trips_per_party"]
    turnover = cfg["visitors.turnover_per_day"]
    arr_split = cfg["visitors.arrival_gateway_split"]
    cv_share = cfg["caravans.share_of_vis"][condition]
    park_cv = cfg["caravans.share_of_park_arrivals"]
    lodgings = []    # (id, category, point, parties)
    for z in zones:
        if z.unoccupied > 0:
            lodgings.append((z.zone_id, "holiday_home", (z.lon, z.lat), z.unoccupied * hh_occ))
    for p in pois:
        if p.category in ("caravan_park", "accommodation"):
            lodgings.append((p.poi_id, p.category, (p.lon, p.lat), p.weight * lodge_occ))
    for lid, lcat, lpt, parties in lodgings:
        for _ in range(_sround(rng, parties * per_party / 2)):
            cat = _choice(rng, vis_shares)
            i, d = grav.sample(rng, lpt[0], lpt[1], dests[cat])
            if i is None:
                continue
            did = dests[cat].ids[i]
            dpt = pt(did)
            t1 = clock.depart(rng, "visitor_local")
            add(t1, lpt, dpt, "car", "vis", lid, cat, did, "visitor_local", d)
            t2 = clock.back(rng, t1, d, "visitor_local")
            add(t2, dpt, lpt, "car", "vis", did, lcat, lid, "visitor_local", d)
        p_cv = park_cv if lcat == "caravan_park" else cv_share
        for direction in ("arrival", "departure"):
            for _ in range(_sround(rng, parties * turnover)):
                g = gw_by[_choice(rng, arr_split)]
                gpt = (g.lon, g.lat)
                if gpt == lpt:
                    continue
                d = grav.dist(g.lon, g.lat, np.array([lpt[0]]), np.array([lpt[1]]))[0]
                vt = "caravan" if rng.random() < p_cv else "car"
                if direction == "arrival":
                    add(clock.depart(rng, "lodging_arrival"), gpt, lpt, vt, "vis", g.gateway_id, lcat, lid,
                        "lodging_arrival", d)
                else:
                    add(clock.depart(rng, "lodging_departure"), lpt, gpt, vt, "vis", lid, "gateway",
                        g.gateway_id, "lodging_departure", d)

    # ---------------------------------------------------------------- NYE event
    if condition == "event_nye":
        _event(cfg, rng, add, grav, zones, lodgings, gw_by, pois, hh_occ)

    # ---------------------------------------------------------------- day-trippers (+ summer scaling)
    def crossings(gid):
        g = gw_by[gid]
        return sum(((t.from_lon, t.from_lat) == (g.lon, g.lat)) + ((t.to_lon, t.to_lat) == (g.lon, g.lat))
                   for t in trips)

    day_cross = dict(vis_cross)
    scale_note = ""
    summer_f = 1.0
    if condition in ("summer_peak", "event_nye"):
        target_vhr = cfg["visitors.summer_vhr_target"]
        if growth == "base" and condition == "summer_peak":
            current = crossings("gw_vhr") + vis_cross["gw_vhr"]
            if current < target_vhr and vis_cross["gw_vhr"] > 0:
                summer_f = (vis_cross["gw_vhr"] + target_vhr - current) / vis_cross["gw_vhr"]
            scale_note = f"day-tripper volume x{summer_f:.2f} to reach {target_vhr} at gw_vhr (S-D18)"
        else:   # base-year summer_peak factor: growth and the NYE event ADD to an ordinary summer day
            summer_f = generate(cfg, "summer_peak", cfg["growth.base_year"], "base", seed, inputs).meta["summer_factor"]
            scale_note = f"day-tripper volume x{summer_f:.2f} (base-year factor, S-D18 target {target_vhr})"
        if cfg["visitors.summer_scale_all_gateways"]:
            day_cross = {gid: v * summer_f for gid, v in vis_cross.items()}
        else:
            day_cross["gw_vhr"] = vis_cross["gw_vhr"] * summer_f
    second = cfg["visitors.second_stop_share"]
    for g in gws:
        gpt = (g.lon, g.lat)
        n_tours = day_cross[g.gateway_id] / 2
        if g.gateway_id == "gw_vhr" and condition == "summer_peak" and growth == "base":
            n_tours = math.ceil(n_tours)
        else:
            n_tours = _sround(rng, n_tours)
        for _ in range(n_tours):
            vt = "caravan" if rng.random() < cv_share else "car"
            cat = _choice(rng, vis_shares)
            i, d = grav.sample(rng, g.lon, g.lat, dests[cat])
            if i is None:
                continue
            did = dests[cat].ids[i]
            dpt = pt(did)
            t = clock.depart(rng, "visitor_arrival")
            add(t, gpt, dpt, vt, "vis", g.gateway_id, cat, did, "day_trip", d)
            last, last_id = dpt, did
            if rng.random() < second:
                cat2 = _choice(rng, vis_shares)
                j, d2 = grav.sample(rng, dpt[0], dpt[1], dests[cat2])
                if j is not None:
                    t = clock.back(rng, t, d, "visitor_local")
                    did2 = dests[cat2].ids[j]
                    add(t, dpt, pt(did2), vt, "vis", did, cat2, did2, "day_trip", d2)
                    last, last_id, d = pt(did2), did2, d2
            t = clock.back(rng, t, d, "day_trip")
            add(t, last, gpt, vt, "vis", last_id, "gateway", g.gateway_id, "day_trip", d)

    # ---------------------------------------------------------------- ids, meta
    trips.sort(key=lambda t: (t.depart, t.stratum, t.origin_zone, t.dest_poi, t.from_lon, t.to_lon))
    for n, t in enumerate(trips):
        t.id = format_id(t.stratum, t.origin_zone, t.dest_category, t.dest_poi, n)
    cross = {g.gateway_id: 0 for g in gws}
    trucks = {g.gateway_id: 0 for g in gws}
    pt_gw = {(g.lon, g.lat): g.gateway_id for g in gws}
    for t in trips:
        for p in ((t.from_lon, t.from_lat), (t.to_lon, t.to_lat)):
            gid = pt_gw.get(p)
            if gid:
                cross[gid] += 1
                trucks[gid] += t.vtype == "truck"
    meta = {
        "condition": condition, "year": year, "growth": growth, "seed": seed,
        "config": str(cfg.source) if cfg.source else "", "overrides": cfg.overrides,
        "hourly_profile": target_label,
        "occupied_households": round(occ_total, 1),
        "resident_rate": round(rate, 4),
        "resident_rate_factor": round(expected_res / (occ_total * rate), 4) if occ_total else 0,
        "resident_trips_expected": round(expected_res, 1),
        "resident_trips": sum(1 for t in trips if t.resident),
        "resident_trips_generated_before_layers": n_res,
        "gateway_crossings": cross, "gateway_trucks": trucks,
        "gateway_aadt": {g.gateway_id: g.aadt for g in gws},
        "resident_and_lodging_crossings_expected_weekday": {k: round(v, 1) for k, v in res_cross.items()},
        "thr_target": {k: round(v, 1) for k, v in thr_cross.items()},
        "thr_paired": {k: round(v, 1) for k, v in achieved.items()},
        "summer_scaling": scale_note,
        "summer_factor": summer_f,
        "external_growth_factor": round(grow_f, 4),
        "trips": len(trips),
    }
    return Result(trips, meta)


def _event(cfg, rng, add, grav, zones, lodgings, gw_by, pois, hh_occ):
    venue = next((p for p in pois if p.name == cfg["event.venue"]), None)
    if venue is None:
        raise ValueError(f"event venue {cfg['event.venue']!r} is not a POI")
    vpt = (venue.lon, venue.lat)
    cars = cfg["event.attendees"] * cfg["event.car_share"] / cfg["event.persons_per_car"]
    split = cfg["event.origin_split"]
    a0, a1 = cfg["event.arrival_window_h"]
    d0, d1 = cfg["event.departure_window_h"]
    early = cfg["event.early_leaver_share"]
    tmax = cfg["time.max_depart_s"]
    inside = [z for z in zones if z.access == "inside" and z.occupied_households > 0]
    res_w = _cdf([z.occupied_households for z in inside])
    lod = [(lid, lcat, lpt, parties) for lid, lcat, lpt, parties in lodgings if parties > 0]
    lod_w = _cdf([x[3] for x in lod])
    arr_split = cfg["visitors.arrival_gateway_split"]
    n_by = {k: _sround(rng, cars * v) for k, v in split.items()}
    for kind, n in sorted(n_by.items()):
        for _ in range(n):
            if kind == "res":
                z = inside[_pick(rng, res_w)]
                opt, oid, back_cat, stratum = (z.lon, z.lat), z.zone_id, "home", "res"
            elif kind == "vis_local":
                lid, lcat, opt, _p = lod[_pick(rng, lod_w)]
                oid, back_cat, stratum = lid, lcat, "vis"
            else:
                g = gw_by[_choice(rng, arr_split)]
                opt, oid, back_cat, stratum = (g.lon, g.lat), g.gateway_id, "gateway", "vis"
            if opt == vpt:
                continue
            d = grav.dist(opt[0], opt[1], np.array([vpt[0]]), np.array([vpt[1]]))[0]
            t1 = rng.uniform(a0, a1) * 3600
            if rng.random() < early:
                e0, e1 = cfg["event.early_departure_window_h"]
                t2 = max(t1 + cfg["event.min_stay_s"], rng.uniform(e0, e1) * 3600)
            else:
                t2 = rng.uniform(d0, d1) * 3600
            t2 = min(t2, tmax)
            add(t1, opt, vpt, "car", stratum, oid, "beach_foreshore", venue.poi_id, "event", d, stratum == "res")
            add(t2, vpt, opt, "car", stratum, venue.poi_id, back_cat, oid, "event", d, stratum == "res")
