// IPC contract: channel names and zod schemas validated in the main process for every call.
import { z } from 'zod'
import { META_FIELDS, QC_CATEGORIES } from '@core/types'

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

export const chartConfig = z.object({
  type: z.enum(['distribution', 'scatter', 'table']),
  measureKey: z.string().max(200).nullable(),
  compareKey: z.string().max(200).nullable(),
  groupKey: z.string().max(200).nullable(),
  xScale: z.enum(['linear', 'log']),
  yScale: z.enum(['linear', 'log']),
  tableColumns: z.array(z.string().max(200)).max(2000)
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
  'export:chart': z.object({ format: z.enum(['svg', 'png']), data: z.string().max(40_000_000), suggestedName: z.string().max(200) }),
  'settings:setAuthor': z.object({ authorLabel: z.string().max(80) })
} as const

/** Envelope for every IPC response so errors reach the renderer as readable messages, not stack traces. */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string }
