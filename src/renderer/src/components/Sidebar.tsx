import { useMemo, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { BarChart3, BookmarkCheck, ClipboardList, Home, Search, HelpCircle, LogOut, PackageOpen, ShieldCheck, Upload, Archive, UserRound, ChevronsUpDown, Check } from 'lucide-react'
import { call } from '../api'
import { useStore, errorText, type Page } from '../store'
import { shortDate } from '../lib/format'

export const MOD = typeof window !== 'undefined' && window.bari?.platform === 'darwin' ? '⌘' : 'Ctrl '

export const NAV: { page: Page; label: string; icon: React.ReactNode }[] = [
  { page: 'overview', label: 'Overview', icon: <Home size={18} /> },
  { page: 'explore', label: 'Explore data', icon: <BarChart3 size={18} /> },
  { page: 'measurements', label: 'Measurements', icon: <ClipboardList size={18} /> },
  { page: 'quality', label: 'Data quality', icon: <ShieldCheck size={18} /> },
  { page: 'views', label: 'Saved views', icon: <BookmarkCheck size={18} /> },
  { page: 'export', label: 'Export', icon: <PackageOpen size={18} /> }
]

export function Sidebar() {
  const page = useStore((s) => s.page)
  const setPage = useStore((s) => s.setPage)
  const project = useStore((s) => s.project)!
  const snapshot = useStore((s) => s.snapshot)
  const versionId = useStore((s) => s.versionId)
  const toast = useStore((s) => s.toast)

  const reviewCount = useMemo(() => {
    if (!snapshot) return 0
    return new Set(snapshot.flags.filter((f) => f.status === 'needs_review').map((f) => f.formatKey + f.kind)).size
  }, [snapshot])

  const closeProject = async () => {
    await call('project:close')
    await useStore.getState().setProject(null)
  }
  const backup = async () => {
    try {
      const r = await call<{ fileName: string; files: number } | null>('backup:create')
      if (r) toast('success', `Backup saved: ${r.fileName} (${r.files} files, checksummed).`)
    } catch (e) {
      toast('error', errorText(e))
    }
  }

  return (
    <aside className="sidebar glass drag" aria-label="Navigation">
      <div className="brand">
        <h1>BARI-CNS</h1>
        <p>Research Workspace</p>
      </div>
      {snapshot && (
        <button className="search-btn no-drag" data-tour="search" onClick={() => useStore.getState().setPaletteOpen(true)} aria-label="Open measure search">
          <Search size={15} /> Search measures <span className="kbd">{MOD}K</span>
        </button>
      )}
      <nav className="nav no-drag" data-tour="nav">
        {NAV.map((n, i) => (
          <button key={n.page} data-tour={`nav-${n.page}`} aria-current={page === n.page ? 'page' : undefined} onClick={() => setPage(n.page)} disabled={!snapshot && n.page !== 'overview'} title={`${n.label} (${MOD}${i + 1})`}>
            {n.icon}
            <span>{n.label}</span>
            {n.page === 'quality' && reviewCount > 0 ? <span className="count" title="Formatting interpretations needing review">{reviewCount}</span> : <span className="key" aria-hidden>{MOD}{i + 1}</span>}
          </button>
        ))}
      </nav>
      <div className="sidebar-foot no-drag">
        <button className="btn" onClick={() => useStore.getState().setImportOpen(true)}>
          <Upload size={15} /> Import workbook
        </button>
        <div className="project-card">
          <div className="name" title={project.name}>
            {project.name} {project.isDemo && <span className="badge accent">Synthetic</span>}
          </div>
          <div className="sub" title={project.folderName}>{project.folderName}</div>
          {project.versions.length > 0 && <VersionSwitcher />}
          <div className="row" style={{ marginTop: 8, gap: 4 }}>
            <button className="btn ghost sm" onClick={backup} title="Back up project (consistent, checksummed package)">
              <Archive size={14} /> Backup
            </button>
            <button className="btn ghost sm" onClick={closeProject} title="Close project">
              <LogOut size={14} /> Close
            </button>
          </div>
        </div>
        <div className="row" style={{ gap: 4 }}>
          <AuthorLabel />
          <span className="spacer" />
          <button className="btn ghost sm icon" title="Take the tour" aria-label="Take the tour" onClick={() => useStore.getState().startTour()} disabled={!snapshot}>
            <HelpCircle size={15} />
          </button>
        </div>
      </div>
      {!versionId && project.versions.length === 0 && <span className="sr-only">No dataset imported yet</span>}
    </aside>
  )
}

function VersionSwitcher() {
  const project = useStore((s) => s.project)!
  const versionId = useStore((s) => s.versionId)
  const current = project.versions.find((v) => v.id === versionId)
  const [open, setOpen] = useState(false)
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button className="btn ghost sm" style={{ marginTop: 6, width: '100%', justifyContent: 'space-between' }} aria-label="Switch dataset version">
          <span>Dataset v{current?.versionNumber ?? '—'}</span>
          <ChevronsUpDown size={13} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="popover" side="right" align="end" sideOffset={10} style={{ width: 320 }}>
          <div className="group-label">Dataset versions (immutable)</div>
          <div className="list">
            {project.versions.map((v) => (
              <button
                key={v.id}
                className="list-item"
                aria-selected={v.id === versionId}
                onClick={async () => {
                  setOpen(false)
                  useStore.setState({ viewContext: null })
                  await useStore.getState().loadVersion(v.id, null)
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="t">v{v.versionNumber} · {v.sourceFileName}</div>
                  <div className="s">{shortDate(v.createdAt)} · {v.participants} participants · {v.columns} columns · sha {v.sha256.slice(0, 8)}</div>
                </div>
                {v.id === versionId && <Check size={15} />}
              </button>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function AuthorLabel() {
  const authorLabel = useStore((s) => s.authorLabel)
  const [draft, setDraft] = useState(authorLabel)
  const [open, setOpen] = useState(false)
  return (
    <Popover.Root open={open} onOpenChange={(o) => { setOpen(o); setDraft(useStore.getState().authorLabel) }}>
      <Popover.Trigger asChild>
        <button className="btn ghost sm" style={{ justifyContent: 'flex-start' }} title="Local label recorded with your edits">
          <UserRound size={14} /> {authorLabel || 'Set your initials'}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="popover" side="right" align="end" sideOffset={10} style={{ width: 300 }}>
          <form
            className="stack"
            style={{ gap: 10 }}
            onSubmit={async (e) => {
              e.preventDefault()
              const r = await call<{ authorLabel: string }>('settings:setAuthor', { authorLabel: draft })
              useStore.getState().setAuthorLabel(r.authorLabel)
              setOpen(false)
            }}
          >
            <label className="field">
              Author label
              <input className="input" value={draft} maxLength={80} onChange={(e) => setDraft(e.target.value)} placeholder="e.g. initials or role" autoFocus />
            </label>
            <p className="small muted" style={{ margin: 0 }}>
              Recorded with curation edits, saved views and exports on this computer. It is a local label, not an authenticated identity.
            </p>
            <button className="btn primary sm" type="submit">Save</button>
          </form>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
