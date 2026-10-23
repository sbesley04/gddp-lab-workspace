import { useMemo } from 'react'
import { Calculator, Copy, FileText, X, AlertTriangle, Info } from 'lucide-react'
import type { DatasetSnapshot, VariableInfo } from '@core/types'
import type { DistributionData, ScatterData } from '@core/chartData'
import {
  brownForsythe, describe, fmt, fmtCi, formatP, hedgesG, holm, kendall, kruskalWallis, linearFit, mannWhitney, oneWayAnova, pearson, spearman, welchAnova, welchT,
  type Descriptive
} from '@core/analysis'
import { useStore } from '../store'
import { label, qcPolicyText } from '../lib/format'
import type { FullChart } from './chartOptions'
import { fitInputs } from './chartOptions'
import { APP_NAME } from '../lib/version'

interface Common {
  chart: FullChart
  snapshot: DatasetSnapshot
  onChange: (a: Partial<FullChart['analysis']>) => void
}

const Pv = ({ p }: { p: number }) => <span className={p < 0.05 ? 'badge accent' : 'badge'} style={{ fontVariantNumeric: 'tabular-nums' }}>p {formatP(p)}</span>

function copy(text: string, what: string) {
  navigator.clipboard
    .writeText(text)
    .then(() => useStore.getState().toast('success', `${what} copied.`))
    .catch((e) => useStore.getState().toast('error', `Copy failed: ${e}`))
}

function provenance(snapshot: DatasetSnapshot) {
  return `${APP_NAME}; dataset v${snapshot.versionNumber} (source SHA-256 ${snapshot.sourceSha256.slice(0, 12)}…, sheet “${snapshot.sheetName}”), metadata revision ${snapshot.metadataVersion}`
}

function Shell({ title, onClose, children, actions }: { title: string; onClose: () => void; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="paper card" data-testid="stats-panel">
      <div className="card-head">
        <h3><Calculator size={16} /> {title}</h3>
        <span className="badge outline">Exploratory</span>
        <span className="spacer" />
        {actions}
        <button className="btn ghost sm icon" aria-label="Close statistics" onClick={onClose}><X size={14} /></button>
      </div>
      {children}
    </div>
  )
}

function Intro({ kind, chart, onChange }: { kind: 'distribution' | 'scatter' } & Pick<Common, 'chart' | 'onChange'>) {
  const a = chart.analysis
  return (
    <div className="paper card">
      <div className="card-head"><h3><Calculator size={16} /> Statistics</h3><span className="muted small">Nothing is computed until you ask</span></div>
      <p className="small" style={{ marginTop: 0 }}>
        {kind === 'scatter'
          ? 'Least-squares fit with 95% confidence (and optional prediction) bands, Pearson, Spearman and Kendall correlations with CIs and p-values, coefficient table, R², residual normality and influential points.'
          : 'Publication-style descriptives (mean ± SD, 95% CIs for mean and median, geometric mean, skewness, kurtosis, Shapiro–Wilk) and, when grouped, Welch t / Mann–Whitney (2 groups) or Welch ANOVA / Kruskal–Wallis with Holm-adjusted pairwise tests (3+ groups), with effect sizes.'}
      </p>
      <div className="row wrap" style={{ marginBottom: 10 }}>
        {kind === 'scatter' ? (
          <>
            <label className="check small"><input type="checkbox" checked={a.fitLine} onChange={(e) => onChange({ fitLine: e.target.checked })} /> Best-fit line</label>
            <label className="check small"><input type="checkbox" checked={a.confidenceBand} onChange={(e) => onChange({ confidenceBand: e.target.checked })} /> 95% confidence band</label>
            <label className="check small"><input type="checkbox" checked={a.predictionBand} onChange={(e) => onChange({ predictionBand: e.target.checked })} /> 95% prediction band</label>
          </>
        ) : (
          <label className="check small"><input type="checkbox" checked={a.meanCi} onChange={(e) => onChange({ meanCi: e.target.checked })} /> Show mean ± 95% CI on chart</label>
        )}
      </div>
      <button className="btn primary sm" onClick={() => onChange({ requested: true })} data-testid="compute-stats"><Calculator size={14} /> Compute statistics</button>
    </div>
  )
}

