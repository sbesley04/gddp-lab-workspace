import { useMemo } from 'react'
import { buildFlagIndex, computeSelection, type SelectionResult } from '@core/selection'
import type { SelectionSpec, VariableInfo, DatasetSnapshot } from '@core/types'
import { useStore } from '../store'

export function useSpec(): SelectionSpec | null {
  const versionId = useStore((s) => s.versionId)
  const filter = useStore((s) => s.filter)
  const qcExclude = useStore((s) => s.qcExclude)
  const visitIds = useStore((s) => s.visitIds)
  return useMemo(() => (versionId ? { datasetVersionId: versionId, filter, qc: { exclude: qcExclude }, visitIds, participantIds: null } : null), [versionId, filter, qcExclude, visitIds])
}

export function useFlagIndex(snapshot: DatasetSnapshot | null) {
  return useMemo(() => (snapshot ? buildFlagIndex(snapshot) : null), [snapshot])
}

/** The one selection used by every table, chart, summary and export preview in the UI. */
export function useSelection(): SelectionResult | null {
  const snapshot = useStore((s) => s.snapshot)
  const spec = useSpec()
  const flagIndex = useFlagIndex(snapshot)
  return useMemo(() => (snapshot && spec && flagIndex ? computeSelection(snapshot, spec, flagIndex) : null), [snapshot, spec, flagIndex])
}

export function useVar(key: string | null): VariableInfo | null {
  const snapshot = useStore((s) => s.snapshot)
  return useMemo(() => (key && snapshot ? snapshot.variables.find((v) => v.key === key) ?? null : null), [key, snapshot])
}
