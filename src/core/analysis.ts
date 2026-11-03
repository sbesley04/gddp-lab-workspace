// On-demand inferential statistics. Nothing here runs automatically: the UI calls these only when the
// researcher presses "Compute". Every result carries its method, n and assumptions so it can be reported.
// Reference values from R 4.3 (tools/stats_reference.R) are checked in tests/inference.test.ts.

import { mean as meanOf, quantileType7, sampleSd } from './stats'
import { pbinom, pchisqUpper, pfUpper, pnorm, ptTwoSided, qnorm, qt } from './distributions'

export const CONF_LEVEL = 0.95

export interface Interval {
  lower: number
  upper: number
  level: number
}

// ---------------------------------------------------------------- descriptive

export interface Descriptive {
  n: number
  mean: number | null
  sd: number | null
  se: number | null
  meanCi: Interval | null
  median: number | null
  medianCi: (Interval & { achievedLevel: number }) | null
  q1: number | null
  q3: number | null
  iqr: number | null
  min: number | null
  max: number | null
  cv: number | null // %, only when all values > 0
  geoMean: number | null // only when all values > 0
  geoMeanCi: Interval | null
  skewness: number | null // adjusted Fisher–Pearson G1 (as SPSS / Excel SKEW)
  kurtosis: number | null // excess kurtosis G2 (as SPSS / Excel KURT)
  shapiro: ShapiroResult | null
}

export function describe(xs: number[]): Descriptive {
  const x = [...xs].sort((a, b) => a - b)
  const n = x.length
  const m = meanOf(x)
  const sd = sampleSd(x)
  const se = sd !== null ? sd / Math.sqrt(n) : null
  const tcrit = n >= 2 ? qt(1 - (1 - CONF_LEVEL) / 2, n - 1) : null
  const allPos = n > 0 && x[0] > 0
  let geoMean: number | null = null
  let geoMeanCi: Interval | null = null
  if (allPos) {
    const logs = x.map(Math.log)
    const lm = meanOf(logs)!
    geoMean = Math.exp(lm)
    const lsd = sampleSd(logs)
    if (lsd !== null && tcrit !== null) {
      const h = (tcrit * lsd) / Math.sqrt(n)
      geoMeanCi = { lower: Math.exp(lm - h), upper: Math.exp(lm + h), level: CONF_LEVEL }
    }
  }
  let skewness: number | null = null
  let kurtosis: number | null = null
  if (n >= 3 && m !== null) {
    let m2 = 0
    let m3 = 0
    let m4 = 0
    for (const v of x) {
      const d = v - m
      m2 += d * d
      m3 += d * d * d
      m4 += d * d * d * d
    }
    m2 /= n
    m3 /= n
    m4 /= n
    if (m2 > 0) {
      const g1 = m3 / Math.pow(m2, 1.5)
      skewness = (Math.sqrt(n * (n - 1)) / (n - 2)) * g1
      if (n >= 4) {
        const g2 = m4 / (m2 * m2) - 3
        kurtosis = (((n + 1) * g2 + 6) * (n - 1)) / ((n - 2) * (n - 3))
      }
    }
  }
  const q1 = quantileType7(x, 0.25)
  const q3 = quantileType7(x, 0.75)
  return {
    n,
    mean: m,
    sd,
    se,
    meanCi: m !== null && se !== null && tcrit !== null ? { lower: m - tcrit * se, upper: m + tcrit * se, level: CONF_LEVEL } : null,
    median: quantileType7(x, 0.5),
    medianCi: medianCi(x),
    q1,
    q3,
    iqr: q1 !== null && q3 !== null ? q3 - q1 : null,
    min: n ? x[0] : null,
    max: n ? x[n - 1] : null,
    cv: allPos && sd !== null && m ? (100 * sd) / m : null,
    geoMean,
    geoMeanCi,
    skewness,
    kurtosis,
    shapiro: n >= 3 && n <= 5000 ? shapiroWilk(x) : null
  }
}

