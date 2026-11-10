// tools/lab-release.mjs: builds the lab-server download folder. Run as a subprocess, exactly as maintainers use it.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { removeTree } from '../src/main/fsutil'

const SCRIPT = resolve(__dirname, '../tools/lab-release.mjs')
const dirs: string[] = []

function tmp() {
  const d = mkdtempSync(join(tmpdir(), 'bari-labrel-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  for (const d of dirs.splice(0)) removeTree(d)
})

function run(...args: string[]) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' })
  return { code: r.status, out: r.stdout, err: r.stderr }
}

function fakeInstallers(dir: string, version: string, content = 'x') {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `BARI-CNS-Research-Workspace-${version}-mac.dmg`), `mac ${version} ${content}`)
  writeFileSync(join(dir, `BARI-CNS-Research-Workspace-${version}-windows-setup.exe`), `win ${version} ${content}`)
  writeFileSync(join(dir, `BARI-CNS-Research-Workspace-${version}-windows-setup.exe.blockmap`), 'ignored')
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex')

describe('lab release folder', () => {
  it('publishes verified copies, checksums and a download page', () => {
    const from = tmp()
    const out = join(tmp(), 'BARI-CNS')
    fakeInstallers(from, '1.2.0')
    const r = run('--from', from, '--out', out, '--version', '1.2.0', '--date', '2026-11-10')
    expect(r.code, r.err).toBe(0)
    expect(readdirSync(join(out, '1.2.0')).sort()).toEqual([
      'BARI-CNS-Research-Workspace-1.2.0-mac.dmg',
      'BARI-CNS-Research-Workspace-1.2.0-windows-setup.exe',
      'SHA256SUMS.txt',
      'release.json'
    ])
    const sums = readFileSync(join(out, '1.2.0', 'SHA256SUMS.txt'), 'utf8')
    expect(sums).toContain(`${sha('mac 1.2.0 x')}  BARI-CNS-Research-Workspace-1.2.0-mac.dmg`)
    const html = readFileSync(join(out, 'index.html'), 'utf8')
    expect(html).toContain('href="1.2.0/BARI-CNS-Research-Workspace-1.2.0-mac.dmg"')
    expect(html).toContain('Open Anyway')
    expect(html).not.toMatch(/https?:\/\//) // works from a file share with no internet
    expect(readFileSync(join(out, 'HOW-TO-INSTALL.txt'), 'utf8')).toContain('1.2.0/BARI-CNS-Research-Workspace-1.2.0-windows-setup.exe')
  })

  it('lists versions newest first and keeps earlier ones', () => {
    const out = join(tmp(), 'dl')
    for (const v of ['0.9.0', '0.10.0']) {
      const from = tmp()
      fakeInstallers(from, v)
      expect(run('--from', from, '--out', out, '--version', v).code).toBe(0)
    }
    const html = readFileSync(join(out, 'index.html'), 'utf8')
    expect(html).toContain('Version 0.10.0')
    expect(html).toContain('Earlier versions')
    expect(html.indexOf('0.10.0/')).toBeLessThan(html.indexOf('0.9.0/'))
  })

  it('refuses to silently overwrite a published version, but re-running the same files is fine', () => {
    const out = join(tmp(), 'dl')
    const a = tmp()
    fakeInstallers(a, '1.0.0', 'first')
    expect(run('--from', a, '--out', out, '--version', '1.0.0').code).toBe(0)
    expect(run('--from', a, '--out', out, '--version', '1.0.0').out).toMatch(/already published with these exact files/)
    const b = tmp()
    fakeInstallers(b, '1.0.0', 'second')
    const r = run('--from', b, '--out', out, '--version', '1.0.0')
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/already published/)
    expect(run('--from', b, '--out', out, '--version', '1.0.0', '--replace').code).toBe(0)
    expect(readFileSync(join(out, '1.0.0', 'BARI-CNS-Research-Workspace-1.0.0-mac.dmg'), 'utf8')).toBe('mac 1.0.0 second')
  })

  it('rejects files that do not match a SHA256SUMS.txt shipped with them', () => {
    const from = tmp()
    fakeInstallers(from, '1.0.0')
    writeFileSync(join(from, 'SHA256SUMS.txt'), `${sha('something else')}  BARI-CNS-Research-Workspace-1.0.0-mac.dmg\n`)
    const r = run('--from', from, '--out', join(tmp(), 'dl'), '--version', '1.0.0')
    expect(r.code).toBe(1)
    expect(r.err).toMatch(/damaged or incomplete/)
  })

  it('explains a missing installer or a version mismatch', () => {
    const from = tmp()
    fakeInstallers(from, '0.3.1')
    const wrong = run('--from', from, '--out', join(tmp(), 'dl'), '--version', '0.4.0')
    expect(wrong.code).toBe(1)
    expect(wrong.err).toMatch(/No installers for version 0\.4\.0/)
    expect(wrong.err).toContain('BARI-CNS-Research-Workspace-0.3.1-mac.dmg')

    const macOnly = tmp()
    writeFileSync(join(macOnly, 'BARI-CNS-Research-Workspace-0.4.0-mac.dmg'), 'm')
    const out = join(tmp(), 'dl')
    expect(run('--from', macOnly, '--out', out, '--version', '0.4.0').err).toMatch(/windows installer for 0\.4\.0 is missing/)
    expect(run('--from', macOnly, '--out', out, '--version', '0.4.0', '--allow-partial').code).toBe(0)
  })

  it('accepts the 0.3.1 file names (separate Apple Silicon and Intel Macs)', () => {
    const from = tmp()
    for (const s of ['mac-apple-silicon.dmg', 'mac-intel.dmg', 'windows-setup.exe']) writeFileSync(join(from, `BARI-CNS-Research-Workspace-0.3.1-${s}`), s)
    const out = join(tmp(), 'dl')
    expect(run('--from', from, '--out', out, '--version', '0.3.1').code).toBe(0)
    const html = readFileSync(join(out, 'index.html'), 'utf8')
    expect(html).toContain('Apple Silicon')
    expect(html).toContain('About This Mac')
  })

  it('does not pick up its own output when it sits inside the installer folder', () => {
    const from = tmp()
    fakeInstallers(from, '2.0.0')
    const out = join(from, 'lab-server')
    expect(run('--from', from, '--out', out, '--version', '2.0.0').code).toBe(0)
    expect(run('--from', from, '--out', out, '--version', '2.0.0').code).toBe(0)
    expect(existsSync(join(out, '2.0.0', 'lab-server'))).toBe(false)
  })
})
