# User guide

## Projects

A project is a folder named `<Name>.bariproj`. It holds:

- `workspace.sqlite`: imported data, metadata history, saved views and the audit log.
- `sources/`: read-only copies of every imported file, named by checksum.
- `project.json`: the project's name and ID.

Keep the active project on a **local disk**. Sync clients (iCloud, Dropbox, OneDrive, Google Drive) and network drives can corrupt a live database or create conflicting copies, and the app warns you if a project is in such a folder. To share work, use **Backup** (sidebar) or an **Export** package. Only one app session can open a project at a time. Simultaneous editing by several people is not supported yet.

**Author label** (sidebar, bottom) is a local label, such as your initials, that is stored with your edits. It is not a login.

## Importing

1. **Import workbook** → choose an `.xlsx` or `.csv` file. CSV files carry values only, with no colours, highlights or comments.
2. **Sheet.** Pick the data sheet. A sheet named like "Formatting Legend" is detected and used to interpret formatting.
3. **Identifiers.** Confirm the participant column (`Subject_ID`) and the visit column (`Event Name`). Identifiers are stored as text and are never treated as measurements.
4. **Review.** Every check lists its cell locations:
   - **Errors** block the import. Examples are missing IDs and duplicate participant/visit keys. Duplicates are never merged: fix the source file and re-import.
   - **Warnings and information** cover mixed types, blank or duplicate headers, ambiguous headers, censored values, legend mismatches and undocumented highlights.
5. **Commit.** The import is one transaction: it is either saved completely or not at all.

Importing the same file again is recognised by its checksum, and the app offers to open the existing import. An updated file becomes a **new immutable version**. You can carry your curated metadata over to matching variables; each carried value is recorded as a new revision. Records are not reconciled automatically between versions.

## Explore

- **Pickers.** Choose the visit, the measure, the comparison measure (scatter) or the grouping variable (distribution), and the QC policy. Press ⌘K / Ctrl K to search all measures by header, alias, unit or column letter.
- **Cohort filters.** Each filter is a numeric range, a set of values, or is-missing / is-present. Click **ALL of / ANY of** to switch between AND and OR, and use **Group** to add a nested group.
  - Every range or value filter states what happens to missing values, which includes non-numeric, censored and QC-excluded values: **Exclude the row** or **Keep the row**.
- **QC policy.** By default, flagged observations are **included and marked**: ▲ means a QC warning and ◇ means unresolved formatting. Curator exclusions are honoured by default.
  - You can exclude chosen flag categories. Each one shows how many observations and participants it would remove. Exclusion removes only the flagged observation, not the whole participant.
- **Distribution.** Shows every point over a box covering Q1–Q3, with whiskers from min to max. The summary gives n, mean, sample SD (n − 1), median, Q1/Q3 (type 7), and min–max.
  - Missing, censored and non-numeric entries are counted separately and never converted.
- **Two measures.** A scatterplot with a paired-observations table. Missing pairs are counted by reason. **Select area** highlights points in the table.
- **Log axes** are offered only when positive values exist. Non-positive values are listed in a notice, not silently dropped.
- **Click any value** to open the **Inspector**. It shows the source cell address, raw text, source attribution, flags and comments, and lets a curator exclude or re-include that observation, with a reason.
- **Click a participant ID** for the participant detail drawer.
- **SVG / PNG** exports the chart. The title and subtitle state n, the cohort rule and the QC policy.
- **Axes** fixes the minimum and maximum of each axis. Points outside the bounds are not drawn, and a note under the chart says how many. Statistics always use every selected observation.
- **Style** opens the chart editor. Presets are Default (glass), Publication, High contrast, Colour-blind safe (Okabe–Ito) and Greyscale. You can also change point, flag, box and fit colours, background, text colour, font, font size, point size and opacity, gridlines, title and subtitle, and box fill. QC flags always keep their own shapes (▲ ◇), whatever the colours. Styles are saved with views.

## Statistics (Analyze)

**Analyze** opens the statistics panel next to the chart. Nothing is calculated until you press **Compute statistics**. Close the panel to discard the results.

**Distribution charts**, per group:
- n, mean (SD) with a t-based 95% CI;
- median [IQR] with a distribution-free 95% CI (the achieved confidence is shown on hover);
- geometric mean with 95% CI (only when all values are positive), CV %;
- skewness and excess kurtosis (the SPSS/Excel definitions);
- the Shapiro–Wilk normality test.

When grouped by a categorical variable:
- **Two groups:** Welch's t-test (mean difference, 95% CI, t, df, p), Hedges' g with 95% CI, and the Mann–Whitney U test (exact for small samples without ties) with rank-biserial r and the Hodges–Lehmann shift.
- **Three or more groups:** Welch's ANOVA, classic one-way ANOVA (η²), Kruskal–Wallis (ε²) and the Brown–Forsythe test for equal variances, plus pairwise Welch t and Mann–Whitney tests with Holm-adjusted p-values.
- **Show mean ± 95% CI on chart** draws an error bar beside each box.

