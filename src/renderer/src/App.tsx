import { useEffect, useState } from 'react'
import { call } from './api'
import { useStore, errorText, type ProjectState } from './store'
import { Sidebar, NAV } from './components/Sidebar'
import { ContextBar } from './components/ContextBar'
import { Toasts } from './components/Toasts'
import { Welcome } from './pages/Welcome'
import { Overview } from './pages/Overview'
import { Explore } from './pages/Explore'
import { Measurements } from './pages/Measurements'
import { DataQuality } from './pages/DataQuality'
import { SavedViews } from './pages/SavedViews'
import { ExportPage } from './pages/ExportPage'
import { ImportWizard } from './components/ImportWizard'
import { Inspector } from './components/Inspector'
import { ParticipantDrawer } from './components/ParticipantDrawer'
import { CommandPalette } from './components/CommandPalette'
import { ViewBanner } from './components/ViewBanner'
import { Tour, tourSeen } from './components/Tour'
import { Loader2 } from 'lucide-react'

export function App() {
  const project = useStore((s) => s.project)
  const page = useStore((s) => s.page)
  const inspected = useStore((s) => s.inspected)
  const snapshot = useStore((s) => s.snapshot)
  const loading = useStore((s) => s.loading)
  const [booted, setBooted] = useState(false)

  // Offer the tour once, the first time a dataset is open on this computer.
  useEffect(() => {
    if (snapshot && !tourSeen() && useStore.getState().tourStep === null) {
      const t = setTimeout(() => useStore.getState().startTour(), 600)
      return () => clearTimeout(t)
    }
  }, [snapshot])

  useEffect(() => {
    ;(async () => {
      try {
        const info = await call<{ authorLabel: string }>('app:info')
        useStore.getState().setAuthorLabel(info.authorLabel)
        const p = await call<ProjectState | null>('project:current')
        if (p) await useStore.getState().setProject(p)
      } catch (e) {
        useStore.getState().toast('error', errorText(e))
      } finally {
        setBooted(true)
      }
    })()
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        if (useStore.getState().snapshot) useStore.getState().setPaletteOpen(true)
      }
      if (e.key === 'Escape') useStore.getState().inspect(null)
      // ⌘1–⌘6 / Ctrl+1–6 switch pages.
      if ((e.metaKey || e.ctrlKey) && /^[1-6]$/.test(e.key) && useStore.getState().snapshot) {
        e.preventDefault()
        useStore.getState().setPage(NAV[Number(e.key) - 1].page)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!booted) return <div className="ambient" />
  if (!project)
    return (
      <>
        <div className="ambient" />
        <Welcome />
        <Toasts />
      </>
    )

  const showInspector = !!inspected && !!snapshot
  return (
    <>
      <div className="ambient" />
      <div className={`app ${showInspector ? 'with-inspector' : ''}`}>
        <Sidebar />
        <main className="main glass" aria-busy={loading}>
          <ViewBanner />
          {!snapshot && project.versions.length > 0 ? (
            <div className="empty" style={{ flex: 1 }}>
              <Loader2 className="spin" />
              <span>Loading dataset…</span>
            </div>
          ) : page === 'overview' ? (
            <Overview />
          ) : page === 'explore' ? (
            <Explore />
          ) : page === 'measurements' ? (
            <Measurements />
          ) : page === 'quality' ? (
            <DataQuality />
          ) : page === 'views' ? (
            <SavedViews />
          ) : (
            <ExportPage />
          )}
          <ContextBar />
        </main>
        {showInspector && <Inspector />}
      </div>
      <ImportWizard />
      <ParticipantDrawer />
      <CommandPalette />
      <Tour />
      <Toasts />
    </>
  )
}
