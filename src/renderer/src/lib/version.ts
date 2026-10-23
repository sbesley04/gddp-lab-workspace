declare const __APP_VERSION__: string | undefined
export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'
export const APP_NAME = `BARI-CNS Research Workspace ${APP_VERSION}`
