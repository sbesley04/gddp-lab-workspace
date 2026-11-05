# BARI-CNS Research Workspace

An offline desktop app (macOS and Windows) for exploring BARI-CNS study spreadsheets without SQL or data-wrangling code. It imports a workbook while keeping its source attribution, QC highlights and comments. You can then build reproducible selections and charts, record every step in an R-syntax analysis log, and export a documented research-context package for statisticians or AI assistants. An optional read-only MCP server lets an AI assistant query aggregate results directly.

It is a research tool for **exploration**. Statistical tests and multivariate methods run only when you ask for them, are labelled exploratory, and are validated against R. The app makes no causal or efficacy claims and gives no clinical recommendations.

## Versions

- **Installers: 0.3.1** (2026-10-26). 0.3.0 plus a Windows fix for deleting folders that contain read-only source snapshots.
- **Source (`main`), unreleased:** analysis log with signatures, chart downloads with sidecars, covariates and colour-by, display transforms, histograms, correlation matrix, heatmap and PCA. These are not in the 0.3.1 installers; build from source to use them.
- **`mcp-server` branch, unreleased:** the read-only MCP server described in [docs/MCP.md](docs/MCP.md).

## What works

| Area | Status |
| --- | --- |
| Projects in local folders (SQLite, single-writer lock, sync-folder warning) | Working |
| XLSX/CSV import: preview, guided ID/visit mapping, validation, one-transaction commit, read-only checksummed snapshot, immutable versions, mapping reuse | Working |
| Numbered visits sorted numerically on import (Month 2 before Month 6) | Working (unreleased) |
| Source/QC preservation: theme colours and tints, rich-text headers turned into aliases, threaded comments, legend decoding with exact / needs-review / unresolved statuses, curator decisions | Working |
| Measurement catalog with append-only metadata revisions, quasi-identifier flags and covariate tags | Working |
| AND/OR cohort filters with explicit missing handling; QC inclusion policy with impact counts | Working |
| Distribution (box + all points; histogram unreleased) and two-measure scatter; linked table; forced axis bounds; chart style editor with presets | Working |
| Colour-by a categorical variable; display transforms (log2, log10, centre, z-score, rank) that never change stored data or exports | Working (unreleased) |
| On-demand statistics: CIs, normality, Welch t / Mann–Whitney / ANOVA / Kruskal–Wallis with effect sizes and Holm-adjusted pairwise tests, Pearson / Spearman / Kendall, linear fit with confidence and prediction bands; copyable tables, APA summaries and methods text | Working, validated against R 4.3 |
| Many measures: correlation matrix (no p-values), participant × measure heatmap, and exploratory PCA with a gap suggestion for wide panels | Working (unreleased), validated against R |
| Analysis log in R syntax with per-step and chain signatures (History panel, `analysis_log.R` in exports) | Working (unreleased) |
| Chart download: SVG/PNG, journal and slide size presets, signature footer, `.chart.json` and `.analysis-log.R` sidecars | Working (unreleased) |
| Saved views pinned to dataset and metadata versions and reproduced after restart; Compare whiteboard of views and notes, exportable as SVG/PNG | Working |
| First-run tour, ⌘K search and ⌘1–⌘6 shortcuts; wide tables virtualised in both directions | Working |
| Research-context ZIP (pseudonymous keys, checksums, preview); `analysis_log.R` is the seventh file in unreleased builds | Working |
| Backup and verified restore | Working |
| MCP server for AI assistants (read-only, aggregate results, small-cell suppression, access log) | Working (unreleased), tested on synthetic data only |
| macOS installers (arm64 and x64 DMG/ZIP, unsigned) | Built and smoke-tested with `--self-test` (x64 under Rosetta) |
| Windows installer (NSIS x64, unsigned) | Unit tests and the packaged `--self-test` pass on Windows in CI; the install wizard has not been run by hand |

Rows marked *unreleased* are in the source but not in the 0.3.1 installers. [docs/STATUS.md](docs/STATUS.md) lists how each feature was verified.

## For researchers

1. Install from a release your lab provides (or `release/` after building). The app is unsigned, so on macOS right-click it and choose **Open** the first time. On Windows, choose **More info → Run anyway** in SmartScreen.
2. **Create project** and choose a folder on a local disk (not iCloud, Dropbox, OneDrive or a network drive).
3. **Import workbook**, confirm `Subject_ID` and `Event Name`, review the checks, then commit.
4. Use **Explore**, **Measurements**, **Data quality**, **Saved views** and **Export**.

**Open synthetic demo** loads invented data you can use to learn the app safely. Full guide: [docs/USER_GUIDE.md](docs/USER_GUIDE.md).

## For developers

```bash
npm install
```

```bash
npm run dev
```

| Command | Purpose |
| --- | --- |
| `npm run typecheck` | TypeScript |
| `npm test` | Vitest unit and integration tests (141, synthetic data only) |
| `npm run e2e` | Builds, then runs the Playwright UI tests |
| `npm run test:reference` | Opt-in checks against a local real workbook (counts only) |
| `npm run build:mcp` | Builds the MCP server to `out/mcp/server.js` |
| `npm run dist:mac` / `npm run dist:win` | Unsigned installers in `release/` |

Statistics and multivariate results are checked against R with `tools/stats_reference.R` and `tools/multivariate_reference.R`. See [docs/DEVELOPING.md](docs/DEVELOPING.md) for architecture, the security model, the reference-workbook check, packaging and signing.

## Documentation

| Document | Contents |
| --- | --- |
| [USER_GUIDE.md](docs/USER_GUIDE.md) | Every screen and workflow |
| [MCP.md](docs/MCP.md) | Connecting an AI assistant, what it can and cannot see |
| [LIMITATIONS.md](docs/LIMITATIONS.md) | Scope, privacy, platforms and known gaps |
| [STATUS.md](docs/STATUS.md) | Release history and how each feature was verified |
| [DEVELOPING.md](docs/DEVELOPING.md) | Architecture, commands, security model, testing |
| [ROADMAP.md](docs/ROADMAP.md) | Planned work |
| [WORKBOOK_SEMANTICS.md](docs/WORKBOOK_SEMANTICS.md) | How to document a study workbook (details stay local) |
| [SIGNING.md](docs/SIGNING.md) | Code signing and notarisation |

## Data protection

- No network access, telemetry, accounts or API keys. The app blocks every outgoing request, and tests assert that none were attempted.
- The optional MCP server makes no network requests either, but the AI assistant you connect it to sends its results to the AI provider. Read [docs/MCP.md](docs/MCP.md) and check your IRB approval and data use agreement before connecting a real project.
- Real study data must never go into source control, logs, issues or installers. `.gitignore` excludes spreadsheets except the synthetic fixtures in `tests/fixtures/`, and study-specific notes stay in the git-ignored `docs/private/`.
- Project databases are protected only by operating-system file permissions. They are **not encrypted**, and the app makes no regulatory-compliance claims. See [docs/LIMITATIONS.md](docs/LIMITATIONS.md).
