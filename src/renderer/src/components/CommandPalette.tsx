import * as Dialog from '@radix-ui/react-dialog'
import { useStore } from '../store'
import { VariableList } from './Pickers'

/** ⌘K / Ctrl+K: jump to any measurement by header, alias, unit or column letter. */
export function CommandPalette() {
  const open = useStore((s) => s.paletteOpen)
  const setOpen = useStore((s) => s.setPaletteOpen)
  const snapshot = useStore((s) => s.snapshot)
  if (!snapshot) return null
  const measures = snapshot.variables.filter((v) => v.role === 'measure')
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog narrow" style={{ top: '18%', transform: 'translate(-50%, 0)', width: 460 }} aria-describedby={undefined}>
          <Dialog.Title className="sr-only">Find a measurement</Dialog.Title>
          <div style={{ padding: 12 }}>
            <VariableList
              vars={measures}
              value={null}
              onPick={(v) => {
                if (!v) return
                const st = useStore.getState()
                const numeric = v.kind === 'numeric' || v.kind === 'mixed'
                st.setChart(numeric ? { measureKey: v.key, type: st.chart.type === 'table' ? 'distribution' : st.chart.type } : { groupKey: v.key, type: 'distribution' })
                st.setPage('explore')
                setOpen(false)
              }}
            />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
