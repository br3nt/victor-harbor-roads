"""S7 comparison tables (markdown) for sim/assumptions/S7-improvements.md part 3.

    python -m vhsim.integration.s7_tables --year 2025 --growth base --conditions weekday_term summer_peak \
        --scenarios baseline cp bp n2 n3 ...

Reads report_<year>_<growth>_s7/{summary,foreshore}.csv (vhsim.integration.report --suffix _s7) and
s7_diagnosis/hotspots__<condition>_<year>_<growth>.csv (vhsim.integration.bottlenecks hotspots).
Each option is compared with today's network, the council package (cp) and Brent's package (bp)
for the same year and condition.
"""
from __future__ import annotations

import argparse
import json

import pandas as pd

from vhsim.integration.bottlenecks import OUT as DIAG
from vhsim.integration.report import LABEL, RESULTS

SHORT_HOTSPOTS = {
    "Armstrong Rd / Crozier Rd": "Armstrong/Crozier",
    "Armstrong Rd / Greenhills Rd": "Armstrong/Greenhills",
    "Hindmarsh Rd / Grantley Ave / Bridge Tce": "Grantley/Bridge Tce",
    "Victoria St, Bay Rd to Torrens St (side streets, accesses)": "Victoria St",
    "Hindmarsh Rd side streets (Wattle Dr ... Rupara Ave)": "Hindmarsh side sts",
    "Torrens St / Coral St": "Torrens/Coral",
    "Torrens/Seaview/Eyre roundabout + Eyre Tce/McKinlay St": "Seaview rbt + Eyre",
    "Crozier Rd / Burke St": "Crozier/Burke",
}


def summary_table(year, growth, cond, scenarios) -> str:
    s = pd.read_csv(RESULTS / f"report_{year}_{growth}_s7" / "summary.csv")
    s = s[(s.condition == cond) & s.scenario.isin(scenarios)].set_index("scenario")
    fore = RESULTS / f"report_{year}_{growth}_s7" / "foreshore.csv"
    f = pd.read_csv(fore) if fore.exists() else pd.DataFrame()
    f = f[f.condition == cond].set_index("scenario") if len(f) else f
    b, cp, bp = (s.loc[k] if k in s.index else None for k in ("baseline", "cp", "bp"))
    lines = ["| Scenario | Seeds | Mean trip (min) | Δ trip vs today (s) | Time stopped (veh-h) | seed range | vs today | vs CP | vs BP "
             "| Trucks on foreshore (veh-km / day) |",
             "|---|---|---|---|---|---|---|---|---|---|"]

    def pct(x, ref):
        return f"{100 * (x / ref.time_stopped_veh_h - 1):+.0f}%" if ref is not None and ref.time_stopped_veh_h else "—"

    for sc in scenarios:
        if sc not in s.index:
            continue
        r = s.loc[sc]
        trucks = f.loc[sc].get("vkm_truck", float("nan")) if len(f) and sc in f.index else float("nan")
        meta = json.loads((RESULTS / f"{sc}__{cond}_{year}_{growth}" / "network.json").read_text())
        per = [x["total_waiting_veh_h"] for x in meta.get("per_seed", [])]
        rng = f"{min(per):.0f}–{max(per):.0f}" if per else "—"
        lines.append(f"| {LABEL.get(sc, sc)} | {int(r.seeds)} | {r.mean_trip_min:.2f} | {r.trip_change_s:+.1f} | "
                     f"{r.time_stopped_veh_h:.0f} | {rng} | {pct(r.time_stopped_veh_h, b)} | "
                     f"{pct(r.time_stopped_veh_h, cp) if sc != 'cp' else '—'} | "
                     f"{pct(r.time_stopped_veh_h, bp) if sc != 'bp' else '—'} | "
                     f"{'0' if pd.isna(trucks) else f'{trucks:.1f}'} |")
    return "\n".join(lines)


def hotspot_table(year, growth, cond, scenarios) -> str:
    h = pd.read_csv(DIAG / f"hotspots__{cond}_{year}_{growth}.csv").set_index("scenario")
    cols = list(SHORT_HOTSPOTS)
    lines = ["| Scenario | " + " | ".join(SHORT_HOTSPOTS[c] for c in cols) + " | Network (edgeData) |",
             "|---|" + "---|" * (len(cols) + 1)]
    for sc in scenarios:
        if sc not in h.index:
            continue
        r = h.loc[sc]
        lines.append(f"| {sc} | " + " | ".join(f"{r[c]:.1f}" for c in cols) + f" | {r.network_wait_veh_h:.0f} |")
    return "\n".join(lines)


KEY_APPROACHES = {
    "39946279": "Crozier Rd at Armstrong Rd", "97536780": "Armstrong Rd (south leg) at Crozier Rd",
    "-46824359": "Greenhills Rd at Armstrong Rd", "217056482#0": "Bridge Tce at the Grantley crossing",
    "-184390360#1": "Grantley crossing link onto Hindmarsh Rd", "184390356": "Eyre Tce at the Seaview roundabout",
    "42530572#1": "Granite St at Victoria St",
}


def approach_table(year, growth, cond, scenarios) -> str:
    """Mean delay (s per vehicle, R15 definition incl. any bay) on the key approaches."""
    i = pd.read_csv(RESULTS / f"report_{year}_{growth}_s7" / "intersections.csv", dtype={"approach_edge": str})
    i = i[(i.condition == cond) & i.approach_edge.isin(KEY_APPROACHES)]
    p = i.pivot_table(index="approach_edge", columns="scenario", values="mean_delay_s")
    cols = [s for s in scenarios if s in p.columns]
    lines = ["| Approach | " + " | ".join(cols) + " |", "|---|" + "---|" * len(cols)]
    for a, name in KEY_APPROACHES.items():
        if a in p.index:
            lines.append(f"| {name} | " + " | ".join("—" if pd.isna(p.loc[a, c]) else f"{p.loc[a, c]:.0f}" for c in cols) + " |")
    return "\n".join(lines)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--year", default="2025")
    ap.add_argument("--growth", default="base")
    ap.add_argument("--conditions", nargs="+", default=["weekday_term", "summer_peak"])
    ap.add_argument("--scenarios", nargs="+", required=True)
    a = ap.parse_args(argv)
    for c in a.conditions:
        print(f"\n#### {c} {a.year} {a.growth}: network\n")
        print(summary_table(a.year, a.growth, c, a.scenarios))
        print(f"\n#### {c} {a.year} {a.growth}: vehicle-hours stopped at the hotspots\n")
        print(hotspot_table(a.year, a.growth, c, a.scenarios))
        print(f"\n#### {c} {a.year} {a.growth}: mean delay on key approaches (s per vehicle)\n")
        print(approach_table(a.year, a.growth, c, a.scenarios))


if __name__ == "__main__":
    main()
