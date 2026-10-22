import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// Opt-in check against the real workbook. Set BARI_REFERENCE_XLSX to its local path.
export default defineConfig({
  resolve: {
    alias: {
      '@core': resolve(__dirname, 'src/core'),
      '@shared': resolve(__dirname, 'src/shared'),
      '@importer': resolve(__dirname, 'src/importer')
    }
  },
  test: { include: ['tests/reference/**/*.test.ts'], environment: 'node' }
})
