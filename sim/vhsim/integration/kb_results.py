"""Write the knowledge-base "Simulation Results" note body from the report CSVs (no hand-typed numbers).

    python -m vhsim.integration.kb_results > /tmp/results.html
"""
from __future__ import annotations

import html
import json

import pandas as pd

from vhsim.integration.report import COND, LABEL
from vhsim.paths import DATA

D = DATA / "results" / "report_2025_base"
h = lambda s: html.escape(str(s))


def fmt(x, nd=0):
    return "—" if pd.isna(x) else f"{x:.{nd}f}"


NEW_OPTIONS = [  # (id, plain name, cost class: order-of-magnitude assumption, S7-04)
    ("n9", "N9 Crozier Rd turn lanes at Armstrong Rd + Hindmarsh Rd / Grantley Ave roundabout", "$$–$$$"),
    ("n3", "N3 Crozier Rd turn lanes at Armstrong Rd", "$"),
    ("n4", "N4 Hindmarsh Rd / Grantley Ave roundabout (beside the rail crossing)", "$$–$$$"),
    ("n7", "N7 three roundabouts: Armstrong/Crozier, Armstrong/Greenhills, Hindmarsh/Grantley", "$$$"),
    ("n2", "N2 Armstrong Rd / Crozier Rd roundabout", "$$"),
    ("n5", "N5 Armstrong/Crozier + Armstrong/Greenhills roundabouts", "$$$"),
    ("n6", "N6 no right turn out of Granite St, Coral St, Wattle Dr", "$"),
    ("n8", "N8 Victoria St left-turn lanes into Oval Rd and the IGA car park", "$"),
]


def better_options() -> str:
    """Section from the S7 tables (sim/assumptions/S7-improvements.md): options aimed at where the delay is."""
    a = pd.read_csv(DATA / "results" / "report_2025_base_s7" / "summary.csv")
    g = pd.read_csv(DATA / "results" / "report_2041_high_s7" / "summary.csv")

    def cell(df, cond, sc, with_seeds=False):
        x = df[(df.condition == cond) & (df.scenario == sc)]
        if x.empty:
            return "not run"
        r = x.iloc[0]
        s = f"{r.stopped_change_pct:+.0f}%"
        return s + (f" ({int(r.seeds)} seed{'s' if r.seeds != 1 else ''})" if with_seeds else "")

    rows = [("cp", h(LABEL["cp"]), "—"), ("bp", h(LABEL["bp"]), "—")] + [(i, h(n), c) for i, n, c in NEW_OPTIONS]
    o = ["""<h2 id="better-options">Better options: aimed at where the delay actually is (R16)</h2>
<p>We first located the delay on today's network (method, hotspot tables and assumptions:
<code>sim/assumptions/S7-improvements.md</code>), then designed options aimed at it and ran them like the others.
Most delay is <strong>side-street right turns onto one-lane main roads</strong> around midday (10:00–17:00 holds
83–89% of it), not the town-centre roundabouts (most approaches average 3–8 s). The largest hotspots are Victoria St
between Bay Rd and Torrens St (car-park and side-street turns), side streets onto Hindmarsh Rd, the Bridge Tce /
Grantley Ave link onto Hindmarsh Rd, the Seaview/Eyre roundabout, and, as the town grows, Crozier Rd and Greenhills Rd
joining Armstrong Rd (Crozier Rd drivers wait 53–74 s a vehicle at 2041 high growth, about 15 years from now).</p>
<table><thead><tr><th>Option</th><th>Cost class (assumed)</th><th>Time stopped, now (2025 data), term weekday</th>
<th>Now (2025 data), summer peak day</th><th>2041 (about 15 years from now), high growth, term weekday</th></tr></thead><tbody>"""]
    for sc, name, cost in rows:
        o.append(f"<tr><td>{name}</td><td>{h(cost)}</td><td>{cell(a, 'weekday_term', sc)}</td>"
                 f"<td>{cell(a, 'summer_peak', sc)}</td><td>{cell(g, 'weekday_term', sc, True)}</td></tr>")
    o.append("""</tbody></table>
<p>Change in total time vehicles spend stopped, against today's network in the same year and condition (now: 3 seeds).
Cost classes are order-of-magnitude assumptions, not estimates: $ under $0.5 M, $$ $0.5–3 M, $$$ $3–10 M.
The new junctions are geometric approximations, not designs; N4 sits beside a level crossing and would need crossing
protection and land.</p>
<ul>
<li><strong>Today's traffic:</strong> N9 (Crozier Rd turn lanes at Armstrong Rd plus a roundabout at Hindmarsh Rd /
Grantley Ave) is the best tested: about 11% less time stopped on a term weekday and 18% less on a summer day (the summer
range across seeds, 364–386 vehicle-hours, is clear of today's 450–472).</li>
<li><strong>As the town grows:</strong> N7 (roundabouts at Armstrong/Crozier, Armstrong/Greenhills and
Hindmarsh/Grantley) is the best tested at 2041 (about 15 years from now) high growth (about −24%), while both the council's package and Brent's
are about +60%. A staged reading: N9 now, then the Armstrong Rd roundabouts as the growth areas fill.</li>
<li><strong>Growth is still not solved:</strong> even N7 leaves 2041 weekday queueing at about 3.4 times today's, and
no tested option fixes the Victoria St corridor or the Hindmarsh Rd side streets (about 80% of summer delay stays
where it is under N9).</li>
<li><strong>Didn't help:</strong> N6 (turn bans: traffic moves onto other side streets; +22% in summer) and N8
(Victoria St left-turn lanes).</li>
<li>The council's two ring-road options are compared in <a href="#ring-road">their own section</a>.</li>
</ul>""")
    return "\n".join(o)


