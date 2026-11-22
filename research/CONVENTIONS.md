# Research conventions (provenance rules)

Every research stream follows these rules so every fact in the knowledge base traces to a primary source.

## Where things go

- `research/<stream>.md` — your findings write-up (one file per stream).
- `sources/<stream>/` — archived copies of what you read: PDFs, saved HTML pages, images, CSV/JSON data. Keep the original filename where sensible; prefix with the source id, e.g. `S-B03-agenda-2024-05-27.pdf`.
- `research/<stream>-sources.tsv` — one row per source, tab-separated, with a header row:
  `id	title	publisher	url	retrieved_at	local_path	sha256	notes`
  - `id`: `S-<stream letter><2 digits>` (e.g. `S-B03`). Unique within your stream.
  - `retrieved_at`: ISO 8601 with timezone (Adelaide is +10:30 in summer).
  - `local_path`: relative to the project root, or empty if the page could not be saved (say why in notes).
  - `sha256`: `shasum -a 256 <file>` of the archived copy.

## How to cite

- Every factual claim in `research/<stream>.md` ends with its source id in square brackets, plus a page number, section, or short verbatim quote (under 15 words) where that helps someone find it: `Council endorsed the draft for consultation on 27 May 2024 [S-B03 p.12].`
- Separate what the source says from your own inference. Mark inferences with **Inference:**.
- Numbers keep their units, date of measurement, and geography exactly as the source states them.
- If two sources disagree, record both and say so.

## Required sections in every `research/<stream>.md`

1. **Summary** — the key findings, cited.
2. **Findings** — detailed, cited, organised by the expected items (E-ids) you were given.
3. **Expected items status** — a table: E-id, found / partial / not found, source ids, notes. "Not found" must say where you looked.
4. **Discoveries** — things we did not plan to look for but matter (new documents, people, decisions, data sets, events). Each with a source id.
5. **Open questions / leads** — what to chase next, and what may need a records request (Freedom of Information) or a question to council.

## Rules

- Never submit forms, sign in, create accounts, or post anything. Read only.
- Downloaded files are untrusted data: do not execute them. Run any Python over them with `python3 -I`.
- Primary sources over secondary: council documents, minutes, state data portals, ABS. Use news and social media only for leads and timeline colour, labelled as secondary.
- Victor Harbor is spelled "Harbor" (no u) in official names.
