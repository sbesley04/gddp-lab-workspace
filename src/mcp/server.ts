// MCP server definition: tools, resources and prompts over a read-only Workspace.
import { appendFileSync } from 'node:fs'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { QC_CATEGORIES } from '@core/types'
import { TRANSFORMS } from '@core/transforms'
import { APP_VERSION } from '../main/version'
import { analysisPrompt, guideMarkdown, serverInstructions } from './guide'
import * as T from './tools'
import { ToolError, type Workspace } from './workspace'

const condition = z.object({
  variable: z.string().describe('Variable key, header, label or alias'),
  min: z.number().optional().describe('Keep rows with value ≥ min (numeric variables)'),
  max: z.number().optional().describe('Keep rows with value ≤ max (numeric variables)'),
  oneOf: z.array(z.string()).optional().describe('Keep rows whose value is one of these labels (categorical variables)'),
  is: z.enum(['missing', 'present']).optional().describe('Keep rows where the value is missing / present'),
  keepMissing: z.boolean().optional().describe('Also keep rows where this variable is missing or not evaluable (default false)')
})

const selection = {
  datasetVersion: z.number().int().positive().optional().describe('Dataset version number (default: latest import)'),
  savedView: z.string().optional().describe('Reuse the selection of a saved view (id or name). Do not combine with the other selection fields.'),
  visits: z.array(z.string()).optional().describe('Visit names to include, e.g. ["Baseline"]. Default: all visits.'),
  where: z.array(condition).optional().describe('Row filters. Each needs exactly one of min/max, oneOf or is.'),
  match: z.enum(['all', 'any']).optional().describe('Combine filters with AND ("all", default) or OR ("any")'),
  qcExclude: z.array(z.enum(QC_CATEGORIES)).optional().describe('QC categories whose flagged values are excluded. Default ["curator_exclusion"].')
}

const transform = z.enum(TRANSFORMS).optional().describe('Transform applied before analysis: none (default), log2, log10, center, zscore, rank')
const groupFrom = z
  .enum(['same_row', 'participant'])
  .optional()
  .describe('Where the group value comes from: "same_row" (the observation\'s own visit) or "participant" (the participant\'s value at any visit, for covariates recorded once)')

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }

export interface ServerOptions {
  /** Append one JSON line per tool call (name, arguments, outcome, size). Never contains results. */
  accessLog?: string | null
}

