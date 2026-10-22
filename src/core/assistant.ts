// Interface boundary for a FUTURE optional AI connector. Nothing implements this in the first release,
// and no code path sends data anywhere. Any implementation must satisfy the contract documented here.

import type { ContextExportPreview } from './contextExport'

export interface AssistantPayloadPreview {
  /** The exact bytes that would be sent, shown to the user before sending. */
  files: ContextExportPreview['files']
  summary: string
  estimatedTokens: number
  estimatedCostNote: string // provider pricing must be verified at implementation time
}

export interface AssistantProviderInfo {
  id: string
  displayName: string
  /** Credentials live in the OS keychain (e.g. Electron safeStorage), never in project files or logs. */
  credentialStorage: 'os-keychain'
  docsVerifiedOn: string // date the provider's current API documentation was checked
}

export interface AnalysisAssistantProvider {
  info(): AssistantProviderInfo
  /** Must be user-initiated, after the user has seen preview(). */
  send(preview: AssistantPayloadPreview, signal: AbortSignal): Promise<{ text: string; requestId: string | null }>
  /** Must degrade to a clear message when offline or rate-limited; the export package remains the fallback. */
  availability(): Promise<'ready' | 'offline' | 'rate_limited' | 'not_configured'>
}
