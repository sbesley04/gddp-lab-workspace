// Entry point: `node out/mcp/server.js --project <folder.bariproj> [--min-cell-size 5] [--no-access-log]`
// Speaks MCP over stdio. stdout carries protocol messages only; diagnostics go to stderr.
import { join, resolve } from 'node:path'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createServer } from './server'
import { DEFAULT_POLICY, Workspace } from './workspace'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function fail(message: string): never {
  process.stderr.write(`[bari-cns-mcp] ${message}\n`)
  process.exit(1)
}

async function main() {
  const dir = arg('--project') ?? process.env.BARI_PROJECT
  if (!dir) fail('Pass --project <path to a .bariproj folder> (or set BARI_PROJECT).')
  const minRaw = arg('--min-cell-size')
  const minCellSize = minRaw === undefined ? DEFAULT_POLICY.minCellSize : Number(minRaw)
  if (!Number.isInteger(minCellSize) || minCellSize < 1) fail('--min-cell-size must be a whole number of at least 1.')

  let ws: Workspace
  try {
    ws = Workspace.open(resolve(dir), { mode: 'aggregate', minCellSize })
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e))
  }
  const accessLog = process.argv.includes('--no-access-log') ? null : join(ws.project.dir, 'mcp-access.jsonl')
  const server = createServer(ws, { accessLog })
  await server.connect(new StdioServerTransport())
  process.stderr.write(`[bari-cns-mcp] serving "${ws.project.info.name}" read-only (aggregate results, min cell size ${minCellSize})\n`)
  const shutdown = () => {
    try {
      ws.close()
    } finally {
      process.exit(0)
    }
  }
  process.stdin.on('close', shutdown)
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((e) => fail(e instanceof Error ? (e.stack ?? e.message) : String(e)))
