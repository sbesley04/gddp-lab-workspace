import { useMemo } from 'react'
import { buildProvenance, type Provenance } from '@core/provenance'
import { useStore } from '../store'
import { useSelection, useSpec } from './selection'
import { APP_VERSION } from './version'

/** Analysis log for the chart on screen: same selection spec, metadata revision and chart settings as everything else. */
export function useProvenance(): Provenance | null {
  const snapshot = useStore((s) => s.snapshot)
  const chart = useStore((s) => s.chart)
  const spec = useSpec()
  const sel = useSelection()
  return useMemo(() => (snapshot && spec ? buildProvenance({ snapshot, spec, chart, sel, appVersion: APP_VERSION }) : null), [snapshot, spec, chart, sel])
}
