# Improvement strategy

Reviewed 2026-11-17 on branch `mcp-server` at `2f09d2e`. This document records what a code and documentation review found, and the order in which to fix it. [ROADMAP.md](ROADMAP.md) lists planned features; this document sets priorities across them.

**Verdict.** The engineering base is strong, but the app is not yet fit for institutional use. The gaps are statistical guardrails, tamper-evidence, MCP privacy and release discipline. The roadmap puts new features ahead of them.

## Progress

Updated 2026-11-19. Everything marked done is in the source, unreleased, and verified as [STATUS.md](STATUS.md) describes.

| Item | State | Notes |
| --- | --- | --- |
| Phase 0: ignore `.codex/` and `Claude outputs/`; fix the stale CI and doc comments (E6, E9 in part) | Done | `CLAUDE.md` and `AGENTS.md` are still kept in sync by hand. |
| Phase 0: settle the MCP connection (Q1) | **Open** | Needs the developer. The server was still connected to an assistant session on 2026-11-19; it was not called. |
| Phase 0: push and merge branches, tag a release (E5, E6 in part) | **Open** | Needs a decision on what the release contains. |
| S1 Independence guard | Done | `src/core/independence.ts`, used by the app and the MCP server. The app computes no test, interval or fit when a participant contributes more than one row, and offers each visit as a one-click fix. The descriptive many-measures views (correlation matrix, heatmap, PCA) are not blocked but say when visits are pooled. The MCP server still warns instead of refusing (Q6). |
| S2 Methods and caveat text | Done | Visit and participant wording is derived from the analysed rows. |
| S3 Censoring visibility | Done in part | Percent censored is shown per variable and group, with the direction of the bias. Means and SDs are marked above a threshold of 15%, which is **provisional** until Q4 is answered. Censoring-aware estimates remain Phase 3. |
| S4 Analysis register | Done | Append-only table; the main process recomputes each analysis. Shown in History and written to the context package. Analyses run through the MCP server or in R are not recorded. |
| S5 Neutral p-values | Done | No accent below .05. |
| S7 R in CI | Done locally; CI job not yet run | Each reference file records its R and package versions. `npm run reference:check` regenerates and compares them; the `r-reference` CI job does the same with pinned versions, and has not run yet because nothing has been pushed. |
| G4 Copy the database before migrating | Done | Brought forward from Phase 2, because the register adds a migration. |
| G1 Hash chain with a verify command | Done | `src/main/integrity.ts`. Every audit, revision and register row is chained as the app writes it. **Verify** in the sidebar, `--verify-project <folder>` on the command line, and a check on restore. Backups and exports record the chain head as an anchor. The chain has no secret key: a full, consistent rewrite is caught only by an anchor, and only reliably by one kept outside the project folder. Rows written before the chain existed are marked as entered after the fact. |
| G5 Audit every curation action | Done | Quasi-identifier flags, segment names and study context now write audit entries. |
| M1 MCP docs overstate the guarantee | Done | Minimum and maximum are withheld for every variable unless the server is started with `--show-extremes`. The guide and [MCP.md](MCP.md) say that a median or quartile can be one participant's value. |
| M2 Small counts not suppressed everywhere | Done | Every count below the minimum cell size is returned as "<n", including counts inside warnings. No complementary suppression: a small count can sometimes be derived from a total. |
| M3 Differencing, M4 free text | **Open**, now documented | No query budget or overlap check. Header comments, study context, saved-view names and the project name still pass through. |
| G2, G3, G6, E5 (rest of Phase 2) | **Open** | Full fingerprints and renaming "signature"; encrypted backups; recomputing chart sidecars in the main process; signing. Then the validation pack and threat model. |

Phase 2's first "done when" condition is met and tested: a tampered database fails verification (`tests/integrity.test.ts`, seven kinds of tampering). "MCP.md matches what the code returns" is met for M1 and M2.

Phase 1's first "done when" condition is met and tested: a multi-visit fixture cannot produce a test (`tests/guardrails.test.ts`, `e2e/guardrails.spec.ts`). The second is met locally and awaits its first CI run.

## What was checked

