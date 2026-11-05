// Text the model reads before using the tools: server instructions (short, always loaded by clients that
// support them), the interpretation guide resource and the exploratory-analysis prompt.
import type { PrivacyPolicy } from './workspace'

export function serverInstructions(policy: PrivacyPolicy): string {
  return `BARI-CNS Research Workspace (read-only). Explores one study project: participants observed at visits, with
biomarker, neuropsychological, CSF and clinical measures imported from a curated workbook.

Start with get_study_overview, then search_variables to find variable keys. Read the bari://guide resource before
interpreting results. Results are aggregate only (privacy mode "${policy.mode}"): participant identifiers and individual
values are never returned, and groups with fewer than ${policy.minCellSize} participants are suppressed.

Key rules:
- Missing is never zero. Censored values such as "<0.5" are below a detection limit; they are reported as counts and
  never replaced by a number. Text codes such as "QNS" mean the value was not measured.
- Each row is one participant at one visit. Pick a single visit for group comparisons and correlations, or use
  change_between_visits for within-participant change.
- QC flags come from cell colours in the workbook. By default only curator exclusions are excluded; flagged values
  are otherwise included. Use qcExclude to test sensitivity, and report which policy you used.
- Metadata (unit, specimen, definition) can be "unknown" or "tentative": never assume a unit.
- All statistics are exploratory. Make no causal or treatment-efficacy claims, and say how many tests you ran.
- Quote the dataset version, metadata version, visits, filters and QC policy (each result's "selection") so the
  analysis can be reproduced in the app.`
}

export function guideMarkdown(policy: PrivacyPolicy): string {
  return `# How to read BARI-CNS data

## Structure
- A project holds one or more **dataset versions**, each an immutable import of a workbook sheet. Use the latest
  unless asked otherwise.
- Each **row** is one participant at one **visit** (the "Event Name" column), e.g. Baseline, Month 2, Month 6.
  Visits are ordered numerically. Actual visit dates are not recorded; never infer elapsed time from visit names
  beyond what they say.
- Each **variable** has a stable key, the source header, aliases, and metadata (label, variable group, unit,
  specimen, assay, score type, definition, source). Every metadata field has a status:
  - **confirmed**: set by a curator.
  - **tentative**: derived from the header or legend; plausible but unverified.
  - **unknown**: not documented. Do not guess a unit or definition; say it is unknown.
- **Variable groups** come from thick column borders in the workbook, named from the workbook's legend. When the
  number of border groups does not match the legend, the names are tentative.

## Values
- **number**: analysed.
- **censored** ("<0.5", ">100"): outside an assay's range. Counted, never replaced by the bound and left out of
  numeric statistics. Many censored values can bias means upward; mention it.
- **text** ("QNS", "N/A"): not a measurement. Counted and left out.
- **missing**: blank. Never zero.

## QC flags (from cell fill colours)
| Category | Meaning |
|---|---|
| sample_warning | NULISA sample QC warning (legend colour, exact match) |
| target_warning | NULISA target QC warning |
| both_warnings | Sample and target warnings |
| possible_sample_warning / possible_target_warning | Colour resembles a QC colour; needs curator review |
| unresolved_highlight | Undocumented highlight; meaning unknown |
| curator_exclusion | A curator deliberately excluded the value |

The default policy excludes only **curator_exclusion**. Flagged values are otherwise included and counted. A good
sensitivity check is to rerun with \`qcExclude: ["sample_warning", "target_warning", "both_warnings"]\`.

## Source attribution
Font colours in the workbook say which source spreadsheet a column (or cell) came from. Default black text cannot be
told apart from the legend's "black" source, so that attribution is tentative. Bold multi-colour headers mean the
same variable appears in several sources; those names become aliases.

## Choosing an analysis
- **One visit, two or more groups:** \`compare_groups\` (Welch t, Hedges' g and Mann–Whitney for two groups; Welch
  ANOVA, Kruskal–Wallis and Holm-adjusted pairwise tests for more).
- **Two measures:** \`correlate\` (Spearman by default; Pearson and a linear fit are also given).
- **Change over time:** \`change_between_visits\` (paired by participant, descriptive with CIs).
- **Many measures:** \`correlation_matrix\` or \`principal_components\`. These are complete-case or pairwise
  analyses; check how many rows survive.
- Skewed biomarkers (NULISA, cytokines) are often analysed on a log scale: use \`transform: "log2"\` or "log10".
  Zeros and negative values cannot be logged and are reported.
- Grouping covariates (sex, race) may only be recorded at one visit. Use \`groupFrom: "participant"\` to carry a
  participant's value across visits.

## Reporting
- Every statistical result is **exploratory**. Small samples are common; report n, effect sizes and confidence
  intervals, not just p-values. Adjust for, or at least state, the number of tests run.
- Never claim causality or treatment efficacy. A change over time without a control group is not a treatment effect.
- Quote each result's \`selection\` block (dataset version, metadata version, visits, filter and QC policy) so the
  analysis can be reproduced in the app.

## Privacy
Mode: **${policy.mode}**. Participant identifiers, row numbers and individual values are never returned. Groups and
selections with fewer than ${policy.minCellSize} participants are suppressed ("<${policy.minCellSize}"). Extremes
(min/max) are withheld for variables a curator marked as quasi-identifiers. Comment text is returned only for column
headers; cell comments are only counted. Do not try to work around suppression, for example by combining overlapping
filters.
`
}

export function analysisPrompt(question: string): string {
  return `You are helping a researcher explore the BARI-CNS study with the bari-cns tools. Question: ${question}

Work like this:
1. Call get_study_overview and read the bari://guide resource.
2. Use search_variables and describe_variable to find the relevant measures. Check units, metadata status, missing
   and censored counts, and QC flags before analysing.
3. Choose a single visit (or use change_between_visits) and state the selection explicitly.
4. Run the smallest number of tests that answers the question. Prefer effect sizes and confidence intervals.
5. Run one QC sensitivity check (exclude NULISA QC warnings) when biomarkers are involved.
6. Report: what you ran, n per group, effect sizes with CIs, p-values labelled exploratory, the number of tests,
   caveats (censoring, missing data, unknown units, small n), and the selection block for each result.
Never claim causality or treatment efficacy.`
}
