// Tamper-evidence for the append-only records: audit log, curation revisions and the analysis register.
//
// SQLite triggers stop the app from rewriting these tables, but any SQLite tool can drop a trigger. So every row is
// also entered in a hash chain when the app writes it: each chain entry holds a SHA-256 of the row's content and a
// SHA-256 linking it to the entry before. verifyIntegrity() recomputes all of it and reports rows that were changed,
// removed, or added outside the app, and immutability triggers that are missing.
//
// What this does not do: the chain has no secret key, so someone who rewrites the whole chain consistently is not
// caught by the chain alone. Each backup and context-export manifest therefore records the chain head at the time
// (an "anchor"); verification checks every anchor it is given against the chain, and a copy kept outside the project
// folder is what makes a full rewrite detectable.
import { createHash } from 'node:crypto'
import type { Db } from './db/db'
import { MIGRATIONS } from './db/migrations'

export const CHAIN_GENESIS = 'bari-integrity-chain/1'

/** Tables in the chain, with the columns that make up a row's content, in a fixed order. */
export const CHAINED_TABLES = {
  audit_log: ['id', 'at', 'action', 'detail_json', 'author_label'],
  revision: ['id', 'dataset_version_id', 'kind', 'target', 'field', 'value_json', 'status', 'author_label', 'reason', 'created_at'],
  analysis_register: ['id', 'fingerprint', 'dataset_version_id', 'metadata_version', 'kind', 'title', 'n_rows', 'n_participants', 'test_count', 'record_json', 'app_version', 'author_label', 'created_at']
} as const
export type ChainedTable = keyof typeof CHAINED_TABLES
const TABLE_NAMES = Object.keys(CHAINED_TABLES) as ChainedTable[]

const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')

export function rowHash(table: ChainedTable, row: Record<string, unknown>): string {
  return sha(JSON.stringify([table, ...CHAINED_TABLES[table].map((c) => (typeof row[c] === 'bigint' ? Number(row[c]) : (row[c] ?? null)))]))
}

export function linkHash(previous: string, table: string, rowId: number, hash: string): string {
  return sha(`${previous}\n${table}\n${rowId}\n${hash}`)
}

export interface ChainHead {
  seq: number
  chainHash: string
}

export function chainHead(db: Db): ChainHead | null {
  const r = db.get<{ seq: number; chain_hash: string }>('SELECT seq, chain_hash FROM integrity_chain ORDER BY seq DESC LIMIT 1')
  return r ? { seq: Number(r.seq), chainHash: r.chain_hash } : null
}

/**
 * Enters the rows of `table` with id > afterId into the chain, in id order. Call it in the same transaction as the
 * insert, with the id that was the table's maximum before the insert: rows that were already there and are not in
 * the chain are deliberately left out, so that verification reports them.
 */
export function chainRows(db: Db, table: ChainedTable, afterId: number, legacy = false): number {
  const rows = db.all<Record<string, unknown>>(`SELECT * FROM ${table} WHERE id > ? ORDER BY id`, afterId)
  if (rows.length === 0) return 0
  let prev = chainHead(db)?.chainHash ?? CHAIN_GENESIS
  const now = new Date().toISOString()
  for (const row of rows) {
    const id = Number(row.id)
    const h = rowHash(table, row)
    prev = linkHash(prev, table, id, h)
    db.run('INSERT INTO integrity_chain(table_name, row_id, row_hash, chain_hash, legacy, sealed_at) VALUES (?,?,?,?,?,?)', table, id, h, prev, legacy ? 1 : 0, now)
  }
  return rows.length
}

export const maxId = (db: Db, table: ChainedTable): number => Number(db.get<{ m: number | null }>(`SELECT MAX(id) AS m FROM ${table}`)?.m ?? 0)

/**
 * Starts the chain once per project. Rows written before the chain existed (projects made by an earlier app version)
 * are entered as "legacy": they are protected from now on, but a change made before this moment cannot be detected.
 */
export function startChain(db: Db): void {
  if (db.get("SELECT 1 FROM meta WHERE key = 'integrity_chain_started'")) return
  db.transaction(() => {
    for (const t of TABLE_NAMES) chainRows(db, t, 0, true)
    db.run("INSERT INTO meta(key, value) VALUES ('integrity_chain_started', ?)", new Date().toISOString())
  })
}

export interface IntegrityProblem {
  kind: 'row_changed' | 'row_missing' | 'chain_broken' | 'row_not_chained' | 'trigger_missing' | 'anchor_mismatch' | 'chain_not_started'
  table?: string
  rowId?: number
  seq?: number
  detail: string
}

export interface IntegrityReport {
  ok: boolean
  checkedAt: string
  /** Chain entries checked, and how many of them were entered after the fact (legacy). */
  entries: number
  legacyEntries: number
  head: ChainHead | null
  tables: Record<string, { rows: number; chained: number }>
  anchorsChecked: number
  problemCount: number
  /** The first 50 problems. */
  problems: IntegrityProblem[]
}