/** Distribution-free CI for the median from order statistics (binomial, conservative ≥ 95%). */
export function medianCi(sorted: number[]): (Interval & { achievedLevel: number }) | null {
  const n = sorted.length
  const alpha = 1 - CONF_LEVEL
  // l = qbinom(alpha/2, n, 0.5): smallest l with P(B ≤ l) ≥ alpha/2
  let l = 0
  while (l < n && pbinom(l, n, 0.5) < alpha / 2) l++
  if (l < 1) return null
  const achieved = 1 - 2 * pbinom(l - 1, n, 0.5)
  return { lower: sorted[l - 1], upper: sorted[n - l], level: CONF_LEVEL, achievedLevel: achieved }
}

// ---------------------------------------------------------------- Shapiro–Wilk (Royston 1995, AS R94, as in R)

export interface ShapiroResult {
  w: number
  p: number
}

function poly(cc: number[], x: number): number {
  let ret = cc[0]
  if (cc.length > 1) {
    let p = x * cc[cc.length - 1]
    for (let j = cc.length - 2; j > 0; j--) p = (p + cc[j]) * x
    ret += p
  }
  return ret
}

export function shapiroWilk(sortedInput: number[]): ShapiroResult | null {
  const x = [...sortedInput].sort((a, b) => a - b)
  const n = x.length
  if (n < 3 || n > 5000) return null
  const range = x[n - 1] - x[0]
  if (range < 1e-19) return null
  const nn2 = Math.floor(n / 2)
  const a = new Array<number>(nn2 + 1).fill(0) // 1-based
  const c1 = [0, 0.221157, -0.147981, -2.07119, 4.434685, -2.706056]
  const c2 = [0, 0.042981, -0.293762, -1.752461, 5.682633, -3.582633]
  const c3 = [0.544, -0.39978, 0.025054, -6.714e-4]
  const c4 = [1.3822, -0.77857, 0.062767, -0.0020322]
  const c5 = [-1.5861, -0.31082, -0.083751, 0.0038915]
  const c6 = [-0.4803, -0.082676, 0.0030302]
  const g = [-2.273, 0.459]
  const an = n
  if (n === 3) a[1] = Math.SQRT1_2
  else {
    const an25 = an + 0.25
    let summ2 = 0
    for (let i = 1; i <= nn2; i++) {
      a[i] = qnorm((i - 0.375) / an25)
      summ2 += a[i] * a[i]
    }
    summ2 *= 2
    const ssumm2 = Math.sqrt(summ2)
    const rsn = 1 / Math.sqrt(an)
    const a1 = poly(c1, rsn) - a[1] / ssumm2
    let i1: number
    let fac: number
    if (n > 5) {
      i1 = 3
      const a2 = -a[2] / ssumm2 + poly(c2, rsn)
      fac = Math.sqrt((summ2 - 2 * a[1] * a[1] - 2 * a[2] * a[2]) / (1 - 2 * a1 * a1 - 2 * a2 * a2))
      a[2] = a2
    } else {
      i1 = 2
      fac = Math.sqrt((summ2 - 2 * a[1] * a[1]) / (1 - 2 * a1 * a1))
    }
    a[1] = a1
    for (let i = i1; i <= nn2; i++) a[i] /= -fac
  }
  // W as the squared correlation between ordered data and coefficients
  let sa = 0
  let sx = 0
  for (let i = 0; i < n; i++) {
    sx += x[i] / range
    const j = n - 1 - i
    if (i !== j) sa += Math.sign(i - j) * a[1 + Math.min(i, j)]
  }
  sa /= n
  sx /= n
  let ssa = 0
  let ssx = 0
  let sax = 0
  for (let i = 0, j = n - 1; i < n; i++, j--) {
    const asa = i !== j ? Math.sign(i - j) * a[1 + Math.min(i, j)] - sa : -sa
    const xsx = x[i] / range - sx
    ssa += asa * asa
    ssx += xsx * xsx
    sax += asa * xsx
  }
  const ssassx = Math.sqrt(ssa * ssx)
  const w1 = ((ssassx - sax) * (ssassx + sax)) / (ssa * ssx)
  const w = 1 - w1
  if (n === 3) {
    const p = (6 / Math.PI) * (Math.asin(Math.sqrt(w)) - Math.PI / 3)
    return { w, p: Math.max(0, p) }
  }
  let y = Math.log(w1)
  const xx = Math.log(an)
  let m: number
  let s: number
  if (n <= 11) {
    const gamma = poly(g, an)
    if (y >= gamma) return { w, p: 1e-99 }
    y = -Math.log(gamma - y)
    m = poly(c3, an)
    s = Math.exp(poly(c4, an))
  } else {
    m = poly(c5, xx)
    s = Math.exp(poly(c6, xx))
  }
  return { w, p: 1 - pnorm((y - m) / s) }
}

