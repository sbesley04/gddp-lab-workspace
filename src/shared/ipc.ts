// IPC contract: channel names and zod schemas validated in the main process for every call.
import { z } from 'zod'
import { META_FIELDS, QC_CATEGORIES } from '@core/types'
import { TRANSFORMS } from '@core/transforms'

const id = z.string().min(1).max(200)
const author = z.string().max(80).nullable()
const reason = z.string().max(2000).nullable()

const conditionTest = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('range'), min: z.number().finite().nullable(), max: z.number().finite().nullable() }),
  z.object({ kind: z.literal('in'), values: z.array(z.string().max(500)).max(500) }),
  z.object({ kind: z.literal('missing') }),
  z.object({ kind: z.literal('present') })
])

export const filterCondition = z.object({
  type: z.literal('cond'),
  id: z.string().max(64),
  variableKey: z.string().max(200),
  test: conditionTest,
  onMissing: z.enum(['exclude', 'include'])
})

export type FilterGroupInput = { type: 'group'; id: string; op: 'and' | 'or'; children: (FilterGroupInput | z.infer<typeof filterCondition>)[] }
export const filterGroup: z.ZodType<FilterGroupInput> = z.lazy(() =>
  z.object({ type: z.literal('group'), id: z.string().max(64), op: z.enum(['and', 'or']), children: z.array(z.union([filterCondition, filterGroup])).max(100) })
)

export const selectionSpec = z.object({
  datasetVersionId: id,
  visitIds: z.union([z.literal('all'), z.array(id).max(1000)]),
  filter: filterGroup,
  qc: z.object({ exclude: z.array(z.enum(QC_CATEGORIES)) }),
  participantIds: z.array(z.string().max(200)).max(100000).nullable()
})

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/)
export const chartStyle = z.object({
  preset: z.enum(['glass', 'publication', 'contrast', 'colorblind', 'grayscale', 'custom']),
  pointColor: color,
  flagColor: color,
  unresolvedColor: color,
  boxColor: color,
  fitColor: color,
  background: z.enum(['transparent', 'white', 'black']),
  textColor: color.nullable(),
  font: z.enum(['system', 'sans', 'serif', 'mono']),
  fontSize: z.number().min(8).max(28),
  pointSize: z.number().min(2).max(30),
  pointOpacity: z.number().min(0.1).max(1),
  showGrid: z.boolean(),
  showTitle: z.boolean(),
  showSubtitle: z.boolean(),
  boxFill: z.boolean()
})

export const chartConfig = z.object({
  type: z.enum(['distribution', 'scatter', 'table', 'pca']),
  measureKey: z.string().max(200).nullable(),
  compareKey: z.string().max(200).nullable(),
  groupKey: z.string().max(200).nullable(),
  colorKey: z.string().max(200).nullable().optional(),
  transformMeasure: z.enum(TRANSFORMS).optional(),
  transformCompare: z.enum(TRANSFORMS).optional(),
  xScale: z.enum(['linear', 'log']),
  yScale: z.enum(['linear', 'log']),
  tableColumns: z.array(z.string().max(200)).max(2000),
  pcaKeys: z.array(z.string().max(200)).max(2000).optional(),
  xMin: z.number().finite().nullable().optional(),
  xMax: z.number().finite().nullable().optional(),
  yMin: z.number().finite().nullable().optional(),
  yMax: z.number().finite().nullable().optional(),
  style: chartStyle.optional(),
  analysis: z.object({ requested: z.boolean(), fitLine: z.boolean(), confidenceBand: z.boolean(), predictionBand: z.boolean(), meanCi: z.boolean().optional() }).optional()
})

const boardCard = z.object({
  id: z.string().max(64),
  kind: z.enum(['view', 'note']),
  viewId: z.string().max(200).nullable(),
  x: z.number().finite(),
  y: z.number().finite(),
  w: z.number().finite().min(120).max(4000),
  h: z.number().finite().min(80).max(4000),
  text: z.string().max(20000).nullable(),
  style: chartStyle.nullable()
})

export const boardLayout = z.object({
  cards: z.array(boardCard).max(200),
  boardStyle: chartStyle.nullable(),
  grid: z.number().int().min(1).max(200)
})

export const savedViewSpec = z.object({
  schema: z.literal(1),
  selection: selectionSpec,
  chart: chartConfig,
  transformations: z.array(z.string()).max(0),
  missingDataPolicy: z.string().max(200)
})

