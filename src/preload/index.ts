// Sandboxed preload: exposes one narrow, typed invoke function. No Node APIs reach the renderer.
import { contextBridge, ipcRenderer } from 'electron'
import { CHANNELS } from '@shared/channels'

const allowed = new Set<string>(CHANNELS)

contextBridge.exposeInMainWorld('bari', {
  invoke: (channel: string, payload?: unknown) => {
    if (!allowed.has(channel)) return Promise.resolve({ ok: false, error: `Unknown channel ${channel}` })
    return ipcRenderer.invoke(channel, payload)
  },
  platform: process.platform
})