// ---------------------------------------------------------------- two groups

export interface WelchT {
  diff: number // mean(a) − mean(b)
  ci: Interval
  t: number
  df: number
  p: number
}

export function welchT(a: number[], b: number[]): WelchT | null {
  const n1 = a.length
  const n2 = b.length
  if (n1 < 2 || n2 < 2) return null
  const m1 = meanOf(a)!
  const m2 = meanOf(b)!
  const v1 = sampleSd(a)! ** 2
  const v2 = sampleSd(b)! ** 2
  const se2 = v1 / n1 + v2 / n2
  if (se2 === 0) return null
  const se = Math.sqrt(se2)
  const df = (se2 * se2) / ((v1 / n1) ** 2 / (n1 - 1) + (v2 / n2) ** 2 / (n2 - 1))
  const t = (m1 - m2) / se
  const crit = qt(1 - (1 - CONF_LEVEL) / 2, df)
  return { diff: m1 - m2, ci: { lower: m1 - m2 - crit * se, upper: m1 - m2 + crit * se, level: CONF_LEVEL }, t, df, p: ptTwoSided(t, df) }
}

export interface HedgesG {
  g: number
  ci: Interval
}

/** Hedges' g (pooled SD, small-sample corrected) with a normal-approximation CI (Hedges & Olkin 1985). */
export function hedgesG(a: number[], b: number[]): HedgesG | null {
  const n1 = a.length
  const n2 = b.length
  if (n1 < 2 || n2 < 2) return null
  const sp = Math.sqrt(((n1 - 1) * sampleSd(a)! ** 2 + (n2 - 1) * sampleSd(b)! ** 2) / (n1 + n2 - 2))
  if (sp === 0) return null
  const d = (meanOf(a)! - meanOf(b)!) / sp
  const j = 1 - 3 / (4 * (n1 + n2) - 9)
  const g = j * d
  const se = Math.sqrt((n1 + n2) / (n1 * n2) + (g * g) / (2 * (n1 + n2)))
  const z = qnorm(1 - (1 - CONF_LEVEL) / 2)
  return { g, ci: { lower: g - z * se, upper: g + z * se, level: CONF_LEVEL } }
}

/** Average ranks (ties share their mean rank) and tie-group sizes. */
export function ranks(values: number[]): { r: number[]; tieSizes: number[] } {
  const idx = values.map((v, i) => [v, i] as const).sort((p, q) => p[0] - q[0])
  const r = new Array<number>(values.length)
  const tieSizes: number[] = []
  let i = 0
  while (i < idx.length) {
    let j = i
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++
    const avg = (i + j) / 2 + 1
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg
    if (j > i) tieSizes.push(j - i + 1)
    i = j + 1
  }
  return { r, tieSizes }
}

export interface MannWhitney {
  w: number // R's W: rank sum of the first group − n1(n1+1)/2
  p: number
  method: 'exact' | 'normal approximation with continuity correction'
  rankBiserial: number // r = 1 − 2U/(n1 n2), with U = W; positive when group a tends to be larger
  hodgesLehmann: number // median of all pairwise differences a_i − b_j
}

