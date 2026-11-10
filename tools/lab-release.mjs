#!/usr/bin/env node
// Builds (or updates) the lab-server download folder from finished installers.
//
//   npm run release:lab -- --out /Volumes/software/BARI-CNS
//   node tools/lab-release.mjs --from <folder with installers> --out <download folder> [--version 0.4.0] [--notes notes.txt]
//
// The download folder looks like this, and can be shared read-only over SMB or served by any web server:
//
//   index.html               download page (newest version first, install steps, troubleshooting)
//   HOW-TO-INSTALL.txt       the same, as plain text, for people browsing the share in Finder or Explorer
//   0.4.0/                   one folder per version, never changed once published
//     BARI-CNS-Research-Workspace-0.4.0-mac.dmg
//     BARI-CNS-Research-Workspace-0.4.0-windows-setup.exe
//     SHA256SUMS.txt         checksums (shasum -a 256 -c SHA256SUMS.txt)
//     release.json           machine-readable record used to rebuild index.html
//     NOTES.txt              release notes (if --notes was given)
//
// Every file is copied to a .partial name, re-read and checked against the source checksum, then renamed,
// so a dropped network connection never leaves a half-written installer that looks complete.
// No dependencies beyond Node itself.
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const PRODUCT = 'BARI-CNS Research Workspace'
const PREFIX = 'BARI-CNS-Research-Workspace'
const APP_BUNDLE = `${PRODUCT}.app`

/** Installer kinds, by file-name suffix. The first is what current builds produce; the others match the 0.3.1 release. */
const KINDS = [
  { suffix: '-mac.dmg', platform: 'mac', label: 'Mac (Apple Silicon and Intel)', order: 0 },
  { suffix: '-mac-apple-silicon.dmg', platform: 'mac', label: 'Mac with Apple Silicon (M1, M2, M3 …)', order: 1 },
  { suffix: '-mac-intel.dmg', platform: 'mac', label: 'Mac with an Intel processor', order: 2 },
  { suffix: '-windows-setup.exe', platform: 'windows', label: 'Windows 10 or 11 (64-bit)', order: 3 }
]

class UsageError extends Error {}

function parseArgs(argv) {
  const opts = { from: 'release', out: join('release', 'lab-server'), version: null, notes: null, date: null, allowPartial: false, replace: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const value = () => {
      const v = argv[++i]
      if (v === undefined || v.startsWith('--')) throw new UsageError(`${a} needs a value`)
      return v
    }
    if (a === '--from') opts.from = value()
    else if (a === '--out') opts.out = value()
    else if (a === '--version') opts.version = value()
    else if (a === '--notes') opts.notes = value()
    else if (a === '--date') opts.date = value()
    else if (a === '--allow-partial') opts.allowPartial = true
    else if (a === '--replace') opts.replace = true
    else if (a === '--help' || a === '-h') opts.help = true
    else throw new UsageError(`Unknown option ${a}`)
  }
  return opts
}

const HELP = `Usage: node tools/lab-release.mjs [options]

Copies finished installers into the lab-server download folder, checks every copy,
writes SHA256SUMS.txt and rebuilds index.html.

  --from <dir>       where the installers are (searched 3 levels deep; default: release)
  --out <dir>        the download folder, e.g. the NAS share (default: release/lab-server)
  --version <x.y.z>  version to publish (default: the version in package.json)
  --notes <file>     plain-text release notes to show on the download page
  --allow-partial    publish even if the Mac or Windows installer is missing
  --replace          overwrite a version that is already published with different files
`

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isInside(child, parent) {
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith(sep) && !/^[A-Za-z]:/.test(rel))
}

/** Lists files up to `depth` folders deep, skipping `skipDir` (the output folder may sit inside release/). */
function listFiles(dir, depth, skipDir) {
  const out = []
  const walk = (d, level) => {
    let entries
    try {
      entries = readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = join(d, e.name)
      if (e.isDirectory()) {
        // Skip unpacked app folders (thousands of files) and the output folder.
        if (level < depth && !e.name.endsWith('.app') && !e.name.endsWith('-unpacked') && !isInside(p, skipDir)) walk(p, level + 1)
      } else if (e.isFile()) out.push(p)
    }
  }
  walk(dir, 0)
  return out
}

