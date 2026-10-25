# BARI-CNS Research Workspace

An offline desktop app (macOS and Windows) for exploring BARI-CNS study spreadsheets without SQL or data-wrangling code. It imports a workbook while keeping its source attribution, QC highlights and comments. You can then build reproducible selections and descriptive charts, and export a documented research-context package for statisticians or AI assistants.

It is a research tool for **exploration**. Statistical tests run only when you ask for them, are labelled exploratory, and are validated against R. The app makes no causal or efficacy claims and gives no clinical recommendations.

## What works in this release (0.3.0)

| Area | Status |
| --- | --- |
| Projects in local folders (SQLite, single-writer lock, sync-folder warning) | Working |
| XLSX/CSV import: preview, guided ID/visit mapping, validation, one-transaction commit, read-only checksummed snapshot, immutable versions, mapping reuse | Working |
| Source/QC preservation: theme colours and tints, rich-text headers turned into aliases, threaded comments, legend decoding with exact / needs-review / unresolved statuses, curator decisions | Working |
| Measurement catalog with append-only metadata revisions and quasi-identifier flags | Working |
| AND/OR cohort filters with explicit missing handling; QC inclusion policy with impact counts | Working |
| Distribution (box + all points, optional grouping) and two-measure scatter; linked table; SVG/PNG export | Working |
| Forced axis bounds; chart style editor with presets (publication, high contrast, colour-blind safe, greyscale) | Working (0.2) |
| On-demand statistics: CIs, normality, Welch t / Mann–Whitney / ANOVA / Kruskal–Wallis with effect sizes and Holm-adjusted pairwise tests, Pearson / Spearman / Kendall, linear fit with confidence and prediction bands; copyable tables, APA summaries and methods text | Working (0.2), validated against R 4.3 |
| Suggested names for saved views; Compare whiteboard of saved views and notes, exportable as SVG/PNG | Working (0.2) |
| First-run tour (replayable), ⌘K search and ⌘1–⌘6 shortcuts; virtualised wide tables with whole-area column adding | Working (0.3) |
| Saved views pinned to dataset and metadata versions; reproduced after restart | Working |
| Research-context ZIP (six files, pseudonymous keys, checksums, preview) | Working |
| Backup and verified restore | Working |
| macOS installers (arm64 and x64 DMG/ZIP, unsigned) | Built and smoke-tested on this Mac |
| Windows installer (NSIS x64, unsigned) | Built by cross-compiling; **not run on Windows** |

See [docs/STATUS.md](docs/STATUS.md) for each acceptance criterion and how it was verified.

## For researchers

1. Install from `release/` (or from a release your lab provides). The app is unsigned, so on macOS right-click it and choose **Open** the first time. On Windows, choose **More info → Run anyway** in SmartScreen.
2. **Create project** and choose a folder on a local disk (not iCloud, Dropbox, OneDrive or a network drive).
3. **Import workbook**, confirm `Subject_ID` and `Event Name`, review the checks, then commit.
4. Use **Explore**, **Measurements**, **Data quality**, **Saved views** and **Export**.

There is also **Open synthetic demo**, which loads invented data you can use to learn the app safely. Full guide: [docs/USER_GUIDE.md](docs/USER_GUIDE.md).

## For developers

```bash
npm install
```

```bash
npm run dev
```

The main checks are `npm run typecheck`, `npm test` and `npm run e2e`, and `npm run dist:mac` / `npm run dist:win` build the installers. See [docs/DEVELOPING.md](docs/DEVELOPING.md) for architecture, the reference-workbook check, packaging and signing.

## Data protection

- No network access, telemetry, accounts or API keys. The app blocks every outgoing request, and tests assert that none were attempted.
- Real study data must never go into source control, logs, issues or installers. `.gitignore` excludes spreadsheets except the synthetic fixtures in `tests/fixtures/`.
- Project databases are protected only by operating-system file permissions. They are **not encrypted**, and this release makes no regulatory-compliance claims. See [docs/LIMITATIONS.md](docs/LIMITATIONS.md).
