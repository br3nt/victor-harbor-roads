"""Address index for the residents' site (``viewer/residents/data/addresses.json``).

    python -m vhsim.viewer.addresses --gnaf DIR [--out viewer/residents/data/addresses.json]

DIR holds the South Australian pipe-separated G-NAF files (see below). Run from ``sim/``.

Source: Geoscape Geocoded National Address File (G-NAF), November 2026 release (GDA2020), "Open G-NAF" on
data.gov.au (https://data.gov.au/data/dataset/geocoded-national-address-file-g-naf). Only these South Australia
tables are read: ``SA_ADDRESS_DETAIL``, ``SA_ADDRESS_DEFAULT_GEOCODE``, ``SA_STREET_LOCALITY``, ``SA_LOCALITY``.
Licence: the Open G-NAF End User Licence Agreement (26 Feb 2016), which is Creative Commons Attribution 4.0
International plus one use restriction: it must not be used to generate addresses or a compilation of addresses for
the sending of mail without verifying each address can receive mail. This index is used only to find a point on a
map, never for mail. Attribution travels with the data (the ``attribution`` field, and the residents' page footer).

What is kept: current (not retired) principal addresses in the localities of the Victor Harbor council area, with
street name and type, locality, house number (with suffix, number ranges and lot numbers), flat/unit, and the
default geocode. Dropped: building names, levels, alias addresses, mesh blocks, parcel ids, dates. Each street also
gets a point on the street (the address nearest the average of its addresses) for street-only matches.

File format (version 1), compact JSON, about 0.3 MB (15,656 addresses, 652 streets, 10 localities in the November 2026 release):
    {"v":1, "source":..., "licence":..., "attribution":..., "built":"YYYY-MM-DD",
     "loc":["Victor Harbor", ...],
     "streets":[[name, locIndex, lon, lat, [[number, dx, dy] | [number, dx, dy, flat], ...]], ...]}
``dx``/``dy`` are integers in units of 0.00001 degree (about 1 m) from the street's ``lon``/``lat``; ``number`` is
text such as "12", "12A", "12-14" or "Lot 5" (empty when the address has none); ``flat`` is text such as "3" (unit) or
"Shop 3".
"""
from __future__ import annotations

import argparse
import csv
import datetime
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

LOCALITIES = [
    "VICTOR HARBOR", "ENCOUNTER BAY", "HAYBOROUGH", "MCCRACKEN", "HINDMARSH VALLEY", "LOWER INMAN VALLEY",
    "INMAN VALLEY", "WAITPINGA", "MOUNT JAGGED", "BACK VALLEY",
]
SOURCE = "Geoscape Geocoded National Address File (G-NAF), November 2026, South Australia (GDA2020), Open G-NAF"
LICENCE = "Open G-NAF End User Licence Agreement (Creative Commons Attribution 4.0 International with a no-mail-generation use restriction)"
ATTRIBUTION = "Incorporates or developed using G-NAF © Geoscape Australia licensed by the Commonwealth of Australia under the Open Geo-coded National Address File (G-NAF) End User Licence Agreement. Modified: reduced to this area and simplified."
UNIT_TYPES = {"UNIT", "STRATA UNIT"}


def title(s: str) -> str:
    """'MCCRACKEN' -> 'McCracken', 'ST ANDREWS' -> 'St Andrews', "O'CONNOR" -> "O'Connor"."""
    out = []
    for w in s.lower().split():
        if w.startswith("mc") and len(w) > 2:
            w = "Mc" + w[2:].capitalize()
        else:
            w = re.sub(r"(^|['-])([a-z])", lambda m: m.group(1) + m.group(2).upper(), w)
        out.append(w)
    return " ".join(out)


def read_psv(path: Path):
    with open(path, newline="", encoding="utf-8") as f:
        yield from csv.DictReader(f, delimiter="|")


def find(gnaf: Path, name: str) -> Path:
    hits = sorted(gnaf.rglob(f"{name}_psv.psv"))
    if not hits:
        sys.exit(f"{name}_psv.psv not found under {gnaf}")
    return hits[0]


def number_text(r: dict) -> str:
    """'12', '12A', '12-14', '12A-14B', 'Lot 5' or '' for an address with no street number."""
    def part(prefix, num, suffix):
        return f"{r[prefix]}{r[num]}{r[suffix]}" if r[num] else ""
    first = part("NUMBER_FIRST_PREFIX", "NUMBER_FIRST", "NUMBER_FIRST_SUFFIX")
    last = part("NUMBER_LAST_PREFIX", "NUMBER_LAST", "NUMBER_LAST_SUFFIX")
    if first and last:
        return f"{first}-{last}"
    if first:
        return first
    if r["LOT_NUMBER"]:
        return f"Lot {r['LOT_NUMBER_PREFIX']}{r['LOT_NUMBER']}{r['LOT_NUMBER_SUFFIX']}"
    return ""


