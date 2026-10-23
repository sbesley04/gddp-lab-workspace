// On-demand statistics checked against R 4.3 reference values (tools/stats_reference.R → stats_reference.json).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { pbinom, pchisqUpper, pfUpper, pnorm, pt, qnorm, qt } from '@core/distributions'
import { brownForsythe, describe as describeX, holm, kendall, kruskalWallis, linearFit, mannWhitney, oneWayAnova, pearson, shapiroWilk, spearman, welchAnova, welchT, hedgesG, formatP } from '@core/analysis'

const R = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'stats_reference.json'), 'utf8'))
const D = R.data
const close = (got: number, want: number, rel = 1e-8) => expect(Math.abs(got - want)).toBeLessThanOrEqual(rel * Math.max(1, Math.abs(want)))

describe('distributions match R', () => {
  it('pt / qt / qnorm / pnorm / pf / pchisq / pbinom', () => {
    for (const c of R.dist.pt) close(pt(c.t, c.df), c.p, 1e-10)
    for (const c of R.dist.qt) close(qt(c.p, c.df), c.q, 1e-9)
    for (const c of R.dist.qnorm) close(qnorm(c.p), c.q, 1e-9)
    for (const c of R.dist.pnorm) expect(Math.abs(pnorm(c.z) - c.p) / c.p).toBeLessThan(1e-9)
    for (const c of R.dist.pf) close(pfUpper(c.f, c.d1, c.d2), c.p, 1e-10)
    for (const c of R.dist.pchisq) close(pchisqUpper(c.x, c.k), c.p, 1e-10)
    for (const c of R.dist.pbinom) close(pbinom(c.k, c.n, 0.5), c.p, 1e-10)
  })
})

describe('descriptives match R', () => {
  it('mean, SD, SE, t CI, quartiles, skewness, kurtosis, median CI', () => {
    const d = describeX(D.a)
    const r = R.describe_a
    close(d.mean!, r.mean)
    close(d.sd!, r.sd)
    close(d.se!, r.se)
    close(d.meanCi!.lower, r.ci[0])
    close(d.meanCi!.upper, r.ci[1])
    close(d.median!, r.median)
    close(d.q1!, r.q1)
    close(d.q3!, r.q3)
    close(d.skewness!, r.skew)
    close(d.kurtosis!, r.kurt)
    close(d.medianCi!.lower, r.medci.lower)
    close(d.medianCi!.upper, r.medci.upper)
    close(d.medianCi!.achievedLevel, r.medci.achieved)
  })
  it('geometric mean and its CI', () => {
    const d = describeX(D.c3)
    close(d.geoMean!, R.geo_c3.gm)
    close(d.geoMeanCi!.lower, R.geo_c3.ci[0])
    close(d.geoMeanCi!.upper, R.geo_c3.ci[1])
  })
  it('Shapiro–Wilk W and p for n = 3 … 200', () => {
    for (const [k, v] of Object.entries<number[]>(D.sw)) {
      const s = shapiroWilk(v)!
      close(s.w, R.shapiro[k].w, 1e-6)
      expect(Math.abs(s.p - R.shapiro[k].p)).toBeLessThan(1e-6)
    }
  })
})

