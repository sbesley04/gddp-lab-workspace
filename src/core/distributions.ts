// Probability distributions for on-demand inference. Pure functions, validated against R in
// tests/inference.test.ts (reference values produced by tools/stats_reference.R).

const EPS = 1e-15
const FPMIN = 1e-300

/** log Γ(x) via the Lanczos approximation (g = 7, n = 9); relative error < 1e-14 for x > 0. */
export function logGamma(x: number): number {
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7]
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - logGamma(1 - x)
  x -= 1
  let a = c[0]
  const t = x + 7.5
  for (let i = 1; i < 9; i++) a += c[i] / (x + i)
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a)
}

function betacf(a: number, b: number, x: number): number {
  const qab = a + b
  const qap = a + 1
  const qam = a - 1
  let c = 1
  let d = 1 - (qab * x) / qap
  if (Math.abs(d) < FPMIN) d = FPMIN
  d = 1 / d
  let h = d
  for (let m = 1; m <= 10000; m++) {
    const m2 = 2 * m
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2))
    d = 1 + aa * d
    if (Math.abs(d) < FPMIN) d = FPMIN
    c = 1 + aa / c
    if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    h *= d * c
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2))
    d = 1 + aa * d
    if (Math.abs(d) < FPMIN) d = FPMIN
    c = 1 + aa / c
    if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < EPS) break
  }
  return h
}

/** Regularised incomplete beta I_x(a, b). */
export function incBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const lbt = logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x)
  const bt = Math.exp(lbt)
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(a, b, x)) / a
  return 1 - (bt * betacf(b, a, 1 - x)) / b
}

/** Regularised lower incomplete gamma P(a, x). */
export function incGammaLower(a: number, x: number): number {
  if (x <= 0) return 0
  const gln = logGamma(a)
  if (x < a + 1) {
    let ap = a
    let sum = 1 / a
    let del = sum
    for (let n = 1; n <= 10000; n++) {
      ap += 1
      del *= x / ap
      sum += del
      if (Math.abs(del) < Math.abs(sum) * EPS) break
    }
    return sum * Math.exp(-x + a * Math.log(x) - gln)
  }
  // continued fraction for Q, then P = 1 - Q
  let b = x + 1 - a
  let c = 1 / FPMIN
  let d = 1 / b
  let h = d
  for (let i = 1; i <= 10000; i++) {
    const an = -i * (i - a)
    b += 2
    d = an * d + b
    if (Math.abs(d) < FPMIN) d = FPMIN
    c = b + an / c
    if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < EPS) break
  }
  return 1 - Math.exp(-x + a * Math.log(x) - gln) * h
}

/** Upper-tail regularised gamma Q(a, x), computed directly for accuracy in the far tail. */
function incGammaUpper(a: number, x: number): number {
  if (x < a + 1) return 1 - incGammaLower(a, x)
  const gln = logGamma(a)
  let b = x + 1 - a
  let c = 1 / FPMIN
  let d = 1 / b
  let h = d
  for (let i = 1; i <= 10000; i++) {
    const an = -i * (i - a)
    b += 2
    d = an * d + b
    if (Math.abs(d) < FPMIN) d = FPMIN
    c = b + an / c
    if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < EPS) break
  }
  return Math.exp(-x + a * Math.log(x) - gln) * h
}

/** Standard normal CDF Φ(z), accurate in both tails. */
export function pnorm(z: number): number {
  if (!Number.isFinite(z)) return z > 0 ? 1 : 0
  const q = 0.5 * incGammaUpper(0.5, (z * z) / 2) // = P(Z > |z|)
  return z >= 0 ? 1 - q : q
}

/** Upper tail 1 − Φ(z) without cancellation. */
export function pnormUpper(z: number): number {
  return pnorm(-z)
}

/** Standard normal quantile (Acklam's rational approximation refined by one Halley step). */
export function qnorm(p: number): number {
  if (p <= 0) return -Infinity
  if (p >= 1) return Infinity
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239]
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1]
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416]
  const pl = 0.02425
  let x: number
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p))
    x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  } else if (p <= 1 - pl) {
    const q = p - 0.5
    const r = q * q
    x = ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p))
    x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  }
  for (let i = 0; i < 2; i++) {
    const e = pnorm(x) - p
    const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2)
    x = x - u / (1 + (x * u) / 2)
  }
  return x
}

/** Student t CDF. */
export function pt(t: number, df: number): number {
  if (!Number.isFinite(t)) return t > 0 ? 1 : 0
  const x = df / (df + t * t)
  const tail = 0.5 * incBeta(x, df / 2, 0.5)
  return t >= 0 ? 1 - tail : tail
}

/** Two-sided p-value for a t statistic. */
export function ptTwoSided(t: number, df: number): number {
  return Math.min(1, incBeta(df / (df + t * t), df / 2, 0.5))
}

function invert(cdf: (x: number) => number, p: number, lo: number, hi: number): number {
  while (cdf(lo) > p) lo *= 2
  while (cdf(hi) < p) hi *= 2
  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2
    if (cdf(mid) < p) lo = mid
    else hi = mid
    if (hi - lo <= 1e-14 * Math.max(1, Math.abs(mid))) break
  }
  return (lo + hi) / 2
}

/** Student t quantile. */
export function qt(p: number, df: number): number {
  if (p === 0.5) return 0
  if (p < 0.5) return -qt(1 - p, df)
  return invert((x) => pt(x, df), p, 0, Math.max(10, Math.abs(qnorm(p)) * 4))
}

/** F distribution upper tail P(F > f). */
export function pfUpper(f: number, d1: number, d2: number): number {
  if (f <= 0) return 1
  return incBeta(d2 / (d2 + d1 * f), d2 / 2, d1 / 2)
}

/** Chi-square upper tail P(X > x). */
export function pchisqUpper(x: number, k: number): number {
  if (x <= 0) return 1
  return incGammaUpper(k / 2, x / 2)
}

/** Binomial CDF P(X ≤ k). */
export function pbinom(k: number, n: number, p: number): number {
  if (k < 0) return 0
  if (k >= n) return 1
  return 1 - incBeta(p, k + 1, n - k)
}
