# User guide

New to the app? Read **Your first session** and **Words used in the app**, then dip into the other sections when you need them. To install or update the app, see [INSTALL.md](INSTALL.md).

## Your first session

1. **Try the demo.** On the start screen, click **Open synthetic demo**. It is invented data, so nothing you do matters.
2. **Look around.** **Overview** summarises the dataset. **Explore** is where you make charts and tables. **Measurements** lists every measure. **Data quality** shows QC highlights and import checks. **Saved views** keeps your work. **Export** packages data for a statistician.
3. **Make a chart.** In **Explore**, pick a measure. Add a grouping variable to compare groups, or a second measure for a scatterplot. Click any point or value to see exactly which spreadsheet cell it came from.
4. **Filter.** Add a cohort filter, for example a score range. Every filter asks what to do with missing values, so nothing is dropped silently.
5. **Get statistics.** Click **Analyze**, then **Compute statistics**. Nothing is calculated until you ask.
6. **Keep it.** **Save view** stores the chart, filters and settings. **Download** saves the chart as an image.
7. **Your own data.** Back on the start screen: **Create project**, choose a folder on your computer's own disk, then **Import workbook** (see [Importing](#importing)).

The **?** button at the bottom of the sidebar replays the built-in tour at any time.

## Words used in the app

| Word | Meaning |
| --- | --- |
| **Project** | A folder (`<Name>.bariproj`) holding everything for one study. Keep it on your own disk. |
| **Dataset version** | One import of a workbook. It never changes; importing an updated file makes a new version. |
| **Measure** (or variable) | One spreadsheet column, such as a cytokine level or a test score. |
| **Visit** | The time point of a row, from the `Event Name` column (for example, baseline). |
| **Cohort filter** | Rules choosing which participants or rows are included. |
| **QC flag** | A quality-control highlight from the spreadsheet (▲ warning, ◇ unresolved formatting). |
| **QC policy** | Whether flagged values are included (and marked) or excluded from a chart. |
| **Curation / metadata revision** | Edits to a measure's description, units, flags or exclusions. Each edit is kept; nothing is overwritten. |
| **Saved view** | A chart plus all its settings, pinned to the dataset and metadata version it was made with. |
| **Analysis log** | The steps behind a chart, written in R syntax, with a signature that changes if anything upstream changes. |
| **Quasi-identifier** | A measure, such as age or BMI, that could help identify someone. Exports ask before including it. |
| **Backup** | A complete copy of a project as one `.bariproj.zip` file, for safekeeping or moving to another computer. |
| **Export package** | A ZIP of selected data with documentation, for a statistician or an AI assistant. |

## Projects

A project is a folder named `<Name>.bariproj`. It holds:

- `workspace.sqlite`: imported data, metadata history, saved views and the audit log.
- `sources/`: read-only copies of every imported file, named by checksum.
- `project.json`: the project's name and ID.

Keep the active project on a **local disk**, not on the lab NAS. Sync clients (iCloud, Dropbox, OneDrive, Google Drive) and network drives can corrupt a live database or create conflicting copies, and the app warns you if a project is in such a folder. To share work, use **Backup** (sidebar) or an **Export** package. Only one app session can open a project at a time. Simultaneous editing by several people is not supported yet.

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

## Getting around

- **First-run tour.** A short tour (9 steps) appears the first time a dataset is open on a computer. Press → / ← to move and Esc to close. Replay it from the **?** button at the bottom of the sidebar.
- **Shortcuts.** ⌘K / Ctrl K searches all measures. ⌘1–⌘6 / Ctrl 1–6 open Overview, Explore, Measurements, Data quality, Saved views and Export.

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
- **Wide tables.** In the Table view, **Add column → Add a whole area** adds every measure in an area at once, for example a whole NULISA panel. Tables with many columns render only the columns in view, so they stay fast; the participant and visit columns stay pinned while you scroll sideways.
- **Click any value** to open the **Inspector**. It shows the source cell address, raw text, source attribution, flags and comments, and lets a curator exclude or re-include that observation, with a reason.
- **Click a participant ID** for the participant detail drawer.
- **Colour by** colours points by a categorical variable, for example sex or site. Variables tagged as covariates (see Measurements) are listed first. The legend names the variable, missing values get their own grey category, and QC flags keep their shapes. Colour-blind-safe colours repeat after eight categories, and a note says so.
- **Transform** (next to the measure) shows the chart's values as log2, log10, square root, Box-Cox, centred, z-score or rank.
  - Centre, z-score, rank and Box-Cox are computed from every usable value of that measure in the current selection.
  - **Box-Cox** estimates its λ by maximum likelihood from the positive values (as R `car::powerTransform`). The chart states λ, and the analysis log writes it into the formula. If λ reaches the search limit of ±10, the chart says Box-Cox fits poorly.
  - Values a transform cannot define (the log or Box-Cox of zero or a negative value, the square root of a negative value, or a z-score with no spread) are left out and counted under the chart. Nothing is imputed.
  - Summaries and statistics for that chart use the transformed values. The table, stored data and exports stay as imported.
