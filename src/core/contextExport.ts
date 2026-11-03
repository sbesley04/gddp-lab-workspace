// Builds the research-context package files from the shared selection engine. Pure: hashing,
// pseudonym derivation and ZIP writing are injected by the main process.

import type { DatasetSnapshot, SelectionSpec, VariableInfo } from './types'
import { QC_CATEGORY_LABELS } from './types'
import { computeSelection, countsFor, describeFilter, getObservation, type SelectionResult } from './selection'
import { toCsv } from './csv'
import { buildProvenance } from './provenance'

export const CONTEXT_EXPORT_SCHEMA = 'bari-cns-context-export/1'

export interface ContextExportOptions {
  variableKeys: string[]
  /** Quasi-identifiers the researcher explicitly chose to keep. Any other selected quasi-identifier blocks export. */
  confirmedQuasiIdentifiers: string[]
  participantKeyMode: 'project_pseudonym' | 'random_per_export' | 'source_id'
  includeCommentText: boolean
  analysisQuestion: string
}

export interface ContextExportInput {
  snapshot: DatasetSnapshot
  spec: SelectionSpec
  options: ContextExportOptions
  studyContext: string
  appVersion: string
  createdAt: string
  keyFor: (participantId: string) => string
}

export interface ContextExportPreview {
  files: Record<string, string>
  summary: string
  participants: number
  rows: number
  variables: { key: string; header: string; unit: string | null; unitStatus: string; definitionStatus: string; quasiIdentifier: boolean }[]
  unresolved: { key: string; header: string; missing: string[] }[]
  blockingQuasiIdentifiers: string[]
  guardedCells: number
  omitted: string[]
  manifestBase: Record<string, unknown>
}

const fmt = (v: VariableInfo, f: keyof VariableInfo['meta']) => v.meta[f].value ?? ''

function visitName(snapshot: DatasetSnapshot, visitId: string) {
  return snapshot.visits.find((v) => v.id === visitId)?.name ?? visitId
}