| Area | How |
| --- | --- |
| Docs and plans | Read in full: README, every file in `docs/` except `docs/private/`, and the local infrastructure plan (not in the repository) |
| Core engine | Read: types, value classification, selection, statistics and inference, transforms, chart data, analysis log, context export |
| Main process | Read: IPC and security, migrations, project and lock, snapshot, import, curation, backup, export |
| MCP server | Read: tools, workspace, entry point, server registration |
| Renderer | Read the statistics panel; searched the rest for independence warnings, accessibility markers and error handling |
| Baseline | `npm run typecheck` clean; `npm test` 153 of 153 passed |

Not done: `npm run e2e`, a packaged build, `npm run test:reference`, and any query against a real project. Findings marked "by reading" were not reproduced with a failing test.

## Check first: MCP connection to a study project

A local assistant configuration (`.codex/config.toml`, untracked) points the MCP server at a project folder outside the repository, and the same server was connected to the review session. [STATUS.md](STATUS.md) says the server has not been run against the real project and that this needs an IRB/DUA decision.

The review did not call the server and did not check what the folder holds. If it holds real study data, disconnect the server from every assistant until the decision is made.

## What is already strong

- One selection engine (`computeSelection`) behind the table, charts, summaries, exports and MCP.
- Immutable imports, append-only curation, saved views pinned to dataset and metadata versions.
- Statistics validated against R to about 1e-8.
- A tight Electron security model: sandbox, strict CSP, fuses, blocked network, validated IPC.
- Documentation that is honest about what is untested.

## Findings

### Statistical validity

| # | Gap | Where | Basis |
| --- | --- | --- | --- |
| S1 | **Repeated visits are pooled silently.** The app defaults to all visits and runs Welch, Mann–Whitney and correlation tests on rows, with no independence check. The MCP server warns about this (`repeatedWarning`); the app does not. | `src/renderer/src/store.ts` (default `visitIds: 'all'`), `src/renderer/src/components/StatsPanel.tsx`, `src/mcp/tools.ts` | By reading |
| S2 | **Methods and caveat text are wrong for multi-visit data.** The scatter methods text says "only participants with numeric values" where n is rows. The caveats hard-code "baseline observations". | `StatsPanel.tsx` (`Caveats`, `methods`) | By reading |
| S3 | **Censored values are dropped from every statistic.** For assays with detection limits this biases means upward. The app shows only a count. The MCP server states the bias; the app does not. `observation_context.detection_limit` is an empty placeholder. | `src/core/chartData.ts`, `src/core/stats.ts` | By reading |
| S4 | **Computed statistics are never recorded.** The analysis log notes only that the panel was opened. Nobody can count how many tests were run in a project. | `src/core/provenance.ts` (`statistics` step) | By reading |
| S5 | **p < .05 is highlighted** with an accent badge, which encourages reading exploratory results as findings. | `StatsPanel.tsx` (`Pv`) | By reading |
| S6 | **The analysis log is not runnable**, by design. A reader cannot re-run it to confirm the app's numbers. | `src/core/provenance.ts` | Documented |
| S7 | **CI never runs R.** The reference JSON files are committed, with no R or package versions recorded in them. Drift between the R scripts and the fixtures would go unnoticed. | `.github/workflows/build.yml`, `tools/*.R` | By reading |

S1 and S2 are not triggered by a single-visit workbook. They apply as soon as a second visit is imported.

### Integrity and governance

| # | Gap | Where | Basis |
| --- | --- | --- | --- |
| G1 | **The audit trail is not tamper-evident.** Immutability is enforced by SQLite triggers, which any SQLite tool can drop. There is no hash chain over `audit_log` or `revision`. | `src/main/db/migrations.ts` | By reading |
| G2 | **The "signature" is a fingerprint.** It is the first 8 hex characters (32 bits) of an unkeyed SHA-256 chain. It identifies a chart's inputs; it does not prove who made it, and 32 bits is weak against collision. | `src/core/provenance.ts` | By reading |
| G3 | **No encryption at rest.** Backups are plain ZIP files that hold source identifiers and the pseudonym secret. | `src/main/project.ts`, `src/main/backup.ts` | Documented in part |
| G4 | **Migrations run in place on open**, with no automatic backup first. | `src/main/project.ts`, `src/main/db/db.ts` | By reading |
| G5 | **Three curation actions skip the audit log:** quasi-identifier flag, segment name, study context. They still write revisions. | `src/main/curation.ts` | By reading |
| G6 | **Chart export trusts the renderer.** The SVG, the sidecars and the signature all come from the renderer and are written as received. This is the one exception to "the main process recomputes exports". | `src/main/exportService.ts` (`writeChartFiles`) | By reading |
| G7 | **Author labels are free text.** Already documented; it limits what any audit trail can prove. | [LIMITATIONS.md](LIMITATIONS.md) | Documented |
| G8 | **`node:sqlite` is experimental.** The test run prints Node's warning. The storage layer depends on an API that may change. | `src/main/db/db.ts` | Observed |

