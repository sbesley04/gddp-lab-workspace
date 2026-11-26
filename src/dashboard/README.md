# Dashboard (separate app, in progress)

Code for the planned dashboard app. It is kept apart from the workspace app: nothing in `src/renderer` imports it,
and the Compare board is unchanged.

| File | What it is |
| --- | --- |
| `cohortStats.ts` | Pure TS. A cohort stored by visit name (`BoardCohort`), resolved to a `SelectionSpec` for a snapshot, and per-measure counts: n usable, % missing, % censored, flagged and QC-excluded. All row decisions go through `computeSelection`. Tests: `tests/dashboard.test.ts`. |
| `chartViews.tsx` | React chart builders (distribution, scatter, correlation, heatmap, PCA, table) from a chart config and a selection, using the workspace's `chartOptions.ts`. PCA waits for an explicit Compute. Not yet used anywhere. |

It reuses `src/core` and the renderer's chart options, so its numbers and charts match Explore.
