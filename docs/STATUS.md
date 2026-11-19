# Release status

| Version | Date | State |
| --- | --- | --- |
| 0.1.0 | 2026-10-22 | First release; macOS installers smoke-tested |
| 0.2.0 | 2026-10-23 | On-demand statistics, chart styling, Compare boards |
| 0.3.0 | 2026-10-25 | UI rework, first-run tour, virtualised wide tables |
| 0.3.1 | 2026-10-26 | Windows folder-removal fix; **current installers** |
| Unreleased | 2026-11-03 | Analysis log, chart downloads, covariates, transforms, histogram, correlation matrix, heatmap, PCA |
| Unreleased | 2026-11-05 | Read-only MCP server for AI assistants |
| Unreleased | 2026-11-09 | Square-root and Box-Cox transforms, PCA biplot |
| Unreleased | 2026-11-19 | Statistical guardrails: independence guard, censoring visibility, analysis register, neutral p-values, R check |
| Unreleased | 2026-11-19 | Integrity: hash chain over the audit log, revisions and register with a verify command; full curation audit; MCP small-count and extreme-value suppression |

## Current test inventory

- `npm test`: 176 Vitest tests in 19 files, all on synthetic data (including 15 for the MCP server, 13 for the statistical guardrails and 6 for record integrity).
- `npm run e2e`: Playwright. The full UI workflow, chart downloads (`e2e/charts.spec.ts`), the tour, wide table, PCA and many-measures views (`e2e/tour-table.spec.ts`), the statistical guardrails, the record check and the error boundary (`e2e/guardrails.spec.ts`), and screenshots of every screen in light and dark mode.
- `npm run reference:check`: regenerates the three R reference files and compares them with the committed ones (needs R with jsonlite and car).
- `npm run test:reference`: opt-in, local-only checks against the real workbook; expected counts live in a git-ignored file.
- `--self-test`: packaged-build smoke test.
- R reference values: `tools/stats_reference.R` (tests, CIs, regression) `tools/multivariate_reference.R` (PCA, biplot vectors, correlation matrix) and `tools/transforms_reference.R` (Box-Cox). Each file records the R and package versions that produced it (R 4.3.2, jsonlite 2.0.0, car 3.1.3).

## 0.1.0 (first release, 2026-10-22)

Verified on 2026-10-22 on macOS 26.5 (Apple Silicon), Node 24.14, Electron 44.9.3.

| # | Acceptance criterion | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Import the supplied workbook; reconcile its participants, baseline rows and columns; keep the blank column out of the picker, with an explanation | **Pass** | `npm run test:reference` (importer model plus the full database path, with counts from a local expectations file). The UI import of the real workbook matched the expected participant, row, measure, blank-column and comment counts. |
| 2 | Formatting and comments preserved or marked unresolved; source and QC interpretations validated against the legend | **Pass** | Reference checks: exact target and combined QC colours, a sample-warning colour mismatch marked needs review, rich-text multi-source headers and alias inconsistencies, all matching the local expectations. Details are kept locally (see [WORKBOOK_SEMANTICS.md](WORKBOOK_SEMANTICS.md)). |
| 3 | Table, chart, summaries and export agree exactly | **Pass** | `tests/workflow.test.ts` (same rows and same n across distribution, grouped distribution, summary and export) and `e2e/workflow.spec.ts` (cohort count = table rows = export rows = manifest rows) |
| 4 | Filters, missing vs zero, numeric-looking IDs, ambiguous headers, duplicate keys, censored values, invalid log, no matching data | **Pass** | `tests/selection.test.ts`, `tests/importer.test.ts`, `tests/values.test.ts`, `tests/workflow.test.ts` on synthetic fixtures |
| 5 | Descriptive calculations against independent small fixtures | **Pass** | `tests/stats.test.ts`: hand-computed expected values, explained inline |
| 6 | Save a view, restart, reproduce against the same dataset version | **Pass** | Unit test (close and reopen the project, with curation made after the save) and E2E (relaunch the app, open as saved, same cohort) |
| 7 | Export and inspect a context package | **Pass** | Unit and E2E tests unzip the package and check the six files (eight in unreleased builds), SHA-256 checksums, pseudonymous keys, absence of source IDs, paths and comment authors, quasi-identifier blocking, and the baseline-only statement |
| 8 | Backup and restore without changing observations | **Pass** | Content hash equal after restore; a damaged backup is rejected and leaves nothing behind (unit, E2E, reference) |
| 9 | Core workflow without internet or API credentials | **Pass, with a caveat** | E2E asserts that no non-local request was attempted during the whole workflow. All requests are blocked by policy, and no credentials exist anywhere. The test machine itself was online. |
| 10 | Package and smoke-test on Windows and macOS | **macOS: pass. Windows: built, untested at 0.1.0** (since passed in CI; see 0.3.1) | macOS arm64 and x64 DMGs were mounted, the app copied out and `--self-test` run (import, view reproduce, export checksums, backup/restore, UI load). x64 ran under Rosetta. The Windows NSIS installer was cross-built but never run. All builds are unsigned. Signing steps are in [SIGNING.md](SIGNING.md). |

