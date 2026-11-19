// Independence guard, shared by the app and the MCP server.
// Each row is one participant at one visit. The tests in analysis.ts assume independent observations, so a set of rows in
// which any participant appears more than once must not be tested as if the rows were unrelated.

import type { DatasetSnapshot } from './types'

export interface RepeatInfo {
  /** Observations (rows) in the analysed set. */
  rows: number
  participants: number
  /** Participants who contribute more than one row. */
  repeatedParticipants: number
  repeated: boolean
}

/** Counts how many participants contribute more than one observation. */
export function repeatInfoOfIds(participantIds: Iterable<string>): RepeatInfo {
  const seen = new Map<string, number>()
  let rows = 0
  for (const id of participantIds) {
    rows++
    seen.set(id, (seen.get(id) ?? 0) + 1)
  }
  let repeatedParticipants = 0
  for (const n of seen.values()) if (n > 1) repeatedParticipants++
  return { rows, participants: seen.size, repeatedParticipants, repeated: repeatedParticipants > 0 }
}

export function repeatInfo(snapshot: Pick<DatasetSnapshot, 'rows'>, rows: Iterable<number>): RepeatInfo {
  const ids: string[] = []
  for (const r of rows) ids.push(snapshot.rows[r].participantId)
  return repeatInfoOfIds(ids)
}

/** The statement both the app and the MCP server show; null when every participant contributes one observation. */
export function independenceMessage(info: RepeatInfo): string | null {
  if (!info.repeated) return null
  return `${info.rows} observations come from ${info.participants} participants: ${info.repeatedParticipants} participant(s) contribute more than one visit. Tests and confidence intervals assume independent observations.`
}

export interface VisitCount {
  id: string
  name: string
  rows: number
}

/** Visits present in a set of rows, in study order, with the number of rows at each. */
export function visitsOfRows(snapshot: Pick<DatasetSnapshot, 'rows' | 'visits'>, rows: Iterable<number>): VisitCount[] {
  const counts = new Map<string, number>()
  for (const r of rows) {
    const id = snapshot.rows[r].visitId
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  // snapshot.visits is already in study order (see visitOrder.ts).
  const order = new Map(snapshot.visits.map((v, i) => [v.id, i]))
  const name = (id: string) => snapshot.visits.find((v) => v.id === id)?.name ?? id
  return [...counts.entries()].map(([id, n]) => ({ id, name: name(id), rows: n })).sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9))
}

/** "observations at Baseline" or "observations pooled across 2 visits (Baseline, Month 6)": never a fixed word. */
export function visitScopeText(visits: VisitCount[]): string {
  if (visits.length === 0) return 'no observations'
  if (visits.length === 1) return `observations at ${visits[0].name}`
  return `observations pooled across ${visits.length} visits (${visits.map((v) => v.name).join(', ')})`
}