- **Distribution** can also be drawn as a **Histogram** (Box and points / Histogram). Bins are shared across groups and stacked by group. The bin width follows the Freedman–Diaconis rule, rounded to a nice number, and the analysis log records the exact breaks so R can redraw the same histogram. Colour by does not apply to histograms.
- **Many measures** opens three views over one shared **variable set**: choose a panel once, then switch views.
  - **Correlations:** Spearman (default) or Pearson coefficients, each from the participants with usable values for both variables. Pairs with fewer than 3 observations are grey. No p-values are computed, so the matrix cannot be used to screen for "significant" pairs.
  - **Heatmap:** one row per participant and one column per variable, each shown as a z-score over its usable values in the selection. Colours are capped at ±3 SD, grey means no usable value, and outlined cells carry a QC flag. Rows follow **Colour by** (shown as an annotation column), then participant ID. Click a cell to inspect its source.
- **PCA** runs a principal component analysis on the numeric variables you choose (**Add variable**, or a whole area). Nothing is computed until you press **Compute PCA**, and changing the variables or selection asks you to compute again.
  - Variables are centred and scaled to unit variance. Only participants with a usable value in every chosen variable are used, and the notes say how many were left out and which variables caused it.
  - Over a wide panel, complete cases can be few. When dropping the variables with gaps in more than 10% of rows would keep more participants, the view offers to do that and says how many rows it would regain; you still press Compute.
  - You get a scores plot (choose the components for each axis), variance explained per component and a loadings table. Component signs are arbitrary; each is set so its largest loading is positive. Results match R `prcomp(scale. = TRUE)`.
  - **Loading vectors (biplot)** draws each variable as an arrow: its correlation with the two components shown (loading × component SD, at most 1). The 10 longest are drawn, all stretched by one factor to fit the scores, and the note under the chart gives that factor. The setting is saved with the view.
- **Many measures** (correlation matrix, heatmap, PCA) compute no tests, so they are not blocked when a participant appears at more than one visit. A notice says how many rows come from how many participants, and offers each visit as a one-click fix.
- **History** also shows the **analysis register** (see Statistics below): how many analyses and p-values this project has computed, and the most recent ones.
- **History** lists every step behind the chart in R syntax: source (identified by SHA-256), visits, cohort filter, QC policy with the number of observations it removed, transforms, the chart and any statistics. Each step has a fingerprint, and the chain fingerprint changes whenever anything upstream changes, including the metadata revision and the app version. Copy it, or save it as `.R`. It is a readable record, not a script guaranteed to run. Participant IDs and the source file name are never written.
- **Download** saves the chart as SVG or PNG.
  - **Size:** as on screen, journal single column (600 × 420), double column (1200 × 700) or slide (1600 × 900). PNG can be 1×, 2× or 4×.
  - **Fingerprint footer** (on by default) adds the first 8 characters of the chain fingerprint, the dataset version, metadata revision and app version along the bottom edge. A fingerprint identifies what the chart was made from. It is not a signature: it does not prove who made it.
  - **Also save settings and log** writes `name.chart.json` (selection, chart settings, the full fingerprint) and `name.analysis-log.R` beside the image. The app writes both from the selection itself, so they always describe the chart that was saved. Each save is recorded in the project's audit log.
