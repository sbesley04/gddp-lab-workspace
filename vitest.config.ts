import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@core': resolve(__dirname, 'src/core'),
      '@shared': resolve(__dirname, 'src/shared'),
      '@importer': resolve(__dirname, 'src/importer')
    }
  },
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/reference/**'],
    environment: 'node',
    // Set-up hooks create SQLite projects on disk and import a workbook. On a busy Windows CI runner, with
    // every test file running in parallel, that has taken more than the default 10 s.
    hookTimeout: 60_000
  }
})
