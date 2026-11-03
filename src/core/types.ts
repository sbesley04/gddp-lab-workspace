// Shared domain types. This module is pure: no Node, Electron or DOM dependencies.
import type { TransformId } from './transforms'

/** Classification of a single source cell. Missing is never zero; censored is never its bound. */
export type CellValue =
  | { k: 'missing' }
  | { k: 'number'; v: number; raw: string }
  | { k: 'censored'; op: '<' | '<=' | '>' | '>='; bound: number; raw: string }
  | { k: 'text'; raw: string }

export type MetaStatus = 'unknown' | 'tentative' | 'confirmed'

export interface MetaField {
  value: string | null
  status: MetaStatus
  /** Where the current value came from, e.g. "header-derived", "legend", "curator". */
  provenance: string
  revisionId: number | null
}

export const META_FIELDS = [
  'displayLabel',
  'area',
  'unit',
  'specimen',
  'assay',
  'scoreType',
  'definition',
  'source'
] as const
export type MetaFieldName = (typeof META_FIELDS)[number]
export type VariableMeta = Record<MetaFieldName, MetaField>

export type VariableRole = 'participant_id' | 'event' | 'measure' | 'blank'
export type VariableKind = 'numeric' | 'categorical' | 'mixed' | 'empty'

export interface RichRun {
  text: string
  color: string | null // resolved RRGGBB or null for inherited/default
  colorRef: ColorRef | null
  bold: boolean
  italic: boolean
}

export interface ColorRef {
  rgb?: string
  theme?: number
  tint?: number
  indexed?: number
  auto?: boolean
  /** Resolved RRGGBB (uppercase, no alpha) when resolvable. */
  resolved?: string | null
}

export interface Alias {
  text: string
  source: string | null
  status: MetaStatus
  provenance: string
}

export interface SourceAttribution {
  source: string | null
  mode: 'whole_column' | 'mixed_source' | 'identical_across_sources' | 'unresolved'
  status: InterpretationStatus
  note: string
}

export interface VariableInfo {
  index: number // position in snapshot arrays
  columnIndex: number // 1-based source column
  letter: string
  key: string // stable variable identifier
  header: string
  headerRuns: RichRun[] | null
  role: VariableRole
  kind: VariableKind
  groupSegment: number | null
  subgroupSegment: number | null
  meta: VariableMeta
  aliases: Alias[]
  attribution: SourceAttribution | null
  quasiIdentifier: boolean
  /** Researcher-tagged covariate (age, sex, site...): offered first for colouring and grouping. */
  covariate: boolean
  /** Distinct text categories, for categorical variables. */
  categories: string[]
  counts: { number: number; missing: number; censored: number; text: number }
}

export interface VisitInfo {
  id: string
  name: string
  order: number
  actualDate: null // never inferred from source
}

export interface RowInfo {
  index: number
  rowNumber: number // 1-based source row
  participantId: string // source identifier, stored as text
  visitId: string
}

export type InterpretationStatus =
  | 'legend_exact'
  | 'legend_tentative'
  | 'needs_review'
  | 'unresolved'
  | 'curator_confirmed'
  | 'curator_rejected'

export type InterpretationKind =
  | 'qc_sample'
  | 'qc_target'
  | 'qc_both'
  | 'unresolved_highlight'
  | 'unresolved_font'
  | 'cell_source'
  | 'curator_exclusion'

/** The user-facing QC categories that an inclusion policy can act on. */
export const QC_CATEGORIES = [
  'sample_warning',
  'target_warning',
  'both_warnings',
  'possible_sample_warning',
  'possible_target_warning',
  'unresolved_highlight',
  'curator_exclusion'
] as const
export type QcCategory = (typeof QC_CATEGORIES)[number]

export const QC_CATEGORY_LABELS: Record<QcCategory, string> = {
  sample_warning: 'NULISA sample QC warning',
  target_warning: 'NULISA target QC warning',
  both_warnings: 'Sample + target QC warnings',
  possible_sample_warning: 'Possible sample warning (needs review)',
  possible_target_warning: 'Possible target warning (needs review)',
  unresolved_highlight: 'Unresolved formatting',
  curator_exclusion: 'Curator exclusion'
}