export function buildContextFiles(input: ContextExportInput): ContextExportPreview {
  const { snapshot, spec, options } = input
  const sel: SelectionResult = computeSelection(snapshot, spec)
  const byKey = new Map(snapshot.variables.map((v) => [v.key, v]))
  const vars = options.variableKeys.map((k) => byKey.get(k)).filter((v): v is VariableInfo => !!v && v.role === 'measure')
  const blockingQuasiIdentifiers = vars.filter((v) => v.quasiIdentifier && !options.confirmedQuasiIdentifiers.includes(v.key)).map((v) => v.key)
  const keyOf = (pid: string) => (options.participantKeyMode === 'source_id' ? pid : input.keyFor(pid))
  const omitted: string[] = [
    'Complete source workbook (never included)',
    'Unselected columns',
    'Participant identifier column (replaced by participant_key)',
    'Comment authors'
  ]
  if (!options.includeCommentText) omitted.push('Free-text comments')

  // selected_data.csv (wide; QC-excluded and missing values are blank — see quality_flags.csv and the dictionary)
  const header = ['participant_key', 'visit', ...vars.map((v) => v.key)]
  const dataRows: (string | number | null)[][] = [header]
  let guarded = 0
  for (const row of sel.rows) {
    const r = snapshot.rows[row]
    const line: (string | number | null)[] = [keyOf(r.participantId), visitName(snapshot, r.visitId)]
    for (const v of vars) {
      const o = getObservation(sel.ctx, row, v.index)
      if (o.value.k === 'missing' || o.qcExcludedBy.length) line.push(null)
      else if (o.value.k === 'number') line.push(o.value.v)
      else line.push(o.value.raw.trim())
    }
    dataRows.push(line)
  }
  const data = toCsv(dataRows)
  guarded += data.guardedCells

  // data_dictionary.csv
  const dict: (string | number | null)[][] = [
    ['variable_id', 'original_header', 'display_label', 'research_area', 'unit', 'unit_status', 'score_type', 'score_type_status', 'specimen', 'specimen_status', 'assay_method', 'assay_status', 'definition', 'definition_status', 'source_attribution', 'aliases', 'value_type', 'n_numeric', 'n_missing', 'n_censored', 'n_nonnumeric', 'n_qc_excluded', 'source_sheet', 'source_column', 'quasi_identifier']
  ]
  const unresolved: ContextExportPreview['unresolved'] = []
  for (const v of vars) {
    const c = countsFor(sel, v.index)
    const missing = (['unit', 'definition', 'specimen', 'scoreType'] as const).filter((f) => v.meta[f].status === 'unknown')
    if (missing.length) unresolved.push({ key: v.key, header: v.header, missing })
    dict.push([
      v.key, v.header, fmt(v, 'displayLabel'), fmt(v, 'area'),
      fmt(v, 'unit'), v.meta.unit.status, fmt(v, 'scoreType'), v.meta.scoreType.status,
      fmt(v, 'specimen'), v.meta.specimen.status, fmt(v, 'assay'), v.meta.assay.status,
      fmt(v, 'definition'), v.meta.definition.status,
      v.attribution ? `${v.attribution.mode}${v.attribution.source ? `: ${v.attribution.source}` : ''} (${v.attribution.status})` : 'not available',
      v.aliases.map((a) => `${a.text}${a.source ? ` [${a.source}]` : ''}`).join(' | '),
      v.kind, c.numeric, c.missing, c.censored, c.text, c.qcExcluded,
      snapshot.sheetName, v.letter, v.quasiIdentifier ? 'yes' : 'no'
    ])
  }
  const dictionary = toCsv(dict)
  guarded += dictionary.guardedCells

  // quality_flags.csv
  const q: (string | number | null)[][] = [['participant_key', 'visit', 'variable_id', 'source_cell', 'flag_category', 'interpretation_status', 'policy_action', 'detail']]
  const varSet = new Set(vars.map((v) => v.index))
  let commentCount = 0
  for (const row of sel.rows) {
    const r = snapshot.rows[row]
    for (const v of vars) {
      const o = getObservation(sel.ctx, row, v.index)
      for (const f of o.flags) {
        if (!f.category) continue
        q.push([
          keyOf(r.participantId), visitName(snapshot, r.visitId), v.key, `${v.letter}${r.rowNumber}`,
          QC_CATEGORY_LABELS[f.category], f.status,
          o.value.k === 'missing' ? 'not applicable (missing)' : o.qcExcludedBy.includes(f.category) ? 'excluded by policy' : 'included (flag visible)',
          f.detail
        ])
      }
    }
  }
  const selRowSet = new Set(sel.rows)
  for (const a of snapshot.annotations) {
    const relevant = (a.variable === null || varSet.has(a.variable)) && (a.row === null || selRowSet.has(a.row))
    if (!relevant) continue
    commentCount++
    if (!options.includeCommentText) continue
    const v = a.variable !== null ? snapshot.variables[a.variable] : null
    const r = a.row !== null ? snapshot.rows[a.row] : null
    q.push([r ? keyOf(r.participantId) : '', r ? visitName(snapshot, r.visitId) : '', v?.key ?? '', a.address, 'Source comment', 'annotation', 'informational', a.text])
  }
  const quality = toCsv(q)
  guarded += quality.guardedCells

  const visitsInSel = [...new Set(sel.rows.map((i) => visitName(snapshot, snapshot.rows[i].visitId)))]
  const baselineOnly = visitsInSel.length === 1 && /baseline/i.test(visitsInSel[0])
  const filterText = describeFilter(sel.ctx, spec.filter)
  const otherQc = spec.qc.exclude.filter((c) => c !== 'curator_exclusion')
  const qcText =
    (otherQc.length ? `Excluded flag categories: ${otherQc.map((c) => QC_CATEGORY_LABELS[c]).join('; ')}` : 'All QC-flagged observations included (flags listed in quality_flags.csv)') +
    (spec.qc.exclude.includes('curator_exclusion') ? '; curator exclusions honoured' : '; curator exclusions NOT applied')

  const studyContext = `# Study context

${input.studyContext.trim() || '_No curator-entered study context yet._'}

## Dataset scope

- Dataset version: v${snapshot.versionNumber} (${snapshot.datasetVersionId})
- Source sheet: ${snapshot.sheetName}; source file SHA-256: ${snapshot.sourceSha256}
- Metadata version: ${snapshot.metadataVersion}
- Visits in this export: ${visitsInSel.join(', ') || 'none'}
${baselineOnly ? '- **This export contains baseline observations only.** It cannot describe follow-up trajectories, change over time or treatment effects.\n' : ''}- Participants: ${sel.participantIds.length}; rows: ${sel.rows.length}; variables: ${vars.length}
- Cohort rule: ${filterText}
- QC policy: ${qcText}

## Known limitations

- ${unresolved.length} of ${vars.length} exported variables have unresolved metadata (unit, definition, specimen or score type); see data_dictionary.csv status columns.
- Formatting-derived source attributions and QC flags are interpretations of the workbook legend; statuses other than \`legend_exact\` or \`curator_confirmed\` are unconfirmed.
- Raw, scaled, clinic and T-score variants are separate variables unless a curator has documented their relationship.
- Missing values are blank. Censored values (e.g. "<0.5") are exported as text and were never replaced by their bound. Values excluded by the QC policy are blank and listed in quality_flags.csv.
- No inferential statistics, hypothesis tests or causal analyses were performed by the export tool.
`

  const analysisRequest = `# Analysis request

## Researcher question

${options.analysisQuestion.trim() || '_No question entered._'}

## Instructions for the analyst (human or AI)

1. Distinguish clearly between exploratory hypotheses and evidence. Do not present exploratory patterns as findings.
2. Cite variables by \`variable_id\` and their original headers from data_dictionary.csv, and cite source cells from quality_flags.csv where relevant.
3. Preserve missingness: blank values are missing or QC-excluded, never zero. Do not impute without stating the method and its assumptions.
4. Treat censored values (e.g. "<x") as censored; do not substitute the bound.
5. Do not assume causality${baselineOnly ? ' or treatment effects; these are baseline-only observations' : ''}. Treatment efficacy and cure are open research questions.
6. Identify missing metadata (units, definitions, specimens, score types) that limit interpretation, and say what would be needed to resolve it.
7. Do not combine variables with different units, specimens or score types without documented justification.
8. State every analytical assumption, transformation and exclusion explicitly.
`

  const provenance = buildProvenance({ snapshot, spec, chart: null, appVersion: input.appVersion })
  const files: Record<string, string> = {
    'selected_data.csv': data.text,
    'data_dictionary.csv': dictionary.text,
    'quality_flags.csv': quality.text,
    'study_context.md': studyContext,
    'analysis_request.md': analysisRequest,
    'analysis_log.R': provenance.text
  }

  const summary = [
    `BARI-CNS research context — dataset v${snapshot.versionNumber}, metadata v${snapshot.metadataVersion}`,
    baselineOnly ? 'Baseline observations only.' : `Visits: ${visitsInSel.join(', ')}`,
    `${sel.participantIds.length} participants, ${sel.rows.length} rows, ${vars.length} variables.`,
    `Cohort: ${filterText}.`,
    `QC: ${qcText}.`,
    `Unresolved metadata on ${unresolved.length} variable(s).`,
    options.analysisQuestion.trim() ? `Question: ${options.analysisQuestion.trim()}` : ''
  ]
    .filter(Boolean)
    .join('\n')

  const manifestBase = {
    schema: CONTEXT_EXPORT_SCHEMA,
    createdAt: input.createdAt,
    software: { name: 'BARI-CNS Research Workspace', version: input.appVersion },
    dataset: { versionId: snapshot.datasetVersionId, versionNumber: snapshot.versionNumber, sourceSha256: snapshot.sourceSha256, sheet: snapshot.sheetName, sourceKind: snapshot.sourceKind },
    metadataVersion: snapshot.metadataVersion,
    selection: { rule: filterText, spec, rows: sel.rows.length, participants: sel.participantIds.length, visits: visitsInSel },
    qcPolicy: { exclude: spec.qc.exclude, description: qcText },
    variables: vars.map((v) => v.key),
    transformations: [] as string[],
    analysisLog: { file: 'analysis_log.R', signature: provenance.signature },
    participantKeys: {
      mode: options.participantKeyMode,
      note:
        options.participantKeyMode === 'project_pseudonym'
          ? 'Keyed HMAC-SHA256 of the source identifier with a project secret that is not exported. Stable across exports from this project.'
          : options.participantKeyMode === 'random_per_export'
            ? 'Random keys generated for this export only; not linkable to other exports.'
            : 'Source identifiers exported as-is (explicitly chosen by the researcher).',
      disclaimer: 'Pseudonymisation is not anonymisation. Review quasi-identifiers before sharing.'
    },
    quasiIdentifiersIncluded: vars.filter((v) => v.quasiIdentifier).map((v) => v.key),
    comments: { relevant: commentCount, textIncluded: options.includeCommentText, authorsIncluded: false },
    csv: { encoding: 'UTF-8', lineEnding: 'CRLF', formulaGuard: 'Text cells starting with = + - @ tab or CR are prefixed with an apostrophe; numbers are never altered.', guardedCells: guarded },
    omitted
  }

  return {
    files,
    summary,
    participants: sel.participantIds.length,
    rows: sel.rows.length,
    variables: vars.map((v) => ({ key: v.key, header: v.header, unit: v.meta.unit.value, unitStatus: v.meta.unit.status, definitionStatus: v.meta.definition.status, quasiIdentifier: v.quasiIdentifier })),
    unresolved,
    blockingQuasiIdentifiers,
    guardedCells: guarded,
    omitted,
    manifestBase
  }
}
