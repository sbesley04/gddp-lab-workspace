# MCP server (AI assistant access)

The MCP server lets an AI assistant that supports the [Model Context Protocol](https://modelcontextprotocol.io), such as Claude Desktop, Claude Code, Cursor or Gemini CLI, explore a project. It reuses the app's own selection engine and R-validated statistics, so its numbers match what the app shows for the same selection.

## Before you connect it: where data goes

The server itself makes no network requests. **The assistant does:** every tool result is sent to the AI provider as part of the conversation. Only connect a project if your IRB approval, data use agreement and institutional policy allow aggregate study results to be shared with that provider.

What the server returns, and what it never returns:

| Returned | Never returned |
| --- | --- |
| Counts, descriptive statistics, test results, correlations, PCA variance and loadings | Participant identifiers, row numbers, individual values, PCA scores |
| Variable metadata, aliases, source attribution, comments on column headers | Text of comments on individual cells (counted only); comment and curator authors |
| Short text codes in numeric columns (e.g. `QNS`) and censored values (e.g. `<0.5`) | Free-text cell values (counted only) |

- **Small-cell suppression:** selections and groups with fewer than 5 participants are suppressed (`"<5"`). Change the threshold with `--min-cell-size`.
- **Quasi-identifiers:** minimum and maximum are withheld for variables marked as quasi-identifiers (age, BMI and similar).
- These rules reduce risk but are **not anonymisation**. Someone determined could combine overlapping filters to narrow down individuals. Treat the conversation as containing study data.
- **Read-only:** the server opens the database read-only, never takes the project lock and cannot change anything. It works while the app has the project open, and it picks up curation changes made in the app on the next call.
- **Access log:** every call is appended to `mcp-access.jsonl` in the project folder: tool name, arguments, success and result size, never results. Turn it off with `--no-access-log`.

## Build

```bash
npm run build:mcp
```

This writes one self-contained file, `out/mcp/server.js`. It needs Node.js 22.13 or later (for `node:sqlite`) and no `node_modules`.

## Connect

Use absolute paths. Desktop apps often cannot see a Node installed with nvm or Homebrew, so give the full path to `node` (run `which node`).

**Claude Desktop:** add this to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows), then restart Claude Desktop:

```json
{
  "mcpServers": {
    "bari-cns": {
      "command": "/usr/local/bin/node",
      "args": ["/path/to/bari-cns-workspace/out/mcp/server.js", "--project", "/path/to/My Study.bariproj"]
    }
  }
}
```

**Claude Code:**

```bash
claude mcp add bari-cns -- node /path/to/bari-cns-workspace/out/mcp/server.js --project "/path/to/My Study.bariproj"
```

**Inspect by hand:**

```bash
npx @modelcontextprotocol/inspector node out/mcp/server.js --project "/path/to/My Study.bariproj"
```

Options: `--project <dir>` (or the `BARI_PROJECT` environment variable), `--min-cell-size <n>` (default 5), `--no-access-log`.

## What the assistant gets

**Instructions**, sent when it connects: how the data is laid out, the rules for missing and censored values, QC policy, metadata status, privacy and reporting.

**Tools** (all read-only):

| Tool | Purpose |
| --- | --- |
| `get_study_overview` | Dataset versions, visits, variable groups, covariates, QC totals, open curation items, study context |
| `search_variables` | Fuzzy search by name, alias, group, unit or definition; returns the keys other tools take |
| `describe_variable` | Metadata with status and provenance, aliases, source attribution, header comments, per-visit counts and statistics |
| `cohort_counts` | What a selection keeps, per visit, and why rows were excluded |
| `summarize` | Descriptive statistics, optionally by group and transform |
| `compare_groups` | Welch t, Hedges g and Mann–Whitney (2 groups); Welch and classic ANOVA, Kruskal–Wallis and Holm-adjusted pairwise tests (3 or more groups) |
| `correlate` | Spearman, Pearson or Kendall with CI, plus an OLS fit |
| `correlation_matrix` | Pairwise-complete coefficients and the strongest pairs |
| `principal_components` | Variance explained, top loadings, dropped rows and which variables cause the gaps, group mean scores |
| `change_between_visits` | Within-participant change between two visits, paired by participant (descriptive) |
| `qc_overview` | QC flags by category and status, and the variables most affected |
| `list_saved_views` | Researchers' saved views; pass `savedView` to other tools to reuse a view's selection |

Every analysis tool takes the same selection fields: `datasetVersion`, `visits`, `where` (filters), `match`, `qcExclude`, or `savedView`. Every result includes a `selection` block (dataset version, metadata version, visits, filter, QC policy, n) so the analysis can be rebuilt in the app, and a `warnings` list. Warnings cover censoring, repeated visits per participant, covariates recorded at only one visit, complete-case losses and untransformable values.

**Resources:** `bari://guide` (how to read the data) and `bari://data-dictionary` (every variable, as CSV).

**Prompt:** `exploratory_analysis`, a step-by-step workflow for a research question.

## Limits

- Statistics are exploratory and not adjusted across a conversation. Paired significance tests, mixed models and covariate adjustment are not offered: they have not been validated against R yet.
- Only aggregate mode exists. A pseudonymous row-level mode, and writing saved views back to the app, are possible later additions.

## Development

The code is in `src/mcp/`: `workspace.ts` (read-only project and snapshot cache), `tools.ts` (tool logic and privacy rules), `guide.ts` (instructions, guide and prompt), `server.ts` (MCP registration) and `main.ts` (stdio entry point). `tests/mcp.test.ts` drives the server through an in-memory MCP client on synthetic data. It checks results against the core statistics, suppression, read-only access, and that no participant identifier appears in any output.