/** Cell-level formatting interpretation (QC flag, source note or unresolved formatting). */
export interface CellFlag {
  row: number // row index
  variable: number // variable index
  kind: InterpretationKind
  status: InterpretationStatus
  category: QcCategory | null // null when not a QC-type flag (e.g. cell_source)
  formatKey: string
  detail: string
}

export interface Annotation {
  id: string
  address: string
  row: number | null // row index, null for header
  variable: number | null
  text: string
  author: string | null
  threaded: boolean
}

export interface DatasetSnapshot {
  datasetVersionId: string
  versionNumber: number
  sourceFileName: string
  sourceSha256: string
  sheetName: string
  importedAt: string
  sourceKind: 'xlsx' | 'csv'
  metadataVersion: number
  visits: VisitInfo[]
  rows: RowInfo[]
  variables: VariableInfo[]
  /** values[variableIndex][rowIndex] */
  values: CellValue[][]
  flags: CellFlag[]
  annotations: Annotation[]
}

// ----- Selection -----

export type ConditionTest =
  | { kind: 'range'; min: number | null; max: number | null }
  | { kind: 'in'; values: string[] }
  | { kind: 'missing' }
  | { kind: 'present' }

export interface FilterCondition {
  type: 'cond'
  id: string
  variableKey: string
  test: ConditionTest
  /** What to do when the value is missing, unevaluable (text/censored in a range test) or QC-excluded. */
  onMissing: 'exclude' | 'include'
}

export interface FilterGroup {
  type: 'group'
  id: string
  op: 'and' | 'or'
  children: FilterNode[]
}

export type FilterNode = FilterGroup | FilterCondition

export interface QcPolicy {
  /** Categories whose flagged observations are excluded. Default: none (flagged are included and shown). */
  exclude: QcCategory[]
}

export interface SelectionSpec {
  datasetVersionId: string
  visitIds: string[] | 'all'
  filter: FilterGroup
  qc: QcPolicy
  /** Optional explicit participant restriction (source IDs). */
  participantIds: string[] | null
}

export type StylePreset = 'glass' | 'publication' | 'contrast' | 'colorblind' | 'grayscale' | 'custom'
export type FontChoice = 'system' | 'sans' | 'serif' | 'mono'

/** Visual style of a chart. Flags always keep distinct shapes, whatever the colours. */
export interface ChartStyle {
  preset: StylePreset
  pointColor: string
  flagColor: string
  unresolvedColor: string
  boxColor: string
  fitColor: string
  background: 'transparent' | 'white' | 'black'
  textColor: string | null // null = follow the app theme
  font: FontChoice
  fontSize: number
  pointSize: number
  pointOpacity: number
  showGrid: boolean
  showTitle: boolean
  showSubtitle: boolean
  boxFill: boolean
}

export interface ChartAnalysis {
  /** The statistics panel is open (results are computed only when the user presses Compute). */
  requested: boolean
  fitLine: boolean
  confidenceBand: boolean
  predictionBand: boolean
  meanCi: boolean
}

export interface ChartConfig {
  type: 'distribution' | 'scatter' | 'table' | 'pca'
  measureKey: string | null
  compareKey: string | null
  groupKey: string | null
  /** Categorical covariate used to colour points (flag shapes are unchanged). */
  colorKey?: string | null
  /** Display transforms for the measure (y) and the comparison measure (x). */
  transformMeasure?: TransformId
  transformCompare?: TransformId
  xScale: 'linear' | 'log'
  yScale: 'linear' | 'log'
  tableColumns: string[]
  /** Variables entering the PCA (chart type 'pca'). */
  pcaKeys?: string[]
  /** Forced axis bounds; null = automatic. Values outside are counted, never silently dropped. */
  xMin?: number | null
  xMax?: number | null
  yMin?: number | null
  yMax?: number | null
  style?: ChartStyle
  analysis?: ChartAnalysis
}

export interface SavedViewSpec {
  schema: 1
  selection: SelectionSpec
  chart: ChartConfig
  transformations: string[] // reserved; none applied in this release
  missingDataPolicy: string
}

// Flagged observations are included and shown by default. Deliberate curator exclusions are honoured by default.
export const DEFAULT_QC_POLICY: QcPolicy = { exclude: ['curator_exclusion'] }

export function emptyFilter(): FilterGroup {
  return { type: 'group', id: 'root', op: 'and', children: [] }
}
