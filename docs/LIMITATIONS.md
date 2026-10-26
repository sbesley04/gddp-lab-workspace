# Limitations and operational notes

## Scope

- **Exploration first.** Charts and descriptive summaries are always available. Inferential statistics (CIs, p-values, effect sizes, correlations, simple linear regression) run **only when the researcher presses Compute** for one chart at a time. They are labelled exploratory and validated against R.
- **Not included:** multivariable or repeated-measures models, covariate adjustment, power analysis, automated biomarker screening, p-value ranking across many measures, causal analysis and clinical decision support.
- **Multiplicity:** p-values are not adjusted for the number of analyses you run in a session; only pairwise comparisons within one analysis are Holm-adjusted. Pre-specify primary analyses before reporting them.
- **Baseline-only data.** The reference workbook has one visit. The app is visit-aware, but it draws no trajectories and infers no dates or elapsed time.
- **No automatic record reconciliation** between dataset versions. Each import is its own immutable version.

## Collaboration

- **One writer at a time.** A `.lock` file prevents two app sessions from opening the same project. Simultaneous shared editing is future work, and would need a designed multi-user service, not a database file on a NAS.
- **Sharing** means a **Backup** package (the whole project) or an **Export** package (selected data). Do not keep active projects in iCloud, Dropbox, OneDrive, Google Drive or on network drives.
- **Author labels** are local text and do not identify people reliably.

## Security and privacy

- Project databases and source snapshots are **not encrypted**. They rely on operating-system file permissions and disk encryption (FileVault or BitLocker). Store projects only where study data is permitted.
- **Pseudonymous export keys are not anonymisation.** Quasi-identifiers (age, sex, race, BMI and similar) need explicit confirmation before export.
- **No regulatory, IRB or institutional approval** is claimed or implied.
- The app makes **no network requests**. Updates are manual.

## Platforms

| Platform | Status |
| --- | --- |
| macOS arm64 | DMG installed (copied from the mounted image) and `--self-test` passed, including UI load |
| macOS x64 | DMG installed and `--self-test` passed under Rosetta 2 on Apple Silicon. Not tested on Intel hardware. |
| Windows x64 | CI (GitHub Actions, Windows Server) builds the app, passes all unit tests and the packaged `--self-test` (including UI load). The NSIS install wizard itself has not been run by hand on Windows 10/11. |
| Signing | All builds are **unsigned**. macOS shows a Gatekeeper warning (right-click → Open); Windows shows SmartScreen. See [SIGNING.md](SIGNING.md). |

## Known gaps

- Columns are not virtualised: showing hundreds of columns at once in the table works, but slowly. Rows are virtualised.
- Formatting interpretation is tuned to this lab's legend conventions (source font colours, QC fills, border groups). A workbook with a different legend style will import correctly, but its formatting will mostly show as "unresolved" until a curator reviews it.
- Legacy `.xls` files are not supported; save them as `.xlsx` first.
