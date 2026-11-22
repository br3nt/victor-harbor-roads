# Projecting the 2017 turning counts to 2025

Regenerate with `python -m vhsim.counts.build` (from `sim/`). Code: `vhsim/counts/projection.py` and `validation.py`; tests in `sim/tests/counts/`.

## Why

The only turning counts for the town centre are from Wednesday 26 April 2017 (Tonkin report, source S-D19), nine years old. The simulation needs a recent weekday, so each counted movement is scaled by a growth factor. `turning_2017.csv` is unchanged; the projection is a separate file, `turning_2025_projected.csv`, that keeps the original counts next to the factor, the reason for the factor and the projected counts (`basis = projected`, never to be read as observed).

## Method in plain English

1. **Roads the Department for Infrastructure and Transport (DIT) counts** (Torrens St, Hindmarsh Rd, Victoria St). DIT publishes an annual average daily traffic (AADT) figure for each road section every year, but the figure is only re-counted every few years, and a new release often just repeats an old count. We therefore use each section's *count year*, not the release year (for example the 2009 count of Hindmarsh Rd 47.66–49.1 km sits unchanged in releases 2016–2021 and counts once). A straight line through the logarithm of AADT against count year (a constant percentage change per year) is fitted to the counts for that section and evaluated at 26 April 2017 and mid-2025. The factor is the ratio. For 2025 this is an extrapolation of one to two years beyond the last count (2024).
2. **Council streets with no DIT counts** (Coral, Crozier, Ocean, Stuart, Hill, Wills, Eyre Terrace, Seaview Rd, Bridge Terrace, Grantley Ave, the access road and the car park). The factor is the growth in the City of Victor Harbor's Estimated Resident Population (ERP) 2018–2025 (15,248 to 17,457, source S-C03) as a compound yearly rate of 1.95%, applied over the 8.2 years from the count date to mid-2025: factor 1.171. The 2017 ERP is not in the archived table, so 2018 is the base. Why population and not the nearby main road: these streets serve local households and visitors who stay in the area, whereas the main-road growth reflects through traffic. See the Armstrong Rd caution below.
3. **Movements between two roads.** A movement from one counted road to another gets the *geometric mean* of the two road factors (the square root of their product), because the vehicle belongs equally to both roads. Movements that stay on one road (through and U-turn) get that road's factor. Where the destination is not one known road (Hindmarsh/Grantley/Bridge Tce cross-island movements marked "unresolved") the approach road's factor is used alone.
4. **School holidays to term weekday: factor 1.0.** The count was in the autumn school holidays. No local data was found to say whether a term weekday is busier or quieter, so no adjustment is made. This is an assumption, not evidence; term-time school and commuter peaks are probably sharper than the 2017 shape.

## Factors by road

| Road | Basis | Data points (count year: AADT) | Factor 2017 to 2025 |
|---|---|---|---|
| Torrens St | DIT, geometric mean of two sections | 50.0–50.38 km: 2010: 15,600; 2021: 15,100; 2024: 15,500 (factor 0.991). 50.38–50.56 km: 2010: 13,200; 2021: 12,300; 2024: 12,900 (0.976) | 0.984 |
| Hindmarsh Rd | DIT, 49.1–50.0 km (nearest the town centre) | 2010: 15,800; 2021: 16,700; 2024: 17,300 | 1.051 |
| Victoria St | DIT 04793, 31.5–32.36 km | 2014: 12,600; 2016: 13,900; 2021: 12,000 | 0.912 |
| All council streets | City of Victor Harbor ERP | 2018: 15,248 … 2025: 17,457 | 1.171 |

Overall the projected total over all 6,000 movement-bins is 1.4% above the 2017 total, because most vehicles are on Torrens St and Hindmarsh Rd, which have grown little.

## Validation against newer data (`projection_validation.csv`, `newer_counts.csv`)

Conversion from the 12-hour count to a daily figure: daily = 12-hour total divided by 0.847, the share of a day that hours 07:00–19:00 hold in `sim/data/profiles/hourly_profile.csv`. That share depends on the assumed night profile, so each daily number is uncertain by roughly 5–10%. "Two-way flow" means all vehicles arriving from and leaving along that arm. GEH is a standard traffic-model fit statistic, sqrt(2 (M − C)² / (M + C)); here it is computed on average hourly flows (daily ÷ 24), not the usual peak hour, so it is only a rough guide (under 5 is conventionally good).