/** Exact distribution of the rank-sum statistic (no ties): counts of subsets of {1..N} of size m by sum. */
function exactWilcoxonCdf(m: number, n: number): (w: number) => number {
  const N = m + n
  const maxSum = (N * (N + 1)) / 2
  const dp: Float64Array[] = Array.from({ length: m + 1 }, () => new Float64Array(maxSum + 1))
  dp[0][0] = 1
  for (let item = 1; item <= N; item++)
    for (let k = Math.min(item, m); k >= 1; k--) {
      const prev = dp[k - 1]
      const cur = dp[k]
      for (let s = maxSum; s >= item; s--) if (prev[s - item]) cur[s] += prev[s - item]
    }
  const counts = dp[m]
  const offset = (m * (m + 1)) / 2
  let total = 0
  for (const c of counts) total += c
  const cum: number[] = []
  let acc = 0
  for (let w = 0; w <= m * n; w++) {
    acc += counts[w + offset]
    cum.push(acc / total)
  }
  return (w: number) => (w < 0 ? 0 : w >= cum.length ? 1 : cum[Math.floor(w)])
}

export function mannWhitney(a: number[], b: number[]): MannWhitney | null {
  const n1 = a.length
  const n2 = b.length
  if (n1 < 1 || n2 < 1) return null
  const { r, tieSizes } = ranks([...a, ...b])
  let rs = 0
  for (let i = 0; i < n1; i++) rs += r[i]
  const w = rs - (n1 * (n1 + 1)) / 2
  const diffs: number[] = []
  for (const x of a) for (const y of b) diffs.push(x - y)
  diffs.sort((p, q) => p - q)
  const hl = quantileType7(diffs, 0.5)!
  const rankBiserial = (2 * w) / (n1 * n2) - 1
  if (n1 < 50 && n2 < 50 && tieSizes.length === 0) {
    const cdf = exactWilcoxonCdf(n1, n2)
    const p = w > (n1 * n2) / 2 ? 1 - cdf(w - 1) : cdf(w)
    return { w, p: Math.min(1, 2 * p), method: 'exact', rankBiserial, hodgesLehmann: hl }
  }
  const N = n1 + n2
  const tieTerm = tieSizes.reduce((s, t) => s + t * t * t - t, 0)
  const sigma = Math.sqrt(((n1 * n2) / 12) * (N + 1 - tieTerm / (N * (N - 1))))
  let z = w - (n1 * n2) / 2
  z = (z - Math.sign(z) * 0.5) / sigma
  const p = 2 * Math.min(pnorm(z), 1 - pnorm(z))
  return { w, p: Math.min(1, p), method: 'normal approximation with continuity correction', rankBiserial, hodgesLehmann: hl }
}

// ---------------------------------------------------------------- k groups

export interface AnovaResult {
  f: number
  df1: number
  df2: number
  p: number
  etaSquared?: number
}

/** Classic one-way ANOVA (equal variances), with η². */
export function oneWayAnova(groups: number[][]): AnovaResult | null {
  const gs = groups.filter((g) => g.length > 0)
  const k = gs.length
  const N = gs.reduce((s, g) => s + g.length, 0)
  if (k < 2 || N - k < 1) return null
  const grand = meanOf(gs.flat())!
  let ssb = 0
  let ssw = 0
  for (const g of gs) {
    const m = meanOf(g)!
    ssb += g.length * (m - grand) ** 2
    for (const v of g) ssw += (v - m) ** 2
  }
  if (ssw === 0) return null
  const df1 = k - 1
  const df2 = N - k
  const f = ssb / df1 / (ssw / df2)
  return { f, df1, df2, p: pfUpper(f, df1, df2), etaSquared: ssb / (ssb + ssw) }
}

