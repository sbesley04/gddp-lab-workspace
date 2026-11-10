// Project folders: <Name>.bariproj/ containing project.json, workspace.sqlite, sources/ and a .lock file.
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, renameSync } from 'node:fs'
import { join, basename, resolve } from 'node:path'
import { hostname } from 'node:os'
import { randomBytes, randomUUID } from 'node:crypto'
import { Db } from './db/db'
import { MIGRATIONS } from './db/migrations'

export const PROJECT_SCHEMA = 'bari-cns-project'
export const PROJECT_FORMAT_VERSION = 1

export interface ProjectInfo {
  id: string
  name: string
  createdAt: string
  formatVersion: number
}

export interface LockInfo {
  pid: number
  host: string
  at: string
  sessionId: string
}

export class ProjectLockedError extends Error {
  constructor(public lock: LockInfo) {
    super(`This project appears to be open in another app session (host ${lock.host}, since ${lock.at}).`)
  }
}

/** What to tell the user about a locked project. A lock from another computer never clears by itself, e.g. in a copied folder. */
export function lockedProjectMessage(e: ProjectLockedError, thisHost = hostname()): string {
  if (e.lock.host === thisHost) return `${e.message} Close other copies of the app and try again. If that session crashed, the lock clears automatically on this computer.`
  return (
    `${e.message} Close the app on that computer first. If nobody has it open there (for example, the folder was copied from another computer), ` +
    'delete the hidden ".lock" file inside the project folder and try again. To move a project between computers, use Backup and Restore instead of copying the folder.'
  )
}