### Test inventory at 0.1.0

- `npm test`: 53 Vitest tests.
- `npm run test:reference`: checks against the real workbook. This is opt-in and local only; expected counts live in a git-ignored file.
- `npm run e2e`: Playwright. The full UI workflow, plus screenshots of every screen in light and dark mode.
- `--self-test`: packaged-build smoke test.

## 0.2.0 additions (2026-10-23)

| Feature | Verification |
| --- | --- |
| Suggested view names | `tests/features.test.ts`; E2E saves with the suggested name by pressing Enter |
| Forced axis bounds (out-of-bounds points counted) | E2E checks the notice; values outside bounds still enter statistics |
| Box plots sized consistently (fixed height, capped box width, horizontal scroll for many groups) | Screenshot review in light and dark mode |
| Chart style editor and presets, saved with views; schema rejects malformed colours | `tests/features.test.ts`; screenshots |
| On-demand statistics with p-values, CIs and effect sizes; TSV, APA and methods-text copy | `tests/inference.test.ts`: every statistic matches R 4.3 reference values; E2E checks the panel appears only after Compute |
| Compare whiteboard (drag, resize, notes, styles, SVG/PNG export, persists across restart) | `tests/features.test.ts` (service), E2E (add views, drag, restart, layout kept, SVG export contains both charts) |
| Older saved views keep working | `normalizeChart` and schema test with a 0.1-style spec |

## 0.3.0 installers (2026-10-25)

UI changes since 0.2.0: readable callouts and toasts, single-form metadata editing, compact Overview, Explore layout with tabbed side panel, first-run tour, virtualised wide tables, Compare board placement fixes, static background.

| Artefact | Smoke test |
| --- | --- |
| `BARI-CNS Research Workspace-0.3.0-arm64.dmg` | Mounted, app copied out, `--self-test` passed (6/6 steps incl. UI load) on macOS 26.5 Apple Silicon, 5 s |
| `BARI-CNS Research Workspace-0.3.0.dmg` (x64) | Same, under Rosetta 2, 60 s; not tested on Intel hardware |
| `BARI-CNS-Research-Workspace-Setup-0.3.0.exe` | Cross-built; valid NSIS installer, fuses verified on the unpacked exe; **not run on Windows** |

All builds are unsigned (macOS ad-hoc signature valid; Gatekeeper rejects as expected). Each bundle was checked to contain the 0.3.0 code.

## 0.3.1 installers and Windows verification (2026-10-26)

GitHub Actions run 40348578383 on `windows-latest`: type check, all 72 unit tests and the packaged `--self-test` passed (create project, import, saved-view reproduction, export checksums, backup/restore, UI load, temporary-file removal). The same run passed on macOS. This found and fixed a Windows-only bug: folders containing the read-only source snapshot could not be deleted (affecting re-opening the synthetic demo and failed-restore cleanup). Still untested: running the NSIS install wizard by hand on Windows 10/11.

The 0.3.1 installers were rebuilt with this fix. They contain none of the unreleased work below.

