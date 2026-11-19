// Every R reference file must say which R and package versions produced it, so CI can install the same ones
// (job r-reference) and so drift between the scripts and the committed values cannot go unnoticed.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (name: string) => JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf8'))
const workflow = readFileSync(join(__dirname, '..', '.github', 'workflows', 'build.yml'), 'utf8')

describe('R reference files', () => {
  for (const [file, packages] of [['stats_reference.json', ['jsonlite', 'car']], ['multivariate_reference.json', ['jsonlite']], ['transforms_reference.json', ['jsonlite', 'car']]] as const) {
    it(`${file} records the R and package versions that CI pins`, () => {
      const meta = read(file)._r
      expect(meta.r).toMatch(/^\d+\.\d+\.\d+$/)
      expect(Object.keys(meta.packages).sort()).toEqual([...packages].sort())
      expect(workflow).toContain(`r-version: '${meta.r}'`)
      for (const p of packages) {
        // CRAN writes car 3.1.3 as 3.1-3.
        const v = String(meta.packages[p])
        const cran = v.replace(/^(\d+\.\d+)\.(\d+)$/, '$1-$2')
        expect(workflow.includes(`${p}@${v}`) || workflow.includes(`${p}@${cran}`)).toBe(true)
      }
    })
  }
})
