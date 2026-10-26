// Electron main process: hardened window, offline enforcement, validated IPC.
import { app, BrowserWindow, dialog, ipcMain, powerSaveBlocker, protocol, session, nativeTheme, type IpcMainInvokeEvent } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs'
import { removeTree } from './fsutil'
import { join, normalize, sep, basename, dirname } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { schemas, type IpcResult } from '@shared/ipc'
import { CHANNELS, type ChannelName } from '@shared/channels'
import { Project, ProjectLockedError, syncFolderWarning } from './project'
import { commitImport, inspect, parseSource, previewMapping, validate, type ParsedSource } from './importService'
import { buildSnapshot, listVersions } from './snapshot'
import * as curation from './curation'
import * as views from './views'
import * as boards from './boards'
import { listExports, previewContextExport, writeContextExport } from './exportService'
import { createBackup, restoreBackup } from './backup'
import { APP_VERSION } from './version'
import { runSelfTest, abortSelfTest } from './selfTest'

const isDev = !app.isPackaged && !!process.env.ELECTRON_RENDERER_URL
const mainDir = import.meta.dirname
const rendererDir = join(mainDir, '../renderer')

// ---------- settings & recent projects (userData/settings.json) ----------
interface Settings {
  authorLabel: string
  recent: { id: string; path: string; name: string; openedAt: string }[]
}
const settingsPath = () => join(app.getPath('userData'), 'settings.json')
function loadSettings(): Settings {
  try {
    const s = JSON.parse(readFileSync(settingsPath(), 'utf8'))
    return { authorLabel: typeof s.authorLabel === 'string' ? s.authorLabel : '', recent: Array.isArray(s.recent) ? s.recent : [] }
  } catch {
    return { authorLabel: '', recent: [] }
  }
}
function saveSettings(s: Settings) {
  mkdirSync(dirname(settingsPath()), { recursive: true })
  writeFileSync(settingsPath(), JSON.stringify(s, null, 2))
}
let settings: Settings

// ---------- state ----------
let current: Project | null = null
const pendingImports = new Map<string, ParsedSource>()
const blockedRequests: { url: string; at: string }[] = []
let mainWindow: BrowserWindow | null = null

function requireProject(): Project {
  if (!current) throw new Error('No project is open.')
  return current
}
const author = () => settings.authorLabel.trim() || null

function remember(p: Project) {
  settings.recent = [{ id: p.info.id, path: p.dir, name: p.info.name, openedAt: new Date().toISOString() }, ...settings.recent.filter((r) => r.path !== p.dir)].slice(0, 12)
  saveSettings(settings)
}

/** Opaque key so the renderer never handles filesystem paths. */
const recentKey = (path: string) => createHash('sha256').update(path).digest('hex').slice(0, 16)

function projectState() {
  if (!current) return null
  return {
    id: current.info.id,
    name: current.info.name,
    folderName: basename(current.dir),
    createdAt: current.info.createdAt,
    syncWarning: syncFolderWarning(current.dir),
    metadataVersion: current.metadataVersion(),
    versions: listVersions(current),
    isDemo: current.dir.startsWith(join(app.getPath('userData'), 'demo'))
  }
}

function openProjectAt(dir: string) {
  if (current) {
    current.close()
    current = null
  }
  try {
    current = Project.open(dir)
  } catch (e) {
    if (e instanceof ProjectLockedError) throw new Error(`${e.message} If that session crashed, close other copies of the app and try again; the lock clears automatically on this computer.`)
    throw e
  }
  remember(current)
  return projectState()
}

async function pickDirectory(title: string): Promise<string | null> {
  const r = await dialog.showOpenDialog(mainWindow!, { title, properties: ['openDirectory', 'createDirectory'] })
  return r.canceled || !r.filePaths[0] ? null : r.filePaths[0]
}

function demoWorkbookPath(): string {
  const packaged = join(process.resourcesPath, 'demo', 'demo_workbook.xlsx')
  if (app.isPackaged && existsSync(packaged)) return packaged
  return join(mainDir, '..', '..', 'tests', 'fixtures', 'demo_workbook.xlsx')
}

