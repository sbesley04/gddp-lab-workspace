import { TRANSFORMS, TRANSFORM_LABELS, TRANSFORM_SHORT, type TransformId } from '@core/transforms'
import { useMemo, useState, type ReactNode } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { ChevronDown, Search, Check, Plus, X, Filter, ShieldCheck, CalendarDays, AlertTriangle } from 'lucide-react'
import type { FilterCondition, FilterGroup, FilterNode, QcCategory, VariableInfo } from '@core/types'
import { QC_CATEGORIES } from '@core/types'
import { describeCondition, qcImpact } from '@core/selection'
import { useStore } from '../store'
import { useSelection, useFlagIndex } from '../lib/selection'
import { label, areaOf, qcLabel, plural, qcPolicyText } from '../lib/format'

// ---------------- Measure picker ----------------

export function searchVariables(vars: VariableInfo[], q: string): VariableInfo[] {
  const t = q.trim().toLowerCase()
  if (!t) return vars
  const terms = t.split(/\s+/)
  return vars.filter((v) => {
    const hay = [v.header, label(v), v.letter, areaOf(v), v.meta.unit.value ?? '', v.meta.scoreType.value ?? '', ...v.aliases.map((a) => a.text)].join(' ').toLowerCase()
    return terms.every((x) => hay.includes(x))
  })
}

