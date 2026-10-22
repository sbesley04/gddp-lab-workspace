// Consistent project backups (SQLite online backup + source snapshots + checksummed manifest) and verified restore.
import { backup as sqliteBackup } from 'node:sqlite'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync, chmodSync, mkdtempSync } from 'node:fs'
import { join, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { strToU8, unzipSync, zipSync, strFromU8 } from 'fflate'
import type { Project } from './project'
import { Project as ProjectClass } from './project'
import { MIGRATIONS } from './db/migrations'
import { Db } from './db/db'
import { datasetContentHash, sha256 } from './importService'
import { APP_VERSION } from './version'

export const BACKUP_SCHEMA = 'bari-cns-backup/1'

export interface BackupManifest {
  schema: string
  createdAt: string
  software: { name: string; version: string }
  databaseSchemaVersion: number
  project: { id: string; name: string }
  files: { path: string; sha256: string; bytes: number }[]
  datasets: { id: string; versionNumber: number; contentHash: string }[]
}

export async function createBackup(project: Project, destPath: string, author: string | null): Promise<BackupManifest> {
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
      datasets
    }
    entries['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2))
    const zip = zipSync(entries, { level: 6 })
    const tmp = `${destPath}.partial`
    writeFileSync(tmp, zip)
    renameSync(tmp, destPath)
    project.db.run('INSERT INTO export_record(id, kind, dataset_version_id, metadata_version, file_name, manifest_json, created_at) VALUES (?,?,?,?,?,?,?)', crypto.randomUUID(), 'backup', null, project.metadataVersion(), basename(destPath), JSON.stringify(manifest), manifest.createdAt)
    project.audit('project.backup', { file: basename(destPath), files: manifest.files.length }, author)
    return manifest
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

export interface RestoreResult {
  dir: string
  manifest: BackupManifest
  verified: { files: number; datasets: number; integrity: string }
}

export function restoreBackup(zipPath: string, parentDir: string, folderName?: string): RestoreResult {
  const bytes = new Uint8Array(readFileSync(zipPath))
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
    try {
      for (const d of manifest.datasets) {
        const h = datasetContentHash(p, d.id)
        if (h !== d.contentHash) throw new Error(`Observations for dataset v${d.versionNumber} do not match the backup manifest.`)
      }
      p.audit('project.restore', { from: basename(zipPath), datasets: manifest.datasets.length }, null)
    } finally {
      p.close()
    }
    return { dir, manifest, verified: { files: manifest.files.length, datasets: manifest.datasets.length, integrity } }
  } catch (e) {
    for (const f of manifest.files) if (f.path.startsWith('sources/')) try { chmodSync(join(dir, f.path), 0o644) } catch { /* ignore */ }
    rmSync(dir, { recursive: true, force: true })
    throw e
  }
}