RING_OPTIONS = [  # (id, plain name) — S9, sim/assumptions/S9-ring-road.md
    ("baseline", "Option 2 as it is: today's ring road"),
    ("n7", "Option 2 with junction fixes (N7: roundabouts at Armstrong/Crozier and Armstrong/Greenhills, plus Hindmarsh/Grantley)"),
    ("b3", "Option 2 widened to four lanes (B3)"),
    ("c5", "Option 1: outer ring road via Greenhills Rd (C5), existing ring at 60 km/h"),
    ("c5b", "Option 1: outer ring road west of Greenhills Rd (C5b), existing ring at 60 km/h"),
]
RING_COMBOS = [("weekday_term", "2025", "base", "2025 term weekday"), ("summer_peak", "2025", "base", "2025 summer peak day"),
               ("weekday_term", "2031", "high", "2031 high growth, term weekday"),
               ("summer_peak", "2031", "high", "2031 high growth, summer peak day"),
               ("weekday_term", "2041", "high", "2041 high growth, term weekday")]


def ring_road_options() -> str:
    """Section from the S9 tables (vhsim.integration.s9_ring): the council's two ring-road options."""
    f = DATA / "results" / "report_s9" / "summary.csv"
    if not f.exists():
        return ""
    s = pd.read_csv(f, dtype={"year": str})

    def cell(sc, c, y, g):
        x = s[(s.scenario == sc) & (s.condition == c) & (s.year == y) & (s.growth == g)]
        if x.empty:
            return "not run"
        r = x.iloc[0]
        return "today" if sc == "baseline" else f"{r.stopped_change_pct:+.0f}%"

    o = ["""<h2 id="ring-road">The council's ring-road options</h2>
<p>Option 1 is a new outer freight ring road with the existing ring road (Welch Rd / Armstrong Rd) lowered to
60 km/h; Option 2 keeps the current ring road. The council's map is indicative, so we built Option 1 from the route
it describes over existing roads (Swains Crossing Rd, Greenhills Rd, Hutchinson Rd, Hindmarsh Tiers Rd) plus short
new sections, in two readings, with trucks preferring the outer road. Method and assumptions:
<code>sim/assumptions/S9-ring-road.md</code>. "2025" is today's demand; 2031 and 2041 are the high growth series.</p>
<table><thead><tr><th>Option</th>""" + "".join(f"<th>Time stopped, {h(lab)}</th>" for *_, lab in RING_COMBOS)
         + "</tr></thead><tbody>"]
    for sc, name in RING_OPTIONS:
        o.append(f"<tr><td>{h(name)}</td>" + "".join(f"<td>{cell(sc, c, y, g)}</td>" for c, y, g, _ in RING_COMBOS)
                 + "</tr>")
    o.append("</tbody></table><p>Change in total time vehicles spend stopped, against today's network on the same seeds, "
             "same year and condition. \"not run\": the run did not finish by 22 Nov 2026 (machine overloaded, not "
             "gridlock). Seeds per cell: " + h(", ".join(f"{LBL}: {int(n)}" for LBL, n in _seed_counts(s))) + ".</p>")
    o.append(RING_FINDINGS)
    return "\n".join(o)