def flat_text(r: dict, flat_types: dict) -> str:
    if not r["FLAT_NUMBER"]:
        return ""
    n = f"{r['FLAT_NUMBER_PREFIX']}{r['FLAT_NUMBER']}{r['FLAT_NUMBER_SUFFIX']}"
    t = flat_types.get(r["FLAT_TYPE_CODE"], "UNIT")
    return n if t in UNIT_TYPES or not r["FLAT_TYPE_CODE"] else f"{title(t)} {n}"


def build(gnaf: Path, today: str | None = None) -> dict:
    loc_pid = {r["LOCALITY_PID"]: r["LOCALITY_NAME"] for r in read_psv(find(gnaf, "SA_LOCALITY"))
               if not r["DATE_RETIRED"] and r["LOCALITY_NAME"] in LOCALITIES}
    streets = {r["STREET_LOCALITY_PID"]: r for r in read_psv(find(gnaf, "SA_STREET_LOCALITY"))
               if not r["DATE_RETIRED"] and r["LOCALITY_PID"] in loc_pid}
    flat_types = {}
    try:
        flat_types = {r["CODE"]: r["NAME"] for r in read_psv(find(gnaf, "Authority_Code_FLAT_TYPE_AUT"))}
    except SystemExit:
        pass
    geo = {}
    for r in read_psv(find(gnaf, "SA_ADDRESS_DEFAULT_GEOCODE")):
        if not r["DATE_RETIRED"]:
            geo[r["ADDRESS_DETAIL_PID"]] = (float(r["LONGITUDE"]), float(r["LATITUDE"]))
    by_street = defaultdict(dict)
    n_rows = n_no_street = n_no_geo = 0
    for r in read_psv(find(gnaf, "SA_ADDRESS_DETAIL")):
        if r["DATE_RETIRED"] or r["ALIAS_PRINCIPAL"] != "P" or r["LOCALITY_PID"] not in loc_pid:
            continue
        n_rows += 1
        sid = r["STREET_LOCALITY_PID"]
        if sid not in streets:
            n_no_street += 1
            continue
        pt = geo.get(r["ADDRESS_DETAIL_PID"])
        if not pt:
            n_no_geo += 1
            continue
        by_street[sid][(number_text(r), flat_text(r, flat_types))] = pt   # one point per number+flat

    loc_names = [title(n) for n in LOCALITIES]
    out_streets = []
    n_addr = 0
    for sid, addrs in by_street.items():
        s = streets[sid]
        name = title(" ".join(x for x in (s["STREET_NAME"], s["STREET_TYPE_CODE"], s["STREET_SUFFIX_CODE"]) if x))
        mlon = sum(p[0] for p in addrs.values()) / len(addrs)
        mlat = sum(p[1] for p in addrs.values()) / len(addrs)
        near = min(addrs.values(), key=lambda p: (p[0] - mlon) ** 2 + (p[1] - mlat) ** 2)
        lon0, lat0 = round(near[0], 5), round(near[1], 5)
        rows = []
        for (num, flat), (lon, lat) in sorted(addrs.items(), key=lambda kv: (len(kv[0][0]), kv[0])):
            row = [num, round((lon - lon0) * 1e5), round((lat - lat0) * 1e5)]
            if flat:
                row.append(flat)
            rows.append(row)
        n_addr += len(rows)
        out_streets.append([name, loc_names.index(title(loc_pid[s["LOCALITY_PID"]])), lon0, lat0, rows])
    out_streets.sort(key=lambda s: (s[1], s[0]))
    print(f"{n_rows} principal addresses in {len(LOCALITIES)} localities; {n_no_street} without a street, "
          f"{n_no_geo} without a geocode; kept {n_addr} (unique number+flat) on {len(out_streets)} streets",
          file=sys.stderr)
    return {"v": 1, "source": SOURCE, "licence": LICENCE, "attribution": ATTRIBUTION,
            "built": today or datetime.date.today().isoformat(), "loc": loc_names, "streets": out_streets,
            "counts": {"addresses": n_addr, "streets": len(out_streets), "localities": len(loc_names)}}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--gnaf", required=True, type=Path, help="directory holding the SA G-NAF .psv files (searched recursively)")
    ap.add_argument("--out", type=Path, default=Path("../viewer/residents/data/addresses.json"))
    a = ap.parse_args(argv)
    doc = build(a.gnaf)
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(json.dumps(doc, separators=(",", ":"), ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {a.out} ({a.out.stat().st_size / 1e6:.2f} MB)", file=sys.stderr)


if __name__ == "__main__":
    main()
