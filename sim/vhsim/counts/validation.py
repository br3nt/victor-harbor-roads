"""Compare the projected 2025 counts with newer data (DIT 2024 AADT, SMEC 2026 table, council 2018 count).

12-hour -> daily conversion: daily = 12-hour total / (share of the day held by hours 07-18 in
sim/data/profiles/hourly_profile.csv, i.e. 0.847).  That share rests on an ASSUMED night profile
(S-S3-01), so every daily figure here carries that uncertainty (+/- a few percent to ~10%).

Leg flow = two-way volume on one arm of an intersection: every movement that arrives from the arm
plus every movement that leaves along it (turn type -> destination arm from the diagram directions).

GEH here is computed on MEAN hourly flows (daily / 24) with the usual formula
sqrt(2 (M - C)^2 / (M + C)); this is not the peak-hour GEH normally used for model calibration.
"""
from __future__ import annotations

import csv
import math
from pathlib import Path

from vhsim.counts import profile, projection, turning

# approach arm -> {turn: arm the vehicle leaves along}
DEST = {"S": {"L": "W", "T": "N", "R": "E", "U": "S"}, "N": {"L": "E", "T": "S", "R": "W", "U": "N"},
        "E": {"L": "S", "T": "W", "R": "N", "U": "E"}, "W": {"L": "N", "T": "E", "R": "S", "U": "W"}}
COLUMNS = ["comparison_id", "description", "count_2017_12h", "projected_2025_12h", "share_12h_of_day",
           "projected_2025_daily", "reference_value", "reference_label", "reference_source", "ratio",
           "geh_mean_hour", "notes"]


def geh(modelled: float, observed: float) -> float:
    if modelled + observed == 0:
        return 0.0
    return math.sqrt(2 * (modelled - observed) ** 2 / (modelled + observed))


def twelve_hour_share() -> float:
    return sum(r["share"] for r in profile.build_rows() if 7 <= r["hour"] <= 18)


def _total(r, keys=("light", "heavy", "cycle")):
    return sum(float(r[k]) for k in keys)


def leg_flow(records, intersection: str, arm: str, *, only_through: bool = False):
    """Two-way volume on ``arm`` from turning records (light + heavy + cycle)."""
    tot = 0
    for r in records:
        if r["intersection"] != intersection:
            continue
        mv = r["movement"]
        if only_through and mv != "T":
            continue
        if r["approach_dir"] == arm or (mv != "U" and DEST[r["approach_dir"]][mv] == arm):
            tot += r["light"] + r["heavy"] + r["cycle"]
    return tot


def _proj_total(r) -> float:
    return float(r["light_projected"]) + float(r["heavy_projected"]) + float(r["cycle_projected"])


def _leg(rows_, intersection, arm, *, projected, only_through=False, roads=None) -> float:
    tot = 0.0
    for r in rows_:
        if r["intersection"] != intersection:
            continue
        if roads and r["approach_road"] not in roads:
            continue
        mv = r["movement"]
        if only_through and mv != "T":
            continue
        hit = r["approach_dir"] == arm or (mv != "U" and DEST[r["approach_dir"]][mv] == arm)
        if hit:
            tot += _proj_total(r) if projected else _total(r)
    return tot


def _dit_latest(no: str, a: float, b: float) -> int:
    return projection.dit_history(no, a, b)[-1][1]