## Unreleased: analysis and charts (2026-11-03)

From the lab meeting notes (R command history, edit signatures, PCA, covariates, more visualisation options, saving charts).

| Feature | Verification |
| --- | --- |
| Numbered visits sorted numerically on import (Month 2 before Month 6, not text order) | `tests/visitOrder.test.ts` |
| Analysis log in R syntax with per-step and chain signatures (History panel, `analysis_log.R` in the export ZIP) | `tests/provenance.test.ts` (deterministic text; every upstream change alters the signature; no participant IDs or file name; QC exclusion counts); SHA-256 against NIST vectors; E2E opens History and checks the export ZIP |
| Chart download: size presets, PNG scale, signature footer, `.chart.json` and `.analysis-log.R` sidecars | `tests/chartStamp.test.ts`, `tests/chartExport.test.ts` (other files beside the chart are not overwritten); `e2e/charts.spec.ts` saves SVG and PNG through the UI and checks size, footer, legend, XML well-formedness and sidecars |
| Fix: chart SVG/PNG exports were malformed XML with the default (system) and serif fonts, so PNG export failed and strict SVG readers rejected the file | `e2e/charts.spec.ts` parses the saved SVG; font-stack test |
| Covariate tag (append-only, carried over), colour-by with a named legend | `tests/workflow.test.ts` (as-of and carry-over), `tests/transforms.test.ts` (categories), `e2e/charts.spec.ts` |
| Display transforms (log2, log10, centre, z-score, rank) | `tests/transforms.test.ts`: hand-computed values; z-score and rank checked against R |
| Exploratory PCA (correlation matrix, complete cases, Compute on demand; also on Compare boards) | `tests/pca.test.ts` against R `prcomp(scale. = TRUE)` (`tools/multivariate_reference.R`), to about 1e-8; E2E computes PCA on the demo data |
| Histogram (Freedman–Diaconis, exact breaks in the log) | `tests/transforms.test.ts` (counts match R `hist(right = FALSE)`); E2E |
| Correlation matrix (Spearman/Pearson, pairwise complete, no p-values) and participant × measure heatmap, sharing one variable set with PCA | `tests/matrix.test.ts` against R `cor(use = "pairwise.complete.obs")` with ties and missing values (`tools/multivariate_reference.R`); heatmap ordering and z-scores; E2E |
| PCA gap suggestion (drop variables with gaps in more than 10% of rows when that regains participants) | `tests/pca.test.ts` |

Real workbook (`npm run test:reference`, counts only): import and export checks pass. The correlation matrix, heatmap, PCA, histograms and analysis log run on the largest numeric area (157 variables) without invalid values, and the log contains neither participant IDs nor the file name. Complete-case PCA over that whole area keeps only 13 of 40 rows, which is what the gap suggestion is for.

Packaged build (macOS arm64, `--dir`, unsigned): `--self-test` passes all steps, including the analysis log in the export and a PCA and correlation run. `npm run e2e:packaged` cannot work by design (the inspect fuse is disabled); it now fails at once with that explanation instead of hanging.

Not done: visit-trajectory charts (the reference data has one visit); violin plots; shape-by and facet-by (shapes already mean QC flags); covariate adjustment; PERMANOVA.

## Unreleased: MCP server (2026-11-05)

| Feature | Verification |
| --- | --- |
| Read-only stdio MCP server (`src/mcp/`, built to `out/mcp/server.js`, excluded from the installers) with 12 tools, 2 resources and an analysis prompt; see [MCP.md](MCP.md) | `tests/mcp.test.ts` drives it through an in-memory MCP client on synthetic data: results equal the core statistics for the same selection |
| Aggregate-only results; groups under the minimum cell size (default 5) suppressed; extremes withheld for quasi-identifiers | `tests/mcp.test.ts` checks suppression and that no participant identifier appears in any output |
| Opens the database read-only without taking the project lock; logs calls (never results) to `mcp-access.jsonl` | `tests/mcp.test.ts` (writes fail; works while the app holds the lock) |

