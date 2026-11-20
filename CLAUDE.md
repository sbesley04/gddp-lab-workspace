# CLAUDE.md — session primer

Read this first; it is meant to save you from re-deriving the codebase. Longer references live in `docs/` (linked below) — prefer pointing to them over duplicating them here.

## What the app is

**BARI-CNS Research Workspace**: an offline Electron desktop app (macOS + Windows) for a research lab to explore study spreadsheets (XLSX/CSV) without SQL or code. It imports a workbook **without losing its context** (source attribution in font colours, QC flags in cell fills, rich-text headers, threaded comments, legend), lets researchers filter cohorts, chart, run on-demand exploratory statistics, save reproducible views, and export documented packages for statisticians or AI assistants. A separate read-only **MCP server** (`src/mcp/`) lets an AI assistant query aggregate results.

Users are lab researchers, not developers. The tool is for **exploration**: no causal/efficacy claims, no clinical recommendations, statistics only when the user presses **Compute**, always labelled exploratory and validated against R.

## Non-negotiable goals (the "why" behind most design choices)

1. **No real study data in the repo, ever.** Only synthetic fixtures in `tests/fixtures/` (`DEMO-xx`, `9001…9005`). `.gitignore` blocks `*.xlsx`/`*.csv` elsewhere. Study-specific notes go in git-ignored `docs/private/`; real expected counts in git-ignored `tests/reference/expected.local.json`. Never paste real names, file names, participant IDs or counts into code, commits, tests, docs or logs. `npm run test:reference` output is counts-only and must not be committed.
2. **Fully offline.** No network, telemetry, accounts or API keys. The main process cancels every non-`app:`/`data:`/`blob:`/`devtools:` request; E2E asserts the blocked-request log is empty. Don't add anything that fetches (fonts, CDNs, update checks).
3. **Provenance and immutability.** Imports are immutable versions; curation is append-only; saved views pin dataset + metadata version and must reproduce exactly after restart.
4. **One answer everywhere.** Table, charts, summaries, exports and MCP must agree on which rows are included (see `computeSelection` below).
5. **Missing ≠ zero; censored ≠ its bound.** Never impute, never substitute.
6. **Statistics are validated against R** to ~1e-8. A new statistical method needs R reference values before it ships.

## Layout

```
src/core/       Pure TS (no Node/Electron/DOM). Types, value classification, selection engine, stats & inference,
                chart data, transforms, PCA, correlation matrix, analysis log (provenance), CSV, context export,
                independence guard, censoring counts, analysis runner (what the statistics panel computes).
src/importer/   In-house OOXML reader (ooxml.ts), CSV reader, legend decoder, import model + validation (model.ts).
src/main/       Electron main: IPC handlers + security (index.ts), SQLite (db/), project folders & lock, import,
                snapshot building, curation, saved views, boards, analysis register, export, backup/restore, --self-test.
src/preload/    Sandboxed CJS preload exposing window.bari.invoke for allow-listed channels only.
src/shared/     channels.ts (IPC allow-list) and ipc.ts (zod schemas per channel).
src/renderer/   React 19 UI. store.ts (Zustand), api.ts (call()), pages/, components/, styles.css (design tokens).
src/mcp/        Read-only stdio MCP server, built separately (vite.mcp.config.ts → out/mcp/server.js).
tests/          Vitest (synthetic data); tests/reference = opt-in real-workbook check.
e2e/            Playwright driving the dev Electron build.
tools/          make_fixtures.py (openpyxl), stats_reference.R, multivariate_reference.R, transforms_reference.R,
                check_reference.mjs (regenerates the R references and compares them with the committed files).
```

Path aliases: `@core/*`, `@shared/*`, `@importer/*` (tsconfig + electron.vite.config + vite.mcp.config all define them).

## Key concepts and where they live