### MCP privacy

| # | Gap | Where | Basis |
| --- | --- | --- | --- |
| M1 | **The docs overstate the guarantee.** [MCP.md](MCP.md) says individual values are never returned. Minimum and maximum are returned for any variable not marked as a quasi-identifier, and a median at n = 5 is one participant's value. | `src/mcp/tools.ts` (`descriptive`) | By reading |
| M2 | **Small counts are not suppressed everywhere.** Exclusion reasons, not-analysed counts, text-code and censored-value counts, pair counts and dropped-row counts are returned as they are. | `src/mcp/tools.ts` (`cohortCounts`, `textCodes`, `usableNumbers`, `correlate`, `principalComponents`) | By reading |
| M3 | **No defence against differencing.** Sliding range filters over groups of five or more can isolate individuals. There is no query budget and no overlap check. | `src/mcp/tools.ts` | Documented in part |
| M4 | **Free text passes through:** header comments, study context, saved-view names and descriptions, and the project name. | `src/mcp/tools.ts` | By reading |

### Engineering and sustainability

| # | Gap |
| --- | --- |
| E1 | No lint or format configuration and no coverage measurement. |
| E2 | No React error boundary: a render exception blanks the window. |
| E3 | All computation runs on the UI thread. The full snapshot crosses IPC and the flag index uses string keys, so large cohorts are untested. |
| E4 | E2E does not run in CI. CI covers typecheck, unit tests and the packaged self-test. |
| E5 | Installers are unsigned. Three batches of features have had no release since 0.3.1. |
| E6 | `mcp-server` is 3 commits ahead of its remote, and local `main` is behind `origin/main`. The CI file header and [DEVELOPING.md](DEVELOPING.md) still say the repository has no remote. |
| E7 | The package is `UNLICENSED`. There is no changelog, citation file, security policy or second maintainer. |
| E8 | QC category labels are hard-coded to one assay vendor (`src/core/types.ts`). Another lab's workbook imports with everything "unresolved". |
| E9 | `.codex/` and `Claude outputs/` are untracked and not git-ignored. `CLAUDE.md` and `AGENTS.md` are duplicates kept in sync by hand. |
| E10 | No accessibility audit. ARIA attributes exist, but keyboard and screen-reader use is unverified. |

## The existing plans

**[ROADMAP.md](ROADMAP.md)** has the right ideas in the wrong order.

- Statistician-approved templates (item 2) depend on censoring and independence handling, which are not listed.
- REDCap by API (item 3) conflicts with the fully-offline goal. Start with file import of the REDCap export and data dictionary. Treat the API as a later, explicit opt-in.
- The bring-your-own-key AI connector (item 4) is the lowest value and the highest governance risk. Park it until Phase 2 is complete and the MCP decision is made.
- Multi-user operation (item 7) is correctly last. A reviewer sign-off on saved views, inside the single-writer model, is a useful interim step.

**The local infrastructure plan** (NAS migration and lab server; not in the repository) is sound and suitably cautious. Its two gating decisions, IRB/DUA and university IT, gate this strategy too. Its "reproducible test environment" role should become the pinned R environment that CI uses (S7).

**[STATUS.md](STATUS.md) "Remaining work":** all four items are still open (Windows install wizard, a release with the unreleased work, signing, curator decisions).

## Strategy