Not done: it has not been run against the real project. Whether aggregate results may be sent to an AI provider is a decision for the lab's IRB and data use agreements. No row-level mode, and it cannot write saved views back.

## Unreleased: transforms and biplot (2026-11-09)

Requested at the Nov 5 data analysis review.

| Feature | Verification |
| --- | --- |
| Square-root transform | `tests/transforms.test.ts` (hand-computed; negative values dropped and counted) |
| Box-Cox transform, λ by maximum likelihood (y ~ 1) over the selection's positive values, stated on the chart, in the analysis log and in MCP warnings | `tests/transforms.test.ts` against `tools/transforms_reference.R`: λ matches R `optimize` on the same likelihood to 1e-6 and `car::powerTransform` to 1e-5, the log-likelihood to 1e-9, and transformed values match `car::bcPower` to 1e-10, on four synthetic samples (right-skewed, near-normal, ties, left-skewed with λ ≈ 5.9). An estimate at the ±10 search limit is reported. E2E applies it and checks the λ notice and log line. |
| PCA biplot: loading vectors as each variable's correlation with the shown components, 10 longest drawn, one stretch factor stated; saved with views; recorded in the log | `tests/pca.test.ts` against R `cor(X, pc$x)` to 1e-8; E2E turns it on, checks the notice and log line, and saves a screenshot |

Fixed during this work: the direct Box-Cox formula loses precision at large |λ|, which made a false likelihood maximum near λ = −10. The likelihood is now computed on log values centred at the geometric mean, with `expm1`.

Not done: label collision handling for arrows that point the same way; inverse-normal transform (judged unsuitable at the review); 3D PCA.

## Unreleased: statistical guardrails (2026-11-19)

Phase 1 of [STRATEGY.md](STRATEGY.md), plus two hygiene items from Phase 0.

| Feature | Verification |
| --- | --- |
| Independence guard, shared by the app and the MCP server (`src/core/independence.ts`). When any participant contributes more than one row, the statistics panel computes no test, confidence interval, normality check or fit. It shows plain descriptives and offers each visit as a one-click fix. Fit lines, bands and mean ± CI are not drawn either. | `tests/guardrails.test.ts`: a synthetic two-visit file gives no test, interval or fit from the shared runner (`src/core/analysisRun.ts`), and nothing reaches the register; one visit gives the same numbers as calling the tests directly. `tests/mcp.test.ts` checks the shared warning. `e2e/guardrails.spec.ts` checks the blocked panel, the fix button and the results that follow. |
| Methods, caveat and subtitle text derived from the analysed rows ("observations at Month 6", "27 observations from 14 participants"), not fixed words | `tests/guardrails.test.ts` (visit scope text); E2E checks the caveat names the visit |
| Censoring visibility: percent of measured values censored per group and per measure, the direction of the bias, and a mark on means and SDs above 15% (provisional threshold) | `tests/guardrails.test.ts`: counts by direction, the threshold, the note text, and that summaries use no bound; E2E checks the note and the table cell |
| Analysis register: one append-only row per distinct analysis, recomputed in the main process from the selection and chart settings, with a full SHA-256 fingerprint, its tests and p-values. Listed in History with a running count, and written to the context package as `analysis_register.json` | `tests/guardrails.test.ts`: stored values equal the core functions; duplicates and display changes are not re-recorded; fingerprints change with visits, filter, QC policy, transforms, log axes and metadata version; update and delete are refused; the export lists details only for exported variables and holds no participant ID. E2E checks the counts in the panel and in History. The packaged self-test has a register step (not yet run on a packaged build). |
| p-values displayed without emphasis below .05 | E2E asserts no accent badge in the panel |
| R and package versions recorded in each reference file; `npm run reference:check`; CI workflow `r-reference` with R 4.3.2 and a dated package snapshot | The check reproduces all three files on macOS, and fails when a value or a version is changed by hand. The workflow passes on Linux (GitHub Actions run 44606584321): every value agrees to 1e-9 except Box-Cox λ (1e-6) and the values transformed with it (2e-5), which differ in the last digits between platforms. `tests/rReference.test.ts` checks that the workflow uses the recorded R version. |
| A copy of `workspace.sqlite` is kept before a schema migration | `tests/guardrails.test.ts` (schema upgrade) |
| `.codex/` and `Claude outputs/` git-ignored; stale "no remote" comments removed | By inspection |

