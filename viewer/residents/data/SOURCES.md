# addresses.json: sources and licence

Built by `sim/vhsim/viewer/addresses.py` (run from `sim/`: `python -m vhsim.viewer.addresses --gnaf DIR`).

- **Source**: Geoscape Geocoded National Address File (G-NAF), November 2026 release, GDA2020, "Open G-NAF" on
  data.gov.au (https://data.gov.au/data/dataset/geocoded-national-address-file-g-naf). Tables read: South Australia
  `ADDRESS_DETAIL`, `ADDRESS_DEFAULT_GEOCODE`, `STREET_LOCALITY`, `LOCALITY`, and the flat-type authority code.
  Only the SA files were fetched (about 270 MB of the 1.7 GB national zip, by HTTP range requests); nothing is kept
  in the repository except the output.
- **Built**: 2026-11-21.
- **Licence**: Open G-NAF End User Licence Agreement, 26 February 2016: Creative Commons Attribution 4.0
  International, plus a use restriction. The data must not be used to generate an address or a compilation of
  addresses for the sending of mail unless each address has been verified as able to receive mail from another
  source. We use it only to place a point on a map. Modified material must say it was modified, and the attribution
  below must be kept (it is in the file's `attribution` field and on the residents' page).
- **Attribution**: Incorporates or developed using G-NAF © Geoscape Australia licensed by the Commonwealth of Australia under the Open Geo-coded National Address File (G-NAF) End User Licence Agreement. Modified: reduced to this area and simplified.
  (Wording to be checked against the notice that ships in the G-NAF release; the EULA PDF itself does not give it.)
- **What was kept**: current principal addresses (not retired, not aliases) in Victor Harbor, Encounter Bay,
  Hayborough, McCracken, Hindmarsh Valley, Lower Inman Valley, Inman Valley, Waitpinga, Mount Jagged and Back Valley.
  Street name and type, locality, house number (with suffix, range or lot number), flat or unit, and the default
  geocode (to 1 m). Dropped: building names, levels, parcel ids, dates, postcodes.
- **Counts**: 15,656 addresses (unique number and flat) on 652 streets in 10 localities. Per locality: Victor Harbor
  4,889; Encounter Bay 4,539; Hayborough 2,512; McCracken 1,630; Hindmarsh Valley 670; Waitpinga 503; Lower Inman
  Valley 322; Inman Valley 317; Back Valley 169; Mount Jagged 105. File size about 0.27 MB. Hindmarsh Island and
  Nangkita are in the G-NAF but outside the council area, so they are not included.
- **Privacy**: these are published addresses with no names. The file is downloaded once by the page and searched
  on the device; what a resident types is never sent anywhere.
- **Format**: see the docstring of `addresses.py`.