function openDemo() {
  const base = join(app.getPath('userData'), 'demo')
  if (current?.dir.startsWith(base)) return projectState()
  if (current) {
    current.close()
    current = null
  }
  removeTree(base)
  mkdirSync(base, { recursive: true })
  const p = Project.create(base, 'Synthetic demo')
  const bytes = new Uint8Array(readFileSync(demoWorkbookPath()))
  const src = parseSource(bytes, 'demo_workbook.xlsx (synthetic)')
  const sheet = src.wb.sheets[0].name
  const mp = previewMapping(p, src, sheet)
  const model = validate(src, { sheetName: sheet, headerRow: 1, participantColumn: mp.suggestion.participantColumn!, eventColumn: mp.suggestion.eventColumn })
  commitImport(p, src, model, { authorLabel: 'Demo setup', carryOverFrom: null })
  current = p
  return projectState()
}

// ---------- IPC ----------
type Handler = (payload: any, e: IpcMainInvokeEvent) => unknown | Promise<unknown>
const handlers: Partial<Record<ChannelName, Handler>> = {
  'app:info': () => ({ version: APP_VERSION, platform: process.platform, authorLabel: settings.authorLabel, network: 'All network requests are blocked; the app works fully offline.', darkMode: nativeTheme.shouldUseDarkColors }),
  'app:networkLog': () => ({ blocked: blockedRequests.slice(-200) }),
  'settings:setAuthor': (p) => {
    settings.authorLabel = p.authorLabel.trim()
    saveSettings(settings)
    return { authorLabel: settings.authorLabel }
  },
  'project:recent': () => settings.recent.filter((r) => existsSync(join(r.path, 'project.json'))).map((r) => ({ id: recentKey(r.path), name: r.name, folderName: basename(r.path), openedAt: r.openedAt })),
  'project:forgetRecent': (p) => {
    settings.recent = settings.recent.filter((r) => recentKey(r.path) !== p.id)
    saveSettings(settings)
    return true
  },
  'project:openRecent': (p) => {
    const r = settings.recent.find((x) => recentKey(x.path) === p.id)
    if (!r) throw new Error('That project is no longer in the recent list.')
    return openProjectAt(r.path)
  },
  'project:current': () => projectState(),
  'project:create': async (p) => {
    const parent = await pickDirectory('Choose where to create the project folder')
    if (!parent) return null
    if (current) {
      current.close()
      current = null
    }
    current = Project.create(parent, p.name)
    remember(current)
    return projectState()
  },
  'project:open': async () => {
    const dir = await pickDirectory('Open a .bariproj project folder')
    return dir ? openProjectAt(dir) : null
  },
  'project:close': () => {
    current?.close()
    current = null
    return null
  },
  'project:openDemo': () => openDemo(),
  'import:pickFile': async () => {
    const project = requireProject()
    const r = await dialog.showOpenDialog(mainWindow!, { title: 'Choose a workbook to import', properties: ['openFile'], filters: [{ name: 'Spreadsheets', extensions: ['xlsx', 'csv'] }] })
    if (r.canceled || !r.filePaths[0]) return null
    const path = r.filePaths[0]
    if (statSync(path).size > 200 * 1024 * 1024) throw new Error('This file is larger than the supported 200 MB limit.')
    const src = parseSource(new Uint8Array(readFileSync(path)), basename(path))
    const token = randomUUID()
    pendingImports.set(token, src)
    return { token, ...inspect(project, src) }
  },
  'import:preview': (p) => previewMapping(requireProject(), pending(p.token), p.sheetName, p.headerRow),
  'import:validate': (p) => {
    const model = validate(pending(p.token), p.mapping)
    return {
      summary: model.summary,
      issues: model.issues,
      legend: model.legend,
      segments: model.segments,
      columns: model.columns.map((c) => ({ letter: c.letter, header: c.header, role: c.role, kind: c.kind, attribution: c.attribution, aliases: c.aliases, quasiIdentifier: c.quasiIdentifier, segment: c.segment })),
      sourceKind: model.sourceKind
    }
  },
  'import:commit': (p) => {
    const project = requireProject()
    const src = pending(p.token)
    const model = validate(src, p.mapping)
    const r = commitImport(project, src, model, { authorLabel: author(), carryOverFrom: p.carryOverFrom })
    pendingImports.delete(p.token)
    return { ...r, project: projectState() }
  },
  'import:discard': (p) => pendingImports.delete(p.token),
  'data:versions': () => listVersions(requireProject()),
  'data:snapshot': (p) => buildSnapshot(requireProject(), p.datasetVersionId, p.asOf ?? undefined),
  'data:formatGroups': (p) => curation.formatGroups(requireProject(), p.datasetVersionId, p.asOf ?? requireProject().metadataVersion()),
  'data:importReport': (p) => {
    const r = requireProject().db.get<any>('SELECT import_report_json, legend_json, segments_json FROM dataset_version WHERE id = ?', p.datasetVersionId)
    if (!r) throw new Error('Dataset version not found.')
    return { report: JSON.parse(r.import_report_json), legend: r.legend_json ? JSON.parse(r.legend_json) : null, segments: JSON.parse(r.segments_json) }
  },
  'curation:editMeta': (p) => curation.editVariableMeta(requireProject(), { ...p, author: author() }),
  'curation:setQuasi': (p) => curation.setQuasiIdentifier(requireProject(), { ...p, author: author() }),
  'curation:decideFormat': (p) => curation.decideFormat(requireProject(), { ...p, author: author() }),
  'curation:setExclusion': (p) => curation.setCellExclusion(requireProject(), { ...p, author: author() }),
  'curation:nameSegment': (p) => curation.nameSegment(requireProject(), { ...p, author: author() }),
  'curation:setStudyContext': (p) => curation.setStudyContext(requireProject(), { ...p, author: author() }),
  'curation:getStudyContext': (p) => curation.getStudyContext(requireProject(), p.datasetVersionId, p.asOf ?? requireProject().metadataVersion()),
  'curation:history': (p) => curation.history(requireProject(), p.datasetVersionId, { target: p.target, kind: p.kind }),
  'boards:list': () => boards.listBoards(requireProject()),
  'boards:get': (p) => boards.getBoard(requireProject(), p.id),
  'boards:save': (p) => boards.saveBoard(requireProject(), { ...p, author: author() }),
  'boards:delete': (p) => boards.deleteBoard(requireProject(), p.id, author()),
  'views:list': () => views.listViews(requireProject()),
  'views:save': (p) => views.saveView(requireProject(), { ...p, author: author() }),
  'views:get': (p) => views.getView(requireProject(), p.id),
  'views:delete': (p) => views.deleteView(requireProject(), p.id, author()),
  'export:preview': (p) => previewContextExport(requireProject(), p.spec, p.options, p.metadataVersion),
  'export:write': async (p) => {
    const project = requireProject()
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
    const r = await dialog.showSaveDialog(mainWindow!, { title: 'Save research-context package', defaultPath: `bari-context-${stamp}.zip`, filters: [{ name: 'ZIP package', extensions: ['zip'] }] })
    if (r.canceled || !r.filePath) return null
    return writeContextExport(project, p.spec, p.options, p.metadataVersion, r.filePath, author())
  },
  'export:list': () => listExports(requireProject()),
  'export:chart': async (p) => {
    const ext = p.format
    const r = await dialog.showSaveDialog(mainWindow!, { title: `Save chart as ${ext.toUpperCase()}`, defaultPath: `${p.suggestedName.replace(/[\\/:*?"<>|]+/g, '-')}.${ext}`, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] })
    if (r.canceled || !r.filePath) return null
    if (ext === 'svg') {
      if (!p.data.trimStart().startsWith('<svg') && !p.data.trimStart().startsWith('<?xml')) throw new Error('Chart data is not SVG.')
      writeFileSync(r.filePath, p.data, 'utf8')
    } else {
      const m = /^data:image\/png;base64,(.+)$/.exec(p.data)
      if (!m) throw new Error('Chart data is not a PNG image.')
      writeFileSync(r.filePath, Buffer.from(m[1], 'base64'))
    }
    current?.audit('export.chart', { format: ext, file: basename(r.filePath) }, author())
    return { fileName: basename(r.filePath) }
  },
  'backup:create': async () => {
    const project = requireProject()
    const stamp = new Date().toISOString().slice(0, 10)
    const r = await dialog.showSaveDialog(mainWindow!, { title: 'Save project backup', defaultPath: `${project.info.name}-backup-${stamp}.bariproj.zip`, filters: [{ name: 'Project backup', extensions: ['zip'] }] })
    if (r.canceled || !r.filePath) return null
    const m = await createBackup(project, r.filePath, author())
    return { fileName: basename(r.filePath), files: m.files.length, datasets: m.datasets.length }
  },
  'backup:restore': async () => {
    const f = await dialog.showOpenDialog(mainWindow!, { title: 'Choose a project backup', properties: ['openFile'], filters: [{ name: 'Project backup', extensions: ['zip'] }] })
    if (f.canceled || !f.filePaths[0]) return null
    const parent = await pickDirectory('Choose where to restore the project folder')
    if (!parent) return null
    const res = restoreBackup(f.filePaths[0], parent)
    const state = openProjectAt(res.dir)
    return { verified: res.verified, project: state }
  }
}

