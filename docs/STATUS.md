# Release status: 0.1.0 (first release)

Verified on 2026-10-22 on macOS 26.5 (Apple Silicon), Node 24.14, Electron 44.9.3.

| # | Acceptance criterion | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Import the supplied workbook; reconcile its participants, baseline rows and columns; keep the blank column out of the picker, with an explanation | **Pass** | `npm run test:reference` (importer model plus the full database path, with counts from a local expectations file). The UI import of the real workbook matched the expected participant, row, measure, blank-column and comment counts. |
| 2 | Formatting and comments preserved or marked unresolved; source and QC interpretations validated against the legend | **Pass** | Reference checks: exact target and combined QC colours, a sample-warning colour mismatch marked needs review, rich-text multi-source headers and alias inconsistencies, all matching the local expectations. Details are kept locally (see [WORKBOOK_SEMANTICS.md](WORKBOOK_SEMANTICS.md)). |
| 3 | Table, chart, summaries and export agree exactly | **Pass** | `tests/workflow.test.ts` (same rows and same n across distribution, grouped distribution, summary and export) and `e2e/workflow.spec.ts` (cohort count = table rows = export rows = manifest rows) |
| 4 | Filters, missing vs zero, numeric-looking IDs, ambiguous headers, duplicate keys, censored values, invalid log, no matching data | **Pass** | `tests/selection.test.ts`, `tests/importer.test.ts`, `tests/values.test.ts`, `tests/workflow.test.ts` on synthetic fixtures |
| 5 | Descriptive calculations against independent small fixtures | **Pass** | `tests/stats.test.ts`: hand-computed expected values, explained inline |
| 6 | Save a view, restart, reproduce against the same dataset version | **Pass** | Unit test (close and reopen the project, with curation made after the save) and E2E (relaunch the app, open as saved, same cohort) |
| 7 | Export and inspect a context package | **Pass** | Unit and E2E tests unzip the package and check the six files, SHA-256 checksums, pseudonymous keys, absence of source IDs, paths and comment authors, quasi-identifier blocking, and the baseline-only statement |
| 8 | Backup and restore without changing observations | **Pass** | Content hash equal after restore; a damaged backup is rejected and leaves nothing behind (unit, E2E, reference) |
| 9 | Core workflow without internet or API credentials | **Pass, with a caveat** | E2E asserts that no non-local request was attempted during the whole workflow. All requests are blocked by policy, and no credentials exist anywhere. The test machine itself was online. |
| 10 | Package and smoke-test on Windows and macOS | **macOS: pass. Windows: built, untested.** | macOS arm64 and x64 DMGs were mounted, the app copied out and `--self-test` run (import, view reproduce, export checksums, backup/restore, UI load). x64 ran under Rosetta. The Windows NSIS installer was cross-built but never run. All builds are unsigned. Signing steps are in [SIGNING.md](SIGNING.md). |

## Test inventory

- `npm test`: 53 Vitest tests.
- `npm run test:reference`: checks against the real workbook. This is opt-in and local only; expected counts live in a git-ignored file.
- `npm run e2e`: Playwright. The full UI workflow, plus screenshots of every screen in light and dark mode.
- `--self-test`: packaged-build smoke test.

## Remaining work for a complete multi-platform release

1. Run the NSIS installer on Windows 10/11: install, open, run `--self-test`, then import, save, export and reopen through the UI. The CI workflow does the self-test part once the repository has a GitHub remote.
2. Obtain signing credentials and notarise or sign (see [SIGNING.md](SIGNING.md)).
3. Curator decisions recorded in the local workbook notes (see [WORKBOOK_SEMANTICS.md](WORKBOOK_SEMANTICS.md)):
   - the sample-warning colour mismatch;
   - column-group naming;
   - header alias inconsistencies;
   - "Score" / "Total Score";
   - units and definitions.

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
