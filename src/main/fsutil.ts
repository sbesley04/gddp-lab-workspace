// Folder removal that also works on Windows, where read-only files (our source snapshots are stored
// read-only on purpose) cannot be deleted until the read-only attribute is cleared.
import { chmodSync, existsSync, lstatSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

function makeWritable(path: string) {
  const st = lstatSync(path)
  if (st.isSymbolicLink()) return
  if (st.isDirectory()) for (const entry of readdirSync(path)) makeWritable(join(path, entry))
  try {
    chmodSync(path, st.isDirectory() ? 0o755 : 0o644)
  } catch {
    /* best effort; rmSync below reports anything that still cannot be removed */
  }
}

export function removeTree(dir: string) {
  if (!existsSync(dir)) return
  makeWritable(dir)
  // Retries cover Windows releasing file handles (e.g. SQLite) a moment after close.
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
