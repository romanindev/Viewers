# Viewer + Scoring Form — status, verified baseline, and troubleshooting

> **Start here instead:** the clone-to-running-app quick start now lives in the
> [repository root `README.md`](../../README.md). This file is the supplementary
> reference — per-PR status, the verified baseline table, and troubleshooting —
> kept for anyone who wants the detail behind that quick start.

> ## Status: PR 2 – PR 6 merged into `master`; mandatory scope implemented
>
> **What works:** the host app starts on `:5173`, renders the two-column layout with the OHIF viewer in an iframe and the scoring form on the right, and the `VIEWER_READY` handshake is browser-verified. Activating a row arms `EllipticalROI` in the viewer; drawing an ellipse correlates back to the correct row and reports its value and unit; the row can be cancelled while pending; and unit-safe totals (grouped by exact unit string, never mixed) are computed and displayed at the bottom of the form. See the status table below for exactly what is verified and what is an accepted, documented limitation.
>
> An invalid `StudyInstanceUID` never produces `VIEWER_READY` — the host stays "not ready" indefinitely and OHIF shows its own error inside the iframe. This is the **accepted MVP behavior**: no diagnostic timeout, no new failure message, no contract change (see `ARCHITECTURE.md` §10.10).

## Why this file is here

The assignment (`ASSIGNMENT.pdf` p.4 §7.2) requires a `README.md` that takes a reviewer from `git clone` to a working screen, and states that those steps will be **executed literally on a clean machine**. That is 25% of the grade (p.6 §10, "Working scenario").

The repository root `README.md` now carries that quick start directly, ahead of the preserved, untouched upstream OHIF content. This file remains as the per-PR status record, the verified baseline, and troubleshooting reference.

## Status

| Step | Works? | Delivered by |
|---|---|---|
| Prerequisites documented | ✅ yes | — |
| Clone command shows the real public fork URL | ✅ yes | PR 7 |
| Install (`pnpm run install:update-lockfile`) | ✅ yes — verified on this checkout | PR 2 |
| Viewer starts on `:3000` and opens a study | ✅ yes (unmodified upstream OHIF) | baseline |
| Exact `StudyInstanceUID` recorded and verified | ✅ yes — see "Example study" in the root `README.md` | PR 2 |
| Clean-clone setup verification | ✅ Completed before this README reorganization. The installation and startup commands are unchanged and were successfully executed from a fresh clone; see `IMPLEMENTATION_PLAN.md`, PR 7. | PR 7 |
| Host app starts on `:5173` and shows the viewer in an iframe | ✅ yes | PR 2 |
| Host `message` listener installed before iframe `src`, rejects wrong origin/version | ✅ yes | PR 2 |
| Viewer announces `VIEWER_READY` | ✅ yes — browser-verified | PR 3 |
| Activate a row → `EllipticalROI` becomes active, Cancel returns it to `waiting` | ✅ yes — browser-verified | PR 4 |
| Drawn ellipse lands in the correct row with its value and unit | ✅ yes — browser-verified, with an accepted limitation on late `MEASUREMENT_UPDATED` (see Troubleshooting) | PR 5 |
| Unit-safe totals at the bottom of the form (units never mixed) | ✅ yes — 10/10 unit tests passed for computeTotals; manual demo confirmed by the author (see IMPLEMENTATION_PLAN.md, PR 6). | PR 6 |

## Verified baseline

| Item | Value |
|---|---|
| OHIF version | `3.14.0-beta.29` |
| Baseline commit | `1ec01348d` |
| Node | `24.15.0` (see `.node-version`; `engines.node: >=24`) — verified working with `v24.21.0` |
| pnpm | `11.5.2` (see `package.json` `packageManager`) |
| Viewer origin | `http://localhost:3000` |
| Host origin | `http://localhost:5173` — verified, `strictPort: true` |

Prerequisites, install, run, and usage instructions now live in the
[root `README.md`](../../README.md#prerequisites) — not duplicated here to
avoid the two drifting apart.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `pnpm install` fails complaining about the lockfile | Used plain `pnpm install`; use `pnpm run install:update-lockfile` |
| Install rejects a dependency as too new | `minimumReleaseAge: 2880` (48 h); pin an older exact version |
| Host loads but the iframe is blank | Viewer not running on `:3000`, or the `StudyInstanceUIDs` value is wrong |
| Host never leaves "viewer not ready" | Check the `StudyInstanceUIDs` is valid (an invalid one never produces `VIEWER_READY` — accepted MVP behavior, `ARCHITECTURE.md` §10.10, OHIF shows its own error in the iframe); or see `ARCHITECTURE.md` §6, and `IMPLEMENTATION_NOTES.md` §3 |
| `pnpm --filter host-app run dev` fails with `ERR_PACKAGE_PATH_NOT_EXPORTED ... rollup/package.json ... './parseAst'` | The workspace-wide `rollup: 2.80.0` override (synced from upstream, `pnpm-workspace.yaml`) is older than what Vite 5's bundled Rollup needs. Fixed by the scoped `'vite>rollup': 4.24.0` override added alongside it — re-run `pnpm run install:update-lockfile` if you see this. |
| `pnpm run install:update-lockfile` hangs indefinitely with no CPU/network activity | Observed once in this environment as an apparent pnpm store-index deadlock, unrelated to any of our changes. Kill the `pnpm install` process and retry; it completed normally (`Done in ~4-9s`) on the next attempt. |
| A row's value looks stale after drawing | Accepted limitation (PR 5): if OHIF emits an `MEASUREMENT_UPDATED` for the same annotation after the 200 ms settle-and-replace debounce has already closed and its message has already been sent, that later update is not forwarded — the row stays `ready` with the earlier value. See `ARCHITECTURE.md` §10.12. |

## Further reading

| Document | Purpose |
|---|---|
| `ARCHITECTURE.md` (repo root) | Diagram, message table with payloads, Accepted Decisions |
| `docs/scoring-form/IMPLEMENTATION_NOTES.md` | Verified OHIF source findings, evidence, open items |
| `AI-USAGE.md` (repo root) | How AI was used on this task |
| `TASK.md` (repo root) | Requirements extracted from `ASSIGNMENT.pdf` |