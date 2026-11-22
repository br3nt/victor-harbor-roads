# Hotspot evidence pack

Hotspot by hotspot: today's roads, the council's package and the best tested alternative, with numbers,
side-by-side animations of the same 15 simulated minutes, and congestion maps. Built for an onboarding page
and a slide deck. Method and assumptions: `sim/assumptions/S8-hotspots.md`.

**Years.** This year is 2026. The model's "today" is built on 2025 data and is labelled **now (2025 data)**.
2031 is **in about 5 years** (moderate or high growth, 1 run each); 2041 high growth is **in about 15 years**
(term weekday only: the 2041 summer day jammed for every option tried there, i.e. today's roads, CP, BP and
the four-lane ring road; the N options were not tried). Now = mean of 3 runs. The numbers compare
options on the same traffic; they are not forecasts (Victoria St is over-loaded about 1.5× in the model,
the town centre somewhat under-loaded).

**Open it.** `cd viewer && node test/serve.mjs` then <http://127.0.0.1:4418/hotspots/>. One hotspot per entry
in the list; `#h=<id>&s=<set>` links straight to one.

**Terms.** *Wait* = seconds per vehicle on the approach beyond its free-flow time (the R15 approach delay).
*Time stopped* = vehicle-hours a day standing still on the hotspot's lanes. *Queue* = vehicles standing still,
averaged over the busiest 15 minutes (7.5 m a vehicle). Summer = the summer peak day.

## Hotspots and headline numbers

Abbreviations: CP council package; C3 one-way loop alone; C4 signals alone; BP Brent's package; N3 Crozier Rd
turn lanes; N4 Hindmarsh Rd / Grantley Ave roundabout; N7 three roundabouts (Armstrong/Crozier,
Armstrong/Greenhills, Hindmarsh/Grantley); N8 Victoria St left-turn lanes; N9 = N3 + N4.

### 1. Foreshore route of the one-way loop (Bridge Tce, north Flinders Pde, Coral St) — `foreshore-loop`
Shows: the loop pushes Hindmarsh Rd / Eyre Tce traffic, trucks and caravans down Bridge Tce onto the
foreshore. Animation: summer, now: today | CP | N9.
- **Summer, now (2025 data):** Bridge Tce into north Flinders Pde carries about 2,600 vehicles a day with 14
  trucks and 67 caravans on today's roads. With the council package: about 5,200 (82 trucks, 97 caravans);
  the loop alone 7,400 (162 trucks, 118 caravans). N9 and BP leave it as today.
