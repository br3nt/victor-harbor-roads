# Assumptions — S3-counts

Each entry: value, reason, expected sensitivity, and what evidence would replace it. Sourced values are not listed here; they carry their source id in the data files.

## A1. Approach directions and turn types from the report's diagrams
- **Value:** N/S/E/W and L/T/R/U for each report movement number, read from the diagram on each Appendix A page (standard numbering: 1–3 from S, 4–6 from E, 7–9 from N, 10–12 from W, each left/through/right; xA = U-turn).
- **Why:** the report gives movement numbers, not words; the diagram is the only key. The diagram is schematic and its N arrow is not a surveyed bearing (e.g. Victoria's S arm is labelled "Wills Street").
- **Sensitivity:** low for totals (which do not depend on it); medium when mapping counts onto network edges.
- **Replace with:** compass bearings from the S1 network geometry at each junction.

## A2. Hindmarsh/Grantley/Bridge Tce movement reading
- **Value:** turn types for the 30 movements from arrow shapes; "jog" lanes (3, 8, 18, 23) read as through; cross-island stubs (4, 7, 19, 22) read as L/R with unresolved destination; 5, 6, 20, 21 read as U-turn/return.
- **Why:** the five-lane approaches either side of the island cannot be unambiguously decoded from the schematic.
- **Sensitivity:** low (movements 2 and 24, through on Hindmarsh Rd, carry ~90% of flow; the ambiguous ones total a few hundred vehicles a day).
- **Replace with:** site inspection or aerial imagery of the junction.

## A3. Hourly profile, hours 00–06 and 19–23
- **Value:** Delaware DOT 2024 weekday hourly distribution, factor group 8 (S-S3-01), transcribed from the table image: 00–06 = 0.26, 0.16, 0.14, 0.13, 0.25, 0.75, 2.42 %; 19–23 = 4.02, 3.09, 2.13, 1.26, 0.65 %. These hours total 15.3% of the day; hours 07–18 take the remaining 84.7%.
- **Why:** no Victor Harbor, South Australian or Australian 24-hour profile was found; the DIT data have no hourly counts. Group 8 was picked because its mid-day plateau resembles the 2017 observed shape; the PDF does not define what the factor groups are (urban/rural), so the choice is a judgement.
- **Sensitivity:** the night/evening share changes the daily-total ↔ 07–19 mapping by roughly ±5 points (other groups in the same table put 07–18 at 70–85%). Daily volumes scaled to AADT will move by that much; the 07–18 shape is unaffected.
- **Replace with:** any hourly counts (7-day tube counts) on a Victor Harbor road, or a DIT/Austroads regional profile.

## A4. 2017 school-holiday day as a typical weekday shape
- **Value:** the 7 intersections' summed profile stands for a normal weekday's 07–19 shape.
- **Why:** the only data. The 2017 count day was in school holidays; term-time commuter and school-run peaks (08:00–09:00, 15:00–16:00) are probably sharper than observed.
- **Sensitivity:** medium for the `weekday_term` condition, low for `summer_peak`.
- **Replace with:** term-time counts.

## A5. Summing across intersections for the profile
- **Value:** vehicles passing several of the 7 intersections are counted at each.
- **Why:** no vehicle tracking; assumed each hour is affected proportionally.
- **Sensitivity:** low for shape.

## A6. Position of AADT sections
- **Value:** a section's point is at the RRD fraction along the S-D05 polyline (RRD linear in length), at the midpoint of the part inside lon 138.50–138.72, lat −35.62 to −35.48; the road name comes from the S-D05 feature at that point; section 04688 0–3.9 is named after the feature holding its midpoint (Port Elliot Rd).
- **Why:** S-D02 has no coordinates; the matching statewide GeoJSON (S-D01, SA Lambert) was not used.
- **Sensitivity:** low (tens to a few hundred metres) except where a long rural section is clipped; match to the network edge by name and RRD, not by distance, where possible.

## A7. Summer peak factor
- **Value:** factor ≥ 1.31 (11,000 / 8,400) to ≥ 1.43 (11,000 / 7,700) for Victor Harbor Rd only. Recommend 1.31–1.43 as the lower bound of the true peak; any higher figure is an assumption.
- **Why:** DIT states ">11,000" for unspecified sections; AADT is annual mean, both directions.
- **Sensitivity:** high for `summer_peak` volumes at the gateway.
- **Replace with:** DIT permanent counter or summer tube counts at Victor Harbor Rd, Dec–Jan.

## A8. No summer factor for the town centre
- **Value:** none derived. The 2015 parking surveys show a typical weekday (2 Dec) already had core CBD >80% occupancy, so they are not used to scale traffic.
- **Sensitivity:** high; town-centre summer demand is set in the demand stream.