export const mapping = z.object({
  sheetName: z.string().min(1).max(300),
  headerRow: z.number().int().min(1).max(50),
  participantColumn: z.number().int().min(1).max(20000),
  eventColumn: z.number().int().min(1).max(20000).nullable()
})

export const contextOptions = z.object({
  variableKeys: z.array(z.string().max(200)).min(1).max(5000),
  confirmedQuasiIdentifiers: z.array(z.string().max(200)).max(5000),
  participantKeyMode: z.enum(['project_pseudonym', 'random_per_export', 'source_id']),
  includeCommentText: z.boolean(),
  analysisQuestion: z.string().max(20000)
})

export const schemas = {
  'project:create': z.object({ name: z.string().min(1).max(120) }),
  'project:openRecent': z.object({ id }),
  'project:forgetRecent': z.object({ id }),
  'import:preview': z.object({ token: id, sheetName: z.string().max(300), headerRow: z.number().int().min(1).max(50) }),
  'import:validate': z.object({ token: id, mapping }),
  'import:commit': z.object({ token: id, mapping, confirmMapping: z.literal(true), carryOverFrom: id.nullable() }),
  'import:discard': z.object({ token: id }),
  'data:snapshot': z.object({ datasetVersionId: id, asOf: z.number().int().min(0).nullable() }),
  'data:formatGroups': z.object({ datasetVersionId: id, asOf: z.number().int().min(0).nullable() }),
  'data:importReport': z.object({ datasetVersionId: id }),
  'curation:editMeta': z.object({ datasetVersionId: id, varKey: id, field: z.enum(META_FIELDS), value: z.string().max(5000).nullable(), status: z.enum(['unknown', 'tentative', 'confirmed']), reason }),
  'curation:setQuasi': z.object({ datasetVersionId: id, varKey: id, value: z.boolean(), reason }),
  'curation:setCovariate': z.object({ datasetVersionId: id, varKey: id, value: z.boolean(), reason }),
  'curation:decideFormat': z.object({ datasetVersionId: id, groupKey: z.string().max(500), decision: z.enum(['confirm', 'reject', 'reset']), asKind: z.enum(['qc_sample', 'qc_target', 'qc_both']).optional(), reason }),
  'curation:setExclusion': z.object({ datasetVersionId: id, varKey: id, participantId: z.string().max(200), visitId: id, excluded: z.boolean(), reason }),
  'curation:nameSegment': z.object({ datasetVersionId: id, segment: z.number().int().min(0).max(10000), name: z.string().max(200) }),
  'curation:setStudyContext': z.object({ datasetVersionId: id, text: z.string().max(50000) }),
  'curation:getStudyContext': z.object({ datasetVersionId: id, asOf: z.number().int().min(0).nullable() }),
  'curation:history': z.object({ datasetVersionId: id, target: z.string().max(500).optional(), kind: z.string().max(50).optional() }),
  'views:save': z.object({ name: z.string().min(1).max(200), description: z.string().max(5000).nullable(), spec: savedViewSpec, metadataVersion: z.number().int().min(0) }),
  'views:get': z.object({ id }),
  'views:delete': z.object({ id }),
  'export:preview': z.object({ spec: selectionSpec, options: contextOptions, metadataVersion: z.number().int().min(0) }),
  'export:write': z.object({ spec: selectionSpec, options: contextOptions, metadataVersion: z.number().int().min(0) }),
  'export:chart': z.object({
    format: z.enum(['svg', 'png', 'r']),
    data: z.string().max(40_000_000),
    suggestedName: z.string().max(200),
    /** Optional sidecar files written next to the chart, and the context recorded in the export record. */
    sidecars: z.object({ settings: z.string().max(2_000_000), log: z.string().max(2_000_000) }).optional(),
    context: z.object({ datasetVersionId: z.string().max(100), metadataVersion: z.number().int().min(0), signature: z.string().max(64) }).optional()
  }),
  'settings:setAuthor': z.object({ authorLabel: z.string().max(80) }),
  'boards:get': z.object({ id }),
  'boards:save': z.object({ id: id.nullable(), name: z.string().min(1).max(200), layout: boardLayout }),
  'boards:delete': z.object({ id })
} as const

/** Envelope for every IPC response so errors reach the renderer as readable messages, not stack traces. */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string }