- **Term weekday, now:** 1,030 → 2,740 a day with CP; trucks 10 → 66.
- **2031 (in about 5 years), high growth, summer:** CP about 5,800 a day (63 trucks, 90 caravans) against
  3,100 (14 trucks) today. The loop alone backs up badly here: 388 vehicle-hours stopped a day at this spot
  (today's roads: 7), with worst approach waits over 100 s at Eyre Tce / Bridge Tce and Coral St / Ocean St.
- Time stopped at the spot, summer now: 3.6 vehicle-hours today, 11.0 with CP.

### 2. Crozier Rd / Acraman St / Lindsay St — `lindsay-st`
Shows: traffic diverting through Acraman St under the loop, and Lindsay St residents waiting to get out.
Animation: summer, now: today | CP | N9.
- **Summer, now:** Lindsay St waits **14 s** a vehicle today, **83 s** with the council package (the loop
  alone 48 s; BP 13 s; N9 12 s). Acraman St carries 1,800 a day today, 5,400 with CP.
  Worst 5% of Lindsay St drivers: 55 s today, about 5 minutes (294 s) with CP.
- **2031 (in about 5 years):** moderate growth 39 s today → 99 s CP; high growth 45 s → 142 s CP
  (N9 38 s, BP 43 s). With the loop alone at high growth the junction backs up (312 s).
- **Term weekday, now:** 5 s → 15 s with CP; Acraman St 1,500 → 5,800 a day.

### 3. Torrens St roundabouts at Seaview Rd / Eyre Tce and at Crozier Rd (council signals, C4) — `torrens-signals`
Shows: replacing the two roundabouts with signals (C4). Animation: summer, now: today | C4 signals | N9.
- **Summer, now:** time stopped at the two junctions 44 vehicle-hours a day today; **91 with the signals
  (C4)**, 114 with the whole council package; N9 **26** (−40%; the Grantley roundabout takes load off the
  Seaview roundabout). Eyre Tce waits 27 s today, 31 s with C4, 19 s with N9.
- **2031 (in about 5 years), high growth, summer:** 67 today → 137 C4 / 162 CP; N9 40.
- **Term weekday, now:** 12 today → 39 with C4.
- Under CP, Torrens Lane (a narrow lane in reality) becomes a rat run at the Crozier Rd roundabout
  (120 s waits): see the KB caveat on Torrens Lane.

### 4. Victoria St between Bay Rd and Torrens St — `victoria-st`
Shows: the largest delay in town today; no tested option fixes it. Animation: summer, now: today | CP | N8
(the option built for it).
- **Summer, now:** 77 vehicle-hours stopped a day (the biggest single hotspot); CP 114; BP 80; N8 104
  (worse); N9 67 and N7 70 (−14% and −9%, from traffic using other routes). Granite St waits 44 s;
  Victoria St eastbound through the corridor about 22 s.
- **2031 (in about 5 years), summer:** 193 (moderate) and 178 (high) today; CP 151 / 249; BP 188 / 234;
  N9 113 / 183; N7 110 / 108. These are single runs and swing a lot here (today's roads come out worse at
  moderate growth than at high, and N9 is 41% better at one growth and 3% worse at the other), so only the
  consistent result stands: N7 is about 40% lower than today's roads at both growths. That is traffic taking
  the improved ring road instead of Victoria St, not a fix for the corridor itself.
- Caveat: Victoria St carries about 1.5× its counted traffic in the model and the car parks are simplified;
  this is the least reliable hotspot.

### 5. Bridge Tce / Grantley Ave link onto Hindmarsh Rd — `grantley`
Shows: the right turn from Bridge Tce across Hindmarsh Rd via the 17 m crossing link, and N4's roundabout.
Animation: summer, now: today | CP | N4.
- **Summer, now:** Bridge Tce waits **49 s** today; **15 s with N4**; BP 50 s. The council package cuts it to
  9 s only because the loop sends that traffic elsewhere (onto the foreshore, hotspot 1).
- **2031 (in about 5 years), high growth, summer:** 89 s today → 19 s N4 (N9 20 s); BP 63 s; CP 15 s.
- Time stopped, summer now: 33 → 13 vehicle-hours (N4).

### 6. Armstrong Rd / Crozier Rd (ring road) — `armstrong-crozier`
Shows: Crozier Rd traffic waiting for gaps on the 100 km/h ring road; worst junction as the town grows.
Animations: summer now: today | CP | N3 turn lanes; summer 2031 high growth: today | CP | N7.
- **Summer, now:** Crozier Rd waits **29 s** today; CP 43 s; BP 52 s (more ring-road traffic, fewer gaps);
  **N3 turn lanes 16 s**; N7 roundabout 6 s.
- **2031 (in about 5 years), summer:** moderate growth 80 s today, CP 71, BP 98, N3 26, N7 8; high growth
  **79 s today, CP 104, BP 112, N3 50, N7 8**. Time stopped (high): 70 today, 50 with N3, 5 with N7.
- **2041 (in about 15 years), high growth, term weekday:** 74 s today, CP 100, BP 130, N3 52, N7 8.
- Reading: turn lanes (N3) roughly halve the wait now; by 2031 at high growth they are not enough (50 s),
  while the roundabout (in N7) keeps Crozier Rd under 10 s in every year tested. The roundabout makes
  ring-road traffic slow and give way, so Armstrong Rd itself queues at times (see the 2031 animation).

### 7. Armstrong Rd / Greenhills Rd (ring road) — `armstrong-greenhills`
Shows: growth-area traffic from Greenhills Rd joining the ring road. Animation: summer 2031 high growth:
today | CP | N7.
- **Now:** quiet (1.6 vehicle-hours a day in summer; Greenhills Rd 12 s).
- **2031 (in about 5 years), high growth, summer:** 8 vehicle-hours; Greenhills Rd 20 s today, 23 s CP,
  34 s BP, 8 s N7.
- **2041 (in about 15 years), high growth, term weekday:** 15.6 vehicle-hours today, 26 BP, 19 CP, 2.9 N7;
  Greenhills Rd 22 s today, 46 s BP, 27 s CP, 9 s N7.

### 8. McCracken roundabout by Bunnings and the service stations (local check) — `mccracken`
Junctions: `adelaide_hindmarsh_portelliot` (roundabout), Hindmarsh Rd / Antrim St (node 795603899),
Hindmarsh Rd / Down St. Animation: summer, now: today | CP | B4 (two-lane roundabout).
- **Summer, now:** main legs wait 4–14 s (Port Elliot Rd 14 s); 23 vehicle-hours stopped a day. B4 does not
  help (27; Port Elliot Rd 12 s); CP 17. Down St waits 34 s (500 vehicles a day); Antrim St carries only
  about 7 vehicles a day in the model (56 s) — too few to rate; Alexander St (minor leg) 50 s.
- **2031 (in about 5 years), high growth, summer:** 32 vehicle-hours; Port Elliot Rd 14 s; Down St 42 s.

### 9. The Maude St roundabout (local check) — `maude-st`
The five-leg roundabout Armstrong Rd / George Main Rd / Inman Valley Rd / Mill Rd / Maude St
(`armstrong_georgemain_inmanvalley`, at the Maude St industrial estate) plus Bay Rd / Maude St
(node 773737914). Animation: summer, now: today | CP | N9.
- **Now:** fine (6 vehicle-hours a day in summer; Maude St waits 11 s at the roundabout, 5 s at Bay Rd).
- **2031 (in about 5 years), summer:** grows to 26–34 vehicle-hours; Maude St 41 s at high growth (CP 53 s,
  BP 59 s, N9 49 s); N7 13 vehicle-hours. Single runs swing here too (CP is 14 vehicle-hours at moderate
  growth but 36 at high), so read 2031 as "it gets busier", not as a ranking of options.

### 10. Town entrance roundabout, Victor Harbor Rd / Welch Rd / Waterport Rd (local check) — `entrance-roundabout`
Inside the simulated network (the northern gateway is about 6.5 km further north). No animation (quiet).
- **Summer, now:** 4 vehicle-hours a day, waits 6–7 s. **2031 high growth:** 9 vehicle-hours, 10–11 s. No
  option changes it by more than 1–2 s.

### 11. Franklin Pde by Whaler's (the Bluff end) (local check) — `whalers`
No animation (quiet). Waits 1–5 s on every simulated day and option, now and in 2031; under 0.1
vehicle-hours stopped a day. New Year's Eve and other event days have not been simulated.

### 12. Town-centre service stations (local check) — `service-stations`
Shell (Hindmarsh Rd, nodes `cluster_11174609013_649114783`, `50904904#12.-20`), Caltex (Torrens St
car-park lanes, right-before-left nodes 13163189011–36), Liberty (Victoria St / Inman St, nodes 1842610521,
1948685925), Inman St / Newland St (531031939). No separate animation (Shell and Caltex are inside the
Torrens St animation's view; Liberty inside Victoria St's).
- **Shell, summer now:** Hindmarsh Rd 8 s; the station exit 13 s (about 40 vehicles a day). CP 21 s on
  Hindmarsh Rd (loop traffic); N9 6 s.
- **Caltex, summer now:** car-park lanes 22 s (240 a day); CP 38 s; N9 16 s.
- **Liberty:** Victoria St 3–4 s; quiet.
- **Inman St / Newland St, summer:** Newland St 14 s now, 44 s with CP; 2031 high growth 66 s today, 77 s CP.

### 13. The roundabout by the oval: Bay Rd / Victoria St / George Main Rd (local check) — `oval-roundabout`
`bay_victoria_georgemain`, the only roundabout near the oval (High School about 100 m, Victor Harbor Oval
about 150 m, Beachfront Holiday Park 290 m, Victor Harbor Holiday Park and the police station 330–500 m).
Victoria St / Oval Rd (a give-way T) is in hotspot 4. Animation: summer, now: today | CP | N9.
- **Summer, now:** George Main Rd waits 19 s (CP 23, BP 24, N9 18); 16 vehicle-hours a day.
- **2031 (in about 5 years), summer:** moderate growth 67 s today, CP 36, BP 89, N9 28, N7 40; high growth
  54 s today, CP 76, BP 90, N9 65, N7 35 (single runs; only BP is worse than today at both growths, probably
  because its four-lane ring road draws more traffic down George Main Rd).

## Caveats
- One seed per animation and per 2031 result. Now (3 seeds) summer runs vary ±5–12% between seeds; single
  2031 runs at busy hotspots swing much more (Victoria St, Maude St, the oval roundabout), so treat a 2031
  difference as real only when it shows at both growths.
- Give-way gap acceptance is SUMO's model with the A-INT-02 impatience settings; not checked on site.
- Route choice by travel time only, so diversions into residential streets may be on the high side.
- New junctions (N3, N4, N7) are geometric approximations, not designs; N4 sits beside a level crossing.
- Queues in the numbers are 15-minute averages; the animations show moment-to-moment queues, counted only
  inside the picture, and draw trucks and caravans 1.5 times their size so they can be picked out.
- Approach waits include about 1 s of crossing the previous junction, and leave out time waiting inside the
  junction (right-turners at the turn line), so right-turn waits are somewhat understated.
- The hotspot areas here are wider than the S7 diagnosis's in places (oval roundabout, McCracken, Torrens
  St), so their vehicle-hour totals are higher than S7's; compare options within these tables.

