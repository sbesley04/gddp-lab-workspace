# Limitations and operational notes

## Scope

- **Exploration first.** Charts and descriptive summaries are always available. Inferential statistics (CIs, p-values, effect sizes, correlations, simple linear regression) run **only when the researcher presses Compute** for one chart at a time. They are labelled exploratory and validated against R.
- **Covariates and transforms** are display tools. Tagging a covariate and colouring a chart by it, or applying log2/log10/square root/Box-Cox/centre/z-score/rank to a chart's measures, changes how data is drawn and summarised in that chart only. It is recorded in the analysis log, never imputes, and leaves stored data and exports untouched. Colour-by supports categorical variables only; flags keep their shapes.
- **PCA** is exploratory and runs only when you press Compute, on variables you choose. Variables are standardised, only participants with a usable numeric value in every chosen variable are used (nothing is imputed), and results are checked against R `prcomp(scale. = TRUE)`. There is no PERMANOVA, rotation or automated variable selection.
- **Correlation matrix and heatmap** are descriptive: the matrix computes no p-values, so it cannot be used to screen for "significant" pairs.
- **Not included:** repeated-measures models, covariate adjustment, PERMANOVA, power analysis, automated biomarker screening, p-value ranking across many measures, causal analysis and clinical decision support.
- **Multiplicity:** p-values are not adjusted for the number of analyses you run; only pairwise comparisons within one analysis are Holm-adjusted. The analysis register (unreleased) counts every distinct analysis computed in the statistics panel, so the number can be reported, but nothing is adjusted for it. Analyses run through the MCP server or in R are not counted. Pre-specify primary analyses before reporting them.
- **Repeated visits (unreleased guard).** Each row is one participant at one visit. When a selection holds more than one row for any participant, the statistics panel computes no test, confidence interval or fit, and asks you to pick one visit. There are no paired tests or repeated-measures models yet, so change over time cannot be tested in the app. The many-measures views (correlation matrix, heatmap, PCA) compute no tests and are not blocked; they show a notice when visits are pooled.
- **Censored values** ("<0.5") are never replaced by a number, so every mean and SD leaves them out and is biased (upward for values below a detection limit). The statistics panel shows the percent censored and marks means above 15%. That threshold is provisional and has not been set with a statistician. There are no censoring-aware estimates.
- **Baseline-only data.** The reference workbook has one visit. The app is visit-aware, but it draws no trajectories and infers no dates or elapsed time.
- **No automatic record reconciliation** between dataset versions. Each import is its own immutable version. **Data quality → Version changes** (unreleased) lists what differs between two of them, matching rows by participant and visit and columns by header; it cannot tell that a column or participant was renamed.

## Collaboration

- **One writer at a time.** A `.lock` file prevents two app sessions from opening the same project. Simultaneous shared editing is future work, and would need a designed multi-user service, not a database file on a NAS.
- **Sharing** means a **Backup** package (the whole project) or an **Export** package (selected data). Do not keep active projects in iCloud, Dropbox, OneDrive, Google Drive or on network drives.
- **Author labels** are local text and do not identify people reliably.
- **The record check detects, it does not prevent.** The audit log, curation history and analysis register are hash-chained (unreleased), so a change made with another tool fails **Verify**. The chain has no secret key: someone who rewrites the whole chain consistently is caught only by the state recorded in a backup or export, and only reliably if that copy is kept outside the project folder. It does not cover imported cells, saved views or boards (cells are checked by the content hash in backups).

## Security and privacy

- **Backups** can be encrypted with a passphrase (unreleased); there is no recovery if it is lost. Unencrypted backups are plain ZIP files that hold source identifiers and the pseudonym secret.
- Project databases and source snapshots are **not encrypted**. They rely on operating-system file permissions and disk encryption (FileVault or BitLocker). Store projects only where study data is permitted.
- **Pseudonymous export keys are not anonymisation.** Quasi-identifiers (age, sex, race, BMI and similar) need explicit confirmation before export.
- **No regulatory, IRB or institutional approval** is claimed or implied.
- The app makes **no network requests**. Updates are manual: install the new version from the lab download page ([INSTALL.md](INSTALL.md)).
- [THREAT_MODEL.md](THREAT_MODEL.md) lists what the app defends against and what it leaves to the lab.
- The optional **MCP server** ([MCP.md](MCP.md)) is read-only and returns aggregate results only, with small-cell suppression. Its results reach whichever AI provider the assistant uses. Counts below the minimum cell size and all minimum and maximum values are withheld, but suppression is not anonymisation: a median can be one participant's value, small counts can sometimes be derived from totals, and overlapping filters could narrow down individuals. It has been tested on synthetic data only; whether a real project may be connected is for the lab's IRB and data use agreements to decide.

## Platforms

| Platform | Status |
| --- | --- |
| macOS (one universal DMG for Apple Silicon and Intel, from the next release) | CI mounts the DMG, copies the app out and passes `--self-test` natively on Apple Silicon and under Rosetta 2. Not yet run on Intel hardware. 0.3.1 has separate arm64 and x64 DMGs, tested the same way by hand. |
| Windows x64 | CI installs the setup file silently, passes `--self-test` on the installed app and uninstalls it. The install wizard has not been clicked through by hand on Windows 10/11. |
| Signing | All builds are **unsigned**. macOS asks you to allow the app once in System Settings → Privacy & Security (**Open Anyway**); Windows shows SmartScreen (**More info → Run anyway**). Steps: [INSTALL.md](INSTALL.md). Signing: [SIGNING.md](SIGNING.md). |

## Known gaps

- Charts are limited to one or two measures plus the many-measures views (correlation matrix, heatmap, PCA). There are no visit-trajectory charts, violin plots, shape-by or facet-by.
- Formatting interpretation is tuned to this lab's legend conventions (source font colours, QC fills, border groups). A workbook with a different legend style will import correctly, but its formatting will mostly show as "unresolved" until a curator reviews it.
- Legacy `.xls` files are not supported; save them as `.xlsx` first.
- **Accessibility** is checked automatically for control names, keyboard reach and visible focus (unreleased). Colour contrast, reading order and use with a real screen reader have not been checked, and chart points cannot be reached from the keyboard.
- **Size.** The largest dataset tested is a synthetic one of 2,000 participants, 4,800 rows and 300 columns. Calculations stay under a second there (a correlation matrix of 60 variables takes about 0.8 s), but importing takes about 7 seconds and loading the dataset about 3, and it is loaded again after each curation edit. Drawing at that size is not tested. All computation runs in the window's own thread, so a slow step freezes the interface until it finishes. A bug while drawing a page now shows a message instead of a blank window (unreleased), but the page's unsaved chart settings may be lost.