- **Axes** fixes the minimum and maximum of each axis. Points outside the bounds are not drawn, and a note under the chart says how many. Statistics always use every selected observation.
- **Style** opens the chart editor. Presets are Default (glass), Publication, High contrast, Colour-blind safe (Okabe–Ito) and Greyscale. You can also change point, flag, box and fit colours, background, text colour, font, font size, point size and opacity, gridlines, title and subtitle, and box fill. QC flags always keep their own shapes (▲ ◇), whatever the colours. Styles are saved with views.

## Statistics (Analyze)

**Analyze** opens the statistics panel next to the chart. Nothing is calculated until you press **Compute statistics**. Close the panel to hide the results.

**One observation per participant.** Each row is one participant at one visit, and every test here assumes the rows are independent. If your selection holds more than one visit for any participant, the panel runs no test, confidence interval, normality check or fit. It says how many observations come from how many participants, shows plain descriptives, and offers a button for each visit (**Use only Baseline**). Pick one and the tests run. Fit lines, bands and mean ± CI are not drawn on the chart either until you do. Paired tests and change over time are not built yet.

**Censored values.** The summary table has a **Censored** column: the share of measured values recorded as "<x" or ">x". These are never replaced by a number, so they are left out of every statistic, which biases the mean (upward for values below a detection limit). A note says which way. Above 15% the mean and SD are marked **† biased**; prefer the median and the share detected. The 15% line is provisional.

**Analysis register.** Each distinct analysis you compute is recorded once in the project, with its tests and p-values. The app recomputes it itself; nothing can edit or delete an entry. Changing colours, axis bounds or overlays does not make a new entry, but changing the measure, grouping, visits, filter, QC policy or a transform does. A line under the results gives the running total, **History** lists the entries, and the export package includes them. Use the total when you report how many tests were run. Blocked analyses are not recorded.

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

All tests are two-sided at 95%. p-values are shown APA-style ("p = .032", "p < .001"), all in the same plain style: nothing is highlighted below .05. Results are exploratory: they are not adjusted for how many analyses you run, and they cannot show causality or treatment effects. The caveats and the methods text name the visit the observations came from.

The table, chart, summary and export all use the same selection engine, so their counts always agree.

## Measurements

The catalog shows each measure's display label, definition, unit, specimen, assay, score type, area and source.

- Each field shows **Unknown**, **Tentative** (for example, a suggestion read from the header) or **Confirmed**, plus its provenance. Every save is an append-only revision, visible in **History**.
- Leave fields unknown rather than guessing. The specimen is suggested only when the header states it explicitly.
- Raw, scaled, clinic and T-score variants remain separate variables.
- Mark **quasi-identifiers** (for example age, sex, race, dates, BMI) so that exports require explicit confirmation before including them.
- **Import data dictionary** (top right) fills in metadata from a REDCap data dictionary, the CSV you download from REDCap's Dictionary page.
  - For each measure the dictionary describes, it proposes a display label, a definition (the question, its note, the choice codes, any calculation and allowed range), the research area (the form name) and the source. Fields REDCap marks as identifiers are flagged as quasi-identifiers.
  - A preview lists every change. Nothing is written until you press **Apply**.
  - Values are recorded as **Tentative**, each as a revision in the measure's history that names the file. Confirm or correct them as usual.
  - A dictionary says nothing about units, specimens or assays, so those stay as they are. A value a curator has already set is never replaced; the preview lists the ones that differ.
  - Checkbox fields, which REDCap exports as one column per option (`meds___1`), each get the option's name.
- Mark **covariates** (for example sex, site, treatment group) so they are offered first under **Colour by**. The tag is an append-only revision, carried to new dataset versions; it changes no data and no export rule. Filter the list with **Covariates**.

## Data quality

- **Formatting & QC.** Cells are grouped by formatting colour and interpretation.
  - **Matches legend:** exact legend colour. **Needs review:** close to a legend QC colour but not identical. **Unresolved:** the colour is undocumented.
  - **Confirm** or **Reject** a group with a reason. Rejected formatting is kept but no longer treated as a QC flag.