function pending(token: string): ParsedSource {
  const s = pendingImports.get(token)
  if (!s) throw new Error('This import session expired. Choose the file again.')
  return s
}

function registerIpc() {
  for (const channel of CHANNELS) {
    const handler = handlers[channel]
    if (!handler) throw new Error(`Missing IPC handler for ${channel}`)
    ipcMain.handle(channel, async (e, payload): Promise<IpcResult<unknown>> => {
      // Only our own window's main frame may call in.
      if (!mainWindow || e.sender !== mainWindow.webContents || e.senderFrame !== mainWindow.webContents.mainFrame) return { ok: false, error: 'Rejected IPC sender.' }
      const schema = (schemas as Record<string, any>)[channel]
      let input = payload
      if (schema) {
        const parsed = schema.safeParse(payload)
        if (!parsed.success) return { ok: false, error: `Invalid request for ${channel}: ${parsed.error.issues[0]?.message ?? 'validation failed'}` }
        input = parsed.data
      }
      try {
        return { ok: true, data: await handler(input, e) }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    })
  }
}

// ---------- security ----------
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }])

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'", // ECharts and React set inline styles
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join('; ')

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.json': 'application/json'
}

function installSecurity() {
  protocol.handle('app', async (req) => {
    const url = new URL(req.url)
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html'
    const file = normalize(join(rendererDir, rel))
    if (!file.startsWith(rendererDir + sep) || !existsSync(file)) return new Response('Not found', { status: 404 })
    const ext = file.slice(file.lastIndexOf('.')).toLowerCase()
    const headers = new Headers({ 'Content-Type': MIME[ext] ?? 'application/octet-stream', 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff' })
    return new Response(readFileSync(file), { status: 200, headers })
  })
  const allowed = (url: string) =>
    url.startsWith('app://') || url.startsWith('devtools://') || url.startsWith('data:') || url.startsWith('blob:') ||
    (isDev && (url.startsWith(process.env.ELECTRON_RENDERER_URL!) || url.startsWith('ws://localhost') || url.startsWith('http://localhost')))
  session.defaultSession.webRequest.onBeforeRequest((details, cb) => {
    if (allowed(details.url)) return cb({})
    blockedRequests.push({ url: details.url.slice(0, 200), at: new Date().toISOString() })
    cb({ cancel: true })
  })
  // Deny every permission except writing text to the clipboard (used by "Copy context summary").
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'clipboard-sanitized-write'))
  session.defaultSession.setPermissionCheckHandler((_wc, perm) => perm === 'clipboard-sanitized-write')
  app.on('web-contents-created', (_e, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('will-navigate', (e, url) => {
      if (!allowed(url)) e.preventDefault()
    })
    contents.on('will-attach-webview', (e) => e.preventDefault())
  })
}

