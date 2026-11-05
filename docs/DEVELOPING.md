# Developer guide

## Stack

Electron 44, React 19, TypeScript 5.9 and Vite 7, built with `electron-vite`. Other libraries:

- **SQLite:** Node's built-in `node:sqlite`, so there are no native modules to rebuild.
- **Charts:** ECharts 6 with the SVG renderer.
- **UI:** Radix (dialog, popover), TanStack Virtual, Zustand, lucide icons.
- **Data handling:** `fflate` for ZIP, `fast-xml-parser` for OOXML, `papaparse` for CSV, `zod` for IPC validation.
- **Tests:** Vitest and Playwright.

Every runtime library is a devDependency that gets **bundled**, so the packaged app ships no `node_modules`. Licences are MIT, Apache-2.0 or ISC (checked with `npm view <pkg> license`).

`npm audit` reports eight moderate advisories. All are in the electron-builder build-time chain (`global-agent` → `sprintf-js`), and none are in shipped code.

Why the XLSX reader is written in-house: SheetJS Community Edition does not read styles. ExcelJS does not read threaded comments or resolve theme colours and tints, and it is lightly maintained. The reader in `src/importer/ooxml.ts` is about 400 lines over `fflate` and `fast-xml-parser`, and it is covered by fixtures written with openpyxl.

## Layout

```
src/core/       pure TS: types, value classification, stats, selection engine, chart data, CSV, context export
src/importer/   OOXML reader, CSV reader, legend decoder, import model + validation
src/main/       Electron main: security, IPC, SQLite (migrations), projects, import, snapshot, curation,
                saved views, export, backup/restore, --self-test
src/preload/    sandboxed preload exposing window.bari.invoke (allow-listed channels only)
src/shared/     IPC channel list and zod schemas
src/renderer/   React UI (design tokens in styles.css)
src/mcp/        read-only MCP server for AI assistants (see MCP.md); built separately with vite.mcp.config.ts
tests/          Vitest unit + integration; tests/reference = opt-in real-workbook check
e2e/            Playwright Electron tests (UI workflow, screenshots)
tools/          make_fixtures.py (synthetic fixtures via openpyxl; dev only)
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
| `npm test` | Vitest: stats against hand-computed values, values, colours, CSV, importer fixtures, full service workflow |
| `npm run test:reference` | Real-workbook reconciliation (needs `BARI_REFERENCE_XLSX=/path/to/workbook.xlsx`). Expected counts are read from `tests/reference/expected.local.json` (git-ignored; override with `BARI_REFERENCE_EXPECT`). Without that file only structural checks run. Prints counts only. Never commit its output. |
| `npm run e2e` | Builds, then runs Playwright: the full UI workflow (import → filter → save → restart → reproduce → export → backup → restore, with no network requests attempted) and screenshots of every screen in light and dark mode |
| `npm run build:mcp` | Builds the MCP server into `out/mcp/server.js` (one file, plain Node 22.13+). See [MCP.md](MCP.md). |
| `npm run fixtures` | Regenerates the synthetic fixtures (needs Python 3 and openpyxl) |
| `Rscript tools/stats_reference.R tests/fixtures/stats_reference.json` | Regenerates the R 4.x reference values for `tests/inference.test.ts` (needs R with jsonlite and car) |
| `npm run dist:mac` | Unsigned DMG and ZIP for arm64 and x64 in `release/` |
| `npm run dist:win` | Unsigned NSIS x64 installer, which cross-builds from macOS |

**Smoke-test a packaged build:**

```bash
"release/mac-arm64/BARI-CNS Research Workspace.app/Contents/MacOS/BARI-CNS Research Workspace" --self-test /tmp
```

It writes `/tmp/bari-self-test.json` and exits with 0 on success. On Windows, run `"BARI-CNS Research Workspace.exe" --self-test C:\some\folder`. CI (`.github/workflows/build.yml`) runs this on both platforms once the repository has a GitHub remote.

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
- **Statistics code:** `src/core/distributions.ts` (t, F, χ², normal, binomial via incomplete beta and gamma) and `src/core/analysis.ts`. Statistics are never computed automatically; the UI calls them only after **Compute**.
- **Fixtures are synthetic** (`DEMO-xx`, `9001…9005`). `demo_workbook.xlsx` is also bundled with the app as the demo, and as the self-test input.
- **Test-only environment variable:** `BARI_USER_DATA` points the app at an isolated settings folder. It does not affect project data.

## Packaging and signing

See [SIGNING.md](SIGNING.md). Without credentials, the macOS builds are ad-hoc signed by electron-builder's fuse step, and the Windows build is unsigned.
