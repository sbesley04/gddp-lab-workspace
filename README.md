# BARI-CNS Research Workspace

A desktop app (Mac and Windows) for exploring BARI-CNS study spreadsheets **without writing code**. You open a workbook, pick participants and measures, draw charts, run statistics when you ask for them, and save or export exactly what you did.

- **Works offline.** The app never connects to the internet and sends no data anywhere.
- **Keeps the spreadsheet's context.** Source colours, QC highlights and comments come along with the numbers.
- **Reproducible.** Every chart has a record of the steps behind it (in R syntax) that a statistician can check.
- **For exploration.** Statistics are labelled exploratory and are checked against R. The app makes no causal or clinical claims.

## Get the app

Download it from the **lab download page** on the lab server. Ask the lab's data manager for the address if you do not have it.

| Your computer | File to download |
| --- | --- |
| Any Mac (Apple Silicon or Intel), macOS 13 or newer | `BARI-CNS-Research-Workspace-<version>-mac.dmg` |
| Windows 10 or 11 (64-bit) | `BARI-CNS-Research-Workspace-<version>-windows-setup.exe` |

The app is not signed with a paid certificate, so your computer warns you the first time you open it. That is expected. **[docs/INSTALL.md](docs/INSTALL.md)** shows what to click, and what to do if a download or install goes wrong.

## Start in five minutes

1. Open the app and click **Open synthetic demo**. It loads invented data, so you can try everything safely.
2. Go to **Explore**, choose a measure, and look at the chart and the table under it.
3. Add a filter, colour the points by a group, then press **Analyze → Compute statistics**.
4. Click **Save view** to keep what you made.

For your own study: **Create project**, pick a folder **on your computer's own disk**, then **Import workbook**. The **[user guide](docs/USER_GUIDE.md)** walks through every screen.

## Two rules for study data

1. **Keep active projects on your own computer's disk.** Not on the NAS, a network drive, iCloud, Dropbox, OneDrive or Google Drive: these can corrupt a project that is open. To share work or keep a copy on the NAS, use **Backup** or **Export** in the app.
2. **Real study data never goes into this repository**, issues, logs or screenshots. Only the invented test files in `tests/fixtures/` belong here.

Projects are protected only by your computer's own login and disk encryption; they are not encrypted by the app. Backups can be encrypted with a passphrase (unreleased), and a record check detects changes made to the audit log and curation history outside the app (unreleased), but does not prevent them. See [docs/LIMITATIONS.md](docs/LIMITATIONS.md) for what the app does not do.

## Documentation

**For researchers**

| Document | What it covers |
| --- | --- |
| [INSTALL.md](docs/INSTALL.md) | Downloading, installing, updating, and fixing install problems |
| [USER_GUIDE.md](docs/USER_GUIDE.md) | Every screen and workflow, with a glossary |
| [LIMITATIONS.md](docs/LIMITATIONS.md) | What the app does not do; privacy and data protection |
| [MCP.md](docs/MCP.md) | Optional: letting an AI assistant query aggregate results (check IRB approval first) |

**For whoever maintains the app**

| Document | What it covers |
| --- | --- |
| [LAB_SERVER.md](docs/LAB_SERVER.md) | Hosting this repository on the lab NAS and publishing new versions to the download page |
| [DEVELOPING.md](docs/DEVELOPING.md) | Building from source, architecture, security model, tests |
| [STATUS.md](docs/STATUS.md) | Release history and how each feature was verified |
| [ROADMAP.md](docs/ROADMAP.md) | Planned work |
| [STRATEGY.md](docs/STRATEGY.md) | Review findings (2026-11-17), the order in which to address them, and progress |
| [THREAT_MODEL.md](docs/THREAT_MODEL.md) | What the app defends against, and what it leaves to the lab |
| [VALIDATION.md](docs/VALIDATION.md) | The evidence that the app does what it says, and how to re-run it |
| [CHANGELOG.md](CHANGELOG.md) | What changed in each version |
| [WORKBOOK_SEMANTICS.md](docs/WORKBOOK_SEMANTICS.md) | How to document a study workbook (details stay local) |
| [SIGNING.md](docs/SIGNING.md) | Code signing, if the lab gets certificates |

## Versions

- **Installers: 0.3.1** (2026-10-26). 0.3.0 plus a Windows fix for deleting folders that contain read-only source snapshots.
- **Source (`main`), unreleased:** analysis log with fingerprints, chart downloads with sidecars, covariates and colour-by, display transforms, histograms, correlation matrix, heatmap and PCA, the read-only MCP server, statistical guardrails (independence guard, censoring visibility, analysis register, neutral p-values), the record hash chain with its verify command, stricter MCP suppression, encrypted backups, a comparison of dataset versions, REDCap data dictionary import, and a single Mac installer for all Macs. None of this is in the 0.3.1 installers. [docs/STRATEGY.md](docs/STRATEGY.md) records what is done and what is next.