describe('group comparisons match R', () => {
  it("Welch's t", () => {
    const w = welchT(D.a, D.b)!
    close(w.diff, R.welch.diff)
    close(w.t, R.welch.t)
    close(w.df, R.welch.df)
    close(w.p, R.welch.p, 1e-9)
    close(w.ci.lower, R.welch.ci[0])
    close(w.ci.upper, R.welch.ci[1])
  })
  it('Mann–Whitney exact, tied (normal + continuity) and large-sample; Hodges–Lehmann', () => {
    const e = mannWhitney(D.a, D.b)!
    expect(e.method).toBe('exact')
    close(e.w, R.mw_exact.w)
    close(e.p, R.mw_exact.p, 1e-9)
    const t = mannWhitney(D.tie_a, D.tie_b)!
    expect(t.method).not.toBe('exact')
    close(t.w, R.mw_tie.w)
    close(t.p, R.mw_tie.p, 1e-9)
    const b = mannWhitney(D.big_a, D.big_b)!
    close(b.p, R.mw_big.p, 1e-9)
    close(e.hodgesLehmann, R.hl)
  })
  it('Welch ANOVA, classic ANOVA, Kruskal–Wallis (with ties), Brown–Forsythe', () => {
    const g = [D.a, D.b, D.c3]
    const w = welchAnova(g)!
    close(w.f, R.welch3.f)
    close(w.df2, R.welch3.df2)
    close(w.p, R.welch3.p, 1e-9)
    const c = oneWayAnova(g)!
    close(c.f, R.classic3.f)
    close(c.p, R.classic3.p, 1e-9)
    const k = kruskalWallis(g)!
    close(k.h, R.kw3.h)
    close(k.p, R.kw3.p, 1e-9)
    const kt = kruskalWallis([D.tie_a, D.tie_b, [1, 1, 2, 9]])!
    close(kt.h, R.kw_tie.h)
    close(kt.p, R.kw_tie.p, 1e-9)
    const bf = brownForsythe(g)!
    close(bf.f, R.bf.f)
    close(bf.p, R.bf.p, 1e-9)
  })
  it('Holm adjustment', () => {
    holm(R.holm.input).forEach((p, i) => close(p, R.holm.output[i]))
  })
  it("Hedges' g follows the documented formula", () => {
    // Hand-checked case: equal SDs of 1 and a mean difference of 1 → d = 1, J = 1 − 3/(4·20 − 9)
    const a = [0, 1, 2, 0, 1, 2, 0, 1, 2, 1]
    const b = a.map((v) => v - 1)
    const sd = Math.sqrt(a.reduce((s, v) => s + (v - 1) ** 2, 0) / 9)
    const g = hedgesG(a, b)!
    close(g.g, (1 - 3 / 71) * (1 / sd))
  })
})

describe('correlation and regression match R', () => {
  it('Pearson, Spearman (t approx), Kendall τ-b (tie-corrected)', () => {
    const p = pearson(D.x, D.y)!
    close(p.estimate, R.pearson.r)
    close(p.statistic, R.pearson.t)
    close(p.p, R.pearson.p, 1e-9)
    close(p.ci!.lower, R.pearson.ci[0])
    close(p.ci!.upper, R.pearson.ci[1])
    const s = spearman(D.x, D.y)!
    close(s.estimate, R.spearman.rho)
    close(s.p, R.spearman.p, 1e-9)
    const k = kendall(D.xt, D.yt)!
    close(k.estimate, R.kendall.tau)
    close(k.statistic, R.kendall.z)
    close(k.p, R.kendall.p, 1e-9)
  })
  it('linear fit: coefficients, SEs, CIs, R², F, bands, Cook’s distance', () => {
    const f = linearFit(D.x, D.y)!
    const r = R.lm
    close(f.intercept.estimate, r.a)
    close(f.slope.estimate, r.b)
    close(f.intercept.se, r.se_a)
    close(f.slope.se, r.se_b)
    close(f.slope.p, r.p_b, 1e-9)
    close(f.intercept.p, r.p_a, 1e-9)
    close(f.slope.ci.lower, r.ci_b[0])
    close(f.slope.ci.upper, r.ci_b[1])
    close(f.r2, r.r2)
    close(f.adjR2, r.adjr2)
    close(f.sigma, r.sigma)
    close(f.f, r.f)
    ;[1, 5, 9].forEach((xv, i) => {
      const b = f.band(xv)
      // R's predict() matrix is serialised row-wise: [fit, lwr, upr]
      close(b.fit, r.conf[i][0])
      close(b.lower, r.conf[i][1])
      close(b.upper, r.conf[i][2])
      close(b.predLower, r.pred[i][1])
      close(b.predUpper, r.pred[i][2])
    })
    const n = D.x.length
    const expected = r.cooks.map((d: number, i: number) => [i, d]).filter(([, d]: number[]) => d > 4 / n).map(([i]: number[]) => i)
    expect(f.influential.map((x) => x.index).sort()).toEqual(expected.sort())
  })
})

describe('reporting', () => {
  it('formats p-values APA style', () => {
    expect(formatP(0.0004)).toBe('< .001')
    expect(formatP(0.0321)).toBe('= .032')
    expect(formatP(0.5)).toBe('= .500')
  })
})
