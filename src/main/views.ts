// Saved views: immutable specs pinned to a dataset version and a metadata version.
import { randomUUID } from 'node:crypto'
import type { SavedViewSpec } from '@core/types'
import type { Project } from './project'
import { APP_VERSION } from './version'

export interface SavedViewRecord {
  id: string
  name: string
  description: string | null
  datasetVersionId: string
  datasetVersionNumber: number
  metadataVersion: number
  spec: SavedViewSpec
  appVersion: string
  createdAt: string
  author: string | null
  metadataChangedSince: number // count of revisions on this dataset version after the saved metadata version
}

export function saveView(project: Project, input: { name: string; description: string | null; spec: SavedViewSpec; metadataVersion: number; author: string | null }): SavedViewRecord {
  const name = input.name.trim()
  if (!name) throw new Error('A view needs a name.')
  if (!project.db.get('SELECT 1 FROM dataset_version WHERE id = ?', input.spec.selection.datasetVersionId)) throw new Error('Dataset version not found.')
  if (input.metadataVersion > project.metadataVersion()) throw new Error('Metadata version is newer than this project.')
  const id = randomUUID()
  const now = new Date().toISOString()
  project.db.transaction(() => {
    project.db.run(
      'INSERT INTO saved_view(id, name, description, dataset_version_id, metadata_version, spec_json, app_version, created_at, author_label) VALUES (?,?,?,?,?,?,?,?,?)',
      id, name, input.description, input.spec.selection.datasetVersionId, input.metadataVersion, JSON.stringify(input.spec), APP_VERSION, now, input.author
    )
    project.audit('view.save', { id, name }, input.author)
  })
  return getView(project, id)!
}

export function listViews(project: Project): SavedViewRecord[] {
  return project.db.all<any>('SELECT id FROM saved_view ORDER BY created_at DESC').map((r) => getView(project, r.id)!)
}

export function getView(project: Project, id: string): SavedViewRecord | null {
  const r = project.db.get<any>(
    'SELECT sv.*, dv.version_number FROM saved_view sv JOIN dataset_version dv ON dv.id = sv.dataset_version_id WHERE sv.id = ?',
    id
  )
  if (!r) return null
  const changed = project.db.get<{ n: number }>('SELECT COUNT(*) n FROM revision WHERE dataset_version_id = ? AND id > ?', r.dataset_version_id, r.metadata_version)?.n ?? 0
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    datasetVersionId: r.dataset_version_id,
    datasetVersionNumber: r.version_number,
    metadataVersion: r.metadata_version,
    spec: JSON.parse(r.spec_json),
    appVersion: r.app_version,
    createdAt: r.created_at,
    author: r.author_label,
    metadataChangedSince: changed
  }
}

export function deleteView(project: Project, id: string, author: string | null) {
  project.db.transaction(() => {
    project.db.run('DELETE FROM saved_view WHERE id = ?', id)
    project.audit('view.delete', { id }, author)
  })
}
