// Builds the MCP server into one self-contained Node file (out/mcp/server.js); runtime libraries are bundled,
// so it runs with plain Node 22.5+ (for node:sqlite) and needs no node_modules.
import { resolve } from 'node:path'
import { builtinModules } from 'node:module'
import { defineConfig } from 'vite'
import pkg from './package.json'

export default defineConfig({
  resolve: {
    alias: {
      '@core': resolve(__dirname, 'src/core'),
      '@shared': resolve(__dirname, 'src/shared'),
      '@importer': resolve(__dirname, 'src/importer')
    }
  },
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  ssr: { noExternal: true, target: 'node' },
  build: {
    ssr: resolve(__dirname, 'src/mcp/main.ts'),
    outDir: 'out/mcp',
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    rollupOptions: {
      external: [...builtinModules, ...builtinModules.map((m) => `node:${m}`), 'node:sqlite'],
      output: { format: 'es', entryFileNames: 'server.js', inlineDynamicImports: true }
    }
  }
})