/** Heuristic: folders managed by sync clients or network volumes are unsafe for a live SQLite database. */
export function syncFolderWarning(path: string): string | null {
  // Forward slashes, so the same patterns work for Windows paths (\\server\share becomes //server/share).
  const forward = (s: string) => s.replace(/\\/g, '/')
  const candidates = [forward(path), forward(resolve(path))]
  const patterns: [RegExp, string][] = [
    [/Library\/Mobile Documents|iCloud ?Drive|com~apple~CloudDocs/i, 'iCloud Drive'],
    [/Dropbox/i, 'Dropbox'],
    [/OneDrive/i, 'OneDrive'],
    [/Google ?Drive|GoogleDrive|My Drive/i, 'Google Drive'],
    [/Box Sync|\/Box\//i, 'Box'],
    [/^\/Volumes\//, 'a network or external volume'],
    [/^\\\\|^\/\/|^\/net\//, 'a network share']
  ]
  for (const [re, name] of patterns)
    if (candidates.some((c) => re.test(c)))
      return `This folder looks like it is on ${name}. Keep the active project on a local disk: sync and network folders can corrupt a live database or create conflicting copies. Share work with Backup / Export packages instead.`
  return null
}

export class Project {
  readonly db: Db
  readonly info: ProjectInfo
  readonly sessionId = randomUUID()

  private constructor(readonly dir: string, info: ProjectInfo, readonly readOnly = false) {
    this.info = info
    this.db = new Db(join(dir, 'workspace.sqlite'), { readOnly })
    if (!readOnly) {
      this.db.migrate()
      return
    }
    // A read-only reader never migrates, so it must match the schema this code understands exactly.
    let v = 0
    try {
      v = this.db.get<{ v: number | null }>('SELECT MAX(version) AS v FROM schema_migrations')?.v ?? 0
    } catch {
      v = 0
    }
    if (v !== MIGRATIONS.length) {
      this.db.close()
      throw new Error(
        v > MIGRATIONS.length
          ? `This project was created by a newer version of the app (schema ${v}; this reader supports ${MIGRATIONS.length}).`
          : `This project uses an older schema (${v}). Open it once in the app to upgrade it, then try again.`
      )
    }
  }

  get sourcesDir() {
    return join(this.dir, 'sources')
  }

  static create(parentDir: string, name: string): Project {
    const safe = name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'BARI-CNS project'
    const dir = join(parentDir, safe.endsWith('.bariproj') ? safe : `${safe}.bariproj`)
    if (existsSync(dir)) throw new Error(`A folder named "${basename(dir)}" already exists here.`)
    mkdirSync(join(dir, 'sources'), { recursive: true })
    const info: ProjectInfo = { id: randomUUID(), name: name.trim() || 'BARI-CNS project', createdAt: new Date().toISOString(), formatVersion: PROJECT_FORMAT_VERSION }
    writeFileSync(join(dir, 'project.json'), JSON.stringify({ schema: PROJECT_SCHEMA, ...info }, null, 2))
    const p = Project.open(dir)
    p.db.transaction(() => {
      p.db.run('INSERT INTO meta(key, value) VALUES (?, ?)', 'project_id', info.id)
      // Secret used to derive pseudonymous participant keys for exports. Never exported.
      p.db.run('INSERT INTO meta(key, value) VALUES (?, ?)', 'pseudonym_secret', randomBytes(32).toString('hex'))
      p.audit('project.create', { name: info.name })
    })
    return p
  }

  static readInfo(dir: string): ProjectInfo {
    const file = join(dir, 'project.json')
    if (!existsSync(file)) throw new Error('This folder is not a BARI-CNS project (project.json is missing).')
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    if (raw.schema !== PROJECT_SCHEMA) throw new Error('project.json is not a BARI-CNS project file.')
    if (raw.formatVersion > PROJECT_FORMAT_VERSION) throw new Error('This project was created by a newer version of the app.')
    return { id: raw.id, name: raw.name, createdAt: raw.createdAt, formatVersion: raw.formatVersion }
  }

  static open(dir: string, opts: { force?: boolean } = {}): Project {
    const info = Project.readInfo(dir)
    const lockFile = join(dir, '.lock')
    if (existsSync(lockFile) && !opts.force) {
      try {
        const lock = JSON.parse(readFileSync(lockFile, 'utf8')) as LockInfo
        const sameHostDead = lock.host === hostname() && !processAlive(lock.pid)
        if (!sameHostDead) throw new ProjectLockedError(lock)
      } catch (e) {
        if (e instanceof ProjectLockedError) throw e
      }
    }
    const p = new Project(dir, info)
    const lock: LockInfo = { pid: process.pid, host: hostname(), at: new Date().toISOString(), sessionId: p.sessionId }
    const tmp = `${lockFile}.tmp`
    writeFileSync(tmp, JSON.stringify(lock))
    renameSync(tmp, lockFile)
    return p
  }

  /**
   * Opens a project for reading only: no lock is taken or checked, no migration runs and SQLite refuses writes.
   * Safe to use while the app has the same project open (used by the MCP server).
   */
  static openReadOnly(dir: string): Project {
    const info = Project.readInfo(dir)
    if (!existsSync(join(dir, 'workspace.sqlite'))) throw new Error('This project folder has no workspace.sqlite.')
    return new Project(dir, info, true)
  }

  meta(key: string): string | null {
    return this.db.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', key)?.value ?? null
  }

  audit(action: string, detail: unknown, author: string | null = null) {
    this.db.run('INSERT INTO audit_log(at, action, detail_json, author_label) VALUES (?, ?, ?, ?)', new Date().toISOString(), action, JSON.stringify(detail ?? null), author)
  }

  metadataVersion(): number {
    return this.db.get<{ v: number | null }>('SELECT MAX(id) AS v FROM revision')?.v ?? 0
  }

  close() {
    if (this.readOnly) {
      this.db.close()
      return
    }
    try {
      this.db.close()
    } finally {
      const lockFile = join(this.dir, '.lock')
      try {
        const lock = JSON.parse(readFileSync(lockFile, 'utf8')) as LockInfo
        if (lock.sessionId === this.sessionId) unlinkSync(lockFile)
      } catch {
        /* lock already gone */
      }
    }
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}