## What works

| Area | Status |
| --- | --- |
| Projects in local folders (SQLite, single-writer lock, sync-folder warning) | Working |
| XLSX/CSV import: preview, guided ID/visit mapping, validation, one-transaction commit, read-only checksummed snapshot, immutable versions, mapping reuse | Working |
| Numbered visits sorted numerically on import (Month 2 before Month 6) | Working (unreleased) |
| Source/QC preservation: theme colours and tints, rich-text headers turned into aliases, threaded comments, legend decoding with exact / needs-review / unresolved statuses, curator decisions | Working |
| Measurement catalog with append-only metadata revisions, quasi-identifier flags and covariate tags | Working |
| REDCap files: a record export imports with its own identifier and event columns; a data dictionary fills in labels, definitions, forms and identifier flags as tentative metadata | Working (unreleased), synthetic files only |
| Comparison of two imports of the workbook: rows, participants, measures, changed values and QC flags (nothing is merged) | Working (unreleased) |
| AND/OR cohort filters with explicit missing handling; QC inclusion policy with impact counts | Working |
| Distribution (box + all points; histogram unreleased) and two-measure scatter; linked table; forced axis bounds; chart style editor with presets | Working |
| Colour-by a categorical variable; display transforms (log2, log10, square root, Box-Cox, centre, z-score, rank) that never change stored data or exports | Working (unreleased) |
| On-demand statistics: CIs, normality, Welch t / Mann–Whitney / ANOVA / Kruskal–Wallis with effect sizes and Holm-adjusted pairwise tests, Pearson / Spearman / Kendall, linear fit with confidence and prediction bands; copyable tables, APA summaries and methods text | Working, validated against R 4.3 |
| Statistical guardrails: no test, interval or fit when a participant contributes more than one visit (with a one-click fix); percent censored beside every summary; p-values shown without emphasis | Working (unreleased) |
| Analysis register: every distinct analysis computed, with its p-values, recorded append-only by the main process; shown in History and exported | Working (unreleased) |
| Record check: the audit log, curation history and analysis register are hash-chained; **Verify** (or `--verify-project`) reports any row changed, removed or added outside the app | Working (unreleased) |
| Many measures: correlation matrix (no p-values), participant × measure heatmap, and exploratory PCA with a gap suggestion for wide panels and an optional biplot (loading vectors) | Working (unreleased), validated against R |
| Analysis log in R syntax with per-step and chain fingerprints (History panel, `analysis_log.R` in exports) | Working (unreleased) |
| Chart download: SVG/PNG, journal and slide size presets, fingerprint footer, `.chart.json` and `.analysis-log.R` sidecars written by the main process | Working (unreleased) |
| Saved views pinned to dataset and metadata versions and reproduced after restart; Compare whiteboard of views and notes, exportable as SVG/PNG | Working |
| First-run tour, ⌘K search and ⌘1–⌘6 shortcuts; wide tables virtualised in both directions; table values reachable with the arrow keys (unreleased) | Working |
| Research-context ZIP (pseudonymous keys, checksums, preview); `analysis_log.R` and `analysis_register.json` are the seventh and eighth files in unreleased builds | Working |
| Backup and verified restore; optional passphrase encryption (unreleased) | Working |
| MCP server for AI assistants (read-only, aggregate results, every small count suppressed, extremes withheld, access log) | Working (unreleased), tested on synthetic data only |
| macOS installer: one universal DMG for Apple Silicon and Intel, unsigned (0.3.1 shipped separate arm64 and x64 files) | CI mounts the DMG, copies the app out, checks it is universal, its signature and fuses, and runs `--self-test` natively and under Rosetta (unreleased) |
| Windows installer (NSIS x64, unsigned) | CI runs the setup silently, self-tests the installed app and uninstalls it; the install wizard has not been run by hand |
| Lab-server download folder (`npm run release:lab`): verified copies, checksums, offline download page | `tests/labRelease.test.ts`; built from the real installers in CI (unreleased) |

Rows marked *unreleased* are in the source but not in the 0.3.1 installers. [docs/STATUS.md](docs/STATUS.md) lists how each feature was verified.

## Building from source (maintainers)

Needs Node.js 22.13 or newer. Clone the repository to a **local** disk (building on a network share is slow and can fail).

```bash
npm install
```

```bash
npm run dev
```

Installers and publishing them to the lab server: [docs/LAB_SERVER.md](docs/LAB_SERVER.md). Everything else: [docs/DEVELOPING.md](docs/DEVELOPING.md).
