# Shared by the three reference scripts: records which R and package versions produced a reference file, under the
# key "_r". CI (.github/workflows/r-reference.yml) installs these versions from a dated snapshot, regenerates the files
# and fails if they differ from the committed ones (tools/check_reference.mjs).
reference_meta <- function(packages) {
  list(
    r = paste(R.version$major, R.version$minor, sep = "."),
    packages = as.list(setNames(vapply(packages, function(p) as.character(utils::packageVersion(p)), ""), packages))
  )
}
