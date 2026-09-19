# Viewer + Scoring Form — setup guide

> ## Status: PR 2 – PR 6 merged into `master`; mandatory scope implemented
>
> **What works:** the host app starts on `:5173`, renders the two-column layout with the OHIF viewer in an iframe and the scoring form on the right, and the `VIEWER_READY` handshake is browser-verified. Activating a row arms `EllipticalROI` in the viewer; drawing an ellipse correlates back to the correct row and reports its value and unit; the row can be cancelled while pending; and unit-safe totals (grouped by exact unit string, never mixed) are computed and displayed at the bottom of the form. See the status table below for exactly what is verified and what is an accepted, documented limitation.
>
> An invalid `StudyInstanceUID` never produces `VIEWER_READY` — the host stays "not ready" indefinitely and OHIF shows its own error inside the iframe. This is the **accepted MVP behavior**: no diagnostic timeout, no new failure message, no contract change (see `ARCHITECTURE.md` §10.10).

## Why this file is here

The assignment (`ASSIGNMENT.pdf` p.4 §7.2) requires a `README.md` that takes a reviewer from `git clone` to a working screen, and states that those steps will be **executed literally on a clean machine**. That is 25% of the grade (p.6 §10, "Working scenario").

The repository root `README.md` is the **upstream OHIF readme**; PR 7 adds a short pointer near its top to this file, but otherwise leaves it untouched so the fork stays close to upstream and the diff stays reviewable.

## Status

| Step | Works? | Delivered by |
|---|---|---|
| Prerequisites documented | ✅ yes | — |
| Clone command shows the real public fork URL | ✅ yes | PR 7 |
| Install (`pnpm run install:update-lockfile`) | ✅ yes — verified on this checkout | PR 2 |
| Viewer starts on `:3000` and opens a study | ✅ yes (unmodified upstream OHIF) | baseline |
| Exact `StudyInstanceUID` recorded and verified | ✅ yes — see "Known-good study" below | PR 2 |
| Clean-machine run of this guide, verbatim | ⬜ **pending** — not yet re-verified from a clean clone since PR 7's edits | PR 7 |
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

## Prerequisites

- Node `24.15.0` — the repository declares `engines.node: >=24` and pins `.node-version`.
- pnpm `11.5.2` — declared as `packageManager`. Use Corepack or install it directly; note `.npmrc` sets `manage-package-manager-versions=false`, so pnpm is **not** auto-provisioned for you.
- A modern Chromium-based browser (WebGL2 required by Cornerstone).
- No PACS, backend, database or authentication is needed — the viewer uses the public DICOMweb source that ships with OHIF by default.

## Install

```bash
git clone https://github.com/romanindev/Viewers.git
cd Viewers
pnpm run install:update-lockfile
```

**Use that script, not a plain `pnpm install`.** `pnpm-workspace.yaml:17` sets `frozenLockfile: true`, so a plain install fails as soon as the workspace contains our added `apps/*` and `packages/*` packages. The script maps to `pnpm install --no-frozen-lockfile` (`package.json:32`).

Two further install-time constraints worth knowing if something fails — both documented in `IMPLEMENTATION_NOTES.md` §1.2:

- `minimumReleaseAge: 2880` rejects any package published in the last 48 hours;
- `allowBuilds` denies postinstall scripts unless allowlisted.

## Run both applications

Two terminals. The two applications **must** be on different origins — that is deliberate in the assignment (p.2 §4.2), and the bridge's origin validation depends on it.

### Terminal 1 — viewer (OHIF), port 3000

```bash
OHIF_OPEN=false pnpm run dev
```

`OHIF_OPEN=false` suppresses the automatic browser tab, which is noise when the viewer is meant to be consumed inside the host's iframe. The port is `3000` by default and can be overridden with `OHIF_PORT`.

### Terminal 2 — host app, port 5173

```bash
pnpm --filter host-app run dev
```

Then open **`http://localhost:5173`**. The host renders a two-column layout —
a full-height iframe with the OHIF viewer on the left, the scoring form on
the right — and installs its `message` listener before the iframe `src` is
assigned. Once the viewer's bridge extension sends `VIEWER_READY`, the
form becomes usable:

1. Click **Add Measurement** to create a row, then click **Activate** on that row to arm `EllipticalROI` in the viewer.
2. Draw an ellipse on the loaded image — the row moves through
   `drawing → processing → ready` and shows the measured value with its
   unit (e.g. `mm²`).
3. Repeat for further rows. The **Total** panel at the bottom sums ready
   rows grouped by their exact unit string — units are never mixed
   together in one sum.
4. To cancel an active or queued drawing intent, click **Cancel** while the row is in the `drawing` state. The row returns to `waiting` without affecting other rows or their totals.

## Known-good study

The viewer opens a specific study directly, which is the form the iframe URL takes:

```
http://localhost:3000/viewer?StudyInstanceUIDs=<StudyInstanceUID>
```

The host app's default (`apps/host-app/src/config.ts`, overridable via
`VITE_VIEWER_STUDY_URL`) is:

```
http://localhost:3000/viewer?StudyInstanceUIDs=1.3.6.1.4.1.25403.345050719074.3824.20170125095438.5
```

Verified against the default public AWS S3 DICOMweb source
(`platform/app/public/config/dev.js`) — the same study used by upstream
OHIF's own "Measurement Tracking" demo link (root `README.md`). It loads an
MR series with pixel spacing, so `EllipticalROI` yields an area in `mm²`.

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