/** Welch's heteroscedastic one-way ANOVA (as R oneway.test(var.equal = FALSE)). */
export function welchAnova(groups: number[][]): AnovaResult | null {
  const gs = groups.filter((g) => g.length >= 2)
  const k = gs.length
  if (k < 2 || gs.length !== groups.filter((g) => g.length > 0).length) return null
  const n = gs.map((g) => g.length)
  const m = gs.map((g) => meanOf(g)!)
  const v = gs.map((g) => sampleSd(g)! ** 2)
  if (v.some((x) => x === 0)) return null
  const w = n.map((ni, i) => ni / v[i])
  const sw = w.reduce((s, x) => s + x, 0)
  const mw = w.reduce((s, wi, i) => s + wi * m[i], 0) / sw
  const tmp = w.reduce((s, wi, i) => s + (1 - wi / sw) ** 2 / (n[i] - 1), 0) / (k * k - 1)
  const f = w.reduce((s, wi, i) => s + wi * (m[i] - mw) ** 2, 0) / ((k - 1) * (1 + 2 * (k - 2) * tmp))
  const df1 = k - 1
  const df2 = 1 / (3 * tmp)
  return { f, df1, df2, p: pfUpper(f, df1, df2) }
}

/** Brown–Forsythe test for equal variances (Levene's test centred on the median). */
export function brownForsythe(groups: number[][]): AnovaResult | null {
  const dev = groups.filter((g) => g.length > 0).map((g) => {
    const med = quantileType7([...g].sort((a, b) => a - b), 0.5)!
    return g.map((x) => Math.abs(x - med))
  })
  const r = oneWayAnova(dev)
  return r ? { f: r.f, df1: r.df1, df2: r.df2, p: r.p } : null
}

export interface KruskalResult {
  h: number
  df: number
  p: number
  epsilonSquared: number
}

/** Kruskal–Wallis rank-sum test with tie correction (as R kruskal.test), ε² = H(n+1)/(n²−1). */
export function kruskalWallis(groups: number[][]): KruskalResult | null {
  const gs = groups.filter((g) => g.length > 0)
  const k = gs.length
  const all = gs.flat()
  const N = all.length
  if (k < 2 || N < 3) return null
  const { r, tieSizes } = ranks(all)
  let pos = 0
  let s = 0
  for (const g of gs) {
    let rs = 0
    for (let i = 0; i < g.length; i++) rs += r[pos + i]
    pos += g.length
    s += (rs * rs) / g.length
  }
  let h = (12 / (N * (N + 1))) * s - 3 * (N + 1)
  const ties = tieSizes.reduce((acc, t) => acc + t * t * t - t, 0)
  const corr = 1 - ties / (N * N * N - N)
  if (corr === 0) return null
  h /= corr
  return { h, df: k - 1, p: pchisqUpper(h, k - 1), epsilonSquared: (h * (N + 1)) / (N * N - 1) }
}

/** Holm step-down adjustment (as R p.adjust(method = "holm")). */
export function holm(ps: number[]): number[] {
  const m = ps.length
  const order = ps.map((p, i) => [p, i] as const).sort((a, b) => a[0] - b[0])
  const out = new Array<number>(m)
  let running = 0
  order.forEach(([p, i], rank) => {
    running = Math.max(running, Math.min(1, (m - rank) * p))
    out[i] = running
  })
  return out
}

// ---------------------------------------------------------------- correlation & regression

export interface Correlation {
  estimate: number
  ci: Interval | null
  statistic: number
  df?: number
  p: number
  method: string
}

export function pearsonR(x: number[], y: number[]): number {
  const mx = meanOf(x)!
  const my = meanOf(y)!
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < x.length; i++) {
    sxy += (x[i] - mx) * (y[i] - my)
    sxx += (x[i] - mx) ** 2
    syy += (y[i] - my) ** 2
  }
  return sxy / Math.sqrt(sxx * syy)
}

