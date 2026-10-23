# Generates independent reference values for tests/inference.test.ts using base R (and car).
# All data are synthetic. Run:  Rscript tools/stats_reference.R tests/fixtures/stats_reference.json
suppressPackageStartupMessages({ library(jsonlite); library(car) })
args <- commandArgs(trailingOnly = TRUE)
out <- if (length(args)) args[1] else "tests/fixtures/stats_reference.json"
set.seed(20261023)
r4 <- function(v) round(v, 4)
a <- r4(rnorm(12, 10, 2)); b <- r4(rnorm(9, 12, 3)); c3 <- r4(rlnorm(7, 2, 0.4))
tie_a <- c(1, 2, 2, 3, 3, 3, 4, 5, 5); tie_b <- c(2, 3, 4, 4, 5, 6, 6, 7)
big_a <- r4(rnorm(55, 0, 1)); big_b <- r4(rnorm(60, 0.4, 1))
x <- r4(runif(20, 0, 10)); y <- r4(2 + 0.6 * x + rnorm(20, 0, 1.5))
xt <- c(1, 2, 2, 3, 4, 4, 4, 5, 6, 7, 8, 8); yt <- c(2, 1, 3, 3, 5, 4, 6, 6, 5, 8, 7, 9)
sw <- list(n3 = r4(rnorm(3)), n4 = r4(rnorm(4)), n5 = r4(rexp(5)), n7 = r4(rnorm(7)), n11 = r4(rexp(11)),
           n12 = r4(rnorm(12)), n20 = r4(rexp(20)), n50 = r4(rnorm(50)), n200 = r4(rgamma(200, 2)))

ttest <- t.test(a, b)
mw_exact <- wilcox.test(a, b, exact = TRUE, correct = TRUE)
mw_tie <- suppressWarnings(wilcox.test(tie_a, tie_b, exact = FALSE, correct = TRUE))
mw_big <- wilcox.test(big_a, big_b, exact = FALSE, correct = TRUE)
grp <- factor(rep(c("a", "b", "c"), c(length(a), length(b), length(c3))))
vals <- c(a, b, c3)
welch3 <- oneway.test(vals ~ grp, var.equal = FALSE)
classic3 <- oneway.test(vals ~ grp, var.equal = TRUE)
kw3 <- kruskal.test(list(a, b, c3))
kw_tie <- kruskal.test(list(tie_a, tie_b, c(1, 1, 2, 9)))
bf <- leveneTest(vals ~ grp, center = median)
pear <- cor.test(x, y, method = "pearson")
spear <- suppressWarnings(cor.test(x, y, method = "spearman", exact = FALSE))
kend <- suppressWarnings(cor.test(xt, yt, method = "kendall", exact = FALSE))
fit <- lm(y ~ x); sf <- summary(fit); ci <- confint(fit)
pr_c <- predict(fit, newdata = data.frame(x = c(1, 5, 9)), interval = "confidence")
pr_p <- predict(fit, newdata = data.frame(x = c(1, 5, 9)), interval = "prediction")
holm_in <- c(0.01, 0.04, 0.03, 0.2)
med_ci <- function(v) { v <- sort(v); n <- length(v); l <- qbinom(0.025, n, 0.5); list(lower = v[l], upper = v[n - l + 1], achieved = 1 - 2 * pbinom(l - 1, n, 0.5)) }
skew <- function(v) { n <- length(v); m <- mean(v); m2 <- mean((v - m)^2); m3 <- mean((v - m)^3); sqrt(n * (n - 1)) / (n - 2) * m3 / m2^1.5 }
kurt <- function(v) { n <- length(v); m <- mean(v); m2 <- mean((v - m)^2); m4 <- mean((v - m)^4); g2 <- m4 / m2^2 - 3; ((n + 1) * g2 + 6) * (n - 1) / ((n - 2) * (n - 3)) }
tt1 <- t.test(a)
lg <- log(c3); tg <- t.test(lg)