const Caveats = ({ extra }: { extra?: string[] }) => (
  <ul className="small muted" style={{ margin: '10px 0 0', paddingLeft: 18 }}>
    {extra?.map((e) => <li key={e}>{e}</li>)}
    <li>Two-sided tests, 95% confidence. p-values are not adjusted for the number of analyses you run (pairwise comparisons within one analysis are Holm-adjusted).</li>
    <li>Exploratory results from baseline observations cannot establish causality or treatment effects.</li>
    <li>Missing, censored, non-numeric and QC-excluded observations are excluded; axis bounds affect display only.</li>
  </ul>
)

// ---------------------------------------------------------------- distribution

interface GroupStats {
  label: string
  values: number[]
  d: Descriptive
}

export function DistributionStats({ data, measure, group, chart, snapshot, onChange }: Common & { data: DistributionData; measure: VariableInfo; group: VariableInfo | null }) {
  const qc = useStore((s) => s.qcExclude)
  const res = useMemo(() => {
    if (!chart.analysis.requested) return null
    const groups: GroupStats[] = data.groups
      .filter((g) => !g.label.startsWith('('))
      .map((g) => {
        const values = [...g.points, ...g.nonPositiveHidden].map((p) => p.value)
        return { label: g.label, values, d: describe(values) }
      })
    const usable = groups.filter((g) => g.values.length > 0)
    const vals = usable.map((g) => g.values)
    const two = usable.length === 2
    const many = usable.length >= 3
    const pairs: { a: string; b: string; t: ReturnType<typeof welchT>; mw: ReturnType<typeof mannWhitney> }[] = []
    if (many) for (let i = 0; i < usable.length; i++) for (let j = i + 1; j < usable.length; j++) pairs.push({ a: usable[i].label, b: usable[j].label, t: welchT(usable[i].values, usable[j].values), mw: mannWhitney(usable[i].values, usable[j].values) })
    const holmT = holm(pairs.map((p) => p.t?.p ?? 1))
    const holmMw = holm(pairs.map((p) => p.mw?.p ?? 1))
    return {
      groups,
      excludedGroups: data.groups.filter((g) => g.label.startsWith('(')),
      two: two ? { t: welchT(vals[0], vals[1]), g: hedgesG(vals[0], vals[1]), mw: mannWhitney(vals[0], vals[1]), a: usable[0].label, b: usable[1].label } : null,
      many: many ? { welch: welchAnova(vals), classic: oneWayAnova(vals), kw: kruskalWallis(vals), bf: brownForsythe(vals), pairs, holmT, holmMw } : null
    }
  }, [chart.analysis.requested, data])
  if (!res) return <Intro kind="distribution" chart={chart} onChange={onChange} />
  const name = label(measure)
  const tsv = () => {
    const rows = [['Group', 'n', 'Mean', 'SD', 'SE', '95% CI mean (lower)', '95% CI mean (upper)', 'Median', 'Q1', 'Q3', '95% CI median (lower)', '95% CI median (upper)', 'Geometric mean', 'CV %', 'Skewness', 'Excess kurtosis', 'Shapiro–Wilk W', 'Shapiro–Wilk p']]
    for (const g of res.groups) {
      const d = g.d
      rows.push([g.label, String(d.n), ...[d.mean, d.sd, d.se, d.meanCi?.lower, d.meanCi?.upper, d.median, d.q1, d.q3, d.medianCi?.lower, d.medianCi?.upper, d.geoMean, d.cv, d.skewness, d.kurtosis, d.shapiro?.w, d.shapiro?.p].map((v) => (v === null || v === undefined ? '' : String(v)))])
    }
    if (res.two?.t) rows.push([], ["Welch's t", 'difference', String(res.two.t.diff), 'CI', String(res.two.t.ci.lower), String(res.two.t.ci.upper), 't', String(res.two.t.t), 'df', String(res.two.t.df), 'p', String(res.two.t.p)])
    if (res.two?.mw) rows.push(['Mann–Whitney', 'W', String(res.two.mw.w), 'p', String(res.two.mw.p), 'rank-biserial r', String(res.two.mw.rankBiserial), 'Hodges–Lehmann', String(res.two.mw.hodgesLehmann)])
    if (res.two?.g) rows.push(["Hedges' g", String(res.two.g.g), 'CI', String(res.two.g.ci.lower), String(res.two.g.ci.upper)])
    if (res.many) {
      const m = res.many
      if (m.welch) rows.push([], ['Welch ANOVA', 'F', String(m.welch.f), 'df1', String(m.welch.df1), 'df2', String(m.welch.df2), 'p', String(m.welch.p)])
      if (m.classic) rows.push(['One-way ANOVA', 'F', String(m.classic.f), 'df1', String(m.classic.df1), 'df2', String(m.classic.df2), 'p', String(m.classic.p), 'eta²', String(m.classic.etaSquared)])
      if (m.kw) rows.push(['Kruskal–Wallis', 'H', String(m.kw.h), 'df', String(m.kw.df), 'p', String(m.kw.p), 'epsilon²', String(m.kw.epsilonSquared)])
      m.pairs.forEach((p, i) => rows.push([`${p.a} vs ${p.b}`, 'diff', String(p.t?.diff ?? ''), 'Welch p', String(p.t?.p ?? ''), 'Holm', String(m.holmT[i]), 'MW p', String(p.mw?.p ?? ''), 'Holm', String(m.holmMw[i])]))
    }
    return rows.map((r) => r.join('\t')).join('\n')
  }
  const methods = () =>
    `Exploratory analyses of ${name} were performed in ${provenance(snapshot)}. ` +
    'Continuous variables are summarised as mean (SD) and median [IQR]; 95% confidence intervals use the t distribution for means, the log-scale t interval for geometric means, and the distribution-free order-statistic method for medians. Quartiles use Hyndman–Fan type 7 interpolation. Normality was assessed with the Shapiro–Wilk test. ' +
    (res.two ? "Two-group differences were assessed with Welch's t-test (mean difference with 95% CI; effect size Hedges' g with 95% CI) and the Wilcoxon–Mann–Whitney test (exact for n < 50 per group without ties, otherwise normal approximation with continuity correction; effect size rank-biserial correlation; Hodges–Lehmann location shift). " : '') +
    (res.many ? "Differences among groups were assessed with Welch's heteroscedastic one-way ANOVA, classic one-way ANOVA (η²) and the Kruskal–Wallis test (ε²); homogeneity of variance with the Brown–Forsythe test. Pairwise comparisons used Welch's t and Mann–Whitney tests with Holm adjustment. " : '') +
    `All tests were two-sided. Missing, censored, non-numeric and QC-excluded observations were excluded (QC policy: ${qcPolicyText(qc)}); n is reported per group. Results are exploratory and unadjusted for the number of analyses performed.`
  const apa = () =>
    res.groups.map((g) => `${g.label}: M = ${fmt(g.d.mean)}, SD = ${fmt(g.d.sd)}, 95% CI ${fmtCi(g.d.meanCi)}, Mdn = ${fmt(g.d.median)} [IQR ${fmt(g.d.q1)}–${fmt(g.d.q3)}], n = ${g.d.n}`).join('; ') +
    (res.two?.t ? `. Welch's t(${fmt(res.two.t.df, 1)}) = ${fmt(res.two.t.t)}, p ${formatP(res.two.t.p)}, mean difference ${fmt(res.two.t.diff)}, 95% CI ${fmtCi(res.two.t.ci)}${res.two.g ? `, Hedges' g = ${fmt(res.two.g.g)}, 95% CI ${fmtCi(res.two.g.ci)}` : ''}` : '') +
    (res.two?.mw ? `; Mann–Whitney W = ${fmt(res.two.mw.w, 1)}, p ${formatP(res.two.mw.p)}, r = ${fmt(res.two.mw.rankBiserial)}` : '') +
    (res.many?.welch ? `. Welch's F(${fmt(res.many.welch.df1, 0)}, ${fmt(res.many.welch.df2, 1)}) = ${fmt(res.many.welch.f)}, p ${formatP(res.many.welch.p)}` : '') +
    (res.many?.kw ? `; Kruskal–Wallis H(${res.many.kw.df}) = ${fmt(res.many.kw.h)}, p ${formatP(res.many.kw.p)}, ε² = ${fmt(res.many.kw.epsilonSquared)}` : '') +
    '.'
  const small = res.groups.filter((g) => g.d.n < 3)
  return (
    <Shell
      title={`Statistics · ${name}`}
      onClose={() => onChange({ requested: false })}
      actions={
        <>
          <button className="btn sm" onClick={() => copy(tsv(), 'Results table')}><Copy size={13} /> Table (TSV)</button>
          <button className="btn sm" onClick={() => copy(apa(), 'Results summary')}><Copy size={13} /> APA summary</button>
          <button className="btn sm" onClick={() => copy(methods(), 'Methods text')}><FileText size={13} /> Methods text</button>
        </>
      }
    >
      <label className="check small" style={{ marginBottom: 8 }}><input type="checkbox" checked={chart.analysis.meanCi} onChange={(e) => onChange({ meanCi: e.target.checked })} /> Show mean ± 95% CI on chart</label>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr><th>Group</th><th>n</th><th>Mean (SD)</th><th>95% CI mean</th><th>Median [IQR]</th><th>95% CI median</th><th>Geo. mean [95% CI]</th><th>CV %</th><th>Skew</th><th>Kurtosis</th><th>Shapiro–Wilk</th></tr>
          </thead>
          <tbody>
            {res.groups.map((g) => (
              <tr key={g.label}>
                <td><strong>{g.label}</strong></td>
                <td className="num">{g.d.n}</td>
                <td className="num">{fmt(g.d.mean)} ({fmt(g.d.sd)})</td>
                <td className="num">{fmtCi(g.d.meanCi)}</td>
                <td className="num">{fmt(g.d.median)} [{fmt(g.d.q1)}, {fmt(g.d.q3)}]</td>
                <td className="num" title={g.d.medianCi ? `Achieved confidence ${(g.d.medianCi.achievedLevel * 100).toFixed(1)}%` : 'Needs n ≥ 6'}>{fmtCi(g.d.medianCi)}</td>
                <td className="num">{g.d.geoMean !== null ? `${fmt(g.d.geoMean)} ${fmtCi(g.d.geoMeanCi)}` : <span className="muted" title="Needs all values > 0">—</span>}</td>
                <td className="num">{fmt(g.d.cv, 1)}</td>
                <td className="num">{fmt(g.d.skewness)}</td>
                <td className="num">{fmt(g.d.kurtosis)}</td>
                <td className="num">{g.d.shapiro ? <>W = {fmt(g.d.shapiro.w, 3)} <Pv p={g.d.shapiro.p} /></> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {res.two && (
        <div className="grid cols-3" style={{ marginTop: 12 }}>
          <div className="flag-item">
            <strong>Welch's t-test</strong> <span className="muted small">{res.two.a} − {res.two.b}</span>
            {res.two.t ? <div className="num">Δ = {fmt(res.two.t.diff)} {fmtCi(res.two.t.ci)} · t({fmt(res.two.t.df, 1)}) = {fmt(res.two.t.t)} <Pv p={res.two.t.p} /></div> : <div className="muted">Needs n ≥ 2 per group and non-zero variance.</div>}
          </div>
          <div className="flag-item">
            <strong>Hedges' g</strong>
            {res.two.g ? <div className="num">g = {fmt(res.two.g.g)} {fmtCi(res.two.g.ci)}</div> : <div className="muted">Not available.</div>}
          </div>
          <div className="flag-item">
            <strong>Mann–Whitney U</strong> <span className="muted small">{res.two.mw?.method}</span>
            {res.two.mw ? <div className="num">W = {fmt(res.two.mw.w, 1)} <Pv p={res.two.mw.p} /> · r<sub>rb</sub> = {fmt(res.two.mw.rankBiserial)} · HL shift = {fmt(res.two.mw.hodgesLehmann)}</div> : <div className="muted">Not available.</div>}
          </div>
        </div>
      )}
      {res.many && (
        <>
          <div className="grid cols-4" style={{ marginTop: 12 }}>
            <div className="flag-item"><strong>Welch ANOVA</strong>{res.many.welch ? <div className="num">F({fmt(res.many.welch.df1, 0)}, {fmt(res.many.welch.df2, 1)}) = {fmt(res.many.welch.f)} <Pv p={res.many.welch.p} /></div> : <div className="muted">Needs n ≥ 2 and variance in every group.</div>}</div>
            <div className="flag-item"><strong>One-way ANOVA</strong>{res.many.classic ? <div className="num">F({res.many.classic.df1}, {res.many.classic.df2}) = {fmt(res.many.classic.f)} <Pv p={res.many.classic.p} /> · η² = {fmt(res.many.classic.etaSquared)}</div> : '—'}</div>
            <div className="flag-item"><strong>Kruskal–Wallis</strong>{res.many.kw ? <div className="num">H({res.many.kw.df}) = {fmt(res.many.kw.h)} <Pv p={res.many.kw.p} /> · ε² = {fmt(res.many.kw.epsilonSquared)}</div> : '—'}</div>
            <div className="flag-item"><strong>Brown–Forsythe</strong> <span className="muted small">equal variances</span>{res.many.bf ? <div className="num">F = {fmt(res.many.bf.f)} <Pv p={res.many.bf.p} /></div> : '—'}</div>
          </div>
          <div className="group-label" style={{ padding: '12px 0 6px' }}>Pairwise comparisons (Holm-adjusted)</div>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Comparison</th><th>Mean difference [95% CI]</th><th>Welch p</th><th>Holm p</th><th>Mann–Whitney p</th><th>Holm p</th></tr></thead>
              <tbody>
                {res.many.pairs.map((p, i) => (
                  <tr key={`${p.a}|${p.b}`}>
                    <td>{p.a} − {p.b}</td>
                    <td className="num">{p.t ? `${fmt(p.t.diff)} ${fmtCi(p.t.ci)}` : '—'}</td>
                    <td className="num">{p.t ? formatP(p.t.p).replace('= ', '') : '—'}</td>
                    <td className="num"><strong>{p.t ? formatP(res.many!.holmT[i]).replace('= ', '') : '—'}</strong></td>
                    <td className="num">{p.mw ? formatP(p.mw.p).replace('= ', '') : '—'}</td>
                    <td className="num"><strong>{p.mw ? formatP(res.many!.holmMw[i]).replace('= ', '') : '—'}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {res.groups.length === 1 && <p className="small muted">Choose “Group by” to compare groups.</p>}
      {small.length > 0 && <div className="callout" style={{ marginTop: 10 }}><AlertTriangle size={16} /><p className="small">{small.map((g) => g.label).join(', ')}: n &lt; 3, so several statistics are unavailable or unreliable.</p></div>}
      <Caveats extra={res.excludedGroups.length ? [`Rows with a missing or QC-excluded grouping value are left out of comparisons (${res.excludedGroups.map((g) => `${g.label}: ${g.summary.n}`).join(', ')}).`] : undefined} />
    </Shell>
  )
}

// ---------------------------------------------------------------- scatter

export function ScatterStats({ data, x, y, chart, snapshot, onChange, onHighlight }: Common & { data: ScatterData; x: VariableInfo; y: VariableInfo; onHighlight: (rows: number[]) => void }) {
  const qc = useStore((s) => s.qcExclude)
  const res = useMemo(() => {
    if (!chart.analysis.requested) return null
    const fi = fitInputs(data, chart)
    const raw = { xs: data.points.map((p) => p.x), ys: data.points.map((p) => p.y) }
    return {
      fi,
      pearson: pearson(fi.xs, fi.ys),
      spearman: spearman(raw.xs, raw.ys),
      kendall: kendall(raw.xs, raw.ys),
      fit: linearFit(fi.xs, fi.ys)
    }
  }, [chart.analysis.requested, data, chart])
  if (!res) return <Intro kind="scatter" chart={chart} onChange={onChange} />
  const { fit, fi } = res
  const scaleNote = fi.info.transformX || fi.info.transformY ? `Pearson r and the linear fit use log10(${[fi.info.transformX ? label(x) : null, fi.info.transformY ? label(y) : null].filter(Boolean).join(') and log10(')}), matching the log axes${fi.info.excluded ? `; ${fi.info.excluded} non-positive pair(s) excluded` : ''}. Rank correlations are scale-invariant.` : null
  const pid = (i: number) => snapshot.rows[fi.rows[i]]?.participantId
  const tsv = () => {
    const rows: string[][] = [['Statistic', 'Estimate', 'CI lower', 'CI upper', 'Statistic value', 'df', 'p']]
    if (res.pearson) rows.push(["Pearson's r", String(res.pearson.estimate), String(res.pearson.ci?.lower ?? ''), String(res.pearson.ci?.upper ?? ''), String(res.pearson.statistic), String(res.pearson.df ?? ''), String(res.pearson.p)])
    if (res.spearman) rows.push(["Spearman's rho", String(res.spearman.estimate), String(res.spearman.ci?.lower ?? ''), String(res.spearman.ci?.upper ?? ''), String(res.spearman.statistic), String(res.spearman.df ?? ''), String(res.spearman.p)])
    if (res.kendall) rows.push(["Kendall's tau-b", String(res.kendall.estimate), '', '', String(res.kendall.statistic), '', String(res.kendall.p)])
    if (fit) {
      rows.push(['Intercept', String(fit.intercept.estimate), String(fit.intercept.ci.lower), String(fit.intercept.ci.upper), String(fit.intercept.t), String(fit.df2), String(fit.intercept.p)])
      rows.push(['Slope', String(fit.slope.estimate), String(fit.slope.ci.lower), String(fit.slope.ci.upper), String(fit.slope.t), String(fit.df2), String(fit.slope.p)])
      rows.push(['R²', String(fit.r2)], ['Adjusted R²', String(fit.adjR2)], ['Residual SE', String(fit.sigma)], ['F', String(fit.f), '', '', '', `1, ${fit.df2}`, String(fit.p)])
    }
    return rows.map((r) => r.join('\t')).join('\n')
  }
  const methods = () =>
    `Exploratory associations between ${label(x)} and ${label(y)} were examined in ${provenance(snapshot)}. ` +
    "Pearson's r (t test; 95% CI by Fisher's z transformation), Spearman's ρ (t approximation; 95% CI by Fisher's z with the Bonett–Wright standard error) and Kendall's τ-b (tie-corrected normal approximation) were calculated. " +
    `A simple ordinary least-squares regression of ${label(y)} on ${label(x)} was fitted${scaleNote ? ' on the log10 scale' : ''}; 95% confidence intervals for coefficients and for the mean response use the t distribution. Residual normality was assessed with the Shapiro–Wilk test and influence with Cook's distance (threshold 4/n). ` +
    `All tests were two-sided. Only participants with numeric values for both measures were analysed (n = ${fi.xs.length}); missing, censored, non-numeric and QC-excluded observations were excluded (QC policy: ${qcPolicyText(qc)}). Results are exploratory and unadjusted for multiple analyses.`
  const apa = () =>
    [
      res.pearson && `Pearson r(${res.pearson.df}) = ${fmt(res.pearson.estimate)}, 95% CI ${fmtCi(res.pearson.ci)}, p ${formatP(res.pearson.p)}`,
      res.spearman && `Spearman ρ = ${fmt(res.spearman.estimate)}, 95% CI ${fmtCi(res.spearman.ci)}, p ${formatP(res.spearman.p)}`,
      fit && `slope b = ${fmt(fit.slope.estimate, 3)}, 95% CI ${fmtCi(fit.slope.ci, 3)}, t(${fit.df2}) = ${fmt(fit.slope.t)}, p ${formatP(fit.slope.p)}, R² = ${fmt(fit.r2)}`
    ]
      .filter(Boolean)
      .join('; ') + `; n = ${fi.xs.length}.`
  return (
    <Shell
      title={`Statistics · ${label(y)} vs ${label(x)}`}
      onClose={() => onChange({ requested: false })}
      actions={
        <>
          <button className="btn sm" onClick={() => copy(tsv(), 'Results table')}><Copy size={13} /> Table (TSV)</button>
          <button className="btn sm" onClick={() => copy(apa(), 'Results summary')}><Copy size={13} /> APA summary</button>
          <button className="btn sm" onClick={() => copy(methods(), 'Methods text')}><FileText size={13} /> Methods text</button>
        </>
      }
    >
      <div className="row wrap" style={{ marginBottom: 10 }}>
        <label className="check small"><input type="checkbox" checked={chart.analysis.fitLine} onChange={(e) => onChange({ fitLine: e.target.checked })} /> Best-fit line</label>
        <label className="check small"><input type="checkbox" checked={chart.analysis.confidenceBand} onChange={(e) => onChange({ confidenceBand: e.target.checked })} /> 95% confidence band</label>
        <label className="check small"><input type="checkbox" checked={chart.analysis.predictionBand} onChange={(e) => onChange({ predictionBand: e.target.checked })} /> 95% prediction band</label>
        <span className="spacer" />
        <span className="badge outline">n = {fi.xs.length} pairs</span>
      </div>
      {scaleNote && <div className="callout info" style={{ marginBottom: 10 }}><Info size={16} /><p className="small">{scaleNote}</p></div>}
      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <div>
          <div className="group-label" style={{ padding: '0 0 6px' }}>Correlation</div>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Measure</th><th>Estimate [95% CI]</th><th>Test</th><th>p</th></tr></thead>
              <tbody>
                {res.pearson && <tr><td>Pearson r</td><td className="num">{fmt(res.pearson.estimate, 3)} {fmtCi(res.pearson.ci, 3)}</td><td className="num">t({res.pearson.df}) = {fmt(res.pearson.statistic)}</td><td><Pv p={res.pearson.p} /></td></tr>}
                {res.spearman && <tr><td>Spearman ρ</td><td className="num">{fmt(res.spearman.estimate, 3)} {fmtCi(res.spearman.ci, 3)}</td><td className="num">t({res.spearman.df}) = {fmt(res.spearman.statistic)}</td><td><Pv p={res.spearman.p} /></td></tr>}
                {res.kendall && <tr><td>Kendall τ<sub>b</sub></td><td className="num">{fmt(res.kendall.estimate, 3)}</td><td className="num">z = {fmt(res.kendall.statistic)}</td><td><Pv p={res.kendall.p} /></td></tr>}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <div className="group-label" style={{ padding: '0 0 6px' }}>Linear regression ({label(y)} on {label(x)})</div>
          {fit ? (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Term</th><th>Estimate [95% CI]</th><th>SE</th><th>t({fit.df2})</th><th>p</th></tr></thead>
                <tbody>
                  <tr><td>Intercept</td><td className="num">{fmt(fit.intercept.estimate, 3)} {fmtCi(fit.intercept.ci, 3)}</td><td className="num">{fmt(fit.intercept.se, 3)}</td><td className="num">{fmt(fit.intercept.t)}</td><td><Pv p={fit.intercept.p} /></td></tr>
                  <tr><td>Slope</td><td className="num">{fmt(fit.slope.estimate, 3)} {fmtCi(fit.slope.ci, 3)}</td><td className="num">{fmt(fit.slope.se, 3)}</td><td className="num">{fmt(fit.slope.t)}</td><td><Pv p={fit.slope.p} /></td></tr>
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted small">Needs at least 3 pairs with variation in x.</p>
          )}
          {fit && (
            <div className="row wrap small" style={{ marginTop: 8 }}>
              <span className="badge">R² = {fmt(fit.r2, 3)}</span>
              <span className="badge">adj. R² = {fmt(fit.adjR2, 3)}</span>
              <span className="badge">σ = {fmt(fit.sigma, 3)}</span>
              <span className="badge">F(1, {fit.df2}) = {fmt(fit.f)}</span>
              {fit.residualShapiro && <span className="badge" title="Normality of residuals">Residuals Shapiro–Wilk W = {fmt(fit.residualShapiro.w, 3)}, p {formatP(fit.residualShapiro.p)}</span>}
            </div>
          )}
        </div>
      </div>
      {fit && fit.influential.length > 0 && (
        <div className="callout" style={{ marginTop: 10 }}>
          <AlertTriangle size={16} />
          <p className="small" style={{ flex: 1 }}>
            Influential points (Cook's D &gt; 4/n): {fit.influential.slice(0, 8).map((f) => `${pid(f.index)} (D = ${fmt(f.cooksD)})`).join(', ')}. Consider checking these source values before interpreting the fit.
          </p>
          <button className="btn sm" onClick={() => onHighlight(fit.influential.map((f) => fi.rows[f.index]))}>Highlight</button>
        </div>
      )}
      <Caveats />
    </Shell>
  )
}
