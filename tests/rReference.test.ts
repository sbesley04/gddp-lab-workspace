// Every R reference file must say which R and package versions produced it, so CI can install the same ones
// (workflow r-reference.yml) and so drift between the scripts and the committed values cannot go unnoticed.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (name: string) => JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf8'))
const workflow = readFileSync(join(__dirname, '..', '.github', 'workflows', 'r-reference.yml'), 'utf8')

describe('R reference files', () => {
  for (const [file, packages] of [['stats_reference.json', ['jsonlite', 'car']], ['multivariate_reference.json', ['jsonlite']], ['transforms_reference.json', ['jsonlite', 'car']]] as const) {
    it(`${file} records the R and package versions that produced it`, () => {
      const meta = read(file)._r
      expect(meta.r).toMatch(/^\d+\.\d+\.\d+$/)
      expect(Object.keys(meta.packages).sort()).toEqual([...packages].sort())
      for (const p of packages) expect(String(meta.packages[p])).toMatch(/^\d+(\.\d+)+$/)
      // CI installs this R version and a dated package snapshot; tools/check_reference.mjs then fails if the
      // installed package versions differ from the ones recorded here.
      expect(workflow).toContain(`r-version: '${meta.r}'`)
      expect(workflow).toMatch(/R_SNAPSHOT: https:\/\/packagemanager\.posit\.co\/cran\/__linux__\/\w+\/\d{4}-\d{2}-\d{2}/)
      for (const p of packages) expect(workflow).toContain(`${p} ${meta.packages[p]}`)
    })
  }
})
