import { useEffect, useState } from 'react'
import { FolderOpen, FolderPlus, FlaskConical, ArchiveRestore, Clock, ShieldCheck, WifiOff, X } from 'lucide-react'
import { call } from '../api'
import { useStore, errorText, type ProjectState } from '../store'
import { shortDate } from '../lib/format'

interface Recent {
  id: string
  name: string
  folderName: string
  openedAt: string
}

export function Welcome() {
  const [recent, setRecent] = useState<Recent[]>([])
  const [name, setName] = useState('BARI-CNS study')
  const [busy, setBusy] = useState<string | null>(null)
  const toast = useStore((s) => s.toast)
  // An encrypted backup was chosen: the main process holds the file and waits for its passphrase.
  const [locked, setLocked] = useState<{ token: string; fileName: string; wrong: boolean } | null>(null)
  const [pass, setPass] = useState('')

  type RestoreReply = null | { needsPassphrase: true; token: string; fileName: string; wrong: boolean } | { project: ProjectState; verified?: any }
  const restore = async (token?: string, passphrase?: string): Promise<ProjectState | null | { project: ProjectState; verified?: any }> => {
    const r = await call<RestoreReply>('backup:restore', token ? { token, passphrase } : {})
    if (r && 'needsPassphrase' in r) {
      setLocked({ token: r.token, fileName: r.fileName, wrong: r.wrong })
      setPass('')
      return null
    }
    setLocked(null)
    return r
  }

  useEffect(() => {
    call<Recent[]>('project:recent').then(setRecent).catch(() => setRecent([]))
  }, [])

  const run = async (key: string, fn: () => Promise<ProjectState | null | { project: ProjectState; verified?: any }>) => {
    setBusy(key)
    try {
      const r = await fn()
      const p = r && 'project' in r ? r.project : (r as ProjectState | null)
      if (r && 'verified' in r && r.verified) {
        const rec = r.verified.records
        toast(rec && !rec.ok ? 'error' : 'success', `Backup restored and verified: ${r.verified.files} files, ${r.verified.datasets} dataset version(s), integrity ${r.verified.integrity}.${rec ? (rec.ok ? ` Records verified (${rec.entries} entries).` : ` Record check found ${rec.problems} problem(s): open Verify in the sidebar.`) : ''}`)
      }
      if (p) {
        await useStore.getState().setProject(p)
        useStore.getState().setPage(p.versions.length ? 'overview' : 'overview')
        if (!p.versions.length) useStore.getState().setImportOpen(true)
      }
    } catch (e) {
      toast('error', errorText(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="welcome">
      <div className="welcome-card glass">
        <div className="stack" style={{ gap: 18 }}>
          <div>
            <div className="badge accent" style={{ marginBottom: 14 }}>Research Workspace</div>
            <h1>Explore BARI-CNS study data with its context intact.</h1>
          </div>
          <p className="lead">
            Import study workbooks, keep every source annotation and QC flag visible, build reproducible selections and charts, and export a documented context package for statisticians or AI tools.
          </p>
          <div className="stack" style={{ gap: 10 }}>
            <div className="row small muted"><WifiOff size={15} /> Works fully offline — no account, server or API key. Network access is blocked.</div>
            <div className="row small muted"><ShieldCheck size={15} /> Source files are never modified. Imports are immutable, curation is append-only.</div>
          </div>
          <form
            className="stack"
            style={{ gap: 8, marginTop: 6 }}
            onSubmit={(e) => {
              e.preventDefault()
              void run('create', () => call('project:create', { name }))
            }}
          >
            <label className="field">
              New project name
              <div className="row">
                <input className="input" style={{ flex: 1 }} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
                <button className="btn primary" type="submit" disabled={!!busy}>
                  <FolderPlus size={16} /> Create project…
                </button>
              </div>
            </label>
            <span className="small muted">You'll choose a local folder. Avoid iCloud, Dropbox, OneDrive or network drives for the active project.</span>
          </form>
        </div>
        <div className="stack" style={{ gap: 10 }}>
          <button className="action-tile" onClick={() => run('open', () => call('project:open'))} disabled={!!busy}>
            <span className="ic"><FolderOpen size={19} /></span>
            <span><div className="t">Open project</div><div className="s">Choose an existing .bariproj folder</div></span>
          </button>
          <button className="action-tile" onClick={() => run('demo', () => call('project:openDemo'))} disabled={!!busy}>
            <span className="ic" style={{ background: 'var(--violet-soft)', color: 'var(--violet)' }}><FlaskConical size={19} /></span>
            <span><div className="t">Open synthetic demo</div><div className="s">24 invented participants (DEMO-xx) with legend, QC flags and comments</div></span>
          </button>
          <button className="action-tile" onClick={() => run('restore', () => restore())} disabled={!!busy}>
            <span className="ic" style={{ background: 'var(--ok-soft)', color: 'var(--ok)' }}><ArchiveRestore size={19} /></span>
            <span><div className="t">Restore a backup</div><div className="s">Verifies checksums and observations before opening</div></span>
          </button>
          {locked && (
            <form className="paper card stack" style={{ gap: 8 }} data-testid="restore-passphrase" onSubmit={(e) => { e.preventDefault(); if (pass) run('restore', () => restore(locked.token, pass)) }}>
              <strong>{locked.fileName} is encrypted</strong>
              {locked.wrong && <p className="small" style={{ margin: 0, color: 'var(--danger)' }} role="alert">That passphrase does not open this backup (or the file is damaged). Try again.</p>}
              <label className="field">
                Passphrase
                <input className="input" type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoFocus autoComplete="off" aria-label="Backup passphrase" />
              </label>
              <div className="row" style={{ gap: 6 }}>
                <button className="btn primary sm" type="submit" disabled={!pass || !!busy}>Restore</button>
                <button className="btn ghost sm" type="button" onClick={() => setLocked(null)}>Cancel</button>
              </div>
            </form>
          )}
          <div className="group-label" style={{ marginTop: 6 }}>Recent projects</div>
          {recent.length === 0 && <div className="muted small" style={{ padding: '0 10px' }}>No recent projects on this computer.</div>}
          <div className="list">
            {recent.map((r) => (
              <div key={r.id} className="row">
                <button className="list-item" onClick={() => run(r.id, () => call('project:openRecent', { id: r.id }))} disabled={!!busy}>
                  <Clock size={15} className="muted" />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="t">{r.name}</div>
                    <div className="s">{r.folderName} · opened {shortDate(r.openedAt)}</div>
                  </div>
                </button>
                <button
                  className="btn ghost sm icon"
                  aria-label={`Remove ${r.name} from recent list`}
                  onClick={async () => {
                    await call('project:forgetRecent', { id: r.id })
                    setRecent(recent.filter((x) => x.id !== r.id))
                  }}
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
