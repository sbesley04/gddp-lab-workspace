// Consistent project backups (SQLite online backup + source snapshots + checksummed manifest) and verified restore.
// A backup holds the whole project: source identifiers and the secret behind pseudonymous export keys. It can be
// encrypted with a passphrase (AES-256-GCM, key from scrypt). There is no recovery if the passphrase is lost.
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { backup as sqliteBackup } from 'node:sqlite'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync, chmodSync, mkdtempSync } from 'node:fs'
import { removeTree } from './fsutil'
import { join, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { strToU8, unzipSync, zipSync, strFromU8 } from 'fflate'
import type { Project } from './project'
import { Project as ProjectClass } from './project'
import { MIGRATIONS } from './db/migrations'
import { Db } from './db/db'
import { datasetContentHash, sha256 } from './importService'
import { APP_VERSION } from './version'
import { chainHead, verifyIntegrity, type ChainHead } from './integrity'

export const BACKUP_SCHEMA = 'bari-cns-backup/1'

// ---- encryption: MAGIC (8) | salt (16) | nonce (12) | ciphertext | GCM tag (16). The header is authenticated.
const MAGIC = Buffer.from('BARIENC1', 'ascii')
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 }
export const MIN_PASSPHRASE = 8

export class BackupPassphraseError extends Error {
  constructor(readonly reason: 'required' | 'wrong') {
    super(reason === 'required' ? 'This backup is encrypted. Enter its passphrase to restore it.' : 'That passphrase does not open this backup (or the file is damaged).')
  }
}

const keyFrom = (passphrase: string, salt: Buffer) => scryptSync(passphrase.normalize('NFKC'), salt, 32, SCRYPT)

export function isEncryptedBackup(bytes: Uint8Array): boolean {
  return bytes.length > MAGIC.length && Buffer.from(bytes.buffer, bytes.byteOffset, MAGIC.length).equals(MAGIC)
}

export function encryptBackup(zip: Uint8Array, passphrase: string): Buffer {
  if (passphrase.length < MIN_PASSPHRASE) throw new Error(`Use a passphrase of at least ${MIN_PASSPHRASE} characters.`)
  const salt = randomBytes(16)
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', keyFrom(passphrase, salt), nonce)
  const header = Buffer.concat([MAGIC, salt, nonce])
  cipher.setAAD(header)
  const body = Buffer.concat([cipher.update(zip), cipher.final()])
  return Buffer.concat([header, body, cipher.getAuthTag()])
}

export function decryptBackup(bytes: Uint8Array, passphrase: string): Uint8Array {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (buf.length < MAGIC.length + 16 + 12 + 16) throw new BackupPassphraseError('wrong')
  const header = buf.subarray(0, MAGIC.length + 28)
  const salt = header.subarray(MAGIC.length, MAGIC.length + 16)
  const nonce = header.subarray(MAGIC.length + 16)
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(passphrase, salt), nonce)
  decipher.setAAD(header)
  decipher.setAuthTag(buf.subarray(buf.length - 16))
  try {
    return new Uint8Array(Buffer.concat([decipher.update(buf.subarray(header.length, buf.length - 16)), decipher.final()]))
  } catch {
    // GCM cannot tell a wrong passphrase from a changed file: both fail authentication.
    throw new BackupPassphraseError('wrong')
  }
}

export interface BackupManifest {
  schema: string
  createdAt: string
  software: { name: string; version: string }
  databaseSchemaVersion: number
  project: { id: string; name: string }
  files: { path: string; sha256: string; bytes: number }[]
  datasets: { id: string; versionNumber: number; contentHash: string }[]
  /** Head of the integrity chain when the backup was made: an anchor for later verification (absent in older backups). */
  integrity?: { head: ChainHead | null }
}

