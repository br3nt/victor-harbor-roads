"""Hotspots for the visual evidence pack (S8): where each one is, what is compared there, what is animated.

Each hotspot is a set of measuring circles (lon, lat, radius m): an edge belongs to the hotspot when its
stop line (the end of its lane shape) lies inside a circle, in whichever scenario network is measured, so
rebuilt junctions (signals, new roundabouts, turn lanes) are measured on the same ground as today's.
A ``street`` spec (name + longitude range) adds every edge ending at a node on that street, for the
Victoria St corridor (as in ``vhsim.integration.bottlenecks.HOTSPOTS``).

Roles: ``today`` (today's network), ``council`` (the council package, CP), ``component`` (the part of CP
that acts here: C3 one-way loop or C4 signals), ``brent`` (Brent's package, BP) and ``alternative`` (the
best tested option for this spot, or the one built for it when none helps). ``animate`` lists the
(condition, year, growth) sets that get an animation, with the scenarios shown side by side.
Kinds: ``hotspot`` (a bottleneck in the S7 diagnosis or named in the council package) and ``local``
(a place residents asked about; measured the same way, quiet ones say so).
"""
from __future__ import annotations

SCENARIO_LABEL = {
    "baseline": "Today's network", "cp": "Council package", "c3": "C3 one-way loop", "c4": "C4 signals",
    "bp": "Brent's package", "b4": "B4 two-lane McCracken roundabout", "n1": "N1 Grantley crossing closed",
    "n3": "N3 Crozier Rd turn lanes", "n4": "N4 Grantley roundabout", "n7": "N7 three roundabouts",
    "n8": "N8 Victoria St left-turn lanes", "n9": "N9 turn lanes + Grantley roundabout",
}
SCENARIO_LONG = {
    "baseline": "Today's network (no changes)",
    "cp": "Council's town-centre package (30 km/h centre, shared zones, one-way loop, signals)",
    "c3": "C3: the council's one-way outer loop on its own",
    "c4": "C4: the council's traffic signals at Torrens St / Seaview Rd and Torrens St / Crozier Rd on their own",
    "bp": "Brent's package (four-lane ring road, two-lane McCracken roundabout, roundabout slip lanes)",
    "b4": "B4: two-lane McCracken roundabout",
    "n1": "N1: Grantley Ave rail crossing closed",
    "n3": "N3: separate left and right turn lanes on Crozier Rd at Armstrong Rd",
    "n4": "N4: roundabout at Hindmarsh Rd / Grantley Ave (beside the rail crossing)",
    "n7": "N7: roundabouts at Armstrong/Crozier, Armstrong/Greenhills and Hindmarsh/Grantley",
    "n8": "N8: left-turn lanes on Victoria St into Oval Rd and the IGA car park",
    "n9": "N9: Crozier Rd turn lanes at Armstrong Rd + Hindmarsh Rd / Grantley Ave roundabout",
}
# every scenario measured for every hotspot (cheap: one pass over each run serves all hotspots)
SCENARIOS = ["baseline", "cp", "c3", "c4", "bp", "b4", "n3", "n4", "n7", "n8", "n9"]
# (condition, year, growth) periods measured
PERIODS = [(c, y, g) for (y, g) in [(2025, "base"), (2031, "moderate"), (2031, "high"), (2041, "high")]
           for c in ("summer_peak", "weekday_term")]
THIS_YEAR = 2026

