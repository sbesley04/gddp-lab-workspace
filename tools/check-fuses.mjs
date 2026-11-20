#!/usr/bin/env node
// Fails unless a packaged app has the security fuses set in package.json ("build.electronFuses").
// Used by CI on the finished macOS (universal) and Windows builds.
//   node tools/check-fuses.mjs "release/mac-universal/BARI-CNS Research Workspace.app"
//   node tools/check-fuses.mjs "release/win-unpacked/BARI-CNS Research Workspace.exe"
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FuseState, FuseV1Options, getCurrentFuseWire } from '@electron/fuses'

const app = process.argv[2]
if (!app) {
  console.error('Usage: node tools/check-fuses.mjs <path to .app or .exe>')
  process.exit(1)
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const wanted = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).build.electronFuses
// package.json uses camelCase names; @electron/fuses uses PascalCase.
const toOption = (key) => FuseV1Options[key[0].toUpperCase() + key.slice(1)]

const wire = await getCurrentFuseWire(app)
let failed = 0
for (const [key, on] of Object.entries(wanted)) {
  const option = toOption(key)
  if (option === undefined) continue // e.g. resetAdHocDarwinSignature is a build option, not a fuse
  const want = on ? FuseState.ENABLE : FuseState.DISABLE
  const ok = wire[option] === want
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${key}: ${on ? 'on' : 'off'}${ok ? '' : ` (found state ${String(wire[option])})`}`)
}
if (failed) {
  console.error(`${failed} fuse(s) not set as configured in package.json.`)
  process.exit(1)
}