ref <- list(
  data = list(a = a, b = b, c3 = c3, tie_a = tie_a, tie_b = tie_b, big_a = big_a, big_b = big_b, x = x, y = y, xt = xt, yt = yt, sw = sw),
  dist = list(
    pt = list(list(t = 2.1, df = 7, p = pt(2.1, 7)), list(t = -0.5, df = 3.3, p = pt(-0.5, 3.3)), list(t = 8, df = 40, p = pt(8, 40))),
    qt = list(list(p = 0.975, df = 1, q = qt(0.975, 1)), list(p = 0.975, df = 9.37, q = qt(0.975, 9.37)), list(p = 0.995, df = 120, q = qt(0.995, 120))),
    qnorm = list(list(p = 0.975, q = qnorm(0.975)), list(p = 1e-8, q = qnorm(1e-8)), list(p = 0.3, q = qnorm(0.3))),
    pnorm = list(list(z = -7.5, p = pnorm(-7.5)), list(z = 1.23, p = pnorm(1.23))),
    pf = list(list(f = 3.2, d1 = 2, d2 = 17.4, p = pf(3.2, 2, 17.4, lower.tail = FALSE)), list(f = 0.4, d1 = 5, d2 = 30, p = pf(0.4, 5, 30, lower.tail = FALSE))),
    pchisq = list(list(x = 5.99, k = 2, p = pchisq(5.99, 2, lower.tail = FALSE)), list(x = 30, k = 7, p = pchisq(30, 7, lower.tail = FALSE))),
    pbinom = list(list(k = 5, n = 20, p = pbinom(5, 20, 0.5)), list(k = 1, n = 6, p = pbinom(1, 6, 0.5)))
  ),
  describe_a = list(mean = mean(a), sd = sd(a), se = sd(a) / sqrt(length(a)), ci = unname(tt1$conf.int), median = median(a),
                    q1 = unname(quantile(a, 0.25, type = 7)), q3 = unname(quantile(a, 0.75, type = 7)), skew = skew(a), kurt = kurt(a), medci = med_ci(a)),
  geo_c3 = list(gm = exp(mean(lg)), ci = exp(unname(tg$conf.int))),
  shapiro = lapply(sw, function(v) { s <- shapiro.test(v); list(w = unname(s$statistic), p = s$p.value) }),
  welch = list(diff = unname(ttest$estimate[1] - ttest$estimate[2]), t = unname(ttest$statistic), df = unname(ttest$parameter), p = ttest$p.value, ci = unname(ttest$conf.int)),
  mw_exact = list(w = unname(mw_exact$statistic), p = mw_exact$p.value),
  mw_tie = list(w = unname(mw_tie$statistic), p = mw_tie$p.value),
  mw_big = list(w = unname(mw_big$statistic), p = mw_big$p.value),
  hl = median(outer(a, b, "-")),
  welch3 = list(f = unname(welch3$statistic), df1 = unname(welch3$parameter[1]), df2 = unname(welch3$parameter[2]), p = welch3$p.value),
  classic3 = list(f = unname(classic3$statistic), df1 = unname(classic3$parameter[1]), df2 = unname(classic3$parameter[2]), p = classic3$p.value),
  kw3 = list(h = unname(kw3$statistic), df = unname(kw3$parameter), p = kw3$p.value),
  kw_tie = list(h = unname(kw_tie$statistic), p = kw_tie$p.value),
  bf = list(f = bf$`F value`[1], p = bf$`Pr(>F)`[1]),
  pearson = list(r = unname(pear$estimate), t = unname(pear$statistic), p = pear$p.value, ci = unname(pear$conf.int)),
  spearman = list(rho = unname(spear$estimate), p = spear$p.value),
  kendall = list(tau = unname(kend$estimate), z = unname(kend$statistic), p = kend$p.value),
  lm = list(a = coef(fit)[[1]], b = coef(fit)[[2]], se_a = sf$coefficients[1, 2], se_b = sf$coefficients[2, 2], p_b = sf$coefficients[2, 4], p_a = sf$coefficients[1, 4],
            ci_a = unname(ci[1, ]), ci_b = unname(ci[2, ]), r2 = sf$r.squared, adjr2 = sf$adj.r.squared, sigma = sf$sigma, f = unname(sf$fstatistic[1]),
            conf = unname(pr_c), pred = unname(pr_p), cooks = unname(cooks.distance(fit))),
  holm = list(input = holm_in, output = p.adjust(holm_in, "holm"))
)
writeLines(toJSON(ref, auto_unbox = TRUE, digits = NA, pretty = TRUE), out)
cat("wrote", out, "\n")