function fisherCi(r: number, se: number): Interval {
  const z = Math.atanh(r)
  const c = qnorm(1 - (1 - CONF_LEVEL) / 2)
  return { lower: Math.tanh(z - c * se), upper: Math.tanh(z + c * se), level: CONF_LEVEL }
}

/** Pearson r with t test and Fisher-z CI (as R cor.test). */
export function pearson(x: number[], y: number[]): Correlation | null {
  const n = x.length
  if (n < 3) return null
  const r = pearsonR(x, y)
  if (!Number.isFinite(r)) return null
  const df = n - 2
  const t = (r * Math.sqrt(df)) / Math.sqrt(1 - r * r)
  return { estimate: r, ci: n > 3 ? fisherCi(r, 1 / Math.sqrt(n - 3)) : null, statistic: t, df, p: Math.abs(r) === 1 ? 0 : ptTwoSided(t, df), method: "Pearson's r (t test; Fisher z CI)" }
}

/** Spearman ρ, t-approximation p (as R cor.test(exact = FALSE)); CI via Fisher z with Bonett–Wright SE. */
export function spearman(x: number[], y: number[]): Correlation | null {
  const n = x.length
  if (n < 3) return null
  const rho = pearsonR(ranks(x).r, ranks(y).r)
  if (!Number.isFinite(rho)) return null
  const df = n - 2
  const t = rho / Math.sqrt((1 - rho * rho) / df)
  return {
    estimate: rho,
    ci: n > 3 && Math.abs(rho) < 1 ? fisherCi(rho, Math.sqrt((1 + (rho * rho) / 2) / (n - 3))) : null,
    statistic: t,
    df,
    p: Math.abs(rho) === 1 ? 0 : ptTwoSided(t, df),
    method: "Spearman's ρ (t approximation; Bonett–Wright CI)"
  }
}

/** Kendall τ-b with tie-corrected normal approximation (as R cor.test(method = "kendall", exact = FALSE)). */
export function kendall(x: number[], y: number[]): Correlation | null {
  const n = x.length
  if (n < 3) return null
  let s = 0
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) s += Math.sign(x[i] - x[j]) * Math.sign(y[i] - y[j])
  const tieCounts = (v: number[]) => {
    const m = new Map<number, number>()
    for (const a of v) m.set(a, (m.get(a) ?? 0) + 1)
    return [...m.values()].filter((c) => c > 1)
  }
  const tx = tieCounts(x)
  const ty = tieCounts(y)
  const T0 = (n * (n - 1)) / 2
  const T1 = tx.reduce((a, t) => a + (t * (t - 1)) / 2, 0)
  const T2 = ty.reduce((a, t) => a + (t * (t - 1)) / 2, 0)
  const denom = Math.sqrt((T0 - T1) * (T0 - T2))
  if (denom === 0) return null
  const tau = s / denom
  const v0 = n * (n - 1) * (2 * n + 5)
  const vt = tx.reduce((a, t) => a + t * (t - 1) * (2 * t + 5), 0)
  const vu = ty.reduce((a, t) => a + t * (t - 1) * (2 * t + 5), 0)
  const v1 = tx.reduce((a, t) => a + t * (t - 1), 0) * ty.reduce((a, t) => a + t * (t - 1), 0)
  const v2 = tx.reduce((a, t) => a + t * (t - 1) * (t - 2), 0) * ty.reduce((a, t) => a + t * (t - 1) * (t - 2), 0)
  const varS = (v0 - vt - vu) / 18 + v1 / (2 * n * (n - 1)) + v2 / (9 * n * (n - 1) * (n - 2))
  const z = s / Math.sqrt(varS)
  return { estimate: tau, ci: null, statistic: z, p: Math.min(1, 2 * Math.min(pnorm(z), 1 - pnorm(z))), method: "Kendall's τ-b (normal approximation, tie-corrected)" }
}

export interface Coefficient {
  estimate: number
  se: number
  t: number
  p: number
  ci: Interval
}

