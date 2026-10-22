# Workbook semantics (how to document a study workbook)

The detailed notes about the lab's real study workbook are kept **out of this repository**, because they describe unpublished study data and name collaborators. Keep them locally in `docs/private/WORKBOOK_SEMANTICS.md` (git-ignored).

## What to record locally for each study workbook

- **Structure:** sheets, number of rows, participants, visits and columns; blank columns; identifier formats; value types; formulas; comments (legacy or threaded).
- **Column groups:** how borders group columns, compared with any groups the legend lists, and which names are tentative.
- **Source attribution:** each legend font colour, the source it denotes, and whether the workbook uses it exactly, tentatively (default text colour) or not at all; multi-source (rich-text) headers and any alias inconsistencies.
- **QC highlights:** each legend fill colour, how many cells use it exactly, near-matches that need curator review, and undocumented highlights that stay unresolved.
- **Unresolved metadata:** units, specimens, score types and definitions that are unknown, and ambiguous headers.
- **Curator decisions needed:** each open question, so it can be resolved in the app's Data quality and Measurements pages.

## How the app treats these semantics (applies to any workbook)

- Legend colours are matched exactly (theme colour + tint, or RGB). Colours that only resemble a legend QC colour, within a column group that uses that QC colour, are marked **needs review** and are never confirmed or excluded automatically.
- Undocumented highlights remain **unresolved formatting** and are never an automatic exclusion.
- Default text colour is indistinguishable from a legend's "black" source, so that attribution is **tentative**.
- Comment text is preserved as data; comment authors are never exported.

The expected counts used by the opt-in reference test live in `tests/reference/expected.local.json` (git-ignored); see [DEVELOPING.md](DEVELOPING.md).