| Comparison | Projected 2025 daily | Reference | Ratio | GEH |
|---|---|---|---|---|
| Torrens St at Ocean St vs DIT 2024 AADT 50.0–50.38 km | 15,903 | 15,500 | 1.03 | 0.7 |
| Torrens St at Stuart St, same section | 14,099 | 15,500 | 0.91 | 2.4 |
| Torrens St at Coral St, same section | 12,888 | 15,500 | 0.83 | 4.5 |
| Torrens St south leg at Seaview/Eyre, same section | 16,911 | 15,500 | 1.09 | 2.3 |
| Hindmarsh Rd north leg at Seaview/Eyre vs DIT 49.1–50.0 km | 16,716 | 17,300 | 0.97 | 0.9 |
| Hindmarsh Rd through movements at Grantley/Bridge (lower bound), same section | 17,917 | 17,300 | 1.04 | 0.9 |
| Coral St vs SMEC estimate | 3,041 | 3,000 | 1.01 | 0.2 |
| Seaview Rd vs SMEC estimate | 6,146 | 7,100 | 0.87 | 2.4 |
| Eyre Terrace vs SMEC estimate | 3,258 | 1,500 | 2.17 | 7.4 |
| Torrens St (average of Ocean/Stuart/Coral) vs SMEC estimate | 14,296 | 8,500 | 1.68 | 11.1 |

- **Agreement:** the town-centre arterial flows agree with DIT's 2024 AADT within ±10% at five of six positions (0.91–1.09) and within 17% at all (the lowest, 0.83, is at Coral St; the reason is not established). The DIT figure is an all-days annual mean and the 2017 count was a school-holiday weekday, so an exact match is not expected.
- **SMEC (Table 3 of the 2026 Victor Harbor Integrated Transport Strategy modelling report, S-B04 p.22):** it gives "estimated daily volume" with no method or year. It matches Coral St (3,041 vs 3,000) and Seaview Rd (within 13%) but is far below the projection for Eyre Terrace (1,500 vs 3,258) and for Torrens St (8,500 vs DIT's 15,500 and our 14,296). The Torrens St figure contradicts DIT's own count for the same street, so the SMEC table is treated as indicative only. These disagreements are not resolved.
- **Council count, Armstrong Rd (S-B34):** about 6,000 vehicles a day in August 2018, against SMEC's 7,200: a rise of 20% in about seven years (about 2.6% a year), faster than the City's population (14.5% over 2018–2025). It mixes a count with an estimate, so it is only a hint that council collector roads may have grown faster than the 1.171 factor assumes. Armstrong Rd is not one of the counted roads.
- **Not usable numerically:** the 2025 permanent counter on Victor Harbor Rd (S-B04 p.41) is shown only as an unlabelled chart; the Hindmarsh Rd "17,300" in S-B37 repeats DIT's figure; no traffic numbers were found for the Wattle Drive/Hindmarsh Rd upgrade or the Grantley Ave trial. RAA's 2021 estimate of 6,700 a day on Victor Harbor Rd is outside the study core.
- Nothing was downloaded: all documents were already archived in the main checkout, so no `raw/` folder or new source ids were needed.

## Limits

- Hindmarsh Rd's 2025 level is an extrapolation of one year beyond DIT's 2024 count; Torrens St is nearly flat, but DIT's counts for it are only three points over 14 years.
- A single growth factor per road is applied to every hour and every movement, so changes in turning patterns (for example from road changes or new housing) are not captured.
- The comparison positions on Torrens St were placed on DIT sections using OpenStreetMap (Ocean, Stuart and Coral lie between 50.0 and 50.38 km); the Grantley/Bridge and Crozier/Victoria positions along the DIT sections are not verified, so Crozier and Victoria are not validated.
- The summer peak is a separate matter (see `seasonal_factors.csv`): this projection is a term weekday only.

## Summary paragraph for the knowledge base

The 2017 Torrens Street counts (a school-holiday Wednesday) were scaled to a 2025 term weekday using transparent, road-by-road growth factors. For Torrens St, Hindmarsh Rd and Victoria St we fitted the Department for Infrastructure and Transport's own count history by count year, which gives roughly 0.98, 1.05 and 0.91; council streets, which DIT does not count, were scaled by the City's estimated resident population growth of about 1.95% a year (factor 1.17 over 8.2 years), and no school-term adjustment was made because no evidence exists. Against DIT's 2024 annual average daily traffic the projected two-way flows on Torrens St and Hindmarsh Rd come out between 0.83 and 1.09 times the DIT figure, which is reasonable given that the counts differ in year, season and method. Newer council-consultant estimates agree for Coral St and Seaview Rd but disagree for Eyre Terrace and Torrens St, and a 2018 council count on Armstrong Rd hints that local roads may have grown faster than population, so the council-street factor may be low.
