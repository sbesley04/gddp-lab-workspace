// Read-only access to one project for the MCP server: dataset versions, cached snapshots and the privacy policy.
// Snapshots are rebuilt whenever the project's metadata version changes, so curator edits made in the app
// while the server runs are picked up on the next call.
import type { DatasetSnapshot } from '@core/types'
import { Project } from '../main/project'
import { buildSnapshot, listVersions, type DatasetVersionSummary } from '../main/snapshot'

export interface PrivacyPolicy {
  /** Only aggregate results leave the server: no participant IDs, row numbers or individual values. */
  mode: 'aggregate'
  /** Groups and selections with fewer participants than this are suppressed. */
  minCellSize: number
}

export const DEFAULT_POLICY: PrivacyPolicy = { mode: 'aggregate', minCellSize: 5 }

/** An error whose message is meant for the model: it says what went wrong and what to do instead. */
export class ToolError extends Error {}

export class Workspace {
  private cache = new Map<string, DatasetSnapshot>()

  constructor(
    readonly project: Project,
    readonly policy: PrivacyPolicy = DEFAULT_POLICY
  ) {}

  static open(dir: string, policy: PrivacyPolicy = DEFAULT_POLICY): Workspace {
    return new Workspace(Project.openReadOnly(dir), policy)
  }

  versions(): DatasetVersionSummary[] {
    return listVersions(this.project)
  }

  /** The requested dataset version (by number), or the latest import. */
  version(versionNumber?: number): DatasetVersionSummary {
    const all = this.versions()
    if (all.length === 0) throw new ToolError('This project has no imported dataset yet. Import a workbook in the app first.')
    if (versionNumber === undefined) return all[0]
    const v = all.find((x) => x.versionNumber === versionNumber)
    if (!v) throw new ToolError(`Dataset version ${versionNumber} does not exist. Available versions: ${all.map((x) => x.versionNumber).join(', ')}.`)
    return v
  }

  metadataVersion(): number {
    return this.project.metadataVersion()
  }

  snapshot(datasetVersionId: string, asOf?: number): DatasetSnapshot {
    const at = asOf ?? this.metadataVersion()
    const key = `${datasetVersionId}@${at}`
    let snap = this.cache.get(key)
    if (!snap) {
      snap = buildSnapshot(this.project, datasetVersionId, at)
      if (this.cache.size > 8) this.cache.clear()
      this.cache.set(key, snap)
    }
    return snap
  }

  close() {
    this.project.close()
  }
}
