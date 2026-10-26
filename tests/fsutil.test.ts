// Removing a project folder must work on every OS, including Windows where the read-only source
// snapshot cannot be deleted until its read-only attribute is cleared (CI runs this on Windows).
import { mkdtempSync, readFileSync, existsSync, readdirSync, statSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { removeTree } from '../src/main/fsutil'
import { Project } from '../src/main/project'
import { commitImport, parseSource, previewMapping, validate } from '../src/main/importService'

describe('removeTree', () => {
  it('removes a project folder whose source snapshot is stored read-only', () => {
    const root = mkdtempSync(join(tmpdir(), 'bari-rm-'))
    const p = Project.create(root, 'Remove me')
    const src = parseSource(new Uint8Array(readFileSync(join(__dirname, 'fixtures', 'demo_workbook.xlsx'))), 'demo.xlsx')
    const sheet = src.wb.sheets[0].name
    const mp = previewMapping(p, src, sheet)
    commitImport(p, src, validate(src, { sheetName: sheet, headerRow: 1, participantColumn: mp.suggestion.participantColumn!, eventColumn: mp.suggestion.eventColumn }), { authorLabel: null, carryOverFrom: null })
    const snapshot = join(p.sourcesDir, readdirSync(p.sourcesDir)[0])
    expect(statSync(snapshot).mode & 0o222).toBe(0) // stored read-only
    p.close()
    removeTree(root)
    expect(existsSync(root)).toBe(false)
  })

  it('removes nested read-only files and is a no-op for missing folders', () => {
    const root = mkdtempSync(join(tmpdir(), 'bari-rm2-'))
    mkdirSync(join(root, 'a', 'b'), { recursive: true })
    writeFileSync(join(root, 'a', 'b', 'f.txt'), 'x')
    chmodSync(join(root, 'a', 'b', 'f.txt'), 0o444)
    removeTree(root)
    expect(existsSync(root)).toBe(false)
    expect(() => removeTree(join(root, 'never-existed'))).not.toThrow()
  })
})