/** Names of the immutability triggers every project must have, read from the migrations themselves. */
export function expectedTriggers(): string[] {
  return MIGRATIONS.flatMap((m) => [...m.matchAll(/CREATE TRIGGER (\w+)/g)].map((x) => x[1]))
}

export interface Anchor extends ChainHead {
  /** Where the anchor was recorded, for the report. */
  source: string
}

/** Chain heads recorded in this project's backup and export manifests. */
export function recordedAnchors(db: Db): Anchor[] {
  const out: Anchor[] = []
  for (const r of db.all<{ file_name: string; kind: string; manifest_json: string }>('SELECT file_name, kind, manifest_json FROM export_record ORDER BY created_at')) {
    try {
      const a = JSON.parse(r.manifest_json)?.integrity?.head
      if (a && typeof a.seq === 'number' && typeof a.chainHash === 'string') out.push({ seq: a.seq, chainHash: a.chainHash, source: `${r.kind} ${r.file_name}` })
    } catch {
      /* a manifest that is not JSON carries no anchor */
    }
  }
  return out
}

/**
 * Recomputes the whole chain. Read-only: it can run on a project opened without the lock.
 * `anchors` are chain heads recorded elsewhere (a backup or export manifest kept outside the project folder).
 */
export function verifyIntegrity(db: Db, anchors: Anchor[] = []): IntegrityReport {
  const problems: IntegrityProblem[] = []
  let problemCount = 0
  const add = (p: IntegrityProblem) => {
    problemCount++
    if (problems.length < 50) problems.push(p)
  }
  if (!db.get("SELECT 1 FROM meta WHERE key = 'integrity_chain_started'")) add({ kind: 'chain_not_started', detail: 'This project has no integrity chain yet. Open it once in the app to start one.' })

  const present = new Set(db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'trigger'").map((r) => r.name))
  for (const t of expectedTriggers()) if (!present.has(t)) add({ kind: 'trigger_missing', detail: `The trigger ${t} that keeps records append-only is missing from the database.` })

  const entries = db.all<{ seq: number; table_name: string; row_id: number; row_hash: string; chain_hash: string; legacy: number }>('SELECT seq, table_name, row_id, row_hash, chain_hash, legacy FROM integrity_chain ORDER BY seq')
  const bySeq = new Map<number, string>()
  let prev = CHAIN_GENESIS
  let legacyEntries = 0
  const chained: Record<string, number> = Object.fromEntries(TABLE_NAMES.map((t) => [t, 0]))
  for (const e of entries) {
    const seq = Number(e.seq)
    const rowId = Number(e.row_id)
    bySeq.set(seq, e.chain_hash)
    if (e.legacy) legacyEntries++
    const table = e.table_name as ChainedTable
    if (!(table in CHAINED_TABLES)) add({ kind: 'chain_broken', seq, table: e.table_name, detail: `Chain entry ${seq} names a table that is not part of the chain.` })
    else {
      chained[table]++
      const row = db.get<Record<string, unknown>>(`SELECT * FROM ${table} WHERE id = ?`, rowId)
      if (!row) add({ kind: 'row_missing', seq, table, rowId, detail: `${table} row ${rowId} was recorded in the chain but is no longer in the table.` })
      else if (rowHash(table, row) !== e.row_hash) add({ kind: 'row_changed', seq, table, rowId, detail: `${table} row ${rowId} does not match what was recorded when it was written.` })
    }
    // Link each entry to the stored hash before it, so one damaged entry is reported once and not for every entry after it.
    if (linkHash(prev, e.table_name, rowId, e.row_hash) !== e.chain_hash) add({ kind: 'chain_broken', seq, table: e.table_name, rowId, detail: `Chain entry ${seq} does not follow from the entry before it (an entry was changed, removed or inserted).` })
    prev = e.chain_hash
  }

  const tables: IntegrityReport['tables'] = {}
  for (const t of TABLE_NAMES) {
    const rows = Number(db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`)?.n ?? 0)
    tables[t] = { rows, chained: chained[t] }
    const loose = db.all<{ id: number }>(`SELECT id FROM ${t} WHERE id NOT IN (SELECT row_id FROM integrity_chain WHERE table_name = ?) ORDER BY id LIMIT 60`, t)
    for (const r of loose) add({ kind: 'row_not_chained', table: t, rowId: Number(r.id), detail: `${t} row ${r.id} is not in the chain: it was not written by the app.` })
  }

  const allAnchors = [...recordedAnchors(db), ...anchors]
  for (const a of allAnchors) {
    const have = bySeq.get(a.seq)
    if (have !== a.chainHash)
      add({ kind: 'anchor_mismatch', seq: a.seq, detail: `The chain no longer contains the state recorded in ${a.source} (entry ${a.seq}${have === undefined ? ' is missing' : ' differs'}): records written before it were rewritten or removed.` })
  }

  const last = entries[entries.length - 1]
  return {
    ok: problemCount === 0,
    checkedAt: new Date().toISOString(),
    entries: entries.length,
    legacyEntries,
    head: last ? { seq: Number(last.seq), chainHash: last.chain_hash } : null,
    tables,
    anchorsChecked: allAnchors.length,
    problemCount,
    problems
  }
}