def build_rows() -> list[dict]:
    recs, _ = turning.parse_report()
    proj = projection.build_rows()
    share = twelve_hour_share()
    rows: list[dict] = []

    def add(cid, desc, arms, ref, label, source, notes, avg_of=None):
        """arms: list of (intersection, arm, kwargs); the leg flows are averaged."""
        c17 = sum(_leg(proj, i, a, projected=False, **kw) for i, a, kw in arms) / len(arms)
        p25 = sum(_leg(proj, i, a, projected=True, **kw) for i, a, kw in arms) / len(arms)
        daily = p25 / share
        rows.append(dict(
            comparison_id=cid, description=desc, count_2017_12h=f"{c17:.0f}", projected_2025_12h=f"{p25:.0f}",
            share_12h_of_day=f"{share:.4f}", projected_2025_daily=f"{daily:.0f}", reference_value=ref,
            reference_label=label, reference_source=source, ratio=f"{daily / ref:.3f}",
            geh_mean_hour=f"{geh(daily / 24, ref / 24):.2f}", notes=notes))

    t_note = ("two-way volume averaged over the N and S Torrens St legs; section assignment checked against OSM "
              "(Ocean, Stuart and Coral junctions lie at road-running-distance 50.05-50.3 km); DIT AADT is an annual "
              "mean of all days, counted 2024")
    dit_t = _dit_latest("04760", 50.0, 50.38)
    for name, cid in [("Ocean", "ocean"), ("Stuart", "stuart"), ("Coral", "coral")]:
        add(f"dit_torrens_{cid}", f"Torrens St two-way flow at {name} St vs DIT AADT 50.0-50.38 km",
            [(f"Torrens/{name}", "N", {}), (f"Torrens/{name}", "S", {})], dit_t,
            "DIT AADT 2024 count year, Torrens St 50.0-50.38 km", "S-D02", t_note)
    add("dit_torrens_seaview_s", "Torrens St S leg at Seaview/Eyre vs DIT AADT 50.0-50.38 km",
        [("Torrens/Seaview/Eyre", "S", {})], dit_t, "DIT AADT 2024, Torrens St 50.0-50.38 km", "S-D02",
        "S arm is Torrens St just below the roundabout; DIT section boundary 50.0 km is at the roundabout")
    add("dit_hindmarsh_seaview_n", "Hindmarsh Rd N leg at Seaview/Eyre vs DIT AADT 49.1-50.0 km",
        [("Torrens/Seaview/Eyre", "N", {})], _dit_latest("04760", 49.1, 50.0),
        "DIT AADT 2024, Hindmarsh Rd 49.1-50.0 km", "S-D02", "N arm labelled Hindmarsh Road in the report diagram")
    add("dit_hindmarsh_grantley_through", "Hindmarsh Rd through movements at Grantley/Bridge Tce (lower bound) vs DIT 49.1-50.0 km",
        [("Hindmarsh/Grantley/Bridge Tce", "S", dict(only_through=True, roads={"Hindmarsh Rd"}))],
        _dit_latest("04760", 49.1, 50.0), "DIT AADT 2024, Hindmarsh Rd 49.1-50.0 km", "S-D02",
        "northbound plus southbound Hindmarsh Rd through movements only (turns and unresolved cross-island "
        "movements excluded, so a lower bound); junction position along 49.1-50.0 km not verified")
    smec_note = ("SMEC VHITS Revision 2 (Aug 2026) Table 3 'estimated daily volume'; method and year not stated "
                 "(the figures look like modelled or estimated AADT, not a count); compared with the projected 2025 "
                 "12-hour two-way flow on that arm converted to daily")
    add("smec_coral_street", "Coral St (E arm at Torrens/Coral) vs SMEC estimated daily volume",
        [("Torrens/Coral", "E", {})], 3000, "SMEC Table 3, Coral Street", "S-B04 p.22", smec_note)
    add("smec_seaview_road", "Seaview Rd (W arm at Torrens/Seaview/Eyre) vs SMEC estimated daily volume",
        [("Torrens/Seaview/Eyre", "W", {})], 7100, "SMEC Table 3, Seaview Road", "S-B04 p.22", smec_note)
    add("smec_eyre_terrace", "Eyre Tce (E arm at Torrens/Seaview/Eyre) vs SMEC estimated daily volume",
        [("Torrens/Seaview/Eyre", "E", {})], 1500, "SMEC Table 3, Eyre Terrace", "S-B04 p.22", smec_note)
    add("smec_torrens_street", "Torrens St (avg of Ocean/Stuart/Coral N and S legs) vs SMEC estimated daily volume",
        [(f"Torrens/{n}", a, {}) for n in ("Ocean", "Stuart", "Coral") for a in ("N", "S")], 8500,
        "SMEC Table 3, Torrens Street", "S-B04 p.22",
        smec_note + ". CONTRADICTS the DIT 15,500 for the same street; the SMEC figure may be a different location "
                    "or one-way or a different year: unresolved")
    # Armstrong Rd: council count Aug 2018 vs SMEC 2026 table; not a counted road, used for growth only
    erp = projection.erp_series()
    rows.append(dict(
        comparison_id="armstrong_2018_vs_2026", description="Armstrong Rd: council count Aug 2018 vs SMEC Table 3 estimate",
        count_2017_12h="", projected_2025_12h="", share_12h_of_day="", projected_2025_daily="",
        reference_value=6000, reference_label="Council count Aug 2018 (approx. 6,000 vehicles/day); SMEC Table 3 gives 7,200",
        reference_source="S-B34 (Road Safety Audit, Dec 2020, p.3); S-B04 p.22", ratio=f"{7200 / 6000:.3f}",
        geh_mean_hour=f"{geh(7200 / 24, 6000 / 24):.2f}",
        notes=(f"ratio = 7,200 / 6,000 = 1.20 over about 7 years (about 2.6% a year) versus City ERP growth "
               f"{erp[2025] / erp[2018]:.3f} (2018-2025). Mixes a count with an estimate, so only suggestive: council "
               "collector roads may have grown faster than population, in which case the council-street factor "
               "(population growth) would be low")))
    return rows


