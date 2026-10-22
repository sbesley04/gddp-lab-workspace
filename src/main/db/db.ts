// Thin wrapper over node:sqlite (built into Electron's Node runtime: no native modules to rebuild).
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import { MIGRATIONS } from './migrations'

export type Row = Record<string, any>

export class Db {
  readonly raw: DatabaseSync
  private cache = new Map<string, StatementSync>()
  private depth = 0

  constructor(path: string, opts: { readOnly?: boolean } = {}) {
    this.raw = new DatabaseSync(path, { readOnly: opts.readOnly ?? false })
    // Rollback journal (not WAL): a single file plus a transient journal is safer to copy and back up,
    // and avoids WAL's shared-memory requirements on network filesystems.
    this.raw.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 3000;')
  }

  stmt(sql: string): StatementSync {
    let s = this.cache.get(sql)
    if (!s) {
      s = this.raw.prepare(sql)
      this.cache.set(sql, s)
    }
    return s
  }

  run(sql: string, ...params: any[]) {
    return this.stmt(sql).run(...params)
  }

  get<T = Row>(sql: string, ...params: any[]): T | undefined {
    return this.stmt(sql).get(...params) as T | undefined
  }

  all<T = Row>(sql: string, ...params: any[]): T[] {
    return this.stmt(sql).all(...params) as T[]
  }

  exec(sql: string) {
    this.raw.exec(sql)
  }

  /** Runs fn atomically. Nested calls use savepoints. Any thrown error rolls everything back. */
  transaction<T>(fn: () => T): T {
    const sp = `sp${this.depth}`
    if (this.depth === 0) this.raw.exec('BEGIN IMMEDIATE')
    else this.raw.exec(`SAVEPOINT ${sp}`)
    this.depth++
    try {
      const out = fn()
      this.depth--
      if (this.depth === 0) this.raw.exec('COMMIT')
      else this.raw.exec(`RELEASE ${sp}`)
      return out
    } catch (e) {
      this.depth--
      if (this.depth === 0) this.raw.exec('ROLLBACK')
      else this.raw.exec(`ROLLBACK TO ${sp}; RELEASE ${sp}`)
      throw e
    }
  }

  migrate(): number {
    this.raw.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)')
    const current = (this.get<{ v: number | null }>('SELECT MAX(version) AS v FROM schema_migrations')?.v ?? 0) as number
    if (current > MIGRATIONS.length)
      throw new Error(`This project was created by a newer version of the app (schema ${current}; this app supports ${MIGRATIONS.length}). Update the app to open it.`)
    for (let v = current + 1; v <= MIGRATIONS.length; v++) {
      this.transaction(() => {
        this.raw.exec(MIGRATIONS[v - 1])
        this.run('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)', v, new Date().toISOString())
      })
    }
    return MIGRATIONS.length
  }

  close() {
    this.cache.clear()
    this.raw.close()
  }
}
