// Typed access to the main process. Every call goes through one validated IPC bridge.
import type { ChannelName } from '@shared/channels'

declare global {
  interface Window {
    bari: { invoke: (channel: string, payload?: unknown) => Promise<{ ok: true; data: any } | { ok: false; error: string }>; platform: string }
  }
}

export class ApiError extends Error {}

export async function call<T = any>(channel: ChannelName, payload?: unknown): Promise<T> {
  const res = await window.bari.invoke(channel, payload)
  if (!res.ok) throw new ApiError(res.error)
  return res.data as T
}

export const platform = () => window.bari?.platform ?? 'unknown'
