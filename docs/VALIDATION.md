# Validation summary

Written 2026-11-19 for the unreleased source on `main`. This document brings together the evidence that the app does what it says, so that a statistician, a data manager or an institutional reviewer can check it without reading the code. It is a summary of tests that exist, with instructions to re-run them. It is **not** a regulatory validation, and no approval is claimed.

## What "validated" means here

| Claim | Evidence | Limits |
| --- | --- | --- |
| Statistics agree with R | Every statistic is compared with values produced by R scripts in `tools/`, to the tolerances below | On synthetic data. Agreement with R is not a judgement that a method suits a dataset. |
| One answer everywhere | Tests assert that the table, chart, summary and export contain the same rows | |
| Records cannot be altered unnoticed | Tests edit a project with another tool in seven ways; each fails verification | Detection, not prevention; see [THREAT_MODEL.md](THREAT_MODEL.md) |
| Nothing leaves the computer | The UI tests assert that no network request was attempted | The test machine itself was online |
| An installed build works | `--self-test` on the packaged app, run in CI on macOS and Windows | Not re-run by hand for the unreleased work |

## Re-running the evidence

All of this uses synthetic data only and needs no study file.

| Step | Command | Expected |
| --- | --- | --- |
| 1 | `npm install` | Completes |
| 2 | `npm run typecheck` | No output |
| 3 | `npm test` | 188 tests pass |
| 4 | `npm run e2e` | 10 tests pass |
| 5 | `npm run reference:check` (needs R 4.3.2 with jsonlite 2.0.0 and car 3.1.3) | "R reproduces all three reference files." |
| 6 | Packaged app with `--self-test <folder>` | Exit code 0 and `bari-self-test.json` with every step `ok` |

Steps 2, 3, 4 (macOS) and 6 run in CI for every pull request, and step 5 runs when the R scripts or reference files change.

## Statistical methods

Each method is implemented in `src/core/` and compared with the R function named. Reference values are in `tests/fixtures/*_reference.json`, each of which records the R and package versions that produced it.

| Method | R reference | Agreement | Test |
| --- | --- | --- | --- |
| Mean, SD, quartiles (type 7), t-based CI of the mean | `mean`, `sd`, `quantile`, `t.test` | 1e-8 relative | `tests/stats.test.ts` (hand-computed), `tests/inference.test.ts` |
| Distribution-free CI of the median | Order-statistic method, binomial | 1e-8 | `tests/inference.test.ts` |
| Geometric mean with CI, skewness, excess kurtosis | Log-scale `t.test`; SPSS and Excel definitions | 1e-8 | `tests/inference.test.ts` |
| Shapiro–Wilk | `shapiro.test` | 1e-6 (R's own coefficients are single precision) | `tests/inference.test.ts` |
| Welch's t-test, Hedges' g | `t.test` | 1e-8 | `tests/inference.test.ts` |
| Mann–Whitney (exact and normal approximation), rank-biserial r, Hodges–Lehmann shift | `wilcox.test` | 1e-8 | `tests/inference.test.ts` |
| One-way and Welch ANOVA, Kruskal–Wallis, Brown–Forsythe | `oneway.test`, `kruskal.test`, `car::leveneTest(center = median)` | 1e-8 | `tests/inference.test.ts` |
| Holm adjustment | `p.adjust(method = "holm")` | 1e-8 | `tests/inference.test.ts` |
| Pearson, Spearman, Kendall τ-b | `cor.test` | 1e-8 | `tests/inference.test.ts` |
| Simple linear regression, confidence and prediction bands, Cook's distance | `lm`, `predict`, `cooks.distance` | 1e-8 | `tests/inference.test.ts` |
| PCA on standardised variables, biplot vectors | `prcomp(scale. = TRUE)`, `cor(X, pc$x)` | about 1e-8 | `tests/pca.test.ts` |
| Correlation matrix, pairwise complete | `cor(use = "pairwise.complete.obs")` | about 1e-8 | `tests/matrix.test.ts` |
| Histogram bins | `hist(right = FALSE)` | Exact counts | `tests/transforms.test.ts` |
| Box-Cox λ by maximum likelihood, transformed values | `optimize` on the same likelihood; `car::powerTransform`, `car::bcPower` | λ 1e-6 (1e-5 against car); log-likelihood 1e-9; values 1e-10 | `tests/transforms.test.ts` |

The CI check compares R's output on Linux with the values committed from macOS: 1e-9 relative for everything, except Box-Cox λ (1e-6) and values transformed with it (2e-5), which differ in the last digits between platforms.

Not validated because not built: paired tests, repeated-measures models, covariate adjustment, censoring-aware estimates, PERMANOVA.

## Requirements and their tests

| Requirement | Test |
| --- | --- |
| Missing is never zero; censored is never its bound | `tests/values.test.ts`, `tests/selection.test.ts`, `tests/guardrails.test.ts` (summaries use no bound) |
| Table, charts, summaries and exports include the same rows | `tests/workflow.test.ts`, `tests/selection.property.test.ts`, `e2e/workflow.spec.ts` |
| The selection engine follows its documented rules for any filter, visit choice and QC policy | `tests/selection.property.test.ts` (150 random datasets per rule, checked against an independent implementation) |
| Imports are immutable; a failed import leaves nothing behind | `tests/workflow.test.ts` |
| Curation is append-only and reproducible as of any revision | `tests/workflow.test.ts` |
| A saved view reproduces after restart, and after later curation | `tests/workflow.test.ts`, `e2e/workflow.spec.ts` |
| No test, interval or fit on repeated visits | `tests/guardrails.test.ts`, `e2e/guardrails.spec.ts` |
| Every distinct analysis is recorded once, recomputed by the main process | `tests/guardrails.test.ts` |
| Records altered outside the app fail verification | `tests/integrity.test.ts` |
| Every curation action is audited | `tests/integrity.test.ts` |
| Exports carry no participant identifier, file path or comment author unless chosen | `tests/workflow.test.ts`, `tests/provenance.test.ts` |
| Chart files are written from the selection, not from what the window sends | `tests/chartExport.test.ts` |
| An encrypted backup opens only with its passphrase; a changed byte is refused | `tests/workflow.test.ts`, `e2e/workflow.spec.ts` |
| Backup and restore do not change observations | `tests/workflow.test.ts`, the packaged self-test |
| The MCP server returns no identifier, no count below the cell size, and no extremes | `tests/mcp.test.ts` |
| No network request is attempted | `e2e/workflow.spec.ts`, `e2e/guardrails.spec.ts` |

## Known gaps in the evidence

- The packaged build and `npm run test:reference` (the real-workbook check, counts only) were last run before the 2026-11-19 work.
- The Windows install wizard has not been run by hand.
- The largest dataset tested is synthetic: 4,800 rows by 300 columns (`tests/performance.test.ts`). Calculations are fast at that size; importing takes about 7 seconds and loading about 3. Drawing at that size is not tested, and all computation runs in the window's own thread.
- The whole-window error boundary, and `--verify-project` on a packaged build, are untested.
- No accessibility audit.
- The censoring threshold (15%) is provisional and has not been set with a statistician.
- No second person has reviewed the statistical code.

## Review record

For the lab to fill in. Nothing here has been signed.

| Area | Reviewer | Date | Outcome |
| --- | --- | --- | --- |
| Statistical methods and tolerances | | | |
| Independence guard and censoring display | | | |
| Record integrity and backups | | | |
| MCP privacy rules | | | |
| IRB and data use agreement position on the MCP server | | | |
