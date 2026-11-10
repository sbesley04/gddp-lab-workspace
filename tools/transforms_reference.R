# Independent reference values for the Box-Cox transform in tests/transforms.test.ts.
# All data are synthetic literals (no RNG). Needs jsonlite and car. Run:
#   Rscript tools/transforms_reference.R tests/fixtures/transforms_reference.json
suppressPackageStartupMessages({ library(jsonlite); library(car) })
args <- commandArgs(trailingOnly = TRUE)
out <- if (length(args)) args[1] else "tests/fixtures/transforms_reference.json"

samples <- list(
  right_skew = c(0.8, 1.2, 1.5, 2.1, 2.4, 3.3, 4.8, 6.1, 9.7, 15.2, 22.5),
  near_normal = c(10.2, 11.5, 9.8, 12.1, 10.9, 11.3, 9.5, 10.7),
  ties_wide = c(1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144),
  left_skew = c(50, 62, 70, 74, 77, 79, 80, 81, 82)
)

# Profile log-likelihood of lambda for y ~ 1, up to a constant (as src/core/transforms.ts boxcoxLogLik).
loglik <- function(lambda, y) {
  z <- bcPower(y, lambda)
  n <- length(y)
  -(n / 2) * log(sum((z - mean(z))^2) / n) + (lambda - 1) * sum(log(y))
}

ref <- lapply(samples, function(y) {
  opt <- optimize(loglik, c(-10, 10), y = y, maximum = TRUE, tol = 1e-12)
  pt <- powerTransform(y ~ 1, family = "bcPower")
  list(
    y = y,
    lambda = opt$maximum,
    loglik = opt$objective,
    lambda_car = unname(pt$lambda),
    transformed = bcPower(y, opt$maximum)
  )
})
writeLines(toJSON(ref, auto_unbox = TRUE, digits = NA, pretty = TRUE), out)
cat("wrote", out, "\n")
