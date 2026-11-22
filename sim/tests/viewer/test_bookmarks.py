import numpy as np

from vhsim.viewer.bookmarks import auto_bookmarks, clock, parse_bookmark, queue_bookmarks


def test_clock_plain_english():
    assert clock(0) == "midnight"
    assert clock(7 * 3600 + 45 * 60) == "7:45 am"
    assert clock(12 * 3600) == "noon"
    assert clock(15 * 3600 + 15 * 60) == "3:15 pm"
    assert clock(24 * 3600 + 30 * 60) == "12:30 am (next day)"


def test_peak_rise_and_fall():
    begin, dt = 6 * 3600, 900
    delay = np.array([0, 0.1, 0.2, 2.0, 6.0, 9.0, 9.5, 4.0, 1.0, 0.5, 0.4, 0.3])
    bms = auto_bookmarks(delay, begin=begin, interval_s=dt)
    kinds = {b["detail"]["type"]: b for b in bms}
    peak = kinds["peak"]
    assert peak["t"] == begin + 6 * dt and peak["kind"] == "auto"
    assert peak["label"] == "Peak delay 7:30–7:45 am (9.5 vehicle-hours)"
    rises = [b for b in bms if b["detail"]["type"] == "rise"]
    falls = [b for b in bms if b["detail"]["type"] == "fall"]
    assert rises and rises[0]["t"] == begin + 4 * dt                     # +4.0 is the largest rise
    assert "rising" in rises[0]["label"] and "7:00 am" in rises[0]["label"]
    assert falls and falls[0]["t"] == begin + 7 * dt                     # -5.5
    assert "easing" in falls[0]["label"]
    assert [b["t"] for b in bms] == sorted(b["t"] for b in bms)
    # neighbouring steps of the same build-up are one bookmark, not three
    assert len(rises) == 1 and len(falls) == 1


def test_quiet_day_has_no_rise_bookmarks():
    bms = auto_bookmarks(np.array([0.0, 0.01, 0.02, 0.01]), begin=0, interval_s=900)
    assert [b["detail"]["type"] for b in bms] == []


def test_queue_bookmarks_first_crossing():
    T = 6
    halted = np.zeros((T, 3))
    halted[2:5, 1] = [6, 9, 7]      # approach 1 queues from interval 2
    halted[4, 2] = 5.5             # approach 2 briefly
    approaches = [
        {"edge": 0, "label": "Ocean St (east-bound) at Coral St"},
        {"edge": 1, "label": "Main Rd (north-bound) at Beach Rd"},
        {"edge": 2, "label": "Torrens St (south-bound) at Ocean St"},
    ]
    bms = queue_bookmarks(halted, approaches, begin=0, interval_s=900, threshold=5, limit=5)
    assert [b["detail"]["edge"] for b in bms] == [1, 2]
    assert bms[0]["t"] == 1800
    assert bms[0]["label"] == ("Queue on Main Rd (north-bound) at Beach Rd passes 5 halted vehicles per lane "
                              "(15-minute average) at 12:30 am")
    assert bms[0]["detail"]["peak_vehicles"] == 9


def test_rise_into_the_peak_is_folded_into_the_peak():
    bms = auto_bookmarks(np.array([0, 0, 0, 10.0, 2.0, 1.0]), begin=0, interval_s=900)
    types = [b["detail"]["type"] for b in bms]
    assert types.count("peak") == 1 and "rise" not in types
    assert bms[0]["detail"]["change_veh_h"] == 10.0


def test_parse_scenario_bookmark():
    b = parse_bookmark("15:00=School pick-up")
    assert b == {"t": 54000, "label": "School pick-up (3:00 pm)", "kind": "scenario", "detail": {}}
