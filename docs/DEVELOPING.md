# Developer guide

## Stack

Electron 44, React 19, TypeScript 5.9 and Vite 7, built with `electron-vite`. Other libraries:

- **SQLite:** Node's built-in `node:sqlite`, so there are no native modules to rebuild.
- **Charts:** ECharts 6 with the SVG renderer.
- **UI:** Radix (dialog, popover), TanStack Virtual, Zustand, lucide icons.
- **Data handling:** `fflate` for ZIP, `fast-xml-parser` for OOXML, `papaparse` for CSV, `zod` for IPC validation.
- **MCP server:** `@modelcontextprotocol/sdk`, bundled into one file by `vite.mcp.config.ts`.
- **Tests:** Vitest and Playwright.

Every runtime library is a devDependency that gets **bundled**, so the packaged app ships no `node_modules`. Licences are MIT, Apache-2.0 or ISC (checked with `npm view <pkg> license`).

`npm audit` reports eight moderate advisories. All are in the electron-builder build-time chain (`global-agent` → `sprintf-js`), and none are in shipped code.

Why the XLSX reader is written in-house: SheetJS Community Edition does not read styles. ExcelJS does not read threaded comments or resolve theme colours and tints, and it is lightly maintained. The reader in `src/importer/ooxml.ts` is about 400 lines over `fflate` and `fast-xml-parser`, and it is covered by fixtures written with openpyxl.

## Layout

```
src/core/       pure TS: types, value classification, stats and inference, selection engine, chart data,
                transforms, PCA and correlation matrix, analysis log (provenance), CSV, context export
src/importer/   OOXML reader, CSV reader, legend decoder, import model + validation
src/main/       Electron main: security, IPC, SQLite (migrations), projects, import, snapshot, curation,
                saved views, export, backup/restore, --self-test
src/preload/    sandboxed preload exposing window.bari.invoke (allow-listed channels only)
src/shared/     IPC channel list and zod schemas
src/renderer/   React UI (design tokens in styles.css)
src/mcp/        read-only MCP server for AI assistants (see MCP.md); built separately with vite.mcp.config.ts
tests/          Vitest unit + integration; tests/reference = opt-in real-workbook check
e2e/            Playwright Electron tests (UI workflow, chart downloads, tour and wide table, screenshots)
tools/          lab-release.mjs (builds the lab-server download folder), check-fuses.mjs (CI);
                make_fixtures.py (synthetic fixtures via openpyxl); stats_reference.R and
                multivariate_reference.R (R reference values for the tests); dev only
build/          icon, entitlements
```

**Single selection engine.** `src/core/selection.ts` (`computeSelection`) is the only code that decides which rows and observations are included. The table, charts, summaries and export all call it. The main process recomputes exports from the spec instead of trusting renderer data.

**Data model.** The schema is in `src/main/db/migrations.ts`.

- Imports are immutable: triggers block `UPDATE` and `DELETE` on cells, variables and dataset versions.
- Curation is an append-only `revision` table, and the "metadata version" is its maximum id. Snapshots can be rebuilt as of any revision (`buildSnapshot(project, versionId, asOf)`).
- A long-form `observation` view sits over the preserved wide `cell` table.
- Placeholders exist for specimen, batch, replicate, detection limit, units and exposure (`observation_context`). They are intentionally empty.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run with hot reload |
| `npm run typecheck` | TypeScript |
| `npm test` | Vitest (149 tests): stats against hand-computed and R values, PCA and correlation matrix, transforms, analysis log, chart export, values, colours, CSV, importer fixtures, full service workflow, MCP server, lab-release script |
| `npm run test:reference` | Real-workbook reconciliation (needs `BARI_REFERENCE_XLSX=/path/to/workbook.xlsx`). Expected counts are read from `tests/reference/expected.local.json` (git-ignored; override with `BARI_REFERENCE_EXPECT`). Without that file only structural checks run. Prints counts only. Never commit its output. |
| `npm run e2e` | Builds, then runs Playwright: the full UI workflow (import → filter → save → restart → reproduce → export → backup → restore, with no network requests attempted), chart SVG/PNG downloads with sidecars, PCA and many-measures views, the tour and wide table, and screenshots of every screen in light and dark mode |
| `npm run build:mcp` | Builds the MCP server into `out/mcp/server.js` (one file, plain Node 22.13+). See [MCP.md](MCP.md). |
| `npm run fixtures` | Regenerates the synthetic fixtures (needs Python 3 and openpyxl) |
| `Rscript tools/stats_reference.R tests/fixtures/stats_reference.json` | Regenerates the R 4.x reference values for `tests/inference.test.ts` (needs R with jsonlite and car) |
| `Rscript tools/multivariate_reference.R tests/fixtures/multivariate_reference.json` | Regenerates the R reference values for `tests/pca.test.ts` and `tests/matrix.test.ts` (base R and jsonlite) |
| `npm run dist:mac` | Unsigned universal DMG (Apple Silicon and Intel): `release/BARI-CNS-Research-Workspace-<version>-mac.dmg` |
| `npm run dist:win` | Unsigned NSIS x64 installer, which cross-builds from macOS: `release/BARI-CNS-Research-Workspace-<version>-windows-setup.exe` |
| `npm run release:lab -- --out <folder>` | Copies those installers into the lab-server download folder with checksums and a download page. See [LAB_SERVER.md](LAB_SERVER.md). |