export async function createBackup(project: Project, destPath: string, author: string | null, opts: { passphrase?: string | null } = {}): Promise<BackupManifest> {
  const passphrase = opts.passphrase || null
  const work = mkdtempSync(join(tmpdir(), 'bari-backup-'))
  try {
    const dbCopy = join(work, 'workspace.sqlite')
    // Online backup gives a consistent copy even while the project is open.
    await sqliteBackup(project.db.raw, dbCopy)
    const entries: Record<string, Uint8Array> = {}
    entries['workspace.sqlite'] = new Uint8Array(readFileSync(dbCopy))
    entries['project.json'] = new Uint8Array(readFileSync(join(project.dir, 'project.json')))
    for (const f of readdirSync(project.sourcesDir)) if (!f.endsWith('.partial')) entries[`sources/${f}`] = new Uint8Array(readFileSync(join(project.sourcesDir, f)))
    const datasets = project.db.all<any>('SELECT id, version_number, content_hash FROM dataset_version ORDER BY version_number').map((d) => ({ id: d.id, versionNumber: d.version_number, contentHash: d.content_hash }))
    const manifest: BackupManifest = {
      schema: BACKUP_SCHEMA,
      createdAt: new Date().toISOString(),
      software: { name: 'BARI-CNS Research Workspace', version: APP_VERSION },
      databaseSchemaVersion: MIGRATIONS.length,
      project: { id: project.info.id, name: project.info.name },
      files: Object.entries(entries).map(([path, u8]) => ({ path, sha256: sha256(u8), bytes: u8.byteLength })),
      datasets,
      integrity: { head: chainHead(project.db) }
    }
    entries['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2))
    const zip = zipSync(entries, { level: 6 })
    const tmp = `${destPath}.partial`
    writeFileSync(tmp, passphrase ? encryptBackup(zip, passphrase) : zip)
    renameSync(tmp, destPath)
    project.db.run('INSERT INTO export_record(id, kind, dataset_version_id, metadata_version, file_name, manifest_json, created_at) VALUES (?,?,?,?,?,?,?)', crypto.randomUUID(), 'backup', null, project.metadataVersion(), basename(destPath), JSON.stringify({ ...manifest, encrypted: !!passphrase }), manifest.createdAt)
    project.audit('project.backup', { file: basename(destPath), files: manifest.files.length, encrypted: !!passphrase }, author)
    return manifest
  } finally {
    removeTree(work)
  }
}

export interface RestoreResult {
  dir: string
  manifest: BackupManifest
  /** `integrity` is SQLite's own check; `records` is the hash chain over the audit log, revisions and analysis register. */
  verified: { files: number; datasets: number; integrity: string; records: { ok: boolean; entries: number; problems: number } }
}

/** Reads a backup file, decrypting it when needed. Throws BackupPassphraseError when a passphrase is missing or wrong. */
export function readBackupBytes(zipPath: string, passphrase?: string | null): Uint8Array {
  const raw = new Uint8Array(readFileSync(zipPath))
  if (!isEncryptedBackup(raw)) return raw
  if (!passphrase) throw new BackupPassphraseError('required')
  return decryptBackup(raw, passphrase)
}

export function restoreBackup(zipPath: string, parentDir: string, folderName?: string, passphrase?: string | null): RestoreResult {
  const bytes = readBackupBytes(zipPath, passphrase)
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(bytes)
  } catch {
    throw new Error('This file is not a readable backup package.')
  }
  const mf = entries['manifest.json']
  if (!mf) throw new Error('Backup manifest is missing.')
  const manifest = JSON.parse(strFromU8(mf)) as BackupManifest
  if (manifest.schema !== BACKUP_SCHEMA) throw new Error('Unsupported backup format.')
  if (manifest.databaseSchemaVersion > MIGRATIONS.length) throw new Error('This backup was made by a newer version of the app.')
  for (const f of manifest.files) {
    const u8 = entries[f.path]
    if (!u8) throw new Error(`Backup is incomplete: ${f.path} is missing.`)
    if (sha256(u8) !== f.sha256) throw new Error(`Checksum mismatch for ${f.path}; the backup is damaged.`)
    if (f.path.includes('..') || f.path.startsWith('/')) throw new Error('Backup contains an unsafe path.')
  }
  const safeName = (folderName ?? `${manifest.project.name} (restored)`).replace(/[\\/:*?"<>|]+/g, '-')
  const dir = join(parentDir, safeName.endsWith('.bariproj') ? safeName : `${safeName}.bariproj`)
  if (existsSync(dir)) throw new Error(`A folder named "${basename(dir)}" already exists.`)
  mkdirSync(join(dir, 'sources'), { recursive: true })
  try {
    for (const f of manifest.files) {
      const target = join(dir, f.path)
      writeFileSync(target, entries[f.path])
      if (f.path.startsWith('sources/')) chmodSync(target, 0o444)
    }
    const db = new Db(join(dir, 'workspace.sqlite'))
    const integrity = db.get<{ integrity_check: string }>('PRAGMA integrity_check')?.integrity_check ?? 'unknown'
    db.close()
    if (integrity !== 'ok') throw new Error(`Restored database failed its integrity check (${integrity}).`)
    const p = ProjectClass.open(dir)
    let records = { ok: true, entries: 0, problems: 0 }
    try {
      for (const d of manifest.datasets) {
        const h = datasetContentHash(p, d.id)
        if (h !== d.contentHash) throw new Error(`Observations for dataset v${d.versionNumber} do not match the backup manifest.`)
      }
      // The records are checked against the chain head the backup itself recorded. A problem is reported, not fatal:
      // a backup of a project with a damaged record is still the best copy of its data.
      const head = manifest.integrity?.head
      const report = verifyIntegrity(p.db, head ? [{ ...head, source: `the manifest of ${basename(zipPath)}` }] : [])
      records = { ok: report.ok, entries: report.entries, problems: report.problemCount }
      p.audit('project.restore', { from: basename(zipPath), datasets: manifest.datasets.length, recordsOk: report.ok }, null)
    } finally {
      p.close()
    }
    return { dir, manifest, verified: { files: manifest.files.length, datasets: manifest.datasets.length, integrity, records } }
  } catch (e) {
    removeTree(dir)
    throw e
  }
}