| Phase | Work | Addresses | Done when |
| --- | --- | --- | --- |
| **0. Hygiene** (days) | Settle the MCP connection. Push and merge branches. Fix the stale CI and doc comments. Ignore `.codex/` and `Claude outputs/`. Tag a release that contains the unreleased work. | E5, E6, E9 | `main`, the installers and the docs describe the same version. |
| **1. Statistical guardrails** (2–4 weeks) | Independence guard shared by the app and MCP. Correct methods and caveat text. Show percent censored per group, and warn on mean-based statistics above a threshold. An analysis register that stores every computed result and counts tests. Neutral p-value display. Pin R, record versions, and regenerate the references in CI. | S1–S5, S7 | A multi-visit fixture cannot produce an unwarned test. CI fails if R disagrees with the fixtures. |
| **2. Integrity and security** (4–8 weeks) | Hash-chain the audit log and revisions, with a verify command. Store full fingerprints and rename "signature". Back up before migrating. Encrypt backups. Audit every curation action. Recompute chart sidecars in the main process. Harden MCP: suppress all small counts, withhold extremes by default, correct the docs. Sign and notarise builds. Write a validation pack and a threat model. | G1–G6, M1–M4, E5 | A tampered database fails verification. Installers open without warnings. [MCP.md](MCP.md) matches what the code returns. |
| **3. Longitudinal and approved methods** (2–3 months) | Paired tests, change from baseline, trajectory charts. Censoring-aware summaries. Covariate adjustment. Each validated against statistician-provided cases. | S3, S6, roadmap items 1, 2, 8 | A statistician signs off each method before it ships. |
| **4. Interoperability** | Configurable legend profiles. REDCap file import. Units and ontology identifiers. Dataset-version comparison. | E8, roadmap items 3, 5 | A second lab's workbook imports with resolved formatting. |
| **5. Multi-user** | Only after the phases above. Interim: reviewer sign-off on saved views. | G7, roadmap item 7 | Separate design document. |

**Alongside every phase:** lint and coverage (E1); E2E in CI (E4); property tests for the importer and the selection engine; an error boundary (E2); a worker for heavy computation and a large synthetic fixture as a performance budget (E3); an accessibility audit (E10); a licence, changelog, citation file and a second maintainer (E7); a contingency for `node:sqlite` (G8).

### Phase 1 in more detail

Phase 1 is first after hygiene because it protects the conclusions researchers draw today.

1. **Independence guard.** Move the repeated-visits check out of `src/mcp/tools.ts` into `src/core/`, so the app and the MCP server share it. In the app, block or clearly warn when a test is requested and any participant contributes more than one row. Offer "restrict to one visit" as the fix.
2. **Text corrections.** Derive "baseline" and "participants" wording from the selection, not from fixed strings.
3. **Censoring visibility.** Report the percent censored per variable and group next to every summary. Above a threshold (to be set with a statistician), mark means and SDs as biased and prefer medians and detection rates. No substitution, in line with "censored ≠ its bound".
4. **Analysis register.** When Compute is pressed, the main process records the selection fingerprint, method, n and results. The register is append-only, shown in History, exported with the context package, and gives a running count of tests per project.
5. **R in CI.** A pinned R environment regenerates the three reference JSON files and fails on any difference. Each file records the R and package versions.

## A decision that shapes Phase 3

**Recommendation: make R the engine of record for anything beyond the current simple tests.** The app generates a runnable R script and exports the data it needs. CI proves the script reproduces the app's numbers on synthetic data.

| Option | For | Against |
| --- | --- | --- |
| R as engine of record | Small validation burden; methods are the ones statisticians already trust; also closes S6 | Users need R installed for those methods; the app must detect it and explain |
| Re-implement in TypeScript | Works with nothing else installed | Mixed models and censored-data methods are large; each needs its own validation against R |

The simple tests already in `src/core/analysis.ts` stay as they are.

## What this strategy does not propose

- No change to the offline rule, the single selection engine, or immutability.
- No AI connector inside the app until the governance questions are answered.
- No multi-user work before Phases 1 and 2.
- No new statistical method without R reference values, as today.

## Open questions

| # | Question | Owner |
| --- | --- | --- |
| Q1 | Does the project folder the MCP server points at hold real study data? | Developer |
| Q2 | May aggregate results reach an AI provider (IRB/DUA)? | PI |
| Q3 | R as engine of record, or in-app methods, for Phase 3? | PI and statistician |
| Q4 | What censoring threshold should mark mean-based statistics as biased? The app uses a provisional 15% (`CENSORING_BIAS_THRESHOLD` in `src/core/censoring.ts`) until this is answered. | Statistician |
| Q5 | Which licence, and who is the second maintainer? | PI |
| Q6 | Should the MCP server refuse tests on repeated visits, as the app now does, instead of warning? | PI and statistician |
| Q7 | Should the register count assumption checks (Shapiro–Wilk, Brown–Forsythe) with the other p-values, as it does now? | Statistician |