## Jammed runs
None of the 16 new 2031 runs (N3, N4, N7, N9 × moderate/high × weekday/summer) jammed (0–29 teleports each,
under the 5% limit). Flagged as jammed in the hotspot files: the 2041 high-growth summer day for today's
network, CP and BP (stopped before the end of the day, A-INT-05). The one-way loop alone (C3) at 2031 high
growth, summer, did not jam by the batch rule (1,043 teleports, 1.1%) but shows extreme queues at hotspots
1, 2 and 5.

## Files

| File | Size | What |
|---|---|---|
| `viewer/hotspots/index.html` | 10 KB |  |
| `viewer/hotspots/player.js` | 14 KB |  |
| `viewer/hotspots/data/manifest.json` | 177 KB |  |
| `viewer/hotspots/data/shots-plan.json` | 17 KB |  |
| `viewer/hotspots/img/shots.json` | 26 KB |  |
| `sim/data/results/hotspots/index.json` | 11 KB |  |
| `sim/data/results/hotspots/chart_waits.csv` | 77 KB |  |
| `sim/assumptions/S8-hotspots.md` | 10 KB |  |
| `sim/data/results/hotspots/<id>.json` | 13 files, 2.0 MB | metrics, headlines, chart and site checks per hotspot |
| `viewer/hotspots/data/<hotspot>/<set>/<scenario>.json` | 33 files, 6.5 MB (largest 491 KB) | animations |
| `viewer/hotspots/img/<hotspot>__<set>__<view>.png` | 70 files, 14.9 MB | congestion (vehicles queued) and difference maps from the engineer viewer |
| `viewer/hotspots/screenshots/*.png` | 13 files, 4.3 MB | the player in a headless browser (desktop, phone, dark) |