export function createServer(ws: Workspace, opts: ServerOptions = {}): McpServer {
  const server = new McpServer({ name: 'bari-cns', version: APP_VERSION }, { instructions: serverInstructions(ws.policy) })

  const log = (entry: Record<string, unknown>) => {
    if (!opts.accessLog) return
    try {
      appendFileSync(opts.accessLog, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n')
    } catch {
      /* logging must never break a call */
    }
  }

  const tool = <S extends z.ZodRawShape>(name: string, title: string, description: string, shape: S, fn: (args: z.infer<z.ZodObject<S>>) => unknown) => {
    const handler = async (args: z.infer<z.ZodObject<S>>): Promise<CallToolResult> => {
      try {
        const text = JSON.stringify(fn(args))
        log({ tool: name, args, ok: true, bytes: text.length })
        return { content: [{ type: 'text' as const, text }] }
      } catch (e) {
        const message = e instanceof ToolError ? e.message : `Internal error: ${e instanceof Error ? e.message : String(e)}`
        log({ tool: name, args, ok: false, error: message })
        return { content: [{ type: 'text' as const, text: message }], isError: true }
      }
    }
    // The SDK's callback type is inferred from the shape; the generic wrapper cannot express it, hence the cast.
    server.registerTool(name, { title, description, inputSchema: shape, annotations: { title, ...readOnly } }, handler as never)
  }

  tool(
    'get_study_overview',
    'Study overview',
    'Start here. Dataset versions, visits with participant counts, variable groups, covariates, QC flag totals, open curation questions, study context and the privacy policy.',
    {},
    () => T.studyOverview(ws)
  )

  tool(
    'search_variables',
    'Search variables',
    'Find variables by name, alias, group, unit or definition (fuzzy). Returns keys to use in other tools, kinds, units and value counts. Call with no query to list all variables page by page.',
    {
      query: z.string().optional().describe('Words to search for, e.g. "IL6", "depression", "CSF protein"'),
      group: z.string().optional().describe('Only variables in this variable group (e.g. "NULISA")'),
      kind: z.enum(['numeric', 'categorical', 'mixed', 'empty']).optional(),
      datasetVersion: selection.datasetVersion,
      limit: z.number().int().min(1).max(200).optional().describe('Default 25'),
      offset: z.number().int().min(0).optional()
    },
    (a) => T.searchVariables(ws, a)
  )

  tool(
    'describe_variable',
    'Describe a variable',
    'Everything known about one variable: metadata with status and provenance, aliases, source attribution, header comments, and per-visit counts (missing, censored, text codes, QC flags) with descriptive statistics.',
    { variable: z.string().describe('Variable key, header, label or alias'), ...selection },
    (a) => T.describeVariable(ws, a)
  )

  tool(
    'cohort_counts',
    'Cohort counts',
    'How many participants and rows a selection keeps, per visit, how many visits each participant has, and why rows were excluded. Use it to check filters before analysing.',
    selection,
    (a) => T.cohortCounts(ws, a)
  )

  tool(
    'summarize',
    'Summarize a measure',
    'Descriptive statistics (n, mean with 95% CI, SD, median with CI, quartiles, geometric mean, skewness, Shapiro–Wilk) for a numeric measure, optionally by group. Reports values left out (missing, censored, text, QC-excluded).',
    { variable: z.string(), groupBy: z.string().optional().describe('Categorical variable to group by'), groupFrom, transform, ...selection },
    (a) => T.summarize(ws, a)
  )

  tool(
    'compare_groups',
    'Compare groups',
    'Exploratory comparison of a numeric measure between groups of a categorical variable. Two groups: Welch t-test, Hedges g, Mann–Whitney. Three or more: Welch and classic ANOVA, Kruskal–Wallis, Holm-adjusted pairwise tests. Validated against R. Restrict to one visit.',
    {
      variable: z.string(),
      groupBy: z.string().describe('Categorical variable defining the groups'),
      groups: z.array(z.string()).optional().describe('Group labels to compare (default: all non-missing groups)'),
      groupFrom,
      transform,
      ...selection
    },
    (a) => T.compareGroups(ws, a)
  )

  tool(
    'correlate',
    'Correlate two measures',
    'Exploratory association between two numeric measures: Spearman (default), Pearson or Kendall with CI and p-value, plus an OLS linear fit. Reports pairs left out. Validated against R.',
    {
      x: z.string(),
      y: z.string(),
      method: z.enum(['spearman', 'pearson', 'kendall']).optional(),
      transformX: transform,
      transformY: transform,
      ...selection
    },
    (a) => T.correlate(ws, a)
  )

  tool(
    'correlation_matrix',
    'Correlation matrix',
    'Pairwise-complete Spearman or Pearson coefficients among 2–80 measures, with n per pair and the strongest pairs. Descriptive (no p-values).',
    { variables: z.array(z.string()).min(2).max(80), method: z.enum(['spearman', 'pearson']).optional(), ...selection },
    (a) => T.correlationMatrix(ws, a)
  )

  tool(
    'principal_components',
    'Principal components',
    'PCA on standardised measures (complete cases). Variance explained, top loadings per component, rows dropped and which variables cause the gaps, and optional group mean scores. Individual scores are never returned.',
    {
      variables: z.array(z.string()).min(2).max(80),
      components: z.number().int().min(1).max(10).optional().describe('Components to report (default 3)'),
      groupBy: z.string().optional(),
      groupFrom,
      ...selection
    },
    (a) => T.principalComponents(ws, a)
  )

  tool(
    'change_between_visits',
    'Change between visits',
    'Within-participant change in a numeric measure from one visit to another (paired by participant): mean and median change with 95% CIs, counts up/down, optionally by group. Descriptive only.',
    {
      variable: z.string(),
      from: z.string().describe('Earlier visit name, e.g. "Baseline"'),
      to: z.string().describe('Later visit name, e.g. "Month 6"'),
      groupBy: z.string().optional(),
      groupFrom: groupFrom.describe('Default "participant" here'),
      transform,
      datasetVersion: selection.datasetVersion,
      where: selection.where,
      match: selection.match,
      qcExclude: selection.qcExclude
    },
    (a) => T.changeBetweenVisits(ws, a)
  )

  tool(
    'qc_overview',
    'QC overview',
    'Data-quality picture for a selection: QC flag counts by category and status, which variables are most affected, and the current inclusion policy.',
    { variables: z.array(z.string()).optional().describe('Limit to these variables (default: all measures)'), ...selection },
    (a) => T.qcOverview(ws, a)
  )

  tool(
    'list_saved_views',
    'Saved views',
    'Saved views made by researchers in the app: name, description, chart, measures, visits, filter and size. Pass a view id or name as "savedView" to other tools to reuse its selection.',
    {},
    () => T.savedViews(ws)
  )

  server.registerResource(
    'guide',
    'bari://guide',
    { title: 'How to read BARI-CNS data', description: 'Value types, censoring, QC flags, metadata status, analysis choices, reporting and privacy rules.', mimeType: 'text/markdown' },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: guideMarkdown(ws.policy) }] })
  )

  server.registerResource(
    'data-dictionary',
    'bari://data-dictionary',
    { title: 'Data dictionary', description: 'Every variable in the latest dataset version with key, header, group, kind, unit, metadata status and value counts (CSV).', mimeType: 'text/csv' },
    async (uri) => {
      const res = T.searchVariables(ws, { limit: 200, offset: 0 })
      let rows = res.variables
      let next = res.nextOffset
      while (next !== null) {
        const more = T.searchVariables(ws, { limit: 200, offset: next })
        rows = rows.concat(more.variables)
        next = more.nextOffset
      }
      const esc = (s: unknown) => {
        const t = s === undefined || s === null ? '' : String(s)
        return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
      }
      const head = 'key,header,column,role,kind,group,unit,numeric,missing,censored,text,quasi_identifier,covariate,unknown_metadata'
      const lines = rows.map((v) =>
        [v.key, v.header, v.column, v.role, v.kind, v.group, v.unit, v.values.number, v.values.missing, v.values.censored, v.values.text, v.quasiIdentifier ? 'yes' : '', v.covariate ? 'yes' : '', v.unknownMetadata.join(' ')].map(esc).join(',')
      )
      return { contents: [{ uri: uri.href, mimeType: 'text/csv', text: [head, ...lines].join('\n') }] }
    }
  )

  server.registerPrompt(
    'exploratory_analysis',
    { title: 'Exploratory analysis', description: 'A careful, reproducible workflow for answering a research question with these tools.', argsSchema: { question: z.string().describe('The research question') } },
    ({ question }) => ({ messages: [{ role: 'user', content: { type: 'text', text: analysisPrompt(question) } }] })
  )

  return server
}
