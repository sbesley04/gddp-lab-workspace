// RFC 4180 CSV writer with an explicit formula-injection guard that never alters numbers.

const FORMULA_START = /^[=+\-@\t\r]/
const NUMERIC_RE = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/

export interface CsvOptions {
  /** Prefix text cells that start with =, +, -, @, tab or CR (and are not plain numbers) with an apostrophe. */
  guardFormulas: boolean
}

export interface CsvResult {
  text: string
  guardedCells: number
}

export function escapeCsvField(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

export function toCsv(rows: (string | number | null)[][], opts: CsvOptions = { guardFormulas: true }): CsvResult {
  let guarded = 0
  const lines = rows.map((r) =>
    r
      .map((cell) => {
        if (cell === null || cell === undefined) return ''
        if (typeof cell === 'number') return Number.isFinite(cell) ? String(cell) : ''
        let s = cell
        if (opts.guardFormulas && FORMULA_START.test(s) && !NUMERIC_RE.test(s.trim())) {
          s = `'${s}`
          guarded++
        }
        return escapeCsvField(s)
      })
      .join(',')
  )
  return { text: lines.join('\r\n') + '\r\n', guardedCells: guarded }
}
