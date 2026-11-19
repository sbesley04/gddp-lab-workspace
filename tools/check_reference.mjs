// Regenerates the three R reference files into a temporary folder and compares them with the committed ones.
// Fails on any structural difference, any text difference, a different R or package version, or a number that
// differs by more than a tight relative tolerance (to allow for the last bits moving between platforms and BLAS builds).
//   node tools/check_reference.mjs            (needs Rscript with jsonlite and car; run from the repository root)
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const FILES = ['stats_reference', 'multivariate_reference', 'transforms_reference']
const REL_TOL = 1e-9
// Box-Cox λ maximises a likelihood that is flat at its peak, so λ moves by about 1e-7 between platforms (macOS and
// Linux maths libraries differ in the last bits). A value transformed with it, (y^λ − 1)/λ, moves by about ln(y) times
// as much in relative terms: 1e-6 was seen on the first CI run for the left-skewed sample, where λ is near 5.9.
const LOOSE = [
  { file: 'transforms_reference', path: /\.lambda$/, tol: 1e-6 },
  { file: 'transforms_reference', path: /\.transformed\[/, tol: 2e-5 }
]

const diffs = []
function close(a, b, tol) {
  if (a === b) return true
  return Math.abs(a - b) <= tol * Math.max(Math.abs(a), Math.abs(b), 1e-300) || Math.abs(a - b) < 1e-14
}
function compare(file, path, want, got) {
  if (path === '._r') {
    if (JSON.stringify(want) !== JSON.stringify(got)) diffs.push(`${file}: R environment differs. Committed ${JSON.stringify(want)}, this run ${JSON.stringify(got)}. Pin the same versions, or regenerate and commit the reference files on purpose.`)
    return
  }
  if (typeof want === 'number' && typeof got === 'number') {
    const tol = LOOSE.find((l) => l.file === file && l.path.test(path))?.tol ?? REL_TOL
    if (!close(want, got, tol)) diffs.push(`${file}${path}: committed ${want}, regenerated ${got}`)
    return
  }
  if (want === null || got === null || typeof want !== 'object' || typeof got !== 'object') {
    if (want !== got) diffs.push(`${file}${path}: committed ${JSON.stringify(want)}, regenerated ${JSON.stringify(got)}`)
    return
  }
  if (Array.isArray(want) !== Array.isArray(got)) return void diffs.push(`${file}${path}: array/object mismatch`)
  if (Array.isArray(want)) {
    if (want.length !== got.length) return void diffs.push(`${file}${path}: length ${want.length} committed, ${got.length} regenerated`)
    want.forEach((w, i) => compare(file, `${path}[${i}]`, w, got[i]))
    return
  }
  const keys = new Set([...Object.keys(want), ...Object.keys(got)])
  for (const k of keys) {
    if (!(k in want)) diffs.push(`${file}${path}.${k}: only in the regenerated file`)
    else if (!(k in got)) diffs.push(`${file}${path}.${k}: only in the committed file`)
    else compare(file, `${path}.${k}`, want[k], got[k])
  }
}

const work = mkdtempSync(join(tmpdir(), 'bari-rref-'))
try {
  for (const f of FILES) {
    const out = join(work, `${f}.json`)
    execFileSync('Rscript', [`tools/${f}.R`, out], { stdio: ['ignore', 'ignore', 'inherit'] })
    const want = JSON.parse(readFileSync(join('tests', 'fixtures', `${f}.json`), 'utf8'))
    const got = JSON.parse(readFileSync(out, 'utf8'))
    if (!want._r) diffs.push(`${f}: the committed file does not record its R and package versions ("_r").`)
    compare(f, '', want, got)
    console.log(`${f}: R ${got._r?.r}, ${Object.entries(got._r?.packages ?? {}).map(([p, v]) => `${p} ${v}`).join(', ')}`)
  }
} finally {
  rmSync(work, { recursive: true, force: true })
}
if (diffs.length) {
  console.error(`\n${diffs.length} difference(s) between R and the committed reference files:`)
  for (const d of diffs.slice(0, 40)) console.error(`  ${d}`)
  if (diffs.length > 40) console.error(`  … and ${diffs.length - 40} more`)
  process.exit(1)
}
console.log('R reproduces all three reference files.')