export function VariableList({ vars, value, onPick, autoFocus = true, showNone }: { vars: VariableInfo[]; value: string | null; onPick: (v: VariableInfo | null) => void; autoFocus?: boolean; showNone?: string }) {
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const results = useMemo(() => searchVariables(vars, q), [vars, q])
  const grouped = useMemo(() => {
    const m = new Map<string, VariableInfo[]>()
    for (const v of results) m.set(areaOf(v), [...(m.get(areaOf(v)) ?? []), v])
    return [...m.entries()]
  }, [results])
  const flat = grouped.flatMap(([, vs]) => vs)
  return (
    <div style={{ width: 420 }}>
      <div className="row" style={{ padding: '2px 4px 8px' }}>
        <Search size={15} className="muted" />
        <input
          className="input"
          style={{ flex: 1 }}
          placeholder={`Search ${vars.length} measures by name, alias, unit or column…`}
          value={q}
          autoFocus={autoFocus}
          onChange={(e) => {
            setQ(e.target.value)
            setActive(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActive(Math.min(flat.length - 1, active + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive(Math.max(0, active - 1))
            } else if (e.key === 'Enter' && flat[active]) onPick(flat[active])
          }}
          aria-label="Search measures"
        />
      </div>
      <div className="list" role="listbox" style={{ maxHeight: 420, overflow: 'auto' }}>
        {showNone && (
          <button className="list-item" onClick={() => onPick(null)} aria-selected={value === null}>
            <span className="t muted">{showNone}</span>
          </button>
        )}
        {grouped.map(([area, vs]) => (
          <div key={area}>
            <div className="group-label">{area}</div>
            {vs.map((v) => {
              const i = flat.indexOf(v)
              return (
                <button key={v.key} role="option" className="list-item" data-active={i === active} aria-selected={v.key === value} onClick={() => onPick(v)} onMouseEnter={() => setActive(i)}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="t">{label(v)}</div>
                    <div className="s">
                      {v.letter} · {v.meta.unit.value ? `${v.meta.unit.value}${v.meta.unit.status !== 'confirmed' ? ' (tentative)' : ''}` : 'unit unknown'}
                      {v.meta.scoreType.value ? ` · ${v.meta.scoreType.value}` : ''} · n={v.counts.number}
                      {v.aliases.length > 1 ? ` · aka ${v.aliases.slice(1).map((a) => a.text).join(', ')}` : ''}
                    </div>
                  </div>
                  {v.key === value && <Check size={15} />}
                </button>
              )
            })}
          </div>
        ))}
        {flat.length === 0 && <div className="muted small" style={{ padding: 12 }}>No measures match “{q}”.</div>}
      </div>
    </div>
  )
}

export function PickerChip({ icon, k, value, children, testId }: { icon: ReactNode; k: string; value: string; children: (close: () => void) => ReactNode; testId?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button className="picker glass" data-testid={testId} aria-label={`${k}: ${value}`}>
          <span className="k">{icon} {k}</span>
          <span className="v"><span>{value}</span> <ChevronDown size={14} className="muted" /></span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="popover" align="start" sideOffset={8}>
          {children(() => setOpen(false))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

export function MeasurePicker({ icon, k, value, vars, onChange, none, testId }: { icon: ReactNode; k: string; value: string | null; vars: VariableInfo[]; onChange: (key: string | null) => void; none?: string; testId?: string }) {
  const v = vars.find((x) => x.key === value)
  return (
    <PickerChip icon={icon} k={k} value={v ? label(v) : none ?? 'Choose…'} testId={testId}>
      {(close) => (
        <VariableList
          vars={vars}
          value={value}
          showNone={none}
          onPick={(p) => {
            onChange(p?.key ?? null)
            close()
          }}
        />
      )}
    </PickerChip>
  )
}

// ---------------- Visit picker ----------------

export function VisitPicker() {
  const snapshot = useStore((s) => s.snapshot)!
  const visitIds = useStore((s) => s.visitIds)
  const setVisits = useStore((s) => s.setVisits)
  const value = visitIds === 'all' ? (snapshot.visits.length === 1 ? snapshot.visits[0].name : 'All visits') : snapshot.visits.filter((v) => visitIds.includes(v.id)).map((v) => v.name).join(', ') || 'None'
  return (
    <PickerChip icon={<CalendarDays size={16} />} k="Visit" value={value} testId="visit-picker">
      {(close) => (
        <div style={{ width: 300 }} className="stack">
          <div className="list">
            <button className="list-item" aria-selected={visitIds === 'all'} onClick={() => { setVisits('all'); close() }}>
              <span className="t">All visits</span>
            </button>
            {snapshot.visits.map((v) => (
              <button key={v.id} className="list-item" aria-selected={visitIds !== 'all' && visitIds.includes(v.id)} onClick={() => { setVisits([v.id]); close() }}>
                <span className="t">{v.name}</span>
                <span className="s">{snapshot.rows.filter((r) => r.visitId === v.id).length} rows · no date recorded</span>
              </button>
            ))}
          </div>
          {snapshot.visits.length === 1 && <p className="small muted" style={{ margin: '0 8px 6px' }}>This dataset contains a single visit. No time axis or trend is drawn.</p>}
        </div>
      )}
    </PickerChip>
  )
}

// ---------------- QC policy ----------------

export function QcPolicyPicker() {
  const snapshot = useStore((s) => s.snapshot)!
  const qc = useStore((s) => s.qcExclude)
  const setQc = useStore((s) => s.setQcExclude)
  const sel = useSelection()
  const flagIndex = useFlagIndex(snapshot)!
  const measures = useMemo(() => snapshot.variables.filter((v) => v.role === 'measure').map((v) => v.index), [snapshot])
  const present = useMemo(() => new Set(snapshot.flags.map((f) => f.category).filter(Boolean)), [snapshot])
  const impact = useMemo(() => (sel ? qcImpact(snapshot, sel.rows, measures, [...QC_CATEGORIES], flagIndex) : null), [snapshot, sel, measures, flagIndex])
  const other = qc.filter((c) => c !== 'curator_exclusion')
  const value = other.length === 0 ? 'Include flagged' : other.length === 1 ? `Exclude ${qcLabel(other[0])}` : `Exclude ${other.length} categories`
  const toggle = (c: QcCategory) => setQc(qc.includes(c) ? qc.filter((x) => x !== c) : [...qc, c])
  return (
    <PickerChip icon={<ShieldCheck size={16} />} k="QC" value={value} testId="qc-picker">
      {() => (
        <div style={{ width: 430 }} className="stack">
          <div style={{ padding: '4px 6px 0' }}>
            <strong>Inclusion policy</strong>
            <p className="small muted" style={{ margin: '4px 0 0' }}>
              Flagged observations are included and marked by default; curator exclusions are honoured by default. Excluding a category removes only those flagged observations (not whole participants). Missing QC information is never treated as a pass. Current: {qcPolicyText(qc)}.
            </p>
          </div>
          <div className="list">
            {QC_CATEGORIES.filter((c) => present.has(c) || qc.includes(c)).map((c) => (
              <label key={c} className="list-item" style={{ cursor: 'pointer' }}>
                <input type="checkbox" checked={qc.includes(c)} onChange={() => toggle(c)} aria-label={`Exclude ${qcLabel(c)}`} />
                <div style={{ flex: 1 }}>
                  <div className="t">{qcLabel(c)}</div>
                  <div className="s">
                    {impact ? `${plural(impact[c].observations, 'observation')} · ${plural(impact[c].participants, 'participant')} in current selection` : ''}
                  </div>
                </div>
                {c === 'unresolved_highlight' && <span className="badge violet">meaning unknown</span>}
                {c.startsWith('possible') && <span className="badge warn">needs review</span>}
              </label>
            ))}
            {present.size === 0 && <div className="muted small" style={{ padding: 10 }}>No QC or formatting flags were found in this dataset version.</div>}
          </div>
        </div>
      )}
    </PickerChip>
  )
}

// ---------------- Filter builder ----------------

let condSeq = 0
const newId = () => `c${Date.now().toString(36)}${(condSeq++).toString(36)}`

function ConditionEditor({ initial, vars, onSave, onCancel }: { initial: FilterCondition | null; vars: VariableInfo[]; onSave: (c: FilterCondition) => void; onCancel: () => void }) {
  const [varKey, setVarKey] = useState<string | null>(initial?.variableKey ?? null)
  const v = vars.find((x) => x.key === varKey) ?? null
  const categorical = v?.kind === 'categorical'
  const [kind, setKind] = useState<FilterCondition['test']['kind']>(initial?.test.kind ?? 'range')
  const [min, setMin] = useState(initial?.test.kind === 'range' && initial.test.min !== null ? String(initial.test.min) : '')
  const [max, setMax] = useState(initial?.test.kind === 'range' && initial.test.max !== null ? String(initial.test.max) : '')
  const [values, setValues] = useState<string[]>(initial?.test.kind === 'in' ? initial.test.values : [])
  const [onMissing, setOnMissing] = useState<'exclude' | 'include'>(initial?.onMissing ?? 'exclude')
  if (!v)
    return (
      <VariableList
        vars={vars}
        value={null}
        onPick={(p) => {
          if (!p) return
          setVarKey(p.key)
          setKind(p.kind === 'categorical' ? 'in' : 'range')
        }}
      />
    )
  const effKind = categorical && kind === 'range' ? 'in' : kind
  const valid = effKind === 'range' ? min !== '' || max !== '' : effKind === 'in' ? values.length > 0 : true
  return (
    <div style={{ width: 400 }} className="stack">
      <div className="row">
        <strong style={{ flex: 1 }}>{label(v)}</strong>
        <button className="btn ghost sm" onClick={() => setVarKey(null)}>Change</button>
      </div>
      <div className="seg" role="group" aria-label="Condition type">
        {!categorical && <button aria-pressed={effKind === 'range'} onClick={() => setKind('range')}>Range</button>}
        {(categorical || v.categories.length > 0) && <button aria-pressed={effKind === 'in'} onClick={() => setKind('in')}>Values</button>}
        <button aria-pressed={effKind === 'present'} onClick={() => setKind('present')}>Is present</button>
        <button aria-pressed={effKind === 'missing'} onClick={() => setKind('missing')}>Is missing</button>
      </div>
      {effKind === 'range' && (
        <div className="row">
          <input className="input" style={{ width: 120 }} inputMode="decimal" placeholder="min" value={min} onChange={(e) => setMin(e.target.value)} aria-label="Minimum" />
          <span className="muted">≤ value ≤</span>
          <input className="input" style={{ width: 120 }} inputMode="decimal" placeholder="max" value={max} onChange={(e) => setMax(e.target.value)} aria-label="Maximum" />
        </div>
      )}
      {effKind === 'in' && (
        <div className="list" style={{ maxHeight: 220, overflow: 'auto' }}>
          {v.categories.map((c) => (
            <label key={c} className="list-item">
              <input type="checkbox" checked={values.includes(c)} onChange={() => setValues(values.includes(c) ? values.filter((x) => x !== c) : [...values, c])} />
              <span>{c}</span>
            </label>
          ))}
        </div>
      )}
      {(effKind === 'range' || effKind === 'in') && (
        <label className="field">
          When the value is missing, non-numeric, censored or QC-excluded
          <select className="input" value={onMissing} onChange={(e) => setOnMissing(e.target.value as 'exclude' | 'include')}>
            <option value="exclude">Exclude the row</option>
            <option value="include">Keep the row</option>
          </select>
        </label>
      )}
      <div className="row">
        <span className="spacer" />
        <button className="btn ghost sm" onClick={onCancel}>Cancel</button>
        <button
          className="btn primary sm"
          disabled={!valid || (effKind === 'range' && ((min !== '' && isNaN(Number(min))) || (max !== '' && isNaN(Number(max)))))}
          onClick={() =>
            onSave({
              type: 'cond',
              id: initial?.id ?? newId(),
              variableKey: v.key,
              onMissing,
              test: effKind === 'range' ? { kind: 'range', min: min === '' ? null : Number(min), max: max === '' ? null : Number(max) } : effKind === 'in' ? { kind: 'in', values } : { kind: effKind }
            })
          }
        >
          Apply
        </button>
      </div>
    </div>
  )
}

function replaceNode(g: FilterGroup, id: string, next: FilterNode | null): FilterGroup {
  return {
    ...g,
    children: g.children
      .map((c) => (c.id === id ? next : c.type === 'group' ? replaceNode(c, id, next) : c))
      .filter((c): c is FilterNode => c !== null)
      .filter((c) => c.type === 'cond' || c.children.length > 0)
  }
}

function addToGroup(g: FilterGroup, groupId: string, node: FilterNode): FilterGroup {
  if (g.id === groupId) return { ...g, children: [...g.children, node] }
  return { ...g, children: g.children.map((c) => (c.type === 'group' ? addToGroup(c, groupId, node) : c)) }
}

function ConditionChip({ c, vars }: { c: FilterCondition; vars: VariableInfo[] }) {
  const filter = useStore((s) => s.filter)
  const setFilter = useStore((s) => s.setFilter)
  const [open, setOpen] = useState(false)
  const varByKey = useMemo(() => new Map(vars.map((v) => [v.key, v])), [vars])
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <span className="badge accent" style={{ padding: '4px 4px 4px 10px', fontSize: 12.5 }}>
        <Popover.Trigger asChild>
          <button className="btn ghost sm" style={{ height: 22, padding: '0 4px', color: 'inherit' }}>{describeCondition({ varByKey }, c)}</button>
        </Popover.Trigger>
        <button className="btn ghost sm icon" style={{ height: 22, width: 22, color: 'inherit' }} aria-label="Remove condition" onClick={() => setFilter(replaceNode(filter, c.id, null))}>
          <X size={12} />
        </button>
      </span>
      <Popover.Portal>
        <Popover.Content className="popover" align="start" sideOffset={8}>
          <ConditionEditor initial={c} vars={vars} onCancel={() => setOpen(false)} onSave={(n) => { setFilter(replaceNode(filter, c.id, n)); setOpen(false) }} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function AddCondition({ groupId, vars, labelText = 'Add filter' }: { groupId: string; vars: VariableInfo[]; labelText?: string }) {
  const filter = useStore((s) => s.filter)
  const setFilter = useStore((s) => s.setFilter)
  const [open, setOpen] = useState(false)
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button className="btn sm" data-testid="add-filter"><Plus size={13} /> {labelText}</button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="popover" align="start" sideOffset={8}>
          <ConditionEditor initial={null} vars={vars} onCancel={() => setOpen(false)} onSave={(n) => { setFilter(addToGroup(filter, groupId, n)); setOpen(false) }} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function OpToggle({ g }: { g: FilterGroup }) {
  const filter = useStore((s) => s.filter)
  const setFilter = useStore((s) => s.setFilter)
  const flip = (root: FilterGroup): FilterGroup => (root.id === g.id ? { ...root, op: root.op === 'and' ? 'or' : 'and' } : { ...root, children: root.children.map((c) => (c.type === 'group' ? flip(c) : c)) })
  return (
    <button className="btn ghost sm" onClick={() => setFilter(flip(filter))} title="Switch between ALL (AND) and ANY (OR)" aria-label={`Combine with ${g.op === 'and' ? 'AND' : 'OR'}; click to switch`}>
      <strong>{g.op === 'and' ? 'ALL of' : 'ANY of'}</strong>
    </button>
  )
}

export function FilterBar() {
  const snapshot = useStore((s) => s.snapshot)!
  const filter = useStore((s) => s.filter)
  const setFilter = useStore((s) => s.setFilter)
  const sel = useSelection()
  const vars = useMemo(() => snapshot.variables.filter((v) => v.role === 'measure'), [snapshot])
  const total = snapshot.rows.length
  const renderGroup = (g: FilterGroup, nested: boolean): ReactNode => (
    <span key={g.id} className="row wrap" style={nested ? { padding: '3px 6px', border: '1px dashed var(--hairline-strong)', borderRadius: 12 } : undefined}>
      {g.children.length > 1 && <OpToggle g={g} />}
      {g.children.map((c) => (c.type === 'cond' ? <ConditionChip key={c.id} c={c} vars={vars} /> : renderGroup(c, true)))}
      {nested && <AddCondition groupId={g.id} vars={vars} labelText="" />}
    </span>
  )
  return (
    <div className="row wrap" style={{ marginBottom: 12, gap: 8 }} aria-label="Cohort filters" data-tour="filters">
      <span className="row muted small" style={{ gap: 6 }}>
        <Filter size={14} /> Cohort
      </span>
      {filter.children.length === 0 && <span className="muted small">All rows</span>}
      {renderGroup(filter, false)}
      <AddCondition groupId={filter.id} vars={vars} />
      {filter.children.length > 0 && (
        <button className="btn ghost sm" onClick={() => setFilter({ ...filter, children: [...filter.children, { type: 'group', id: newId(), op: filter.op === 'and' ? 'or' : 'and', children: [] }] })} title="Add a nested group with the opposite combinator">
          <Plus size={13} /> Group
        </button>
      )}
      {filter.children.length > 0 && (
        <button className="btn ghost sm" onClick={() => setFilter({ ...filter, children: [] })}>Clear</button>
      )}
      <span className="spacer" />
      {sel && (
        <span className="badge outline" data-testid="cohort-count">
          {sel.rows.length} of {total} rows · {sel.participantIds.length} participants
        </span>
      )}
      {sel && sel.rows.length === 0 && (
        <span className="badge warn"><AlertTriangle size={12} /> No rows match</span>
      )}
    </div>
  )
}

// ---------------- Transform ----------------

export function TransformSelect({ value, onChange, label, testId }: { value: TransformId; onChange: (t: TransformId) => void; label: string; testId?: string }) {
  return (
    <select
      className="btn sm"
      aria-label={label}
      data-testid={testId}
      title={`${label}: ${TRANSFORM_LABELS[value]}. Applied to the values in this chart only; recorded in the analysis log.`}
      value={value}
      onChange={(e) => onChange(e.target.value as TransformId)}
      style={{ width: 'auto', alignSelf: 'center', ...(value !== 'none' ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : {}) }}
    >
      {TRANSFORMS.map((t) => <option key={t} value={t}>{TRANSFORM_SHORT[t]}</option>)}
    </select>
  )
}
