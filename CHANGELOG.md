# Changelog

What changed in each version, newest first. [docs/STATUS.md](docs/STATUS.md) records how each change was verified.

## Unreleased

Not in any installer yet. Build from source to use it.

### Changes that affect existing projects and files

- Two database upgrades happen the first time a project is opened (analysis register, record chain). The app keeps a copy of the database as it was, named `workspace.sqlite.before-schema-<n>.bak`, in the project folder.
- After that upgrade, the MCP server refuses a project until the app has opened it once.
- Every analysis-log fingerprint (formerly "signature") changes. Charts saved earlier keep the old 8-character value in their footer.
- The research-context package has two more files, `analysis_log.R` and `analysis_register.json`. In `manifest.json`, `analysisLog.signature` is now `analysisLog.fingerprint`.
- The chart settings sidecar is now `bari-chart/2` and uses `fingerprint` where it had `signature`.
- MCP results return counts below the minimum cell size as `"<5"` and withhold `min` and `max` unless the server is started with `--show-extremes`.
- **Backup** opens a short form (passphrase or no encryption) instead of saving at once.

### Added

- Statistical guardrails: no test, confidence interval or fit when a participant contributes more than one visit, with a one-click fix; percent censored beside every summary; p-values shown without emphasis; visit and participant wording taken from the rows analysed.
- Analysis register: every distinct analysis computed, with its p-values, recorded by the main process and never edited. Shown in History and exported.
- Record check: the audit log, curation history and analysis register are hash-chained. **Verify** in the sidebar and `--verify-project <folder>` report any entry changed, removed or added outside the app.
- Encrypted backups with a passphrase.
- Analysis log in R syntax with fingerprints; chart downloads (SVG, PNG, size presets, footer, settings and log files written by the main process).
- Covariate tags and colour-by; display transforms (log2, log10, square root, Box-Cox, centre, z-score, rank).
- Histograms, correlation matrix, participant × measure heatmap, exploratory PCA with a gap suggestion and biplot.
- Read-only MCP server for AI assistants (aggregate results, small-count suppression, access log).
- **Measurements → Import data dictionary**: labels, definitions, forms and identifier flags from a REDCap data dictionary, recorded as tentative.
- **Data quality → Version changes**: what differs between two imports of the workbook.
- Keyboard access to table values (arrow keys, Enter to inspect), and buttons in rows that were only clickable.
- MCP option `--withhold-free-text`.
- A message instead of a blank window when a page fails to draw.
- Audit entries for quasi-identifier flags, segment names and study context.
- R reference check (`npm run reference:check`) and its CI workflow; end-to-end UI tests in CI.
- [Threat model](docs/THREAT_MODEL.md), [validation summary](docs/VALIDATION.md) and [improvement strategy](docs/STRATEGY.md).

### Changed

- Reloading after a curation edit no longer re-reads or re-sends the imported data. On a large dataset this takes milliseconds instead of seconds.

### Fixed

- Numbered visits sort numerically on import (Month 2 before Month 6).
- When the header row was not row 1 (for example, below a title), cell font colours were compared with row 1 instead of the headers. This could mark cells as "differs from the column attribution" wrongly, or miss cells that do differ. Imports are never changed, so import such a workbook again to correct its flags.
- Chart SVG and PNG exports were malformed XML with the system and serif fonts.
- The direct Box-Cox formula lost precision at large |λ|.
- In a small window, a popover that opened upwards could put its first buttons above the top of the window, out of reach.

## 0.3.1 (2026-10-26)

- Fixed: folders that contain read-only source snapshots could not be deleted on Windows.

## 0.3.0 (2026-10-25)

- Reworked interface: readable callouts and toasts, single-form metadata editing, compact Overview, tabbed side panel in Explore, static background.
- First-run tour.
- Wide tables virtualised in both directions.

## 0.2.0 (2026-10-23)

- On-demand statistics with p-values, confidence intervals and effect sizes; copyable tables, APA summaries and methods text.
- Chart style editor and presets; forced axis bounds; suggested view names.
- Compare boards.

## 0.1.0 (2026-10-22)

- First release: projects, XLSX and CSV import with preserved formatting and comments, measurement catalogue, cohort filters and QC policy, distribution and scatter charts, saved views, research-context export, backup and restore.