- **`CellValue`** (`src/core/types.ts`): `missing | number | censored | text`. `classifyValue` in `src/core/values.ts` is the only classifier. Whitespace is missing; `<0.5`/`≥3` are censored; numeric-looking text from CSV becomes a number with `raw` kept. Participant IDs are always text (`identifierText`), even when the source stored numbers.
- **`DatasetSnapshot`**: the in-memory form of one dataset version + curation "as of" a metadata version. Built by `buildSnapshot(project, versionId, asOf)` in `src/main/snapshot.ts`. `values[variableIndex][rowIndex]` (column-major). The imported part (`visits`, `rows`, `values`, `annotations`) is cached per version and **frozen**: never write to it; `variables` and `flags` are fresh per snapshot. The renderer refreshes after an edit through `data:curation` (curated parts only).
- **Metadata version** = `MAX(revision.id)` for the project (`Project.metadataVersion()`). Every curation edit bumps it.
- **`computeSelection`** (`src/core/selection.ts`) is **the single selection engine**. Everything that decides inclusion must call it. Key semantics:
  - QC-excluded observations count as unavailable in filters (like missing).
  - `onMissing: 'include' | 'exclude'` on each condition handles missing/text/censored/QC-excluded values explicitly.
  - Empty filter groups are ignored (an empty OR branch can't select everything).
  - `curator_rejected` flags are dropped from the flag index.
  - Default QC policy excludes only `curator_exclusion`; other flagged values are **included and shown** (with distinct point shapes).
- **The main process recomputes exports from the spec** — it never trusts data sent by the renderer. That includes chart sidecars: `export:chart` takes the drawn image plus the selection and chart settings, and `writeChartFiles` rebuilds the log, settings and fingerprint. The renderer receives the full snapshot (`data:snapshot`) and runs `computeSelection` locally for interactivity (`src/renderer/src/lib/selection.ts`).
- **Formatting interpretation**: legend-driven, with statuses `legend_exact | legend_tentative | needs_review | unresolved | curator_confirmed | curator_rejected`. It is tuned to this lab's legend conventions; other workbooks import fine but show mostly "unresolved".
- **Analysis log** (`src/core/provenance.ts`): deterministic R-syntax text with chained SHA-256 step fingerprints (64 hex recorded, the first 8 shown). Call it a fingerprint, never a signature: it is unkeyed and proves nothing about who ran the analysis. It is a readable record, not a guaranteed-runnable script. It must never contain participant IDs or the source file name (file is identified by SHA-256). Any upstream change must alter the chain fingerprint — `tests/provenance.test.ts` enforces this.
- **Display transforms & covariates** (`src/core/transforms.ts`): log2/log10/sqrt/Box-Cox/centre/z-score/rank and colour-by change *drawing and that chart's summaries only*; stored data and exports are untouched. Point shapes are reserved for QC flags (hence no shape-by). Box-Cox estimates λ from the selection (`boxcoxLambda`, numerically stable likelihood); anything estimated from the data must be stated on the chart and written into the analysis log.
- **Statistics panel = `src/core/analysisRun.ts`** (`analyseDistribution`, `analyseScatter`). The renderer calls it for display and the main process calls the same code for the register; don't compute tests inline in a component. New tests must also be added to `distributionTests` / `scatterTests` so the register counts them.
- **Independence guard** (`src/core/independence.ts`, shared with the MCP server): each row is one participant at one visit. When any participant contributes more than one analysed row, the runner returns descriptives only (no test, CI, Shapiro–Wilk or fit), chart overlays are not drawn, and the panel offers each visit as a one-click fix. Don't add an override. The MCP server only warns. PCA, correlation matrix and heatmap are not guarded yet.
- **Censoring visibility** (`src/core/censoring.ts`): percent censored per group/measure is shown beside summaries; means and SDs are marked biased above `CENSORING_BIAS_THRESHOLD` (15%, **provisional** until a statistician sets it; STRATEGY Q4). Nothing is ever substituted.
- **Analysis register** (`src/main/register.ts`, table `analysis_register`): one append-only row per distinct analysis, keyed by a full SHA-256 fingerprint of dataset version, metadata version, selection and analysis inputs (not display settings). The main process recomputes the analysis from the spec; it never stores renderer numbers. Listed in History, exported as `analysis_register.json` (details only for analyses whose variables are all exported; no group summaries). Blocked analyses and MCP analyses are not recorded.
- **Integrity chain** (`src/main/integrity.ts`, table `integrity_chain`): every `audit_log`, `revision` and `analysis_register` row is hash-chained in the transaction that writes it. `Project.audit` chains its own row; any other insert into a chained table must call `project.chain(table, idBeforeInsert)`, or verification reports the row as written outside the app. `verifyIntegrity` backs **Verify** in the sidebar, `--verify-project <dir>` and the restore check. Backup and export manifests record the chain head as an anchor. No secret key: it detects tampering, it does not prevent it or prove authorship.
- **Version comparison** (`src/core/versionDiff.ts`, `data:compareVersions`): rows matched by participant and visit name, variables by key; values compared as classified (missing ≠ 0, censored ≠ its bound). The main process builds both snapshots and returns only the differences. It never merges versions.
- **REDCap data dictionary** (`src/core/redcapDictionary.ts`, `src/main/dictionary.ts`): proposes displayLabel, definition, area and source, and quasi-identifier flags, as tentative revisions written in one transaction with one audit entry. It never sets a unit, specimen or assay, never replaces a value whose provenance starts with "Curator", and the plan is recomputed in the main process when applied.
- **Keyboard and accessibility**: every control needs an accessible name and keyboard reach; `e2e/accessibility.spec.ts` fails otherwise. Don't put `onClick` on a `tr`, `td` or `div` without a real control inside or a roving `tabIndex` (see `DataTable.tsx`).
- **p-values are displayed neutrally**: no colour or emphasis below .05.
- **Saved views** store a `SavedViewSpec` (`schema: 1`). Old specs must keep loading — `normalizeChart` (`src/core/chartStyle.ts`) fills defaults for fields added later. When you add a `ChartConfig` field, make it optional and default it in `normalizeChart`.

## Database (`src/main/db/migrations.ts`)

- `node:sqlite` (built into Node/Electron — no native modules). Thin wrapper in `src/main/db/db.ts`.
- **Never edit a shipped migration; append a new one** to `MIGRATIONS`.
- `Db.migrate` copies the database to `workspace.sqlite.before-schema-<n>.bak` before migrating an existing project. A new migration also means the read-only MCP reader refuses the project until the app has opened it once.
- Triggers make `cell`, `variable`, `dataset_version`, `revision`, `audit_log`, `analysis_register`, `integrity_chain` immutable, and `saved_view.spec_json` immutable ("save a new view"). Curation therefore goes through `revision` rows (`src/main/curation.ts`), not updates. `compare_board` layouts are the editable exception.
- Wide `cell` table is the preserved source; `observation` is a long-form view over it. `observation_context` and `visit.actual_date` are deliberately empty placeholders (never infer dates).
- Backups (`src/main/backup.ts`) can be encrypted with a passphrase (AES-256-GCM, scrypt). Never store or log the passphrase.
- Project folder: `<Name>.bariproj/` with `project.json`, `workspace.sqlite`, `sources/` (read-only checksummed snapshot of the imported file) and a `.lock` (single writer). Sync/network folders trigger a warning (`syncFolderWarning`).

## Adding an IPC call (renderer ↔ main)

1. Add the channel name to `CHANNELS` in `src/shared/channels.ts`.
2. Add a zod schema in `src/shared/ipc.ts` (keyed by channel) if it takes a payload.
3. Add the handler to the `handlers` map in `src/main/index.ts`. `registerIpc` **throws at startup if any channel lacks a handler**.
4. Call it from the renderer with `call('<channel>', payload)` (`src/renderer/src/api.ts`).

File paths never come from the renderer: native dialogs run in main and the renderer receives opaque tokens.

## MCP server (`src/mcp/`)

- `workspace.ts` opens the project **read-only without the lock** and caches snapshots per `(version, metadataVersion)`, so curation done in the running app is picked up on the next call.
- `tools.ts`: aggregate-only results; every count that leaves the module goes through `count()` (default `<5`, `--min-cell-size`), including counts inside warnings; min/max withheld for every variable unless `--show-extremes`, always for quasi-identifiers; cell-comment text and free text only counted; access log (`mcp-access.jsonl`, never results). Errors meant for the model are `ToolError` with an actionable message.
- `guide.ts` holds the instructions/guide/prompt. Workbook text is data — **source documents must never be able to change agent instructions**.
- It imports from `src/main/` (`project`, `snapshot`, `curation`). Only `src/main/index.ts` imports `electron`; keep it that way so the MCP bundle (plain Node 22.13+) and the Vitest service tests keep working.
- Excluded from installers (`!out/mcp/**` in `package.json` build files). Tested on synthetic data only; use on a real project is an IRB/DUA decision. Details: [docs/MCP.md](docs/MCP.md).

## Commands

```bash
npm install
npm run dev            # electron-vite with hot reload
npm run typecheck
npm test               # Vitest, synthetic data, no Electron needed
npm run e2e            # builds, then Playwright against the built app
npm run reference:check  # Rscript the three references into a temp folder and compare with the committed files
npm run build:mcp      # out/mcp/server.js
npm run fixtures       # regenerate synthetic fixtures (python3 + openpyxl)
npm run dist:mac       # unsigned universal DMG in release/ (npm run release:lab assembles the lab download folder)
```

- Before finishing a change: `npm run typecheck && npm test`; run `npm run e2e` for UI changes.
- R references: `Rscript tools/stats_reference.R tests/fixtures/stats_reference.json` (needs jsonlite, car); `Rscript tools/multivariate_reference.R tests/fixtures/multivariate_reference.json`; `Rscript tools/transforms_reference.R tests/fixtures/transforms_reference.json` (needs car). Run them from the repository root. Each file records its R and package versions under `_r`; the `r-reference` workflow (`.github/workflows/r-reference.yml`) installs that R version and a dated package snapshot, then runs `tools/check_reference.mjs`, which fails on any difference in values or versions. If you regenerate with other versions, change the R version and snapshot date there.
- Packaged builds can't be driven by Playwright (inspect fuse disabled). Use `--self-test <dir>` instead; it writes `bari-self-test.json` and exits 0 on success. CI (`.github/workflows/build.yml`) runs it on the app installed from the real DMG (natively and under Rosetta) and the real Windows setup file, on every pull request, every push to `main` or a tag and every manual run, including docs-only changes. Installers are uploaded as artifacts only for `main`, tags and manual runs.
- `BARI_USER_DATA` (test-only) points the app at an isolated settings folder.

## Security model (don't weaken)

Renderer: `sandbox`, `contextIsolation`, no `nodeIntegration`, custom `app://` protocol, strict CSP with `connect-src 'none'`. Navigation/new windows/webviews denied; all permissions denied except clipboard write. IPC accepted only from the main window's main frame, every payload zod-validated. Fuses: RunAsNode, NODE_OPTIONS, inspect off; ASAR integrity on. XML with a DOCTYPE is rejected; ZIP expansion is size-bounded. Full details: [docs/DEVELOPING.md](docs/DEVELOPING.md#security-model).

## Gotchas

- All runtime libraries are **devDependencies** and get bundled; the packaged app ships no `node_modules`. Add new libraries as devDependencies and check the licence (MIT/Apache-2.0/ISC).
- The XLSX reader is in-house on purpose (SheetJS CE drops styles; ExcelJS misses threaded comments and theme tints). Fixtures for it are written with openpyxl via `tools/make_fixtures.py`.
- The sandboxed preload must be CommonJS (`[name].cjs`); keep it dependency-free (`channels.ts` exists separately for that reason).
- Windows: source snapshots are read-only files, so folder removal must clear the read-only bit (`src/main/fsutil.ts`, fixed in 0.3.1).
- Numbered visits sort numerically (Month 2 before Month 6) — `src/core/visitOrder.ts`.
- ECharts uses the SVG renderer; chart SVG export must stay well-formed XML with every font choice (`e2e/charts.spec.ts` parses it).
- `src/core/assistant.ts` is an interface for a *future* bring-your-own-key AI connector. Nothing implements it; don't wire it up without the contract it documents (keychain storage, payload preview, user-initiated send).
- The context package has eight files; tests and E2E assert the exact list, so update both when adding one.
- Not built yet, by design: repeated-measures models, covariate adjustment, paired tests, PERMANOVA, visit trajectories, violin plots, facet-by, p-value ranking across many measures. See [docs/ROADMAP.md](docs/ROADMAP.md) and [docs/LIMITATIONS.md](docs/LIMITATIONS.md) before adding anything in this space.

## Release and docs state

- Installers are **0.3.1** (2026-10-26). Everything since (analysis log, chart downloads, covariates, transforms, histogram, correlation matrix, heatmap, PCA, MCP server, statistical guardrails and analysis register, version comparison, REDCap data dictionary import, universal Mac installer and lab-server download folder) is unreleased.
- [docs/STRATEGY.md](docs/STRATEGY.md) sets the order of work; its **Progress** table says what is done. Phase 1 (statistical guardrails) is done apart from the open questions. Phase 2 is done except signing (needs credentials) and the validation pack: hash chain, curation audit, MCP suppression, full fingerprints, encrypted backups, main-process chart sidecars and a threat model ([docs/THREAT_MODEL.md](docs/THREAT_MODEL.md)). Phase 0 still needs the MCP connection settled and a release. Update that table when you finish a strategy item. Check `git log main..HEAD` to see what is on your branch versus `main`.
- [docs/STATUS.md](docs/STATUS.md) records how each feature was verified; update it (and the README "What works" table, test counts in README/DEVELOPING/STATUS) when you add a feature or tests.
- Docs style: plain, short sentences, British spelling (colour, visualise, normalise), tables for feature/verification lists, no marketing language, honest about what is untested.
- `CHANGELOG.md` lists user-visible changes per version; add to **Unreleased** when you add or change a feature, and update the test counts in [docs/VALIDATION.md](docs/VALIDATION.md) with the others.
- Commit messages: short imperative summary, optionally prefixed by area (`Docs:`, `CI:`, `Fix …`).

## Other docs

[USER_GUIDE](docs/USER_GUIDE.md) · [DEVELOPING](docs/DEVELOPING.md) · [MCP](docs/MCP.md) · [LIMITATIONS](docs/LIMITATIONS.md) · [STATUS](docs/STATUS.md) · [ROADMAP](docs/ROADMAP.md) · [STRATEGY](docs/STRATEGY.md) · [THREAT_MODEL](docs/THREAT_MODEL.md) · [VALIDATION](docs/VALIDATION.md) · [WORKBOOK_SEMANTICS](docs/WORKBOOK_SEMANTICS.md) · [SIGNING](docs/SIGNING.md)