export interface LinearFit {
  n: number
  intercept: Coefficient
  slope: Coefficient
  r2: number
  adjR2: number
  sigma: number // residual standard error
  f: number
  df1: number
  df2: number
  p: number
  residualShapiro: ShapiroResult | null
  influential: { index: number; cooksD: number }[] // Cook's D > 4/n
  band: (x: number) => { fit: number; lower: number; upper: number; predLower: number; predUpper: number }
}

/** Ordinary least squares y = a + b·x (as R lm). Band gives 95% confidence and prediction intervals. */
export function linearFit(x: number[], y: number[]): LinearFit | null {
  const n = x.length
  if (n < 3) return null
  const mx = meanOf(x)!
  const my = meanOf(y)!
  let sxx = 0
  let sxy = 0
  let syy = 0
  for (let i = 0; i < n; i++) {
    sxx += (x[i] - mx) ** 2
    sxy += (x[i] - mx) * (y[i] - my)
    syy += (y[i] - my) ** 2
  }
  if (sxx === 0) return null
  const b = sxy / sxx
  const a = my - b * mx
  const resid = x.map((xi, i) => y[i] - (a + b * xi))
  const sse = resid.reduce((s, e) => s + e * e, 0)
  const df = n - 2
  const s2 = sse / df
  const sigma = Math.sqrt(s2)
  const seB = Math.sqrt(s2 / sxx)
  const seA = Math.sqrt(s2 * (1 / n + (mx * mx) / sxx))
  const crit = qt(1 - (1 - CONF_LEVEL) / 2, df)
  const coef = (est: number, se: number): Coefficient => {
    const t = est / se
    return { estimate: est, se, t, p: se === 0 ? 0 : ptTwoSided(t, df), ci: { lower: est - crit * se, upper: est + crit * se, level: CONF_LEVEL } }
  }
  const r2 = syy === 0 ? 1 : 1 - sse / syy
  const f = sse === 0 ? Infinity : (syy - sse) / (sse / df)
  const influential: { index: number; cooksD: number }[] = []
  x.forEach((xi, i) => {
    const h = 1 / n + (xi - mx) ** 2 / sxx
    const d = (resid[i] ** 2 / (2 * s2)) * (h / (1 - h) ** 2)
    if (d > 4 / n) influential.push({ index: i, cooksD: d })
  })
  return {
    n,
    intercept: coef(a, seA),
    slope: coef(b, seB),
    r2,
    adjR2: 1 - (1 - r2) * ((n - 1) / df),
    sigma,
    f,
    df1: 1,
    df2: df,
    p: sse === 0 ? 0 : pfUpper(f, 1, df),
    residualShapiro: n >= 3 ? shapiroWilk(resid) : null,
    influential: influential.sort((p, q) => q.cooksD - p.cooksD),
    band: (xv: number) => {
      const fit = a + b * xv
      const se = sigma * Math.sqrt(1 / n + (xv - mx) ** 2 / sxx)
      const sp = sigma * Math.sqrt(1 + 1 / n + (xv - mx) ** 2 / sxx)
      return { fit, lower: fit - crit * se, upper: fit + crit * se, predLower: fit - crit * sp, predUpper: fit + crit * sp }
    }
  }
}

// ---------------------------------------------------------------- reporting helpers

/** APA-style p: "< .001" or three decimals without a leading zero. */
export function formatP(p: number): string {
  if (!Number.isFinite(p)) return '—'
  if (p < 0.001) return '< .001'
  return `= ${p.toFixed(3).replace(/^0/, '')}`
}

export function fmt(x: number | null | undefined, digits = 2): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—'
  const abs = Math.abs(x)
  if (abs !== 0 && (abs < 0.001 || abs >= 1e5)) return x.toExponential(2)
  return x.toFixed(digits)
}

export function fmtCi(ci: Interval | null | undefined, digits = 2): string {
  return ci ? `[${fmt(ci.lower, digits)}, ${fmt(ci.upper, digits)}]` : '—'
}