Animation files per hotspot:

- `armstrong-crozier`: summer_peak_2025_base/baseline 68 KB, summer_peak_2025_base/cp 87 KB, summer_peak_2025_base/n3 65 KB, summer_peak_2031_high/baseline 89 KB, summer_peak_2031_high/cp 96 KB, summer_peak_2031_high/n7 106 KB
- `armstrong-greenhills`: summer_peak_2031_high/baseline 98 KB, summer_peak_2031_high/cp 122 KB, summer_peak_2031_high/n7 81 KB
- `foreshore-loop`: summer_peak_2025_base/baseline 231 KB, summer_peak_2025_base/cp 233 KB, summer_peak_2025_base/n9 188 KB
- `grantley`: summer_peak_2025_base/baseline 150 KB, summer_peak_2025_base/cp 120 KB, summer_peak_2025_base/n4 140 KB
- `lindsay-st`: summer_peak_2025_base/baseline 73 KB, summer_peak_2025_base/cp 124 KB, summer_peak_2025_base/n9 81 KB
- `maude-st`: summer_peak_2025_base/baseline 294 KB, summer_peak_2025_base/cp 273 KB, summer_peak_2025_base/n9 251 KB
- `mccracken`: summer_peak_2025_base/b4 245 KB, summer_peak_2025_base/baseline 231 KB, summer_peak_2025_base/cp 223 KB
- `oval-roundabout`: summer_peak_2025_base/baseline 165 KB, summer_peak_2025_base/cp 136 KB, summer_peak_2025_base/n9 133 KB
- `torrens-signals`: summer_peak_2025_base/baseline 389 KB, summer_peak_2025_base/c4 387 KB, summer_peak_2025_base/n9 362 KB
- `victoria-st`: summer_peak_2025_base/baseline 416 KB, summer_peak_2025_base/cp 464 KB, summer_peak_2025_base/n8 491 KB

Tests: `cd sim && python -m pytest tests/integration` (hotspot metrics and animation export);
`cd viewer && node --test test/hotspots-player.test.mjs` (player); `node test/hotspots-smoke.mjs` (page in a
headless browser, writes the screenshots); `node test/hotspot-shots.mjs [--resume]` (pictures).