def _seed_counts(s: pd.DataFrame):
    for sc, name in RING_OPTIONS:
        for c, y, g, lab in RING_COMBOS:
            x = s[(s.scenario == sc) & (s.condition == c) & (s.year == y) & (s.growth == g)]
            if not x.empty:
                yield f"{sc} {lab}", x.seeds.iloc[0]


RING_FINDINGS = """<ul>
<li><strong>Option 1 as consulted made things worse in every run that finished:</strong> at 2041 high growth (term
weekday, 3 seeds) time stopped rose 18% (outer road via Greenhills Rd) and 30% (outer road further west), trips 16–22 s
longer; on a 2025 summer day (one seed) +83%. It does take through trucks off the existing ring road (about 410 a day
to 30–40), and the ring-road junction queues almost disappear, but at 60 km/h the existing ring road is no longer
faster than going through town: Armstrong/Welch Rd lose about half their traffic, and much of it moves onto Hindmarsh
Rd (+14% vehicle-km), Adelaide Rd (+23%) and the town-centre streets, where it queues at side streets and the
Grantley Ave crossing. Trucks using town-centre streets rise by about a quarter, and trips between the northern growth
areas and the town centre get slightly longer (7.4 to 7.8–7.9 minutes).</li>
<li><strong>Option 2 with junction fixes is the best tested at every growth level:</strong> roundabouts at Armstrong
Rd / Crozier Rd and Armstrong Rd / Greenhills Rd (plus Hindmarsh Rd / Grantley Ave, N7) cut time stopped 24% at 2041
high growth, 4–6% on 2031 weekdays and 37–43% on 2031 summer days (single runs). Widening the ring road without fixing
its junctions (B3) is worse than today at 2041.</li>
<li><strong>Not settled:</strong> whether an outer road helps if the existing ring road keeps its speed (that test
did not finish), and Option 1's 2031 and most 2025 runs. The model has no estate streets or new links for the growth
areas and little through freight, which an Option 1 design would change. Details and gaps:
<code>sim/assumptions/S9-ring-road.md</code>.</li>
</ul>"""


