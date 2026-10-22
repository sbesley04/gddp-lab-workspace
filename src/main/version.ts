// Single source of the app version recorded in manifests, saved views and dataset versions.
declare const __APP_VERSION__: string | undefined
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : (process.env.npm_package_version ?? '0.1.0')