def write_csv(path: Path) -> int:
    rows = build_rows()
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=COLUMNS, lineterminator="\n")
        w.writeheader()
        w.writerows(rows)
    return len(rows)


NEWER_COLUMNS = ["id", "location", "value", "unit", "year", "what_the_source_says", "source", "used_in", "notes"]


def newer_counts_rows() -> list[dict]:
    """Post-2017 local volume figures found in the archived council/SMEC/RAA documents (text, not measurements by us)."""
    smec = ("SMEC VHITS Revision 2, Table 3 'estimated daily volume' (AADT column)", "S-B04 p.22", "2025-26 (not stated)")
    rows = [
        ("smec_hindmarsh", "Hindmarsh Rd", 9500, "volume running into Town Centre southwest of Hindmarsh Bridge (footnote 1)",
         "not compared: DIT gives 17,300-19,300 elsewhere on Hindmarsh Rd; different location or method"),
        ("smec_victoria", "Victoria St", 9300, "", "not compared: DIT 04793 section is 12,000 (count 2021)"),
        ("smec_torrens", "Torrens St", 8500, "", "compared in smec_torrens_street: contradicts DIT 15,500"),
        ("smec_armstrong", "Armstrong Rd", 7200, "", "compared in armstrong_2018_vs_2026"),
        ("smec_seaview", "Seaview Rd", 7100, "", "compared in smec_seaview_road"),
        ("smec_coral", "Coral St", 3000, "", "compared in smec_coral_street"),
        ("smec_eyre", "Eyre Tce", 1500, "", "compared in smec_eyre_terrace"),
    ]
    out = [dict(id=i, location=loc, value=v, unit="vehicles/day", year=smec[2], what_the_source_says=smec[0],
                source=smec[1], used_in=u, notes=n or "method not stated") for i, loc, v, n, u in
           [(a, b, c, d, e) for a, b, c, d, e in rows]]
    out += [
        dict(id="armstrong_2018", location="Armstrong Rd", value=6000, unit="vehicles/day", year="Aug 2018",
             what_the_source_says="road carries approximately 6,000 vehicles a day based on traffic volumes collected by Council in August 2018",
             source="S-B34 (Road Safety Audit Armstrong Rd, Dec 2020, p.3)", used_in="armstrong_2018_vs_2026",
             notes="a council count; the only post-2017 measured volume found for a local road"),
        dict(id="hindmarsh_17300", location="Hindmarsh Rd", value=17300, unit="vehicles/day", year="2024 (as quoted Oct 2025)",
             what_the_source_says="17,300 vehicles per day (as estimated on Location SA Maps)",
             source="S-B37", used_in="none", notes="repeats the DIT 2024 AADT (S-D02), so not independent"),
        dict(id="vhr_counter_2025", location="Victor Harbor Rd north of Waterport/Welch Rd (permanent counter)", value="",
             unit="", year="2025", what_the_source_says="chart of daily car counts by direction for 2025; no values in the text",
             source="S-B04 p.41", used_in="none",
             notes="only permanent counter in the area; the chart is a figure with no printed numbers, so no numeric comparison; data held by DIT could be requested"),
        dict(id="raa_vhr_2021", location="Victor Harbor Rd, Mt Compass to Victor Harbor", value=6700, unit="vehicles/day",
             year="2021", what_the_source_says="Royal Automobile Association of SA estimate of average daily volume as at 2021",
             source="S-B36", used_in="none", notes="rural road outside the study area core; context only"),
    ]
    return out


def write_newer_csv(path: Path) -> int:
    rows = newer_counts_rows()
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=NEWER_COLUMNS, lineterminator="\n")
        w.writeheader()
        w.writerows(rows)
    return len(rows)
