/** FNV-1a 32-bit hash, hex. Used only for stable, non-secret identifiers. */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

export function normalizeHeader(h: string): string {
  return h.replace(/\s+/g, ' ').trim()
}

export function slug(s: string, max = 32): string {
  const out = s
    .normalize('NFKD')
    .replace(/[^\w]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
    .slice(0, max)
    .replace(/_+$/g, '')
  return out || 'col'
}

/** Stable variable key derived from the normalized header text, e.g. "il6_3f2a91c0". */
export function variableKey(header: string): string {
  const n = normalizeHeader(header)
  return `${slug(n)}_${fnv1a(n)}`
}

export function columnLetter(col: number): string {
  let s = ''
  let n = col
  while (n > 0) {
    const m = (n - 1) % 26
    s = String.fromCharCode(65 + m) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

export function columnIndexFromLetter(letters: string): number {
  let n = 0
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n
}

export function parseAddress(addr: string): { row: number; col: number } {
  const m = /^([A-Z]+)(\d+)$/i.exec(addr)
  if (!m) throw new Error(`Invalid cell address: ${addr}`)
  return { col: columnIndexFromLetter(m[1]), row: Number(m[2]) }
}
