# Calibration targets (S3 counts)

Regenerate everything with `python -m vhsim.counts.build` (run from `sim/`). Tests: `sim/tests/counts/`.

## turning_2017.csv — 15-minute turning counts, 7 intersections (S-D19)

- **What:** Tonkin "Torrens Street Traffic Management Review – Draft for Consultation" (13 Jul 2017), Appendix A, counts by Austraffic. One row per intersection × movement × 15-min bin (6,000 rows): `light, heavy, cycle` counts. Cyclists are counted separately from motor vehicles (`heavy` share below = heavy / (light + heavy)).
- **Where:** Torrens/Victoria, Torrens/Crozier, Torrens/Coral, Torrens/Stuart, Torrens/Ocean, Torrens/Seaview/Eyre, Hindmarsh/Grantley/Bridge Tce.
- **When:** Wednesday 26 April 2017, 07:00–19:00, fine weather. **Season:** school holidays (autumn), not summer peak and not term-time: use for shape and relative turning shares; scale to today's level with the DIT AADT, not directly.
- **Approach directions / turn types** come from the movement diagram printed on each appendix page (N arrow up the page). They are the report's schematic, not surveyed bearings; the network mapping must confirm them against real geometry. `notes` carries the report's movement number (e.g. `report movement 7`) so each row can be traced to the PDF column. Oddities in the diagrams: Victoria's S arm is labelled "Wills Street" and its N arm "Torrens Street"; Ocean's W arm is "Access"; Coral is a T-junction (Coral St from the E).
- **Hindmarsh/Grantley/Bridge Tce** is a five-lane-per-side layout either side of a central island with 30 numbered movements. Turn types are read from arrow shapes; destinations across the island are marked "unresolved" in `to_road` and several lane groups are flagged low confidence. The through movements that carry ~90% of the flow (report movements 2 and 24, Hindmarsh Rd) are unambiguous.
- **Reproduced report figures** (see `turning_2017_report_totals.csv`; all asserted in tests): 12-hour totals and busiest hour, per intersection: Coral 12,195 (13:15), Crozier 13,055 (11:45), Stuart 13,175 (11:45), Victoria 12,557 (12:00), Seaview/Eyre 17,550 (11:45), Ocean 15,468 (11:45), Grantley/Bridge 15,469 (11:15); busiest-hour volumes 1,281 / 1,431 / 1,367 / 1,410 / 1,823 / 1,606 / 1,624. Ocean and Grantley are different intersections that happen to differ by one vehicle; the PDF totals rows print 15,468 and 15,469. Torrens St right turn into Ocean St (S approach, R) = 673 (report: "around 700"); Stuart St N-approach L = 539 and S-approach R = 177 (report: ~530 / ~180). Heavy share on Torrens St through movements = 1.41% (report-implied 1.4–1.5%).
- **Limits:** one weekday; 12 hours only (no night, no weekend); peaks occur mid-morning to mid-afternoon rather than at commuter times; counts are of movements at each intersection, so summing across intersections counts a vehicle more than once; no origin–destination information beyond the turn.

## aadt.csv — DIT AADT sections (S-D02, geometry S-D05)

- **What:** both-direction annual average daily traffic by road section, 2026 DIT release, with the count year and CV% (coefficient of variation of the estimate, as supplied). Roads 04760 (Victor Harbor / Adelaide / Hindmarsh / Torrens), 04688 (Port Elliot / North Tce / Goolwa), 04793 (Inman Valley / George Main / Victoria St), 04790 (Hindmarsh Tiers Rd).
- **Where:** lon/lat is the midpoint of the part of the section inside lon 138.50–138.72, lat −35.62 to −35.48 (`notes` says where a section was clipped), placed by road-running-distance fraction along the S-D05 polyline; `bearing_deg` is the direction of increasing road-running distance (not a travel direction; AADT is both directions).
- **When/season:** annual mean; count years 2021–2025. Urban town-stretch counts are 2024. DIT lists commercial vehicles as ~2% on the urban sections with no class breakdown (the fields are zero), probably an assumed value. Not a summer or weekday figure.
- **Limits:** no per-direction split; section midpoints are approximate (RRD fraction assumption); long rural sections (e.g. Victor Harbor Rd 28.26–43.21, Hindmarsh Tiers Rd) are represented by their in-box portion only.

## hourly_profile.csv — share of daily traffic by hour

- **Hours 07–18 (`observed`):** shape of all movements summed across the 7 intersections in the 2017 counts, school-holiday Wednesday. Scaled so these 12 hours hold 84.7% of the day (the share the reference table gives them).
- **Hours 00–06 and 19–23 (`assumed`):** Delaware DOT weekday factor group 8 (S-S3-01, archived in `profiles/raw/`). A US reference, not Victor Harbor or Australian data; see `sim/assumptions/S3-counts.md`.
- **Limits:** no weekend or summer profile. The observed hours show a flat mid-day plateau (08:00–16:00) and no sharp commuter peaks, which is typical of a tourist/retiree town centre in holidays and may differ in term time.

## seasonal_factors.csv — summer peak

- **Victor Harbor Rd:** DIT (S-D18) says "more than 11,000 vehicles" use these sections of Victor Harbor Road each day in the summer peak holiday period; AADT is 7,700 (RRD 28.26–43.21) to 8,400 (43.21–45.6) [S-D02] giving a factor of at least 1.31–1.43. It is a lower bound, DIT does not say which section, and nothing is known for the town centre.
- **Parking surveys (supporting only):** the 2015 report shows the core CBD >80% occupied on Wed 2 Dec 2015 (typical weekday) as well as Wed 30 Dec 2015 (peak summer); what changes in summer is that all CBD streets, including Flinders Pde, are at or near capacity for much of the day. No traffic ratio is derived from this.