/** Self-test: load the bundled renderer in a hidden window and wait for the welcome screen via the real IPC bridge. */
async function uiSmoke(): Promise<string> {
  createWindow(false)
  const wc = mainWindow!.webContents
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    const state = await wc.executeJavaScript(`({ text: document.body ? document.body.innerText : '', bridge: typeof window.bari?.invoke === 'function', url: location.href })`).catch(() => null)
    if (state && state.bridge && state.text.includes('Open synthetic demo')) {
      mainWindow!.destroy()
      return `renderer loaded from ${state.url}; IPC bridge available; welcome screen rendered`
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error('Renderer did not reach the welcome screen within 20 s')
}

function createWindow(visible = true) {
  const mac = process.platform === 'darwin'
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    title: 'BARI-CNS Research Workspace',
    titleBarStyle: mac ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 18, y: 20 },
    vibrancy: mac ? 'under-window' : undefined,
    visualEffectState: 'active',
    backgroundMaterial: process.platform === 'win32' ? 'mica' : undefined,
    backgroundColor: mac ? '#00000000' : nativeTheme.shouldUseDarkColors ? '#14171f' : '#eef1f7',
    transparent: false,
    webPreferences: {
      preload: join(mainDir, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      devTools: !app.isPackaged
    }
  })
  if (visible) mainWindow.once('ready-to-show', () => mainWindow?.show())
  if (isDev) mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL!)
  else mainWindow.loadURL('app://bundle/index.html')
  mainWindow.on('closed', () => (mainWindow = null))
}