HOTSPOTS: list[dict] = [
    {
        "id": "foreshore-loop", "kind": "hotspot", "order": 1,
        "title": "Foreshore route of the one-way loop: Bridge Tce, north Flinders Pde, Coral St",
        "short": "Foreshore loop route",
        "why": "The council's clockwise one-way loop sends Hindmarsh Rd / Eyre Tce traffic, trucks and caravans "
               "included, along Bridge Tce and the north end of Flinders Pde into Coral St.",
        "junctions": "eyre_flinders_bridge (Eyre Tce / Flinders Pde / Bridge Tce), coral_flinders (Coral St / Flinders Pde), "
                     "coral_ocean (Coral St / Ocean St) and north Flinders Pde between them",
        "circles": [(138.624415, -35.552552, 45), (138.62456, -35.55316, 35), (138.624704, -35.553767, 40),
                    (138.623035, -35.553865, 40)],
        "site_names": ['Eyre Tce / Bridge Tce', 'north Flinders Pde', 'Coral St / Flinders Pde', 'Coral St / Ocean St'],
        "view": {"centre": (138.6239, -35.5532), "half": 190},
        "roles": {"today": "baseline", "council": "cp", "component": "c3", "brent": "bp", "alternative": "n9"},
        "key_streets": ["Flinders Parade", "Coral Street", "Bridge Terrace"],
        "key": ["Bridge Terrace", "N"], "flow_headline": True,
        "animate": [{"condition": "summer_peak", "year": 2025, "growth": "base", "scenarios": ["baseline", "cp", "n9"]}],
        "labels": [("Flinders Pde", 138.6243, -35.5530), ("Coral St", 138.6233, -35.5541), ("Bridge Tce", 138.6252, -35.5520)],
    },
    {
        "id": "lindsay-st", "kind": "hotspot", "order": 2,
        "title": "Crozier Rd / Acraman St / Lindsay St: side-street diversion",
        "short": "Lindsay St / Acraman St",
        "why": "With the loop, traffic diverts through Acraman St; Lindsay St residents wait for gaps on Crozier Rd.",
        "junctions": "crozier_acraman_lindsay (Crozier Rd / Acraman St / Lindsay St)",
        "circles": [(138.618563, -35.553348, 45)],
        "view": {"centre": (138.618563, -35.553348), "half": 120},
        "roles": {"today": "baseline", "council": "cp", "component": "c3", "brent": "bp", "alternative": "n9"},
        "key_streets": ["Lindsay Street", "Acraman Street"],
        "animate": [{"condition": "summer_peak", "year": 2025, "growth": "base", "scenarios": ["baseline", "cp", "n9"]}],
        "labels": [("Lindsay St", 138.6178, -35.5528), ("Acraman St", 138.6190, -35.5527), ("Crozier Rd", 138.6178, -35.5539)],
    },
    {
        "id": "torrens-signals", "kind": "hotspot", "order": 3,
        "title": "Torrens St at Seaview Rd / Eyre Tce and at Crozier Rd: the council's signals (C4)",
        "short": "Torrens St roundabouts (C4 signals)",
        "why": "The council would replace the two Torrens St roundabouts with traffic signals.",
        "junctions": "torrens_eyre_seaview_hindmarsh and torrens_crozier (roundabouts today)",
        "circles": [(138.623017, -35.55163, 60), (138.620826, -35.554464, 50)],
        "site_names": ['Seaview Rd / Eyre Tce roundabout', 'Crozier Rd roundabout'],
        "view": {"centre": (138.6219, -35.5530), "half": 230},
        "roles": {"today": "baseline", "council": "cp", "component": "c4", "brent": "bp", "alternative": "n9"},
        "key_streets": ["Eyre Terrace", "Seaview Road", "Hindmarsh Road", "Torrens Street", "Crozier Road"],
        "animate": [{"condition": "summer_peak", "year": 2025, "growth": "base", "scenarios": ["baseline", "c4", "n9"]}],
        "labels": [("Seaview Rd", 138.6222, -35.5512), ("Eyre Tce", 138.6238, -35.5520), ("Torrens St", 138.6217, -35.5530),
                   ("Crozier Rd", 138.6198, -35.5543), ("Hindmarsh Rd", 138.6236, -35.5507)],
    },
    {
        "id": "victoria-st", "kind": "hotspot", "order": 4,
        "title": "Victoria St between Bay Rd and Torrens St",
        "short": "Victoria St corridor",
        "why": "The largest single hotspot today: closely spaced side streets and car-park accesses on a one-lane-"
               "each-way street. No tested option fixes it; N8 (left-turn lanes) was built for it and did not help.",
        "junctions": "Victoria St nodes between lon 138.6125 and 138.6200 (as the S7 diagnosis), incl. victoria_oval, "
                     "victoria_granite, the IGA car-park access and the Liberty service station",
        "street": {"name": "Victoria Street", "lon": (138.6125, 138.6200)},
        "view": {"centre": (138.6163, -35.5574), "half": 360},
        "roles": {"today": "baseline", "council": "cp", "component": None, "brent": "bp", "alternative": "n8"},
        "no_fix": True,
        "key_streets": ["Victoria Street", "Granite Street", "Oval Road"],
        "animate": [{"condition": "summer_peak", "year": 2025, "growth": "base", "scenarios": ["baseline", "cp", "n8"]}],
        "labels": [("Victoria St", 138.6150, -35.5579), ("Oval Rd", 138.6154, -35.5568), ("Granite St", 138.6172, -35.5580),
                   ("Liberty", 138.61349, -35.55813)],
    },
    {
        "id": "grantley", "kind": "hotspot", "order": 5,
        "title": "Bridge Tce / Grantley Ave link onto Hindmarsh Rd (beside the rail crossing)",
        "short": "Grantley Ave / Bridge Tce",
        "why": "Bridge Tce traffic turns into the 17 m crossing link, then right across both Hindmarsh Rd streams.",
        "junctions": "hindmarsh_grantley_bridge (nodes 1948692238, 1948692242) and the Bridge Tce approach",
        "circles": [(138.624821, -35.549482, 55), (138.62425, -35.54930, 35)],
        "view": {"centre": (138.6245, -35.5496), "half": 140},
        "roles": {"today": "baseline", "council": "cp", "component": "c3", "brent": "bp", "alternative": "n4"},
        "key_streets": ["Bridge Terrace", "Grantley Avenue", "Hindmarsh Road"],
        "animate": [{"condition": "summer_peak", "year": 2025, "growth": "base", "scenarios": ["baseline", "cp", "n4"]}],
        "labels": [("Bridge Tce", 138.6240, -35.5497), ("Hindmarsh Rd", 138.6253, -35.5490), ("Grantley Ave", 138.6252, -35.5498)],
    },
    {
        "id": "armstrong-crozier", "kind": "hotspot", "order": 6,
        "title": "Armstrong Rd / Crozier Rd (ring road)",
        "short": "Armstrong Rd / Crozier Rd",
        "why": "Crozier Rd joins the 100 km/h ring road at a give-way; it becomes the worst junction as the town grows.",
        "junctions": "armstrong_crozier (node 598111160)",
        "circles": [(138.609142, -35.548383, 55)],
        "view": {"centre": (138.609142, -35.548383), "half": 140},
        "roles": {"today": "baseline", "council": "cp", "component": None, "brent": "bp", "alternative": "n7",
                  "alternative_now": "n3"},
        "key_streets": ["Crozier Road", "Armstrong Road"],
        "animate": [{"condition": "summer_peak", "year": 2025, "growth": "base", "scenarios": ["baseline", "cp", "n3"]},
                    {"condition": "summer_peak", "year": 2031, "growth": "high", "scenarios": ["baseline", "cp", "n7"]}],
        "labels": [("Crozier Rd", 138.6094, -35.5494), ("Armstrong Rd", 138.6080, -35.5478)],
    },
    {
        "id": "armstrong-greenhills", "kind": "hotspot", "order": 7,
        "title": "Armstrong Rd / Greenhills Rd (ring road)",
        "short": "Armstrong Rd / Greenhills Rd",
        "why": "Growth-area traffic from Greenhills Rd joins the ring road at a give-way.",
        "junctions": "armstrong_greenhills (node 598113188)",
        "circles": [(138.608691, -35.540019, 55)],
        "view": {"centre": (138.608691, -35.540019), "half": 140},
        "roles": {"today": "baseline", "council": "cp", "component": None, "brent": "bp", "alternative": "n7"},
        "key_streets": ["Greenhills Road", "Armstrong Road"],
        "animate": [{"condition": "summer_peak", "year": 2031, "growth": "high", "scenarios": ["baseline", "cp", "n7"]}],
        "labels": [("Greenhills Rd", 138.6075, -35.5395), ("Armstrong Rd", 138.6092, -35.5410)],
    },
    {
        "id": "mccracken", "kind": "local", "order": 8,
        "title": "McCracken roundabout (Adelaide Rd / Hindmarsh Rd / Port Elliot Rd) by Bunnings and the service stations",
        "short": "McCracken roundabout",
        "why": "Asked about by residents: Bunnings, Mobil and OTR are 10-30 m away, Caltex McCracken about 40 m. "
               "Includes the nearby side streets onto Hindmarsh Rd (Antrim St, Down St).",
        "junctions": "adelaide_hindmarsh_portelliot (roundabout), Hindmarsh Rd / Antrim St (node 795603899), "
                     "Hindmarsh Rd / Down St (cluster_11195084600_795603873)",
        "circles": [(138.639082, -35.536497, 75), (138.63778, -35.53910, 30), (138.63828, -35.53825, 30)],
        "site_names": ['McCracken roundabout', 'Antrim St', 'Down St'],
        "view": {"centre": (138.6384, -35.5376), "half": 230},
        "roles": {"today": "baseline", "council": "cp", "component": None, "brent": "bp", "alternative": "b4"},
        "key_streets": ["Adelaide Road", "Hindmarsh Road", "Port Elliot Road", "Antrim Street", "Down Street"],
        "animate": [{"condition": "summer_peak", "year": 2025, "growth": "base", "scenarios": ["baseline", "cp", "b4"]}],
        "labels": [("Bunnings", 138.63778, -35.53619), ("Mobil", 138.63941, -35.53611), ("OTR", 138.63969, -35.53672),
                   ("Caltex", 138.63838, -35.53858), ("Adelaide Rd", 138.6395, -35.5352), ("Port Elliot Rd", 138.6410, -35.5372),
                   ("Antrim St", 138.6372, -35.5394), ("Down St", 138.6378, -35.5378)],
    },
    {
        "id": "maude-st", "kind": "local", "order": 9,
        "title": "The Maude St roundabout (Armstrong Rd / George Main Rd / Inman Valley Rd / Mill Rd / Maude St) and Bay Rd / Maude St",
        "short": "Maude St roundabout",
        "why": "Asked about by residents. The five-leg roundabout at the Maude St industrial estate's north end; "
               "Maude St runs south from it to Bay Rd.",
        "junctions": "armstrong_georgemain_inmanvalley (roundabout) and Bay Rd / Maude St (node 773737914)",
        "circles": [(138.59963, -35.55690, 60), (138.60337, -35.56240, 35)],
        "site_names": ['Maude St roundabout', 'Bay Rd / Maude St'],
        "view": {"centre": (138.6015, -35.5596), "half": 380},
        "roles": {"today": "baseline", "council": "cp", "component": None, "brent": "bp", "alternative": "n9"},
        "key_streets": ["Maude Street", "Armstrong Road", "George Main Road", "Inman Valley Road", "Bay Road"],
        "animate": [{"condition": "summer_peak", "year": 2025, "growth": "base", "scenarios": ["baseline", "cp", "n9"]}],
        "labels": [("Maude St", 138.6012, -35.5590), ("Bay Rd", 138.6040, -35.5630), ("George Main Rd", 138.6010, -35.5558),
                   ("Armstrong Rd", 138.5985, -35.5555), ("Inman Valley Rd", 138.5975, -35.5575)],
    },
    {
        "id": "entrance-roundabout", "kind": "local", "order": 10,
        "title": "Town entrance roundabout: Victor Harbor Rd / Welch Rd / Waterport Rd (towards Urimbirra Wildlife Park)",
        "short": "Entrance roundabout (Victor Harbor Rd)",
        "why": "Asked about by residents. Inside the simulated network: the model's northern gateway on Victor Harbor Rd "
               "is about 6.5 km further north, so traffic arrives here already spread out.",
        "junctions": "Victor Harbor Rd / Welch Rd / Waterport Rd roundabout (OSM ways 23075195, 489185635, 542829858, 558791632)",
        "circles": [(138.6338, -35.5193, 60)],
        "view": {"centre": (138.6338, -35.5193), "half": 150},
        "roles": {"today": "baseline", "council": "cp", "component": None, "brent": "bp", "alternative": "n7"},
        "key_streets": ["Victor Harbor Road", "Welch Road", "Waterport Road"],
        "animate": [],
        "labels": [("Victor Harbor Rd", 138.6345, -35.5175), ("Welch Rd", 138.6320, -35.5195), ("Waterport Rd", 138.6355, -35.5200)],
    },
    {
        "id": "whalers", "kind": "local", "order": 11,
        "title": "Franklin Pde by Whaler's Seaside Dining (the Bluff end)",
        "short": "Franklin Pde at Whalers",
        "why": "Asked about by residents. Quiet in the model on every day simulated; New Year's Eve and other event "
               "days have not been simulated.",
        "junctions": "Franklin Pde nodes within 120 m of Whaler's (138.5983, -35.5866)",
        "circles": [(138.59834, -35.58658, 120)],
        "view": {"centre": (138.59834, -35.58658), "half": 150},
        "roles": {"today": "baseline", "council": "cp", "component": None, "brent": "bp", "alternative": "n9"},
        "key_streets": ["Franklin Parade", "Jagger Road"],
        "animate": [],
        "labels": [("Whaler's", 138.59834, -35.58658), ("Franklin Pde", 138.5995, -35.5858)],
    },
    {
        "id": "service-stations", "kind": "local", "order": 12,
        "title": "The town-centre service stations: Shell (Hindmarsh Rd), Caltex (Torrens St), Liberty (Victoria St)",
        "short": "Service stations",
        "why": "Asked about by residents: the accesses and nearest junctions of the three town-centre service stations, "
               "plus Inman St / Newland St beside Liberty.",
        "junctions": "Shell: Hindmarsh Rd nodes cluster_11174609013_649114783 and 50904904#12.-20; Caltex: the "
                     "right-before-left car-park nodes 13163189011-36 by Torrens St / Coral St; Liberty: Victoria St "
                     "node 1842610521 and Victoria St / Inman St (1948685925); Inman St / Newland St (531031939)",
        "circles": [(138.62315, -35.55095, 45), (138.62082, -35.55388, 35), (138.61349, -35.55813, 40),
                    (138.61354, -35.55905, 20)],
        "sites": [
            {"id": "shell", "name": "Shell, Hindmarsh Rd", "circle": (138.62315, -35.55095, 45)},
            {"id": "caltex", "name": "Caltex, Torrens St (car-park lanes)", "circle": (138.62082, -35.55388, 35)},
            {"id": "liberty", "name": "Liberty, Victoria St / Inman St", "circle": (138.61349, -35.55813, 40)},
            {"id": "inman-newland", "name": "Inman St / Newland St", "circle": (138.61354, -35.55905, 20)},
        ],
        "view": {"centre": (138.6227, -35.5520), "half": 220},
        "roles": {"today": "baseline", "council": "cp", "component": None, "brent": "bp", "alternative": "n9"},
        "key_streets": ["Hindmarsh Road", "Torrens Street", "Victoria Street", "Inman Street", "Newland Street"],
        "animate": [],
        "labels": [("Shell", 138.62315, -35.55095), ("Caltex", 138.62082, -35.55388)],
    },
    {
        "id": "oval-roundabout", "kind": "local", "order": 13,
        "title": "The roundabout by the oval: Bay Rd / Victoria St / George Main Rd",
        "short": "Roundabout by the oval",
        "why": "Asked about by residents ('by the oval, near the caravan park, police station and school'). The only "
               "roundabout there: Victor Harbor High School is about 100 m north, Victor Harbor Oval about 150 m "
               "north-east, the Beachfront Holiday Park about 290 m south, Victor Harbor Holiday Park and the police "
               "station 330-500 m west. Victoria St / Oval Rd (a give-way T, 330 m east) is part of the Victoria St hotspot.",
        "junctions": "bay_victoria_georgemain (roundabout)",
        "circles": [(138.611889, -35.557287, 60)],
        "view": {"centre": (138.611889, -35.557287), "half": 150},
        "roles": {"today": "baseline", "council": "cp", "component": None, "brent": "bp", "alternative": "n9"},
        "key_streets": ["Bay Road", "Victoria Street", "George Main Road"],
        "animate": [{"condition": "summer_peak", "year": 2025, "growth": "base", "scenarios": ["baseline", "cp", "n9"]}],
        "labels": [("High School", 138.61168, -35.55633), ("Oval", 138.61347, -35.55622), ("Bay Rd", 138.6110, -35.5582),
                   ("George Main Rd", 138.6108, -35.5565), ("Victoria St", 138.6132, -35.5575)],
    },
]
BY_ID = {h["id"]: h for h in HOTSPOTS}


def year_label(year: int | str, growth: str = "base") -> str:
    """'now (2025 data)' for the model's today; other years with how far ahead of THIS_YEAR they are."""
    y = int(year)
    if growth == "base" or y <= 2025:
        return "now (2025 data)"
    ahead = y - THIS_YEAR
    g = {"moderate": "moderate growth", "high": "high growth"}.get(growth, growth)
    return f"{y} (in about {ahead} years), {g}"


def condition_label(condition: str) -> str:
    return {"summer_peak": "summer peak day", "weekday_term": "term weekday", "saturday": "Saturday",
            "event_nye": "New Year's Eve"}.get(condition, condition)


def period_key(condition: str, year, growth: str) -> str:
    return f"{condition}_{year}_{growth}"
