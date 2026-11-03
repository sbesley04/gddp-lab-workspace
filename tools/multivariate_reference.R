# Independent reference values for tests/pca.test.ts and tests/matrix.test.ts using base R.
# All data are synthetic literals (no RNG). Run:  Rscript tools/multivariate_reference.R tests/fixtures/multivariate_reference.json
suppressPackageStartupMessages(library(jsonlite))
args <- commandArgs(trailingOnly = TRUE)
out <- if (length(args)) args[1] else "tests/fixtures/multivariate_reference.json"
X <- matrix(c(
  2.1, 30, 5.5, 0.8,
  3.4, 25, 4.9, 1.1,
  1.8, 41, 6.2, 0.5,
  4.4, 22, 4.1, 1.6,
  2.9, 35, 5.0, 0.9,
  3.9, 28, 4.6, 1.4,
  1.2, 47, 6.8, 0.3,
  2.5, 33, 5.7, 0.7,
  3.1, 29, 5.2, 1.0,
  4.8, 20, 3.9, 1.9
), ncol = 4, byrow = TRUE)
p <- prcomp(X, center = TRUE, scale. = TRUE)
rot <- unname(p$rotation); sc <- unname(p$x)
# Fix signs: largest-magnitude loading of each component positive (first on ties), as in src/core/pca.ts
for (j in seq_len(ncol(rot))) {
  i <- which.max(abs(rot[, j]) + 1e-12 * rev(seq_len(nrow(rot))))
  if (rot[i, j] < 0) { rot[, j] <- -rot[, j]; sc[, j] <- -sc[, j] }
}
# Correlations with missing values and ties, pairwise-complete (as src/core/matrix.ts)
M <- X
M[2, 1] <- NA; M[5, 3] <- NA; M[7, 3] <- NA; M[9, 4] <- NA
M[3, 2] <- 30  # tie with row 1
na_to_null <- function(m) lapply(seq_len(nrow(m)), function(i) as.list(ifelse(is.na(m[i, ]), NA, m[i, ])))
cor_p <- cor(M, use = "pairwise.complete.obs", method = "pearson")
cor_s <- cor(M, use = "pairwise.complete.obs", method = "spearman")
npair <- crossprod(!is.na(M))
ref <- list(
  m = na_to_null(M),
  cor_pearson = lapply(seq_len(nrow(cor_p)), function(i) unname(cor_p[i, ])),
  cor_spearman = lapply(seq_len(nrow(cor_s)), function(i) unname(cor_s[i, ])),
  npair = lapply(seq_len(nrow(npair)), function(i) unname(npair[i, ])),
  x = lapply(seq_len(nrow(X)), function(i) X[i, ]),
  sdev = unname(p$sdev),
  variance = unname(p$sdev^2 / sum(p$sdev^2)),
  rotation = lapply(seq_len(nrow(rot)), function(i) rot[i, ]),
  scores = lapply(seq_len(nrow(sc)), function(i) sc[i, ]),
  center = unname(p$center), scale = unname(p$scale)
)
writeLines(toJSON(ref, auto_unbox = TRUE, digits = NA, pretty = TRUE, na = "null"), out)
cat("wrote", out, "\n")