- **Flag map.** Shows where flags fall, by participant and column.
- **Import checks.** The full validation report and the decoded legend.
- **Column groups.** Groups detected from header borders. Confirm or rename them.
- **Comments.** Workbook comments are shown exactly as recorded. They are treated as data, never as instructions.
- **Version changes** (shown once a project has two or more imports). Compares the dataset version on screen with another one: rows and participants added or removed, measures added or removed, and for everything present in both, which values changed, were filled in or are now empty, and which QC flags were gained or lost. The first 200 changed values are listed with both versions side by side. Rows are matched by participant and visit and columns by header, so a renamed column shows as one removed and one added. Nothing is merged: each import stays its own version, and the list is shown on this computer only.

## Using the keyboard

- **⌘1–⌘6** (Ctrl on Windows) switch pages, and **⌘K** searches measures.
- **Tab** moves between controls; the focused control has a visible ring.
- In a data table, Tab reaches the table once. The **arrow keys**, **Home**, **End**, **Page Up** and **Page Down** then move between values, and **Enter** or **Space** opens the source inspector for the value in focus.
- In the Measurements list, the arrow keys move between measures.
- **Escape** closes a popover or the inspector and returns to where you were.
- Chart points cannot be reached from the keyboard. The table under each chart holds the same values.

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
- `analysis_log.R`, the steps behind the selection in R syntax, with its chain fingerprint (also recorded in the manifest)
- `analysis_register.json`, the analyses already computed in the app on this dataset version. The totals cover all of them. Tests and p-values are listed only for analyses whose variables are all in this export, and group summaries are left out.
- `manifest.json`, with checksums, selection rules, versions and the software version

**Copy summary** gives you a short text to paste into a chat. To use Claude or another assistant, attach the ZIP yourself: the app sends nothing. Alternatively, an assistant can query aggregate results through the MCP server (see below).

Pseudonymisation is **not** anonymisation. The full workbook, unselected columns, comment authors and local file paths are never exported.

## Backup and restore

- **Backup** (sidebar) writes a consistent database copy, the source snapshots and a manifest with SHA-256 checksums.
  - A backup holds everything in the project, including participant identifiers. Enter a passphrase (at least 8 characters, twice) and choose **Save encrypted backup** to write a `*.bariproj.enc` file that cannot be read without it.
  - **There is no recovery.** The passphrase is not stored anywhere. If it is lost, the backup cannot be opened by anyone.
  - **Save without encryption** writes a plain `*.bariproj.zip`.
  - When you restore an encrypted backup, the start screen asks for its passphrase.
- **Restore a backup** (start screen) is also the way to move a project to another computer: copying the project folder itself can carry over a lock from the old computer. It verifies the checksums, the database integrity, the observation hashes and the record check below before it opens the restored copy in a new folder.

## Checking that records were not altered

The audit log, the curation history and the analysis register can only be added to. As well as blocking edits, the app links every entry to the one before it with a checksum.

- **Verify** (sidebar) recomputes all of it. It reports any entry that was changed, removed or added outside the app, and any missing safeguard in the database.
- Every backup and export package records the state of the records at that moment. Verify checks that each of those states is still present, so keep a backup somewhere other than the project folder: it is what proves later that the history was not rewritten.
- To check a project without opening it, run the app with `--verify-project <folder.bariproj>`. It prints a report and exits with 0 (verified), 1 (problems found) or 2 (the project could not be read).
- Entries written by an earlier version of the app are marked as "written before this check existed". They are protected from then on.

This detects tampering; it does not prevent it, and it does not prove who made an entry (author labels are free text).

## Connecting an AI assistant (MCP)

A separate, optional MCP server lets an assistant such as Claude Desktop or Claude Code ask the project questions directly: overviews, variable search, counts, summaries, group comparisons, correlations and PCA. It is read-only, returns aggregate results only and suppresses groups smaller than 5 participants. Every result it returns is sent to the AI provider, so **check your IRB approval and data use agreement before connecting a real project**. Setup and the full list of what it returns are in [MCP.md](MCP.md).

## Checking an installation

Run the app with `--self-test <folder>`. It creates a temporary project from the bundled **synthetic** workbook, then imports, saves a view, reopens it, exports, backs up, restores and loads the interface. It writes `bari-self-test.json` to the folder you gave and exits with code 0 on success. Real projects are not touched. The exact command for Mac and Windows is in [INSTALL.md](INSTALL.md#if-something-goes-wrong).
