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
  test: { include: ['tests/**/*.test.ts'], exclude: ['tests/reference/**'], environment: 'node' }
})
