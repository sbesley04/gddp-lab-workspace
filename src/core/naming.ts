// Suggested names for saved views, built from what is selected.
import type { ChartConfig, DatasetSnapshot, FilterGroup, FilterNode, QcCategory, VariableInfo } from './types'
import { QC_CATEGORY_LABELS } from './types'

const short = (v: VariableInfo | undefined) => {
  if (!v) return '?'
  const l = v.meta.displayLabel.value ?? v.header
  // Prefer a short form such as "PHQ-9" for long questionnaire headers.
  const m = /\(([A-Z][A-Za-z0-9-]{1,10})\)/.exec(l)
  const base = m && l.length > 28 ? m[1] : l
  return base.length > 32 ? `${base.slice(0, 30)}…` : base
}

function condText(node: FilterNode, vars: Map<string, VariableInfo>): string {
  if (node.type === 'group') {
    const parts = node.children.map((c) => condText(c, vars)).filter(Boolean)
    return parts.length > 1 ? `(${parts.join(node.op === 'and' ? ' & ' : ' or ')})` : parts[0] ?? ''
  }
  const v = short(vars.get(node.variableKey))
  switch (node.test.kind) {
    case 'range': {
      const { min, max } = node.test
      if (min !== null && max !== null) return `${v} ${min}–${max}`
      if (min !== null) return `${v} ≥ ${min}`
      if (max !== null) return `${v} ≤ ${max}`
      return v
    }
    case 'in':
      return `${v} = ${node.test.values.slice(0, 2).join('/')}${node.test.values.length > 2 ? '…' : ''}`
    case 'missing':
      return `${v} missing`
    case 'present':
      return `${v} present`
  }
}

export function suggestViewName(snapshot: DatasetSnapshot, chart: ChartConfig, filter: FilterGroup, qc: QcCategory[], visitIds: string[] | 'all'): string {
  const vars = new Map(snapshot.variables.map((v) => [v.key, v]))
  const m = chart.measureKey ? vars.get(chart.measureKey) : undefined
  const parts: string[] = []
  if (chart.type === 'scatter') parts.push(`${short(m)} vs ${short(chart.compareKey ? vars.get(chart.compareKey) : undefined)}`)
  else if (chart.type === 'pca') parts.push(`PCA of ${(chart.pcaKeys ?? []).length} variables`)
  else if (chart.type === 'distribution') parts.push(chart.groupKey ? `${short(m)} by ${short(vars.get(chart.groupKey))}` : short(m))
  else parts.push(`Table (${chart.tableColumns.length || [chart.measureKey, chart.compareKey, chart.groupKey].filter(Boolean).length} cols)`)
  const f = filter.children.map((c) => condText(c, vars)).filter(Boolean)
  if (f.length) parts.push(f.slice(0, 2).join(filter.op === 'and' ? ' & ' : ' or ') + (f.length > 2 ? ' …' : ''))
  const excl = qc.filter((c) => c !== 'curator_exclusion')
  if (excl.length) parts.push(`excl. ${excl.length === 1 ? QC_CATEGORY_LABELS[excl[0]].replace(/^NULISA /, '').replace(/ warnings?( \(needs review\))?$/i, '').replace(/\bQC$/, '').trim() + ' QC' : `${excl.length} QC flags`}`)
  if (visitIds !== 'all') parts.push(snapshot.visits.filter((v) => visitIds.includes(v.id)).map((v) => v.name).join('/'))
  else if (snapshot.visits.length === 1) parts.push(snapshot.visits[0].name.toLowerCase())
  if (chart.yScale === 'log' || chart.xScale === 'log') parts.push('log')
  return parts.join(' · ').slice(0, 180)
}
