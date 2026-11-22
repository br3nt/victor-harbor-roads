"""Timeline bookmarks: automatic (network delay, peak, junction queues) and scenario-defined."""
from __future__ import annotations

import numpy as np

#: a rise/fall must be at least this share of the day's peak delay ...
REL_THRESHOLD = 0.15
#: ... and at least this many vehicle-hours per 15 minutes
ABS_THRESHOLD = 0.5
#: same-type bookmarks closer than this many intervals are merged (the largest is kept)
MERGE_INTERVALS = 2


def clock(t: float) -> str:
    """Seconds from midnight -> '7:45 am', 'noon', 'midnight', '12:30 am (next day)'."""
    t = int(round(t))
    day, s = divmod(t, 86400)
    h, rem = divmod(s, 3600)
    m = rem // 60
    if h == 0 and m == 0:
        txt = "midnight"
    elif h == 12 and m == 0:
        txt = "noon"
    else:
        txt = f"{(h % 12) or 12}:{m:02d} {'am' if h < 12 else 'pm'}"
    return txt + (" (next day)" if day >= 1 else "")


def clock_range(t0: float, t1: float) -> str:
    a, b = clock(t0), clock(t1)
    if a.endswith((" am", " pm")) and b.endswith((" am", " pm")) and a[-2:] == b[-2:]:
        return f"{a[:-3]}–{b}"
    return f"{a}–{b}"


def _veh_h(x: float) -> str:
    return f"{x:.1f} vehicle-hours" if abs(x) < 100 else f"{x:.0f} vehicle-hours"


def auto_bookmarks(delay_veh_h, begin: float, interval_s: float) -> list[dict]:
    """Peak interval and the sharpest rises/falls of network-wide delay (vehicle-hours per interval)."""
    d = np.asarray(delay_veh_h, float)
    if d.size == 0 or not np.isfinite(d).any() or np.nanmax(d) <= 0:
        return []
    peak_i = int(np.nanargmax(d))
    peak = float(d[peak_i])
    out = []
    if peak >= ABS_THRESHOLD:
        t = begin + peak_i * interval_s
        out.append({"t": t, "kind": "auto", "label": f"Peak delay {clock_range(t, t + interval_s)} ({_veh_h(peak)})",
                    "detail": {"type": "peak", "delay_veh_h": round(peak, 3)}})
    diff = np.diff(d, prepend=d[0])
    thr = max(REL_THRESHOLD * peak, ABS_THRESHOLD)
    for typ, sign in (("rise", 1), ("fall", -1)):
        cand = [i for i in np.argsort(-sign * diff) if sign * diff[i] >= thr]
        chosen: list[int] = []
        for i in cand:
            if all(abs(i - j) > MERGE_INTERVALS - 1 for j in chosen) and len(chosen) < 2:
                chosen.append(int(i))
        for i in chosen:
            if typ == "rise" and i == peak_i and out and out[0]["detail"]["type"] == "peak":
                out[0]["detail"]["change_veh_h"] = round(float(diff[i]), 3)   # the peak says it already
                continue
            t = begin + i * interval_s
            ch = float(diff[i])
            mins = int(round(interval_s / 60))
            if typ == "rise":
                label = f"Delay rising fast at {clock(t)} (+{_veh_h(ch)} in {mins} minutes)"
            else:
                label = f"Congestion easing at {clock(t)} (−{_veh_h(-ch)} in {mins} minutes)"
            out.append({"t": t, "kind": "auto", "label": label,
                        "detail": {"type": typ, "change_veh_h": round(ch, 3)}})
    return sorted(out, key=lambda b: b["t"])


def queue_bookmarks(halted, approaches: list[dict], begin: float, interval_s: float, threshold: float = 5,
                    limit: int = 5) -> list[dict]:
    """First interval where a junction approach's mean halted vehicles per lane reaches ``threshold``.

    ``halted``: [T, A] for the approaches listed in ``approaches`` (dicts with ``edge`` and ``label``).
    Keeps the ``limit`` approaches with the longest peak queue."""
    h = np.asarray(halted, float)
    hits = []
    for a, ap in enumerate(approaches):
        over = np.nonzero(h[:, a] >= threshold)[0]
        if over.size:
            hits.append((float(h[:, a].max()), int(over[0]), a, ap))
    hits.sort(key=lambda x: -x[0])
    out = []
    for peak, i, a, ap in hits[:limit]:
        t = begin + i * interval_s
        out.append({"t": t, "kind": "auto",
                    "label": f"Queue on {ap['label']} passes {threshold:g} halted vehicles per lane "
                             f"(15-minute average) at {clock(t)}",
                    "detail": {"type": "queue", "edge": ap["edge"], "peak_vehicles": round(peak, 1),
                               "threshold_vehicles": threshold}})
    return sorted(out, key=lambda b: b["t"])


def compass(bearing: float) -> str:
    names = ("north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west")
    return names[int(((bearing % 360) + 22.5) // 45) % 8]


def junction_approaches(nj) -> list[dict]:
    """Routable edges that end at a junction with 3+ legs, labelled 'Street (east-bound) at Cross St'."""
    e, nodes = nj["edges"], nj["nodes"]
    legs: dict[int, set] = {}
    names: dict[int, set] = {}
    for i in range(len(e["id"])):
        for n, other in ((e["from"][i], e["to"][i]), (e["to"][i], e["from"][i])):
            legs.setdefault(n, set()).add(other)
            if e["name"][i]:
                names.setdefault(n, set()).add(e["name"][i])
    out = []
    for i in range(len(e["id"])):
        to = e["to"][i]
        if not e["routable"][i] or len(legs.get(to, ())) < 3:
            continue
        street = e["name"][i] or "unnamed road"
        cross = sorted(names.get(to, set()) - {e["name"][i]})
        where = (nodes["name"][to] if nodes["name"][to] else
                 " and ".join(cross) if cross else f"junction {nodes['id'][to]}")
        out.append({"edge": i, "label": f"{street} ({compass(e['bearing'][i])}-bound) at {where}"})
    return out


def parse_bookmark(spec: str) -> dict:
    """'15:00=School pick-up' -> scenario bookmark at 54000 s labelled 'School pick-up (3:00 pm)'."""
    when, _, label = spec.partition("=")
    hh, _, mm = when.strip().partition(":")
    t = int(hh) * 3600 + int(mm or 0) * 60
    return {"t": t, "label": f"{label.strip()} ({clock(t)})", "kind": "scenario", "detail": {}}
