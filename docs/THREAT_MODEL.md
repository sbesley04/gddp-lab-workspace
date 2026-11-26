# Threat model

Written 2026-11-19 for the unreleased source on `main`. It records what the app defends against, how, and what it leaves to the lab. It is a working document for developers and for anyone reviewing the app before institutional use. It is not a compliance statement.

## What is protected

| Asset | Where it lives | Why it matters |
| --- | --- | --- |
| Imported study data, with participant identifiers | `workspace.sqlite` and `sources/` in the project folder | Identifiable research data |
| Pseudonym secret | `meta` table in `workspace.sqlite` | Links pseudonymous export keys back to participants |
| Curation history, audit log, analysis register | `workspace.sqlite` | The record of who decided what, and how many tests were run |
| Backups | Wherever the researcher saves them | A complete copy of everything above |
| Export packages and saved charts | Wherever the researcher saves them | Selected data, pseudonymous by default |
| MCP results | The AI provider's systems, once an assistant is connected | Aggregate study results outside the lab |

## Who and what is trusted

| Party | Trust |
| --- | --- |
| The researcher at the keyboard | Trusted. They can see all data in a project they can open. |
| The main process | Trusted. It owns the database, the file system and every export. |
| The renderer (the window) | Not trusted with files or records. It is sandboxed, has no Node access, and can call only allow-listed IPC channels with validated payloads. |
| An imported workbook | Not trusted. Its text is data, never instructions or code. |
| Other software running as the same user | Not defended against. It can read the project folder. |
| An AI assistant connected through the MCP server | Not trusted with row-level data. It receives aggregates only. |
| The AI provider | Outside the lab. Whether results may go there is an IRB and data use agreement decision. |

## Threats and what is done about them

| # | Threat | Defence | What remains |
| --- | --- | --- | --- |
| T1 | **A hostile or malformed workbook**: XML entity attacks, a ZIP that expands without limit, formulas that run when an export is opened in Excel | XML with a DOCTYPE is rejected. ZIP expansion is size-bounded, and files over 200 MB are refused. Text cells in exported CSV that start with `=`, `+`, `-`, `@`, tab or CR are prefixed with an apostrophe. | The in-house reader is tested on fixtures, not fuzzed. |
| T2 | **Text in a workbook that tries to instruct an AI assistant** (comments, headers) | Comments are stored and shown as data. The MCP guide is fixed text that workbook content cannot change, and cell comments are only counted. | Header comments and the study context are returned to the assistant as written. An assistant can still be misled by them. |
| T3 | **A compromised renderer** (for example a rendering bug exploited by crafted content) | Sandbox, context isolation, strict CSP with `connect-src 'none'`, no navigation or new windows, permissions denied. IPC accepted only from the main window's main frame, with every payload validated. File paths never reach the renderer. The main process recomputes exports, the analysis register and chart sidecars from the selection; it does not store numbers or logs sent by the renderer. | The drawn chart image comes from the renderer. A footer fingerprint that does not match the main process's own is refused, but the pixels are not checked. A compromised renderer can read the project data it is shown. |
| T4 | **Data leaving by network** | The main process cancels every request that is not `app:`, `data:`, `blob:` or `devtools:`. No telemetry, update check, account or API key exists. E2E asserts that nothing was attempted. | The MCP server is a separate program; what the assistant does with its results is outside the app. |
| T5 | **Someone edits the records with another tool** (to change a curation decision, hide an exclusion, or remove a test from the register) | Triggers block updates and deletes. Every audit, revision and register row is hash-chained when written. **Verify** and `--verify-project` report changed, removed and added rows and missing triggers. Backup and export manifests record the chain head. | The chain has no secret key. A full, consistent rewrite is caught only by a chain head recorded elsewhere, and only reliably if that copy is outside the project folder. Detection, not prevention. Imported cells are covered by the content hash in backups, not by the chain. |
| T6 | **False attribution** (an entry recorded under someone else's label) | None. | Author labels are free text. The records show what was done and when, not reliably by whom. Fixing this needs authenticated users, which is Phase 5. |
| T7 | **A lost or stolen computer or disk** | The app relies on operating-system disk encryption (FileVault, BitLocker). | Project folders are not encrypted by the app. |
| T8 | **A backup that reaches the wrong person** | Backups can be encrypted with a passphrase (AES-256-GCM, key from scrypt). The app offers this first. | Encryption is optional, the passphrase strength is the researcher's, and there is no recovery if it is lost. Unencrypted backups are plain ZIP files. |
| T9 | **Re-identification from an export package** | Participant keys are pseudonymous by default (keyed HMAC, secret never exported). Quasi-identifiers need explicit confirmation. Comment authors, file paths and unselected columns are never exported. | Pseudonymisation is not anonymisation. Row-level data is exported by design. |
| T10 | **Re-identification through the MCP server** | Aggregates only. Groups under the minimum cell size are suppressed, every smaller count is returned as "<n", and minimum and maximum are withheld. Calls are logged, never results. | No defence against differencing (overlapping filters, subtracting counts). A median or quartile can equal one participant's value. Free text passes through. |
| T11 | **A tampered or fake installer** | Electron fuses disable RunAsNode, `NODE_OPTIONS` and the inspector. ASAR integrity is on. | Installers are unsigned, so the operating system cannot confirm who built them. Distribute them through a channel the lab controls. |
| T12 | **A compromised dependency** | Exact versions are pinned, all libraries are bundled at build time, and the packaged app ships no `node_modules`. The app has no network access to exfiltrate with. | Dependencies are not audited beyond `npm audit`. A malicious build-time dependency could alter the app. |
| T13 | **Accidental damage**: two writers, a sync client, a failed upgrade, a bug while drawing | A lock file allows one writer. Sync and network folders trigger a warning. The database is copied before a schema migration. Imports are one transaction. Backups are checksummed and verified on restore. A drawing failure shows a message instead of a blank window. | The lock is advisory. A sync client can still corrupt a live database if the warning is ignored. |
| T14 | **Statistical misuse**: testing pooled repeated visits, reading exploratory p-values as findings, uncounted tests | The independence guard blocks tests on repeated visits. p-values are shown without emphasis. Every distinct analysis is registered and counted. Censoring is shown beside summaries. | The register does not see analyses run in R or through the MCP server. The censoring threshold is provisional. Nothing adjusts for the number of tests. |

## Out of scope

- Malware or another person acting as the logged-in user. They can read the project folder directly.
- Several people working on one project at once. The app has one writer and no accounts.
- Physical access to an unlocked computer.
- The security of the AI provider an assistant sends results to.

## What a lab should do

1. Keep projects on an encrypted local disk, not in a sync or network folder.
2. Encrypt backups, and keep at least one outside the project folder. That copy is also what makes a rewritten history detectable.
3. Run **Verify** before relying on a project's history, and after restoring one.
4. Settle the IRB and data use agreement position before connecting the MCP server to a real project.
5. Treat export packages as study data.

## Open items

Signing and notarising installers (T11). Authenticated users (T6). A query budget or overlap check for the MCP server (T10). Fuzzing the workbook reader (T1). A validation pack for institutional review. See [STRATEGY.md](STRATEGY.md).
