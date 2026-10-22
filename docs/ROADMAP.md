# Roadmap (not in the first release)

Architectural boundaries already exist for each item below. None of them is implemented yet.

1. **Longitudinal data.**
   - The data model already separates scheduled visit names (`visit.event_name`) from actual dates (`visit.actual_date`, never inferred).
   - Next steps: visit windows, explicit missing-visit rules, change-from-baseline views and treatment timelines. The `observation_context.treatment_exposure` column is reserved for exposure data.
2. **Statistician-approved analysis templates.**
   - These would cover repeated-measures methods, diagnostics, effect sizes with uncertainty, multiplicity handling, and reproducible code/environment exports.
   - Each would be validated against statistician-provided reference cases before release.
   - They would be a separate module next to `src/core/stats.ts`, fed by the same `computeSelection` output.
3. **REDCap.** API import and metadata (data dictionary) import, source reconciliation, and dataset-version comparison.
4. **Optional AI assistance with the user's own key.** Implement `AnalysisAssistantProvider` (`src/core/assistant.ts`) with:
   - explicit provider and key setup;
   - keys stored in the OS keychain;
   - an exact payload preview;
   - user-initiated sending, with cancellation;
   - cost display;
   - graceful offline and rate-limit behaviour.

   Provider documentation must be re-verified before any compatibility is promised. The research-context ZIP stays the default path, with no API.
5. **Cross-study discovery.** This needs curated study metadata, variable aliases and ontology IDs, and compatible units, specimens and assays.
   - Proposed matches are reviewable suggestions that link to their evidence and dataset version.
   - Human, animal and cell-study evidence are kept distinct.
   - No unattended hypothesis searching.
6. **Agent-readable interface (possibly MCP).** Read-only, versioned access to approved metadata and selections, with project permissions.
   - Source documents must never be able to change agent instructions.
   - Protocol and client compatibility must be verified first.
7. **Multi-user operation.** A purpose-built service with authentication and concurrency control, replacing file-based sharing.