**Two-measure charts:**
- Pearson r (t test, Fisher z CI), Spearman ρ (t approximation, Bonett–Wright CI) and Kendall τ-b.
- Least-squares regression: intercept and slope with SE, 95% CI, t and p; R², adjusted R², residual SE and F.
- Shapiro–Wilk test on the residuals, and influential points (Cook's D > 4/n). **Highlight** marks those points in the table.
- Optional best-fit line, 95% confidence band and 95% prediction band on the chart. With log axes, Pearson r and the fit use log10 values, as displayed.

**Copying results:**
- **Table (TSV)** pastes into Excel or Word with full precision.
- **APA summary** is a results sentence.
- **Methods text** is a paragraph naming every method, the software version, the dataset version and checksum, the metadata revision and the QC policy.

All tests are two-sided at 95%. p-values are shown APA-style ("p = .032", "p < .001"). Results are exploratory: they are not adjusted for how many analyses you run, and with baseline-only data they cannot show causality or treatment effects.

The table, chart, summary and export all use the same selection engine, so their counts always agree.

## Measurements

The catalog shows each measure's display label, definition, unit, specimen, assay, score type, area and source.

- Each field shows **Unknown**, **Tentative** (for example, a suggestion read from the header) or **Confirmed**, plus its provenance. Every save is an append-only revision, visible in **History**.
- Leave fields unknown rather than guessing. The specimen is suggested only when the header states it explicitly.
- Raw, scaled, clinic and T-score variants remain separate variables.
- Mark **quasi-identifiers** (for example age, sex, race, dates, BMI) so that exports require explicit confirmation before including them.

## Data quality

- **Formatting & QC.** Cells are grouped by formatting colour and interpretation.
  - **Matches legend:** exact legend colour. **Needs review:** close to a legend QC colour but not identical. **Unresolved:** the colour is undocumented.
  - **Confirm** or **Reject** a group with a reason. Rejected formatting is kept but no longer treated as a QC flag.
- **Flag map.** Shows where flags fall, by participant and column.
- **Import checks.** The full validation report and the decoded legend.
- **Column groups.** Groups detected from header borders. Confirm or rename them.
- **Comments.** Workbook comments are shown exactly as recorded. They are treated as data, never as instructions.

## Saved views and the Compare board

**Save view** suggests a name from your selection (for example *IL6 vs PHQ-9 total score · PHQ-9 total score ≥ 5 · excl. sample QC · baseline*). Press Enter to accept it or type your own. The view records the dataset version, metadata version, cohort rule, visits, QC policy, chart settings (including axis bounds, style and requested statistics) and variables.

- **Open as saved** reproduces the view exactly, even after later curation; editing is paused while you view it this way.
- **Open with current metadata** applies the latest curation instead.
- A view never silently switches to a newer import.

**Compare** (the second tab in Saved views) holds whiteboards:
- **New board → Add view** puts saved views on the canvas.
- Drag a card by its header and resize it from the corner; cards snap to a grid.
- **Note** adds free text, **Tidy** arranges cards in rows, and zoom controls sit in the toolbar.
- **Style all** applies one style to every chart; the palette icon on a card overrides it for that card.
- Each chart is reproduced from its own pinned dataset and metadata versions, so a board can compare views saved at different times. A badge shows when later curation exists.
- Boards save automatically and export as one **SVG** or **PNG**.

## Export (research-context package)

1. Review the selection, which is always the one from Explore.
2. Choose the variables.
3. Choose participant keys: project pseudonyms by default, random per-export keys, or source IDs (which require a confirmation).
4. Confirm any quasi-identifiers you need, and decide whether to include comment text.
5. Enter the analysis question and the study context.
6. Preview each file exactly as it will be written, then **Create package…**.

The ZIP contains:

- `selected_data.csv`
- `data_dictionary.csv`
- `quality_flags.csv`
- `study_context.md` (which states "baseline observations only" when that applies)
- `analysis_request.md`
- `manifest.json`, with checksums, selection rules, versions and the software version

**Copy summary** gives you a short text to paste into a chat. To use Claude or another assistant, attach the ZIP yourself: the app sends nothing.

Pseudonymisation is **not** anonymisation. The full workbook, unselected columns, comment authors and local file paths are never exported.

## Backup and restore

- **Backup** (sidebar) writes a `*.bariproj.zip`: a consistent database copy, source snapshots, and a manifest with SHA-256 checksums.
- **Restore a backup** (start screen) verifies the checksums, the database integrity and the observation hashes before it opens the restored copy in a new folder.

## Checking an installation

Run the app with `--self-test <folder>`. It creates a temporary project from the bundled **synthetic** workbook, then imports, saves a view, reopens it, exports, backs up, restores and loads the interface. It writes `bari-self-test.json` to the folder you gave and exits with code 0 on success. Real projects are not touched.