Not done: the MCP server warns about repeated visits but does not refuse; analyses run through the MCP server are not in the register; the censoring threshold awaits a statistician (STRATEGY Q4); no censoring-aware estimates; no paired tests. The packaged build and `npm run test:reference` were not re-run for this work.

## Unreleased: integrity and MCP privacy (2026-11-19)

The first part of Phase 2 of [STRATEGY.md](STRATEGY.md).

| Feature | Verification |
| --- | --- |
| Hash chain over the audit log, curation revisions and analysis register (`src/main/integrity.ts`, table `integrity_chain`). Each row is entered as the app writes it, in the same transaction, with a SHA-256 of its content and a SHA-256 linking it to the entry before. | `tests/integrity.test.ts`: every row of the three tables is chained; a rolled-back transaction leaves no entry; the chain table is itself append-only |
| Verification: **Verify** in the sidebar, `--verify-project <folder>` on the command line (read-only, exit code 0, 1 or 2), and on restore. It reports rows changed, removed or added outside the app, broken chain links and missing immutability triggers. | `tests/integrity.test.ts` edits the database with a plain SQLite connection in seven ways (edited audit row, edited revision, deleted row, edited register result, row added outside the app, chain entry removed, row and its hash both edited). Each fails verification with the expected problem kinds, and still fails after the app writes again. E2E opens the sidebar check. `--verify-project` was run by hand on the development build: exit 0 on a clean synthetic project, 1 after a trigger was dropped with another tool, 2 for a folder that is not a project. It has not been run on a packaged build. |
| Anchors: each backup and context-export manifest records the chain head. Verification checks every anchor recorded in the project, and any passed to it. | `tests/integrity.test.ts`: a chain rebuilt from scratch after an edit is caught by the recorded anchors, and by a manifest kept outside the project when those are removed too |
| Restore checks the records against the head the backup recorded, and reports damage without refusing | `tests/integrity.test.ts` |
| Projects from earlier versions: existing rows are chained on first open and marked as entered after the fact | `tests/integrity.test.ts`; `tests/guardrails.test.ts` (schema upgrade) |
| Audit entries for quasi-identifier flags, segment names and study context (the text itself is not copied into the audit detail) | `tests/integrity.test.ts` (audit trail) |
| Notice on the correlation matrix, heatmap and PCA when a participant appears at more than one visit, with the one-visit fix | E2E |
| Error boundary: a failure while drawing a page shows a message, the error text and **Try again**, and the sidebar stays usable; a second boundary covers the whole window | `e2e/guardrails.spec.ts` makes the Explore page throw while it draws, checks the message, opens another page, removes the cause and retries. The whole-window boundary is not tested. |
| MCP: every count below the minimum cell size returned as "<n"; minimum and maximum withheld unless `--show-extremes`; guide and docs corrected | `tests/mcp.test.ts` walks every tool result for count fields below 5, checks counts inside warnings, and confirms the plain numbers return with a cell size of 1 |

Not done: the chain has no secret key, so it does not prove who wrote a record, and a consistent rewrite is caught only by an anchor. Backups are still not encrypted. Chart sidecars still come from the renderer. The MCP server has no defence against differencing and passes free text through. The packaged build was not re-run for this work.

## Remaining work

1. Run the NSIS install wizard by hand on Windows 10/11, then import, save, export and reopen through the UI. CI already runs the unit tests and the packaged `--self-test` on Windows.
2. Build and smoke-test installers that include the unreleased work, then tag a release.
3. Obtain signing credentials and notarise or sign (see [SIGNING.md](SIGNING.md)).
4. Curator decisions recorded in the local workbook notes (see [WORKBOOK_SEMANTICS.md](WORKBOOK_SEMANTICS.md)):
   - the sample-warning colour mismatch;
   - column-group naming;
   - header alias inconsistencies;
   - "Score" / "Total Score";
   - units and definitions.