**Smoke-test a packaged build:**

```bash
"release/mac-universal/BARI-CNS Research Workspace.app/Contents/MacOS/BARI-CNS Research Workspace" --self-test /tmp
```

It writes `/tmp/bari-self-test.json` and exits with 0 on success. On Windows, run `"BARI-CNS Research Workspace.exe" --self-test C:\some\folder`. CI (`.github/workflows/build.yml`, GitHub only) runs it on the app installed from the real DMG and setup file, on both platforms, and checks the security fuses with `tools/check-fuses.mjs`. Under Rosetta, `arch -x86_64 "…/BARI-CNS Research Workspace" --self-test /tmp` checks the Intel half of the universal app.

Playwright cannot drive a packaged build, because the `EnableNodeCliInspectArguments` fuse is disabled for security. That is why the packaged smoke test uses `--self-test`. It includes loading the real renderer in a hidden window through the real IPC bridge.

## Security model

- The renderer runs with `sandbox`, `contextIsolation` and no `nodeIntegration`. It is served from a custom `app://` protocol with a strict CSP: `connect-src 'none'`, and no remote scripts.
- Navigation, new windows and webviews are denied. Every permission is denied except writing text to the clipboard.
- `session.webRequest` cancels any request that is not `app:`, `data:`, `blob:` or `devtools:`, and logs it (`app:networkLog`; E2E asserts the log is empty).
- IPC is limited to one allow-listed `invoke` channel set. Each payload is validated with zod in the main process, and only the main window's main frame is accepted.
- File paths come only from native dialogs in the main process. The renderer gets opaque tokens.
- Fuses: RunAsNode off, NODE_OPTIONS off, inspect off, ASAR integrity on, only-load-from-ASAR on, file-protocol privileges off.
- Workbook text and comments are parsed as data and never interpreted as instructions. XML parts containing a DOCTYPE are rejected, and ZIP expansion is size-bounded.

## Study-specific material stays local

Notes about a real study workbook (collaborator names, file names, participant references, counts) belong in `docs/private/` and expected counts in `tests/reference/expected.local.json`; both are git-ignored. The expectations file accepts `sheet`, `participants`, `rows`, `columns`, `measures`, `events`, `blankColumns`, `comments`, `richHeaders`, `flagCounts` and `aliasInconsistent`, all optional.

## Testing notes

- **Expected statistics are independent.** `tests/stats.test.ts` uses hand-computed values. `tests/inference.test.ts` compares every distribution, test, CI and regression output with base R / car (`t.test`, `wilcox.test`, `oneway.test`, `kruskal.test`, `leveneTest`, `cor.test`, `lm`, `predict`, `shapiro.test`, `p.adjust`) to 1e-8 relative or better (Shapiro–Wilk: 1e-6, matching R's single-precision coefficients).
- **Multivariate results** (`tests/pca.test.ts`, `tests/matrix.test.ts`) match R `prcomp(scale. = TRUE)` and `cor(use = "pairwise.complete.obs")` to about 1e-8, with ties and missing values. Histogram counts match R `hist(right = FALSE)`.
- **Analysis log** (`tests/provenance.test.ts`): the text is deterministic, every upstream change alters the chain signature, and no participant ID or file name is written. SHA-256 is checked against NIST vectors.
- **Statistics code:** `src/core/distributions.ts` (t, F, χ², normal, binomial via incomplete beta and gamma) and `src/core/analysis.ts`. Statistics are never computed automatically; the UI calls them only after **Compute**.
- **Fixtures are synthetic** (`DEMO-xx`, `9001…9005`). `demo_workbook.xlsx` is also bundled with the app as the demo, and as the self-test input.
- **Test-only environment variable:** `BARI_USER_DATA` points the app at an isolated settings folder. It does not affect project data.

## Packaging and signing

See [SIGNING.md](SIGNING.md). Without credentials, the macOS builds are ad-hoc signed by electron-builder's fuse step, and the Windows build is unsigned.
