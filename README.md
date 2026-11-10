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

Projects are protected only by your computer's own login and disk encryption; they are not encrypted by the app. See [docs/LIMITATIONS.md](docs/LIMITATIONS.md) for what the app does not do.

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
| [WORKBOOK_SEMANTICS.md](docs/WORKBOOK_SEMANTICS.md) | How to document a study workbook (details stay local) |
| [SIGNING.md](docs/SIGNING.md) | Code signing, if the lab gets certificates |

## Versions

- **0.3.1** (2026-10-26) is the current installer.
- The source code already contains more, not yet in an installer: the analysis log, chart downloads, covariates and colour-by, display transforms, histograms, correlation matrix, heatmap, PCA, the MCP server, and a single Mac installer for all Macs. [docs/STATUS.md](docs/STATUS.md) lists each feature and how it was tested.

## Building from source (maintainers)

Needs Node.js 22.13 or newer. Clone the repository to a **local** disk (building on a network share is slow and can fail).

```bash
npm install
```

```bash
npm run dev
```

Installers and publishing them to the lab server: [docs/LAB_SERVER.md](docs/LAB_SERVER.md). Everything else: [docs/DEVELOPING.md](docs/DEVELOPING.md).
