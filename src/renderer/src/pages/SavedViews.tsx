import { useEffect, useState } from 'react'
import { BookmarkCheck, Trash2, Play, AlertTriangle } from 'lucide-react'
import type { SavedViewSpec } from '@core/types'
import { call } from '../api'
import { useStore, errorText } from '../store'
import { shortDate, qcPolicyText } from '../lib/format'

interface View {
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
  metadataChangedSince: number
}

export function SavedViews() {
  const [views, setViews] = useState<View[] | null>(null)
  const toast = useStore((s) => s.toast)
  const snapshot = useStore((s) => s.snapshot)
  const load = () => call<View[]>('views:list').then(setViews).catch((e) => { toast('error', errorText(e)); setViews([]) })
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot?.metadataVersion])
  const open = async (v: View, current = false) => {
    try {
      const fresh = await call<View>('views:get', { id: v.id })
      await useStore.getState().applyView(fresh, current)
      toast('info', current ? `Opened “${v.name}” with current metadata.` : `Reproduced “${v.name}” as saved.`)
    } catch (e) {
      toast('error', errorText(e))
    }
  }
  const remove = async (v: View) => {
    if (!confirm(`Delete saved view “${v.name}”? This cannot be undone (the deletion is recorded in the audit log).`)) return
    await call('views:delete', { id: v.id })
    void load()
  }
  return (
    <>
      <header className="topbar drag">
        <div>
          <h2>Saved views</h2>
          <div className="subtitle">Reproducible selections pinned to a dataset version and metadata version</div>
        </div>
      </header>
      <div className="content">
        {views && views.length === 0 && (
          <div className="paper empty">
            <div className="ic"><BookmarkCheck /></div>
            <h3>No saved views yet</h3>
            <p>In Explore, set up a selection and chart, then choose “Save view”.</p>
          </div>
        )}
        <div className="grid cols-2">
          {views?.map((v) => (
            <div key={v.id} className="paper card" data-testid="saved-view">
              <div className="card-head">
                <h3 style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.name}</h3>
                <span className="spacer" />
                <button className="btn ghost sm icon" aria-label={`Delete ${v.name}`} onClick={() => remove(v)}><Trash2 size={14} /></button>
              </div>
              {v.description && <p className="small" style={{ marginTop: 0 }}>{v.description}</p>}
              <div className="kv small">
                <div className="k">Dataset</div><div>v{v.datasetVersionNumber}</div>
                <div className="k">Metadata</div><div>rev. {v.metadataVersion}{v.metadataChangedSince > 0 && <span className="badge warn" style={{ marginLeft: 6 }}><AlertTriangle size={11} /> {v.metadataChangedSince} change(s) since</span>}</div>
                <div className="k">Chart</div><div>{v.spec.chart.type} · {v.spec.chart.xScale}/{v.spec.chart.yScale}</div>
                <div className="k">Cohort</div><div>{v.spec.selection.filter.children.length ? `${v.spec.selection.filter.children.length} condition(s)` : 'All rows'}</div>
                <div className="k">QC policy</div><div>{qcPolicyText(v.spec.selection.qc.exclude)}</div>
                <div className="k">Saved</div><div>{shortDate(v.createdAt)} · {v.author ?? 'no label'} · app {v.appVersion}</div>
              </div>
              <div className="row" style={{ marginTop: 12 }}>
                <button className="btn primary sm" onClick={() => open(v)} data-testid="open-view"><Play size={13} /> Open as saved</button>
                {v.metadataChangedSince > 0 && <button className="btn sm" onClick={() => open(v, true)}>Open with current metadata</button>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
