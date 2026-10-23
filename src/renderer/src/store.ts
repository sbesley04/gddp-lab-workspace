import { create } from 'zustand'
import type { ChartConfig, DatasetSnapshot, FilterGroup, QcCategory, SavedViewSpec } from '@core/types'
import { DEFAULT_QC_POLICY, emptyFilter } from '@core/types'
import { normalizeChart } from '@core/chartStyle'
import { call } from './api'

export interface VersionSummary {
  id: string
  versionNumber: number
  sourceFileName: string
  sha256: string
  sheetName: string
  createdAt: string
  rows: number
  columns: number
  participants: number
  events: string[]
  sourceKind: 'xlsx' | 'csv'
}

export interface ProjectState {
  id: string
  name: string
  folderName: string
  createdAt: string
  syncWarning: string | null
  metadataVersion: number
  versions: VersionSummary[]
  isDemo: boolean
}

export type Page = 'overview' | 'explore' | 'measurements' | 'quality' | 'views' | 'export'

export interface Toast {
  id: number
  kind: 'info' | 'success' | 'error'
  text: string
}

export interface ViewContext {
  id: string
  name: string
  metadataVersion: number
  changedSince: number
}

interface State {
  project: ProjectState | null
  page: Page
  versionId: string | null
  snapshot: DatasetSnapshot | null
  loading: boolean
  /** null = current metadata; a number pins the snapshot to that metadata version (saved views). */
  asOf: number | null
  viewContext: ViewContext | null
  visitIds: string[] | 'all'
  filter: FilterGroup
  qcExclude: QcCategory[]
  chart: ChartConfig
  highlight: number[] // row indexes (linked brushing)
  inspected: { row: number; variable: number | null } | null
  participantDrawer: string | null
  importOpen: boolean
  paletteOpen: boolean
  /** Statistics panel visibility (UI only); results are computed only once chart.analysis.requested is set. */
  statsOpen: boolean
  toasts: Toast[]
  authorLabel: string

  setPage: (p: Page) => void
  setProject: (p: ProjectState | null) => Promise<void>
  refreshProject: () => Promise<void>
  loadVersion: (id: string, asOf?: number | null) => Promise<void>
  reloadSnapshot: () => Promise<void>
  setFilter: (f: FilterGroup) => void
  setQcExclude: (q: QcCategory[]) => void
  setVisits: (v: string[] | 'all') => void
  setChart: (c: Partial<ChartConfig>) => void
  setHighlight: (rows: number[]) => void
  inspect: (i: { row: number; variable: number | null } | null) => void
  openParticipant: (pid: string | null) => void
  setImportOpen: (b: boolean) => void
  setPaletteOpen: (b: boolean) => void
  setStatsOpen: (b: boolean) => void
  toast: (kind: Toast['kind'], text: string) => void
  dismissToast: (id: number) => void
  applyView: (view: { id: string; name: string; metadataVersion: number; metadataChangedSince: number; spec: SavedViewSpec }, useCurrentMetadata?: boolean) => Promise<void>
  useCurrentMetadata: () => Promise<void>
  setAuthorLabel: (s: string) => void
}

export const defaultChart = (): ChartConfig => normalizeChart({ type: 'distribution', measureKey: null, compareKey: null, groupKey: null, xScale: 'linear', yScale: 'linear', tableColumns: [] })

function pickDefaults(s: DatasetSnapshot): Partial<ChartConfig> {
  const numeric = s.variables.filter((v) => v.role === 'measure' && (v.kind === 'numeric' || v.kind === 'mixed'))
  const by = (re: RegExp) => numeric.find((v) => re.test(v.header))
  const measure = by(/^IL6$/i) ?? numeric[0]
  const compare = by(/PHQ/i) ?? numeric.find((v) => v !== measure)
  return { measureKey: measure?.key ?? null, compareKey: compare?.key ?? null }
}

let toastSeq = 0

export const useStore = create<State>((set, get) => ({
  project: null,
  page: 'overview',
  versionId: null,
  snapshot: null,
  loading: false,
  asOf: null,
  viewContext: null,
  visitIds: 'all',
  filter: emptyFilter(),
  qcExclude: [...DEFAULT_QC_POLICY.exclude],
  chart: defaultChart(),
  highlight: [],
  inspected: null,
  participantDrawer: null,
  importOpen: false,
  paletteOpen: false,
  statsOpen: false,
  toasts: [],
  authorLabel: '',

  setPage: (page) => set({ page }),
  setProject: async (project) => {
    set({ project, snapshot: null, versionId: null, asOf: null, viewContext: null, filter: emptyFilter(), qcExclude: [...DEFAULT_QC_POLICY.exclude], visitIds: 'all', chart: defaultChart(), highlight: [], inspected: null })
    if (project?.versions[0]) await get().loadVersion(project.versions[0].id)
  },
  refreshProject: async () => {
    const p = await call<ProjectState | null>('project:current')
    set({ project: p })
  },
  loadVersion: async (id, asOf = null) => {
    set({ loading: true })
    try {
      const snapshot = await call<DatasetSnapshot>('data:snapshot', { datasetVersionId: id, asOf })
      const prev = get().snapshot
      const sameVersion = prev?.datasetVersionId === id
      const chart = sameVersion ? get().chart : { ...defaultChart(), ...pickDefaults(snapshot) }
      set({ snapshot, versionId: id, asOf, chart, ...(sameVersion ? {} : { filter: emptyFilter(), visitIds: 'all' as const, highlight: [], inspected: null }) })
    } finally {
      set({ loading: false })
    }
  },
  reloadSnapshot: async () => {
    const { versionId, asOf } = get()
    if (versionId) await get().loadVersion(versionId, asOf)
    await get().refreshProject()
  },
  setFilter: (filter) => set({ filter, highlight: [] }),
  setQcExclude: (qcExclude) => set({ qcExclude }),
  setVisits: (visitIds) => set({ visitIds }),
  setChart: (c) => set({ chart: { ...get().chart, ...c } }),
  setHighlight: (highlight) => set({ highlight }),
  inspect: (inspected) => set({ inspected }),
  openParticipant: (participantDrawer) => set({ participantDrawer }),
  setImportOpen: (importOpen) => set({ importOpen }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setStatsOpen: (statsOpen) => set({ statsOpen }),
  toast: (kind, text) => {
    const id = ++toastSeq
    set({ toasts: [...get().toasts, { id, kind, text }] })
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 9000 : 4500)
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  applyView: async (view, useCurrent = false) => {
    const sel = view.spec.selection
    await get().loadVersion(sel.datasetVersionId, useCurrent ? null : view.metadataVersion)
    set({
      filter: sel.filter,
      qcExclude: sel.qc.exclude,
      visitIds: sel.visitIds,
      chart: normalizeChart(view.spec.chart),
      statsOpen: !!view.spec.chart.analysis?.requested,
      viewContext: { id: view.id, name: view.name, metadataVersion: view.metadataVersion, changedSince: useCurrent ? 0 : view.metadataChangedSince },
      page: view.spec.chart.type === 'table' ? 'explore' : 'explore'
    })
  },
  useCurrentMetadata: async () => {
    const { versionId } = get()
    if (!versionId) return
    await get().loadVersion(versionId, null)
    set({ viewContext: null })
  },
  setAuthorLabel: (authorLabel) => set({ authorLabel })
}))

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))
