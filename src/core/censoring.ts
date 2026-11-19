// Censoring visibility. Censored values ("<0.5", "≥3") are never replaced by their bound, so every numeric statistic
// leaves them out. That is honest about the value but biases mean-based statistics: dropping values below a detection
// limit pushes the mean up. This module only counts and describes; it substitutes nothing.

import type { CellValue } from './types'

/**
 * Fraction of measured values that are censored above which means and SDs are marked as biased.
 * PROVISIONAL: not yet set with a statistician (docs/STRATEGY.md, open question Q4). Change it here only.
 */
export const CENSORING_BIAS_THRESHOLD = 0.15

export interface CensoringInfo {
  /** Usable numeric values. */
  numeric: number
  /** Usable censored values (not QC-excluded). */
  censored: number
  /** Censored below a limit ("<", "≤") and above a limit (">", "≥"). */
  below: number
  above: number
  /** censored / (numeric + censored); null when nothing was measured. */
  fraction: number | null
  /** True when the fraction is above CENSORING_BIAS_THRESHOLD. */
  biased: boolean
}

export function censoringOf(values: Iterable<CellValue>): CensoringInfo {
  let numeric = 0
  let below = 0
  let above = 0
  for (const v of values) {
    if (v.k === 'number') numeric++
    else if (v.k === 'censored') {
      if (v.op === '<' || v.op === '<=') below++
      else above++
    }
  }
  const censored = below + above
  const fraction = numeric + censored > 0 ? censored / (numeric + censored) : null
  return { numeric, censored, below, above, fraction, biased: fraction !== null && fraction > CENSORING_BIAS_THRESHOLD }
}

export function censoringPercent(c: CensoringInfo): string {
  if (c.fraction === null) return '—'
  const pct = c.fraction * 100
  return pct > 0 && pct < 1 ? '<1%' : `${Math.round(pct)}%`
}

/** Which way leaving the censored values out moves the mean. */
export function censoringDirection(c: CensoringInfo): 'upward' | 'downward' | 'in an unknown direction' {
  if (c.below && !c.above) return 'upward'
  if (c.above && !c.below) return 'downward'
  return 'in an unknown direction'
}

/** One sentence for a variable (and group), or null when nothing is censored. */
export function censoringNote(c: CensoringInfo, what: string): string | null {
  if (!c.censored) return null
  const where = c.below && c.above ? `${c.below} below and ${c.above} above a limit` : c.below ? 'below a detection limit' : 'above a limit'
  const head = `${what}: ${censoringPercent(c)} of measured values are censored (${c.censored} of ${c.numeric + c.censored}, ${where}) and left out, never replaced by their bound.`
  return c.biased
    ? `${head} This is above ${Math.round(CENSORING_BIAS_THRESHOLD * 100)}%, so the mean and SD are biased ${censoringDirection(c)}; prefer the median and the detection rate.`
    : `${head} Mean-based statistics are biased ${censoringDirection(c)} by this.`
}