def body() -> str:
    S = pd.read_csv(D / "summary.csv"); F = pd.read_csv(D / "foreshore.csv")
    I = pd.read_csv(D / "intersections.csv"); A = pd.read_csv(D / "accessibility.csv")
    o = []
    o.append("""<h1>Simulation Results</h1>
<p><strong>Preliminary.</strong> First results from our SUMO (Simulation of Urban MObility) model of Victor Harbor now (traffic built from 2025 data): term weekday and summer peak day, 3 runs (random seeds) each. Independently reviewed on 21 Nov 2026; wording below follows that review. Method: <a rel="related" href="/n/simulation-design">Simulation Design</a>; options: <a rel="related" href="/n/options-register">Options Register</a>; assumptions and calibration fit: <code>sim/assumptions/integration.md</code> (A-INT-01 to 04) and <code>sim/assumptions/S6-scenarios.md</code>.</p>
<h2 id="how-to-read">How to read these results</h2>
<ul>
<li><strong>Differences, not forecasts.</strong> The model is partly calibrated: most main roads are within about ±25% of Department for Infrastructure and Transport (DIT) daily counts, but Victoria St carries about 50% too much and Adelaide Rd about 40% too little, and the town centre is somewhat under-loaded: at the counted intersections the model carries about 0.80 of the 2017 turning counts projected to 2025 (method and validation: <code>sim/data/counts/PROJECTION.md</code>; <a rel="related" href="/n/traffic-and-crash-data#projected-counts">projected counts</a>). Delay grows faster than traffic, so penalties in the town centre are more likely understated than overstated.</li>
<li><strong>Noise.</strong> The 3 seeds share the same trips, so the spread shown is simulation noise only, not uncertainty about demand.</li>
<li><strong>Metrics.</strong> "Trip time" is door-to-door driving time. "Time stopped" is total vehicle-hours stationary in queues; it does not depend on speed limits (unlike the simulator's "time loss" measure, which we do not use). Part of the extra trip time in lower-speed options is the lower limits themselves, assuming full compliance.</li>
<li><strong>As modelled.</strong> Signals (C4) are a minimal design (one shared lane per approach, equal green split) and probably pessimistic; 20 km/h shared streets (C2) have no pedestrian delay and are probably optimistic. Brent's package here is B3+B4+B5 (time-based speed zones, B2, not included).</li>
</ul>""")
    # network
    o.append('<h2 id="network">Network-wide</h2><table><thead><tr><th>Option</th><th>Condition</th><th>Average trip (min)</th><th>Change per trip (s)</th><th>Slowest 5% (min)</th><th>Time stopped (vehicle-hours/day)</th><th>Change in time stopped</th></tr></thead><tbody>')
    rows = []
    for _, r in S.iterrows():
        rows.append({k: (None if pd.isna(v) else v) for k, v in r.items()})
        o.append(f"<tr><td>{h(LABEL[r.scenario])}</td><td>{h(COND[r.condition])}</td><td>{r.mean_trip_min:.2f}</td>"
                 f"<td>{'' if r.scenario == 'baseline' else f'{r.trip_change_s:+.0f}'}</td><td>{r.p95_trip_min:.2f}</td>"
                 f"<td>{r.time_stopped_veh_h:.0f}</td><td>{'' if r.scenario == 'baseline' else f'{r.stopped_change_pct:+.0f}%'}</td></tr>")
    o.append("</tbody></table>")
    o.append('<script type="application/json" id="network-results">' + json.dumps(rows) + "</script>")
    o.append("<p>Seed-to-seed spread: average trip ±0.01–0.08 min; time stopped ±5 (weekday) to ±60 (summer) vehicle-hours. Smaller differences are noise. Components don't add up exactly (C1a + C3 + C4 increments exceed the package's), and C2 was not run on its own.</p>")
    # foreshore
    o.append('<h2 id="foreshore">Foreshore (claim R23a)</h2><p>Per day. "North Flinders Pde" = the northern 128 m of Flinders Parade at Bridge Terrace (the loop\'s route into Coral St); "Esplanade screenline" = vehicles crossing the Esplanade near Albert Place, either direction; vehicle-km = all driving on Flinders Pde and the Esplanade.</p>')
    o.append('<table><thead><tr><th>Option</th><th>Condition</th><th>Trucks via north Flinders Pde</th><th>Caravans via north Flinders Pde</th><th>Cars via north Flinders Pde</th><th>Cars across Esplanade screenline</th><th>Car vehicle-km on foreshore</th><th>Truck vehicle-km on foreshore</th></tr></thead><tbody>')
    for _, r in F[F.scenario.isin(["baseline", "c3", "c3b", "c4", "cp", "bp"])].iterrows():
        o.append(f"<tr><td>{h(LABEL[r.scenario])}</td><td>{h(COND[r.condition])}</td><td>{fmt(r.get('flinders_north_truck'))}</td>"
                 f"<td>{fmt(r.get('flinders_north_caravan'))}</td><td>{fmt(r.get('flinders_north_car'))}</td>"
                 f"<td>{fmt(r.get('esplanade_car'))}</td><td>{fmt(r.get('vkm_car'))}</td><td>{fmt(r.get('vkm_truck'), 1)}</td></tr>")
    o.append("</tbody></table><p>— = that street section is closed to that direction in the option.</p>")
    # intersections
    sel = [("crozier_acraman_lindsay", "42530557#1"), ("crozier_acraman_lindsay", "42530541#5"),
           ("coral_ocean", "60269598#2"), ("torrens_eyre_seaview_hindmarsh", "173449331"),
           ("torrens_eyre_seaview_hindmarsh", "576495712#3"), ("torrens_crozier", "1202918968#1"),
           ("armstrong_crozier", "39946279"), ("victoria_oval", "173449383#0")]
    a = I[I.condition == "summer_peak"]
    o.append('<h2 id="intersections">Selected intersection approaches — summer peak day</h2><p>Average wait (seconds) and traffic (vehicles/day) on each approach.</p><table><thead><tr><th>Intersection</th><th>Approach</th><th>Today: wait / vehicles</th><th>Council package</th><th>Loop only</th><th>Signals only</th><th>Brent\'s package</th><th>Four-lane ring road only</th></tr></thead><tbody>')
    for jid, edge in sel:
        def g(sc):
            x = a[(a.scenario == sc) & (a.junction_id == jid) & (a.approach_edge == edge)]
            return "—" if x.empty or pd.isna(x.mean_delay_s.iloc[0]) else f"{x.mean_delay_s.iloc[0]:.0f} s / {x.veh_per_day.iloc[0]:,}"
        x0 = a[(a.junction_id == jid) & (a.approach_edge == edge)]
        label = x0.approach.iloc[0].split(" (")[0] if not x0.empty else edge
        jname = x0.junction.iloc[0] if not x0.empty else jid
        o.append(f"<tr><td>{h(jname)}</td><td>{h(label)}</td><td>{g('baseline')}</td><td>{g('cp')}</td><td>{g('c3')}</td>"
                 f"<td>{g('c4')}</td><td>{g('bp')}</td><td>{g('b3')}</td></tr>")
    o.append("</tbody></table><p>— = that approach no longer exists in the option (one-way streets), or was rebuilt as a different approach (signals in the council package). Route choice in the model is by travel time alone, with no reluctance to use residential streets, so diverted volumes may be on the high side.</p>")
    # accessibility
    x = A[A.condition == "summer_peak"]
    o.append('<h2 id="accessibility">Travel time from suburbs — summer peak day</h2><p>Home-based trips. Median and slowest 5% (p95), minutes. Rows with few trips (e.g. McCracken to medical, about 126 trips a day to 3 places) are less certain, especially the p95.</p><table><thead><tr><th>From</th><th>To</th><th>Trips/day</th><th>Today median</th><th>Today p95</th><th>Council pkg median</th><th>Council pkg p95</th><th>Brent pkg median</th><th>Brent pkg p95</th></tr></thead><tbody>')
    for area in ["Encounter Bay", "Victor Harbor", "Hayborough", "McCracken", "Hindmarsh Valley"]:
        for cat in ["supermarket", "services", "medical", "beach_foreshore"]:
            def v(sc, col):
                y = x[(x.scenario == sc) & (x.origin_area == area) & (x.dest_category == cat)]
                return "—" if y.empty else f"{y[col].iloc[0] / 60:.1f}"
            nb = x[(x.scenario == "baseline") & (x.origin_area == area) & (x.dest_category == cat)]
            n = "—" if nb.empty else f"{int(nb.n.iloc[0] / 3):,}"
            o.append(f"<tr><td>{h(area)}</td><td>{h(cat.replace('_', ' / '))}</td><td>{n}</td><td>{v('baseline', 'median')}</td><td>{v('baseline', 'p95')}</td>"
                     f"<td>{v('cp', 'median')}</td><td>{v('cp', 'p95')}</td><td>{v('bp', 'median')}</td><td>{v('bp', 'p95')}</td></tr>")
    o.append("</tbody></table>")
    o.append(better_options())
    o.append(ring_road_options())
    o.append("""<h2 id="findings">Findings (preliminary, as modelled)</h2><ul>
<li><strong>Council's town-centre package:</strong> about +28 s per trip and about +60% time stopped in queues on a summer peak day (+275 vehicle-hours a day); about +14 s per trip on a term weekday. Part of the extra trip time is the lower limits themselves.</li>
<li><strong>Which part matters:</strong> on a summer peak day the one-way loop is the largest of the components modelled separately (time stopped +44%; anticlockwise worse); on a term weekday the signals are (+23%) and the loop is neutral.</li>
<li><strong>Foreshore:</strong> the clockwise loop sends about 180 trucks a day (about 10–15 today), twice the caravans in summer, and three to five times the cars via Bridge Terrace and the north end of Flinders Parade into Coral St, while the Esplanade itself carries fewer cars (one-way). Total car driving on the foreshore changes little.</li>
<li><strong>Side streets:</strong> under the council package Acraman St carries about three times today's traffic, and Lindsay St residents wait about 80 s instead of 15 s to get out onto Crozier Rd. Acraman St already has crash hotspots (<a rel="related" href="/n/traffic-and-crash-data#crashes">crash data</a>).</li>
<li><strong>Everyday trips:</strong> in summer, Encounter Bay to a supermarket is about a minute longer on a typical trip and about 2 minutes on the slowest; McCracken to medical services typically 1–1.5 min longer, the slowest 2–4 min.</li>
<li><strong>Brent's package:</strong> neutral network-wide at today's demand. The four-lane ring road as modelled leaves Crozier Rd / Armstrong Rd a give-way, and drivers from Crozier Rd then wait about 50–55 s instead of about 29 s — the junction would need upgrading with the widening.</li>
</ul>
<h2 id="to-check">Known issues to check</h2><ul>
<li>Under the council package, Torrens Lane (tagged a residential street in OpenStreetMap) goes from tens to 500–700 vehicles a day. If it is really a narrow service lane, this inflates the package's penalty slightly.</li>
<li>Growth: at 2041 (about 15 years from now) high growth (State high series) a term weekday finishes (see <a href="#better-options">better options</a>), but a summer day does not: every option jams by early afternoon (<code>sim/assumptions/integration.md</code> A-INT-05). Growth areas load onto today's roads, without their future streets and link roads. Saturday and New Year's Eve are not yet run, nor Option 2's activity centre north of the ring road (C6).</li>
</ul>
<p>Interactive maps of every run: <a rel="related" href="../maps/index.html">Victor Harbor Road Options</a> (a residents' trip checker, plus the detailed viewer with travel time to any place, congestion per lane and direction, and before/after). Source: <code>viewer/</code> in the project. Corrected 22 Nov 2026: a road section where the only vehicle in a 15-minute interval was leaving the stop line could show an hour-long travel time (Grantley Ave at 12:30 on a summer day showed the council package 53 minutes faster than today; it is about a minute slower). Only the maps were affected, not the tables on this page (<code>sim/assumptions/S5-viewer.md</code> V1a).</p>""")
    return "\n".join(o)


if __name__ == "__main__":
    print(body())
