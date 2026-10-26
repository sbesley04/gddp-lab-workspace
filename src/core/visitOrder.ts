// Visit ordering: first appearance in the sheet, except that visits whose names differ only in a number
// ("Month 2", "Month 6", "Visit 10") are put in numeric order within the slots they occupy.
// Unrelated names (Screening, Baseline) keep their first-appearance order; no dates are inferred.
const NUM_RE = /\d+(?:\.\d+)?/

function stemOf(name: string): string | null {
  return NUM_RE.test(name) ? name.replace(new RegExp(NUM_RE.source, 'g'), '#') : null
}

function numbersOf(name: string): number[] {
  return (name.match(new RegExp(NUM_RE.source, 'g')) ?? []).map(Number)
}

function compareNumbers(a: number[], b: number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i]
  return 0
}

export function orderVisits(firstAppearance: string[]): string[] {
  const slots = new Map<string, number[]>()
  firstAppearance.forEach((n, i) => {
    const s = stemOf(n)
    if (s !== null) slots.set(s, [...(slots.get(s) ?? []), i])
  })
  const out = [...firstAppearance]
  for (const idx of slots.values()) {
    const sorted = idx.map((i) => firstAppearance[i]).sort((a, b) => compareNumbers(numbersOf(a), numbersOf(b)))
    idx.forEach((slot, k) => (out[slot] = sorted[k]))
  }
  return out
}