function parseSums(text) {
  const map = new Map()
  for (const line of text.split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(line)
    if (m) map.set(basename(m[2]), m[1].toLowerCase())
  }
  return map
}

function compareVersions(a, b) {
  const pa = a.split(/[.-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : x))
  const pb = b.split(/[.-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : x))
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i]
    const y = pb[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    if (x === y) continue
    if (typeof x === 'number' && typeof y === 'number') return x - y
    return String(x) < String(y) ? -1 : 1
  }
  return 0
}

function formatSize(bytes) {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`
}

function writeAtomic(path, text) {
  writeFileSync(`${path}.partial`, text)
  renameSync(`${path}.partial`, path)
}

/** Finds this version's installers in `from`, checking any SHA256SUMS.txt that came with them. */
function collectInstallers(from, version, outDir, log) {
  if (!existsSync(from) || !statSync(from).isDirectory()) throw new UsageError(`Installer folder not found: ${from}`)
  const files = listFiles(from, 3, outDir)
  const sums = new Map()
  for (const f of files.filter((f) => basename(f) === 'SHA256SUMS.txt')) for (const [k, v] of parseSums(readFileSync(f, 'utf8'))) sums.set(k, v)

  const found = new Map()
  for (const kind of KINDS) {
    const name = `${PREFIX}-${version}${kind.suffix}`
    for (const f of files.filter((f) => basename(f) === name)) {
      const hash = sha256File(f)
      const expected = sums.get(name)
      if (expected && expected !== hash)
        throw new Error(`${name} does not match its SHA256SUMS.txt entry. The file is damaged or incomplete: download or build it again.`)
      const prev = found.get(name)
      if (prev && prev.sha256 !== hash) throw new Error(`Two different files named ${name} were found:\n  ${prev.source}\n  ${f}\nRemove the stale one and try again.`)
      if (!prev) found.set(name, { name, source: f, sha256: hash, bytes: statSync(f).size, platform: kind.platform, label: kind.label, order: kind.order, checkedAgainstSums: Boolean(expected) })
    }
  }

  const installers = [...found.values()].sort((a, b) => a.order - b.order)
  if (!installers.length) {
    const other = files
      .map((f) => basename(f))
      .filter((n) => n.startsWith(PREFIX) || n.startsWith(PRODUCT) || /\.(dmg|exe)$/i.test(n))
    let msg = `No installers for version ${version} in ${from}.`
    if (other.length) msg += `\nFound instead:\n  ${other.join('\n  ')}\nBuild this version (npm run dist:mac / npm run dist:win), or pass --version to publish another one.`
    else msg += '\nBuild them first with npm run dist:mac and npm run dist:win (see docs/LAB_SERVER.md).'
    throw new Error(msg)
  }
  for (const i of installers) log(`  found ${i.name} (${formatSize(i.bytes)})${i.checkedAgainstSums ? ', matches SHA256SUMS.txt' : ''}`)
  return installers
}

/** Copies one file through a .partial name and verifies the copy before giving it its real name. */
function copyVerified(src, dest, expectedHash) {
  const tmp = `${dest}.partial`
  rmSync(tmp, { force: true })
  copyFileSync(src, tmp)
  const got = sha256File(tmp)
  if (got !== expectedHash) {
    rmSync(tmp, { force: true })
    throw new Error(`The copy of ${basename(src)} at ${dirname(dest)} is different from the original (network or disk problem). Nothing was published for this file; try again.`)
  }
  renameSync(tmp, dest)
}

export function publish(rawOpts, log = console.log) {
  const opts = { ...rawOpts }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const version = opts.version ?? JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
  if (!/^\d+\.\d+\.\d+([-.][0-9A-Za-z.-]+)?$/.test(version)) throw new UsageError(`Not a version number: ${version}`)
  const from = resolve(opts.from)
  const out = resolve(opts.out)
  const date = opts.date ?? new Date().toISOString().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new UsageError(`--date must look like 2026-11-10, not ${date}`)
  const notes = opts.notes ? readFileSync(resolve(opts.notes), 'utf8').trim() : ''

  log(`Publishing ${PRODUCT} ${version}`)
  log(`  from ${from}`)
  log(`  to   ${out}`)
  const installers = collectInstallers(from, version, out, log)
  const platforms = new Set(installers.map((i) => i.platform))
  const missing = ['mac', 'windows'].filter((p) => !platforms.has(p))
  if (missing.length && !opts.allowPartial)
    throw new Error(`The ${missing.join(' and ')} installer for ${version} is missing. Build it, or pass --allow-partial to publish without it.`)
  if (missing.length) log(`  warning: publishing without a ${missing.join(' or ')} installer`)

  const dest = join(out, version)
  const recordPath = join(dest, 'release.json')
  if (existsSync(recordPath)) {
    const existing = JSON.parse(readFileSync(recordPath, 'utf8'))
    const same =
      existing.files.length === installers.length &&
      installers.every((i) => existing.files.some((f) => f.name === i.name && f.sha256 === i.sha256) && existsSync(join(dest, i.name)) && statSync(join(dest, i.name)).size === i.bytes)
    if (same) {
      log(`  ${version} is already published with these exact files; only the index pages are refreshed.`)
      writeIndex(out, log)
      return { version, dest, installers, unchanged: true }
    }
    if (!opts.replace)
      throw new Error(
        `Version ${version} is already published at ${dest} with different files.\n` +
          'Researchers may already have downloaded it, so give the new build a new version number (package.json).\n' +
          'Only if the published files are broken, run again with --replace.'
      )
    log(`  replacing the files published for ${version}`)
  }

  mkdirSync(dest, { recursive: true })
  for (const i of installers) {
    log(`  copying ${i.name} …`)
    copyVerified(i.source, join(dest, i.name), i.sha256)
  }
  // Files from an earlier publish of this version that are no longer part of it (only reachable with --replace).
  if (existsSync(recordPath))
    for (const f of JSON.parse(readFileSync(recordPath, 'utf8')).files) if (!installers.some((i) => i.name === f.name)) rmSync(join(dest, f.name), { force: true })

  writeAtomic(join(dest, 'SHA256SUMS.txt'), installers.map((i) => `${i.sha256}  ${i.name}`).join('\n') + '\n')
  if (notes) writeAtomic(join(dest, 'NOTES.txt'), notes + '\n')
  else rmSync(join(dest, 'NOTES.txt'), { force: true })
  const record = {
    product: PRODUCT,
    version,
    date,
    notes,
    files: installers.map((i) => ({ name: i.name, platform: i.platform, label: i.label, bytes: i.bytes, sha256: i.sha256 }))
  }
  writeAtomic(recordPath, JSON.stringify(record, null, 2) + '\n')
  writeIndex(out, log)
  log(`Done. Open ${join(out, 'index.html')} to check the page.`)
  return { version, dest, installers, unchanged: false }
}

// ---------- download page ----------

const MAC_STEPS = [
  'Double-click the .dmg file. A window opens with the app and an Applications folder.',
  `Drag "${PRODUCT}" onto the Applications folder, then eject the disk image (the eject button next to it in the Finder sidebar).`,
  'Open the app from Applications. The first time, macOS says it cannot verify the app (the lab does not pay for an Apple signing certificate). Click Done.',
  'Open System Settings → Privacy & Security, scroll down to the message about the app and click Open Anyway, then confirm with your password. You only do this once per version.'
]
const WINDOWS_STEPS = [
  'Double-click the setup .exe file.',
  'If a blue "Windows protected your PC" box appears, click More info, then Run anyway (the app is not signed with a paid certificate).',
  'Follow the installer. It installs for your user account only, so it does not need administrator rights.',
  `Start "${PRODUCT}" from the Start menu.`
]
const TROUBLE = [
  ['macOS says the app "is damaged and can\'t be opened"', 'The download is usually incomplete. Delete the .dmg, download it again and compare its size with the size on this page. If the message stays, open Terminal and run: xattr -dr com.apple.quarantine "/Applications/' + APP_BUNDLE + '" — then open the app again. Only do this for the file from this page.'],
  ['There is no Open Anyway button', 'Open the app once first (step 3), then look again in Privacy & Security within the next hour. On macOS 14 or older you can instead Control-click the app in Applications and choose Open.'],
  ['The download stops or the file is smaller than listed', 'Download it again on the lab network (or VPN). You can also copy the file straight from the lab share in Finder or File Explorer.'],
  ['Checking that a file is intact', 'Compare its checksum with SHA256SUMS.txt in the same folder. Mac Terminal: shasum -a 256 <file>. Windows PowerShell: Get-FileHash <file>. The long code must match exactly.'],
  ['Updating to a new version', 'Quit the app and install the new version over the old one. Your projects are separate folders and are not touched.'],
  [
    'The app will not start, or you want to check it works',
    'Run the built-in self-test. It uses invented data in a temporary folder and never touches your projects. ' +
      `Mac Terminal: "/Applications/${APP_BUNDLE}/Contents/MacOS/${PRODUCT}" --self-test ~/Desktop — ` +
      `Windows PowerShell: & "$env:LOCALAPPDATA\\Programs\\${PRODUCT}\\${PRODUCT}.exe" --self-test $HOME\\Desktop — ` +
      'It writes bari-self-test.json to your Desktop; "ok": true means everything passed. If not, send that file to the lab\'s data manager.'
  ]
]
const RULES = [
  'Install and run the app from your own computer; do not start it from the lab share.',
  'Keep active projects on your computer\'s own disk, not on the NAS, a network drive or a sync folder (iCloud, Dropbox, OneDrive, Google Drive). Use Backup to put a copy on the NAS where study data is permitted.'
]

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}

function href(version, name) {
  return `${encodeURIComponent(version)}/${encodeURIComponent(name)}`
}

function readReleases(out) {
  const releases = []
  for (const e of readdirSync(out, { withFileTypes: true })) {
    if (!e.isDirectory()) continue
    const p = join(out, e.name, 'release.json')
    if (!existsSync(p)) continue
    try {
      const r = JSON.parse(readFileSync(p, 'utf8'))
      if (r.version === e.name && Array.isArray(r.files)) releases.push(r)
    } catch {
      /* not a release folder */
    }
  }
  return releases.sort((a, b) => compareVersions(b.version, a.version))
}

function renderHtml(releases) {
  const latest = releases[0]
  const button = (f) =>
    `<a class="dl" data-platform="${esc(f.platform)}" href="${href(latest.version, f.name)}" download><span class="what">${esc(f.label)}</span><span class="file">${esc(f.name)} · ${formatSize(f.bytes)}</span></a>`
  const steps = (list) => `<ol>${list.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`
  const twoMacs = latest.files.filter((f) => f.platform === 'mac').length > 1
  const older = releases.slice(1)
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(PRODUCT)} downloads</title>
<style>
:root { --bg: #f6f7f9; --card: #fff; --text: #1d232b; --muted: #5d6673; --line: #dde1e6; --accent: #1f6feb; --accent-bg: #eaf2ff; }
@media (prefers-color-scheme: dark) { :root { --bg: #14171b; --card: #1d2126; --text: #e6e9ed; --muted: #9aa3ae; --line: #323840; --accent: #6ea8fe; --accent-bg: #1c2a40; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.55 -apple-system, "Segoe UI", system-ui, sans-serif; }
main { max-width: 760px; margin: 0 auto; padding: 32px 16px 64px; }
h1 { font-size: 1.6rem; margin: 0 0 4px; }
h2 { font-size: 1.15rem; margin: 32px 0 8px; }
.muted, .file { color: var(--muted); }
.downloads { display: grid; gap: 10px; margin: 20px 0 8px; }
a.dl { display: flex; flex-direction: column; padding: 14px 16px; border: 1px solid var(--line); border-radius: 10px; background: var(--card); color: var(--text); text-decoration: none; }
a.dl:hover, a.dl.mine { border-color: var(--accent); background: var(--accent-bg); }
a.dl .what { font-weight: 600; }
a.dl .file { font-size: .85rem; word-break: break-all; }
a.dl.mine .what::after { content: "  ← this computer"; color: var(--accent); font-weight: 500; }
section, details { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 4px 18px; margin: 10px 0; }
summary { cursor: pointer; font-weight: 600; padding: 10px 0; }
li { margin: 4px 0; }
code { font-size: .9em; word-break: break-all; }
a { color: var(--accent); }
</style>
</head>
<body>
<main>
<h1>${esc(PRODUCT)}</h1>
<p class="muted">Version ${esc(latest.version)} · published ${esc(latest.date)} · Mac (macOS 13 or newer) and Windows 10/11</p>
<div class="downloads">
${latest.files.map(button).join('\n')}
</div>
${twoMacs ? '<p class="muted">Not sure which Mac you have? Apple menu → About This Mac: "Chip: Apple M…" means Apple Silicon, "Processor: Intel" means Intel.</p>' : ''}
<p class="muted"><a href="${href(latest.version, 'SHA256SUMS.txt')}">SHA256SUMS.txt</a>${latest.notes ? ` · <a href="${href(latest.version, 'NOTES.txt')}">What's new</a>` : ''}</p>
${latest.notes ? `<details><summary>What's new in ${esc(latest.version)}</summary><p style="white-space: pre-wrap">${esc(latest.notes)}</p></details>` : ''}
<h2>Install</h2>
<details open><summary>On a Mac</summary>${steps(MAC_STEPS)}</details>
<details open><summary>On Windows</summary>${steps(WINDOWS_STEPS)}</details>
<h2>Two rules for study data</h2>
<section>${steps(RULES).replace('<ol>', '<ul>').replace('</ol>', '</ul>')}</section>
<h2>If something goes wrong</h2>
${TROUBLE.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('\n')}
${
  older.length
    ? `<h2>Earlier versions</h2>\n<section><ul>${older
        .map((r) => `<li>${esc(r.version)} (${esc(r.date)}): ${r.files.map((f) => `<a href="${href(r.version, f.name)}" download>${esc(f.label)}</a>`).join(' · ')}</li>`)
        .join('')}</ul></section>`
    : ''
}
<p class="muted">The app works offline and sends no data anywhere. Questions: ask the lab's data manager.</p>
</main>
<script>
(function () {
  var ua = navigator.userAgent, p = /Mac/.test(ua) ? 'mac' : /Windows/.test(ua) ? 'windows' : '';
  var links = document.querySelectorAll('a.dl[data-platform="' + p + '"]');
  if (links.length === 1) links[0].className += ' mine';
})();
</script>
</body>
</html>
`
}

function renderText(releases) {
  const latest = releases[0]
  const lines = [
    `${PRODUCT} — version ${latest.version} (${latest.date})`,
    '',
    'Open index.html in a browser for the full download page, or use the files below.',
    '',
    'WHICH FILE',
    ...latest.files.map((f) => `  ${f.label}:\n    ${latest.version}/${f.name}  (${formatSize(f.bytes)})`),
    '',
    'INSTALL ON A MAC (macOS 13 or newer)',
    ...MAC_STEPS.map((s, i) => `  ${i + 1}. ${s}`),
    '',
    'INSTALL ON WINDOWS 10/11',
    ...WINDOWS_STEPS.map((s, i) => `  ${i + 1}. ${s}`),
    '',
    'STUDY DATA',
    ...RULES.map((s) => `  - ${s}`),
    '',
    'IF SOMETHING GOES WRONG',
    ...TROUBLE.flatMap(([q, a]) => [`  ${q}:`, `    ${a}`]),
    ''
  ]
  return lines.join('\n').replace(/\n/g, '\r\n') // readable in Notepad as well
}

export function writeIndex(out, log = console.log) {
  const releases = readReleases(out)
  if (!releases.length) throw new Error(`No published versions found in ${out}.`)
  writeAtomic(join(out, 'index.html'), renderHtml(releases))
  writeAtomic(join(out, 'HOW-TO-INSTALL.txt'), renderText(releases))
  log(`  index.html and HOW-TO-INSTALL.txt list ${releases.length} version(s); newest is ${releases[0].version}`)
}

// ---------- command line ----------

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const opts = parseArgs(process.argv.slice(2))
    if (opts.help) {
      process.stdout.write(HELP)
    } else {
      publish(opts)
    }
  } catch (err) {
    process.stderr.write(`\nError: ${err instanceof Error ? err.message : String(err)}\n`)
    if (err instanceof UsageError) process.stderr.write(`\n${HELP}`)
    process.exit(1)
  }
}
