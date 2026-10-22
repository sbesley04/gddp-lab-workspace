import type { CellValue } from './types'

const NUMERIC_RE = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/
const CENSORED_RE = /^(<=|>=|≤|≥|<|>)\s*([-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?)$/

/**
 * Classify a source value. Rules:
 * - null/undefined/empty or whitespace-only text is missing (never zero).
 * - finite numbers are numbers; numeric-looking text (e.g. from CSV) is a number with its raw text kept.
 * - "<x", ">x", "≤x", "≥x" are censored; the bound is kept but never substituted for the value.
 * - anything else is text (categorical label, or non-numeric entry in a numeric column).
 */
export function classifyValue(input: unknown): CellValue {
  if (input === null || input === undefined) return { k: 'missing' }
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return { k: 'text', raw: String(input) }
    return { k: 'number', v: input, raw: String(input) }
  }
  if (typeof input === 'boolean') return { k: 'text', raw: input ? 'TRUE' : 'FALSE' }
  const raw = String(input)
  const t = raw.trim()
  if (t === '') return { k: 'missing' }
  if (NUMERIC_RE.test(t)) return { k: 'number', v: Number(t), raw }
  const m = CENSORED_RE.exec(t)
  if (m) {
    const op = m[1] === '≤' ? '<=' : m[1] === '≥' ? '>=' : (m[1] as '<' | '<=' | '>' | '>=')
    return { k: 'censored', op, bound: Number(m[2]), raw }
  }
  return { k: 'text', raw }
}

/** Identifiers are always text, even when the source stored them as numbers. */
export function identifierText(input: unknown): string | null {
  if (input === null || input === undefined) return null
  if (typeof input === 'number') return Number.isInteger(input) ? String(input) : String(input)
  const t = String(input).trim()
  return t === '' ? null : t
}

export function displayValue(v: CellValue): string {
  switch (v.k) {
    case 'missing':
      return ''
    case 'number':
      return formatNumber(v.v)
    case 'censored':
      return v.raw.trim()
    case 'text':
      return v.raw
  }
}

export function formatNumber(n: number, digits = 4): string {
  if (!Number.isFinite(n)) return String(n)
  if (Number.isInteger(n)) return String(n)
  const abs = Math.abs(n)
  if (abs !== 0 && (abs < 1e-3 || abs >= 1e6)) return n.toExponential(3)
  return String(Number(n.toPrecision(digits + 2)))
}