// ---------- lifecycle ----------
// Isolated profile for automated tests (never needed in normal use). Test windows are often covered by
// other windows, so stop Chromium throttling occluded renderers there; normal use keeps power saving.
if (process.env.BARI_USER_DATA) {
  app.setPath('userData', process.env.BARI_USER_DATA)
  for (const sw of ['disable-renderer-backgrounding', 'disable-backgrounding-occluded-windows', 'disable-background-timer-throttling']) app.commandLine.appendSwitch(sw)
  // Stop macOS App Nap from suspending the test app while its window is hidden.
  app.whenReady().then(() => powerSaveBlocker.start('prevent-app-suspension'))
}
app.enableSandbox()
if (!app.requestSingleInstanceLock() && !process.argv.includes('--self-test')) app.quit()

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

app.whenReady().then(async () => {
  settings = loadSettings()
  installSecurity()
  const st = process.argv.indexOf('--self-test')
  if (st !== -1) {
    // The self-test uses a hidden window; keep macOS App Nap from suspending it.
    powerSaveBlocker.start('prevent-app-suspension')
    // Never hang on a headless machine: crashes and timeouts write a failure report and exit
    // (an uncaught error would otherwise show an invisible modal dialog and wait forever).
    const outDir = process.argv[st + 1]
    process.on('uncaughtException', (e) => abortSelfTest(outDir, `uncaught exception: ${e?.stack ?? e}`))
    process.on('unhandledRejection', (e) => abortSelfTest(outDir, `unhandled rejection: ${(e as Error)?.stack ?? e}`))
    setTimeout(() => abortSelfTest(outDir, 'timed out after 180 s'), 180_000).unref()
    process.stdout.write(`[self-test] starting ${APP_VERSION} on ${process.platform}-${process.arch}\n`)
    registerIpc()
    const code = await runSelfTest(process.argv[st + 1], demoWorkbookPath(), uiSmoke)
    app.exit(code)
    return
  }
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.argv.includes('--self-test')) return // the self-test exits explicitly with its result code
  current?.close()
  current = null
  app.quit()
})
app.on('before-quit', () => {
  current?.close()
  current = null
})
