# IMPLEMENTATION_PLAN.md

> Evidence labels used throughout: **[VERIFIED]** = read from the checked-out source at `1ec01348d` (path given); **[PROPOSED]** = our design decision; **[UNVERIFIED]** = assumption that must be confirmed before code depends on it. Open items are tracked in `docs/scoring-form/IMPLEMENTATION_NOTES.md` §10, and summarised in `ARCHITECTURE.md` §11.
>
> Our working instructions are in `TASK_INSTRUCTIONS.md`, not `CLAUDE.md` (that is a generated symlink to upstream OHIF's `AGENTS.md`).

## Working rule

Implement and merge the task in small feature PRs. The test explicitly values PR history as evidence of reasoning.

Do not build the entire solution in one branch and retroactively split commits.

Each PR should:

- leave the repository understandable;
- have a focused purpose;
- include a meaningful description;
- state what was verified;
- update architecture docs if a decision changed.

## Phase 0 — Baseline verification — ✅ COMPLETE

Goal was to remove environment/OHIF uncertainty before writing feature code. Done, plus a read-only repository/architecture audit.

Recorded baseline — all **[VERIFIED]**:

| Item | Value | Source |
|---|---|---|
| OHIF version | `3.14.0-beta.29` | `package.json` `version` |
| Baseline commit | `1ec01348d` | `git log` |
| Node | `24.15.0` | `.node-version`; `engines.node: >=24` |
| pnpm | `11.5.2` | `package.json` `packageManager` |
| Viewer dev port | `3000` (override: `OHIF_PORT`) | `platform/app/.webpack/webpack.pwa.js:26` |
| Viewer dev command | `pnpm run dev` | `package.json` `scripts.dev` |
| Direct study route | `/viewer?StudyInstanceUIDs=...` works | verified manually |
| Default data source | public AWS S3 static WADO (`defaultDataSourceName: 'ohif'`) | `platform/app/public/config/dev.js:111-125` |
| `EllipticalROI` | in the `default` tool group, area in `mm²` | `modes/basic/src/initToolGroups.ts:65` |

Audit corrections that change this plan:

1. **Install command.** `pnpm-workspace.yaml:17` sets `frozenLockfile: true`, so a plain `pnpm install` **fails** once workspace globs or dependencies change. Use the repository's own script and commit the lockfile:

   ```bash
   pnpm run install:update-lockfile    # package.json:32 -> pnpm install --no-frozen-lockfile
   ```

2. **Dependency pinning.** `minimumReleaseAge: 2880` (48 h) rejects freshly published versions. Pin exact versions at least 48 h old.
3. **Default primary tool is `WindowLevel`, not `Pan`** — `modes/basic/src/initToolGroups.ts:20-37`. See `ARCHITECTURE.md` §6 and §10.7.
4. **Repository-wide typecheck is impossible** (6,981 pre-existing errors, `TS5053` on `--noEmit`, no `typecheck` script). Scoped checks only — see `docs/scoring-form/IMPLEMENTATION_NOTES.md` §9.1.
5. **`setToolActive` fails silently** — `extensions/cornerstone/src/commandsModule.ts:1214-1228`. Activation must be read back. See `ARCHITECTURE.md` §6 and `docs/scoring-form/IMPLEMENTATION_NOTES.md` §3.2.
6. **`cachedStats` timing is an open risk** blocking PR 5 — `docs/scoring-form/IMPLEMENTATION_NOTES.md` §5.3 and §10 item 1.

Baseline is fixed. Do not re-select or move it.

## PR 1 — `docs: establish assignment requirements and implementation plan` — ✅ COMPLETE

Merged as GitHub PR #1, commit `44a2a904a`. Produced `TASK.md`, `TASK_INSTRUCTIONS.md`, `ARCHITECTURE.md` and this implementation plan from a read-only audit of the baseline OHIF checkout. No application code, no workspace changes. See those documents directly for content; not duplicated here.

## PR 2 — `feat: bootstrap host app and shared message contract` — ✅ COMPLETE

Merged as GitHub PR #2, commit `b2c5f4a4d`. Internally referred to below by its original working title, `chore: bootstrap host app and task workspace` — the scope described matches what was actually merged.

### Goal

Create the host shell, the shared protocol package, and the workspace wiring — with **zero OHIF behavior change**.

### Explicitly OUT of scope for PR 2

This PR contains **no OHIF extension and no working handshake**. Specifically excluded:

- `extensions/scoring-form-bridge` (any file);
- any edit to `platform/app/pluginConfig.json`;
- any edit to OHIF source under `platform/`, `extensions/`, `modes/`;
- a viewer that emits `VIEWER_READY` — nothing sends it yet, so the host will never become ready in this PR, and that is the expected state;
- `ACTIVATE_TOOL` / `DEACTIVATE_TOOL` / `MEASUREMENT_ADDED` handling;
- the row reducer, row UI, Add Measurement / Activate buttons;
- the OHIF measurement adapter;
- total calculation;
- the pre-ready command queue (the contract may *define* the message types; nothing sends or queues them yet).

The host-side `message` listener **is** in scope, but only as a validating listener that logs and discards. It is installed so the topology and origin checks are real and testable — not to complete a handshake.

### Files added

```text
apps/host-app/package.json                  react+react-dom pinned 18.3.1; own typescript + vite
apps/host-app/tsconfig.json                 standalone, strict: true, noEmit: true
apps/host-app/vite.config.ts                server.port 5173, strictPort: true
apps/host-app/index.html
apps/host-app/src/main.tsx
apps/host-app/src/App.tsx                   two-column: flexible full-height iframe | scoring panel placeholder
apps/host-app/src/config.ts                 VIEWER_ORIGIN, VIEWER_STUDY_URL, HOST_ORIGIN
apps/host-app/src/bridge/useViewerBridge.ts listener installed BEFORE iframe src is set;
                                            validates origin + event.source + protocol + version; logs and discards
apps/host-app/.env.example
packages/message-contract/package.json      no runtime deps, no .babelrc
packages/message-contract/tsconfig.json     strict: true, noEmit: true
packages/message-contract/src/index.ts      PROTOCOL_NAME, PROTOCOL_VERSION = 1, message-type constants,
                                            BridgeEnvelope<TType, TPayload>, discriminated unions,
                                            runtime guards, BridgeMeasurementValue
```

### Files modified

```text
pnpm-workspace.yaml    + apps/*, + packages/*   (only these two lines)
pnpm-lock.yaml          via `pnpm run install:update-lockfile`
tsconfig.json           + paths/include entry for packages/message-contract
docs/scoring-form/README.md
                       fill in the host-app start command and the known-good StudyInstanceUID;
                       flip the affected rows of its status table
ARCHITECTURE.md        message table rows for every type defined in this PR;
                       Accepted Decisions entries for what was actually decided here
```

The repository root `README.md` is **upstream OHIF's and stays untouched in this PR**. The task setup guide lives at `docs/scoring-form/README.md`. Adding a discoverable pointer from the root README is a submission requirement tracked in PR 7.

**[VERIFIED]** no `pluginConfig.json` change is needed for the host app or contract package — `platform/app/.webpack/writePluginImportsFile.js:126-225` ignores any workspace package not declared there, so adding workspace globs cannot alter the viewer build.

### Important implementation details

- Install the host `message` listener **before** the real iframe URL is assigned, so an early `VIEWER_READY` could not be missed later. Do not rely on timing luck.
- Origin validation is real from day one: exact `event.origin === VIEWER_ORIGIN` **and** `event.source === iframe.contentWindow`. Never `'*'` as `targetOrigin`.
- Pin `react`/`react-dom` to `18.3.1`: **[VERIFIED]** `nodeLinker: hoisted` with a single hoisted `react@18.3.1` at the repo root.
- `strictPort: true` on Vite so a port clash fails loudly rather than silently moving the host origin and breaking origin validation.
- **[UNVERIFIED]** `esbuild` may need `allowBuilds: { esbuild: true }` in `pnpm-workspace.yaml`. Only add it if the install/dev-server actually fails, and comment why. (`docs/scoring-form/IMPLEMENTATION_NOTES.md` §10 item 6.)

### Acceptance criteria

Functional:

1. `pnpm run install:update-lockfile` completes; `pnpm-lock.yaml` is updated and committed; any ignored build scripts are noted in the PR body.
2. `pnpm run dev` still serves the viewer on `:3000`, and `/viewer?StudyInstanceUIDs=<uid>` still loads the study — proving the workspace change broke nothing.
3. The host dev server serves on `:5173`.
4. The host page renders two columns: a flexible full-height iframe on the left showing the OHIF study route, and a scoring-panel placeholder on the right.
5. Devtools confirms two distinct origins (`localhost:5173` parent, `localhost:3000` child).
6. The host `message` listener is installed before the iframe `src` is set — demonstrated by an ordering assertion or a log line, not asserted by prose.
7. A hand-crafted `postMessage` from the wrong origin, or with a wrong `protocol`/`version`, is rejected by the host guard (shown via a log line).
8. Host state remains "viewer not ready" for the whole session. Expected: nothing emits `VIEWER_READY` yet.

Quality:

9. `apps/host-app` typechecks with **zero** errors via its own `tsconfig.json`.
10. `packages/message-contract` typechecks with **zero** errors via its own `tsconfig.json`.
11. `pnpm run build` (viewer production build) still succeeds.
12. No file under `platform/`, `extensions/`, `modes/`, `AGENTS.md` or `CLAUDE.md` is modified. `git diff --stat` in the PR body proves it.
13. No repository-wide `tsc` is claimed or attempted — see `docs/scoring-form/IMPLEMENTATION_NOTES.md` §9.1.

Documentation:

14. `docs/scoring-form/README.md` records the verified baseline and the exact install/start commands, is accurate when read **literally**, and its status table truthfully reflects what does and does not work after this PR.
15. `ARCHITECTURE.md` carries the message-table rows for every type defined here plus the Accepted Decisions actually taken, and still contains the diagram / consolidated payload table / "Accepted Decisions" section required by the assignment (p.4 §7.2).
16. No documentation added or changed in this PR claims that unimplemented behaviour already works.

### Suggested PR body

```md
## What
Bootstraps the Vite/React host app, the shared bridge contract package, and the
workspace/tsconfig wiring. Adds the host-side message listener with the
assignment-required event.origin check plus our additional event.source check.

## Why
Establishes the two-origin topology and a single source of truth for message
types (assignment §5.7) before any OHIF behaviour is touched. Keeping the OHIF
side untouched makes this PR trivially reviewable and proves the workspace
change is inert.

## Not in this PR
No OHIF extension, no pluginConfig change, no VIEWER_READY. The host will
correctly stay in the "viewer not ready" state — the handshake lands in PR 3.
The setup guide's status table says so explicitly; nothing claims to work yet.

## Verified
- pnpm run install:update-lockfile (frozenLockfile:true means plain install fails)
- viewer dev server on :3000, study route still loads
- host dev server on :5173, iframe renders the study, two distinct origins
- listener installed before iframe src; wrong-origin/wrong-version messages rejected
- scoped typecheck: apps/host-app and packages/message-contract, zero errors
- pnpm run build succeeds; git diff --stat shows no OHIF source changes
```

## PR 3 — `feat: add OHIF bridge extension and readiness handshake` — ✅ MERGED (`e2df3ff0e`, GitHub PR #3)

### Goal

Create the viewer-side bridge and a trustworthy `VIEWER_READY`.

### Already established by the audit — [VERIFIED], no re-inspection needed

- Minimal extension shape: `package.json` with `"module": "src/index.tsx"`, `src/id.js`, `src/index.tsx` exporting `{ id, preRegistration }`. **No per-extension webpack build is required** — precedent `extensions/test-extension/` has no `.webpack/` directory.
- Registration: add one entry to `platform/app/pluginConfig.json` `extensions`. The extension need **not** be a dependency of `platform/app` (`platform/app/.webpack/writePluginImportsFile.js:126-225` builds the resolve alias). `extensions/*` is already a workspace glob.
- No mode change needed: no runtime validation of a mode's `extensionDependencies` exists.
- `preRegistration` signature and params: `platform/core/src/extensions/ExtensionManager.ts:276-286`. `peerImport` is on the type but not passed.
- Readiness: `ViewportGridService.EVENTS.VIEWPORTS_READY` (`platform/core/src/services/ViewportGridService/ViewportGridService.ts:14,139-141`, published from `platform/app/src/components/ViewportGrid.tsx:143-150`). Can fire more than once.
- Subscription cleanup: `subscribe()` returns `{ unsubscribe }` (`platform/core/src/services/_shared/pubSubServiceInterface.ts:35-37`). Extension lifecycle is app-lifetime — precedent `extensions/default/src/init.ts:53-77`.

### Changes

- add `extensions/scoring-form-bridge`;
- add one entry to `platform/app/pluginConfig.json` — **[PROPOSED]** as the **last** `extensions` entry, so `toolGroupService` (registered by the cornerstone extension's own `preRegistration`, `extensions/cornerstone/src/index.tsx:210-224`) already exists;
- resolve services/commands **lazily** at message-handling time rather than capturing them during `preRegistration`;
- add viewer-side `message` listener;
- strict host `origin` check;
- `event.source === window.parent`;
- runtime contract validation;
- subscribe to `VIEWPORTS_READY`; emit `VIEWER_READY` **once** (idempotent) and only when activation is achievable;
- cleanup bridge listeners/subscriptions; guard installation so hot reload cannot duplicate them.

### Must resolve in this PR — resolved

`docs/scoring-form/IMPLEMENTATION_NOTES.md` §10 item 4 — readiness fallback. Reproduced with a deliberately invalid `StudyInstanceUIDs`: `VIEWPORTS_READY` never fires, so no `VIEWER_READY` is ever sent and the host correctly stays "not ready" indefinitely; OHIF displays its own error UI inside the iframe. **Accepted decision:** no diagnostic timeout, no new failure message type, no contract change for PR 3's MVP scope — recorded with evidence in `ARCHITECTURE.md` §10.10.

### Verification — browser-verified

- host receives exactly one valid `VIEWER_READY` on a normal CT load — ✅ confirmed;
- a page reload re-establishes readiness with a fresh `viewerInstanceId` — ✅ confirmed;
- a layout change does not produce a duplicate `VIEWER_READY` — ✅ confirmed (underlying `VIEWPORTS_READY` re-fires, `readyEmitted` guard prevents a duplicate send);
- an HMR edit-and-save smoke test showed the handshake still working with no duplicate READY after a subsequent layout change — ✅ confirmed;
- fake wrong-origin / wrong-version / unrelated messages are ignored on both sides — implemented, not separately re-verified in this browser session (unchanged since PR 2's host-side verification and this PR's viewer-side implementation);
- viewer still loads a normal study with the extension registered — ✅ confirmed (CT visibly renders);
- broken-study case: no `VIEWER_READY`, host stays not ready, OHIF shows its own error — ✅ confirmed, and accepted as the MVP behavior (no host-side fallback added, see above).

An additional iframe-lifecycle fix was required during this verification: readiness is now reset at the point the host itself (re)assigns the iframe `src` (`apps/host-app/src/bridge/useViewerBridge.ts`, `resetForNavigation`), not on the iframe's `onLoad` event — `onLoad` fires well before OHIF's own boot completes and risked clearing an already-valid handshake. A reload/navigation *not* initiated by the host cannot be reliably detected with the current architecture; documented as an open, accepted limitation in `ARCHITECTURE.md` §6 and §11 rather than solved with polling, a state machine, or a new message type.

**Merged** to `master` via GitHub PR #3 (`e2df3ff0e`).

## PR 4 — `feat: activate and cancel ellipse from scoring form` — ✅ MERGED (`c740ce731`; docs `4c3d0858`, implementation `e169f8096`)

Activation, cancellation, and the `VIEWER_READY` handshake are implemented and browser-verified per the critical cases below. Measurement correlation (PR 5) is now implemented and merged — see below. Totals (PR 6) are not implemented yet.

### Goal

Implement host -> viewer command path.

### Host changes

- add row model and `useReducer`;
- Add Measurement button;
- row ID generation;
- Activate button;
- per-activation `activationId`;
- pre-ready FIFO command queue — flushed in order on `VIEWER_READY`; a queued activation that is canceled or superseded before flush is **removed from the queue** — no `DEACTIVATE_TOOL` is sent, since the viewer never received the matching `ACTIVATE_TOOL` (§6, §10.3);
- exactly one active drawing intent at a time: activating row B while row A is pending cancels/removes A first, per the same still-queued-vs-already-dispatched rule;
- Cancel action: if the row's `ACTIVATE_TOOL` is still queued, remove it from the queue (no message sent); if it was already dispatched to the viewer, send `DEACTIVATE_TOOL`;
- handle `ACTIVATION_FAILED`: reject if `activationId` does not match the row's current activation (stale, per §10.1/§10.4 rejection rule), otherwise move the row back to `waiting` and surface `reason`.

### Viewer changes

- handle `ACTIVATE_TOOL`; activate `EllipticalROI` via `commandsManager.runCommand('setToolActiveToolbar', { toolName: 'EllipticalROI' }, 'CORNERSTONE')` (`extensions/cornerstone/src/commandsModule.ts:1198-1207`) — **decided**, see `ARCHITECTURE.md` §10.11;
- **verify the activation actually took effect** by reading back `toolGroup.getActivePrimaryMouseButtonTool()` on the `'default'` tool group; **only after that read-back confirms `EllipticalROI` is active does the bridge store armed `{ rowId, activationId }`**; on any exception during activation *or* a read-back mismatch, do **not** arm the row — send `ACTIVATION_FAILED { rowId, activationId, reason }` to the host instead;
- after the flow ends (measurement completes or `DEACTIVATE_TOOL`), **always deactivate `EllipticalROI` and activate the fixed `WindowLevel` constant** — never capture/restore a previously active tool (`ARCHITECTURE.md` §6, §10.7);
- handle `DEACTIVATE_TOOL`: clear matching armed state, cancel any in-progress drawing via `commandsManager.runCommand('cancelMeasurement', {}, 'CORNERSTONE')` (`extensions/cornerstone/src/commandsModule.ts:317-322`), then restore `WindowLevel` as above;
- tolerate the **[VERIFIED]** edge case that `EllipticalROITool.cancel()` still fires `ANNOTATION_COMPLETED` (`node_modules/@cornerstonejs/tools/dist/esm/tools/annotation/EllipticalROITool.js:332`).

Note: `Pan` is **not** the baseline default primary tool — `WindowLevel` is (`modes/basic/src/initToolGroups.ts:20-37`). The restore target is always the fixed `WindowLevel` constant; there is no capture step.

### Must resolve in this PR — resolved

- **[CLOSED]** activation-failure reporting: new `ACTIVATION_FAILED` message, viewer → host, `{ rowId, activationId, reason }`, covering both a thrown/rejected activation call and a read-back mismatch. Recorded in `ARCHITECTURE.md` §5 message table and §10.11.
- **[CLOSED]** activation API: `setToolActiveToolbar`, with a read-back verification step. Recorded in `ARCHITECTURE.md` §10.11.

### Verification

Critical cases:

1. viewer ready -> Activate -> `EllipticalROI` becomes active **and the read-back confirms it**;
2. Activate (dispatched) -> Cancel -> `DEACTIVATE_TOOL` is sent, bridge is not armed, in-progress drawing cancelled, `WindowLevel` restored (never a captured tool);
3. click Activate before iframe/viewer readiness -> command is queued, delivered later, not lost;
4. click Activate then Cancel before iframe/viewer readiness -> the queued `ACTIVATE_TOOL` is removed before flush and no `DEACTIVATE_TOOL` is sent for that attempt (the viewer never saw the activation);
5. row A then row B activation produces one coherent active row — A is canceled/removed, B is armed;
6. unknown / wrong-version messages are ignored;
7. an activation attempted with no viewport/tool group is detected as a failure — the row stays `waiting` and the host receives `ACTIVATION_FAILED`, not a silently armed row;
8. a late/duplicate `ACTIVATION_FAILED` carrying a superseded `activationId` is dropped by the host.

## PR 5 — `feat: correlate OHIF measurements with form rows` — ✅ MERGED (`9cbececba`; docs `bdd55d8b0`, GitHub PR #5)

### Goal

Implement viewer -> host result path.

### Structure — already [VERIFIED], do not re-derive

`extensions/cornerstone/src/utils/measurementServiceMappings/EllipticalROI.ts:61-81`:

- no top-level `area`; area is at `Object.values(measurement.data)[0]?.area`, unit at `.areaUnit`;
- `measurement.data` **is** `annotation.data.cachedStats`, keyed by Cornerstone `targetId`;
- `measurement.uid` equals the Cornerstone `annotationUID`;
- OHIF's internal `measurementService.EVENTS.MEASUREMENT_ADDED` fires on drawing **completion**, payload `{ source, measurement }`, `source.name === CORNERSTONE_3D_TOOLS_SOURCE_NAME` for tool-drawn annotations (`platform/core/src/services/MeasurementService/MeasurementService.ts:541-575`, `extensions/cornerstone/src/initMeasurementService.ts:340-341`);
- `areaUnit` is an **open string set** (`'mm²'`, `'px²'`, plus calibration suffixes; `²` is U+00B2).

Note the naming collision: OHIF's own `measurementService.EVENTS.MEASUREMENT_ADDED` (viewer-internal) is a different thing from the bridge protocol's `MEASUREMENT_ADDED` (viewer → host). The former is the drawing-completion **trigger**; the latter is now the **final result** message, sent only after the settling procedure below.

### ⛔ Blocking open issue — resolved with runtime evidence

**[CLOSED]** `docs/scoring-form/IMPLEMENTATION_NOTES.md` §10 item 1 — `cachedStats` timing. Manually observed (evidence, not assumption): `MEASUREMENT_UPDATED` can arrive either before or after `MEASUREMENT_ADDED`; in one recorded draw, `MEASUREMENT_ADDED` reported `4214.7176 px²`, followed 51 ms later by `MEASUREMENT_UPDATED` reporting `26601.9840 px²`, matching OHIF's own displayed `26602 px²` — i.e. a **finite** area at `MEASUREMENT_ADDED` is not necessarily the **final** one. That draw's speed was not established in the supplied evidence — it is not characterized as fast or slow. Full evidence and citations: `docs/scoring-form/IMPLEMENTATION_NOTES.md` §5.3; decision and rationale: `ARCHITECTURE.md` §10.12.

**Chosen mitigation — settle-and-replace, MVP heuristic, not a correctness guarantee:** correlate `rowId ↔ measurementId` and restore `WindowLevel` immediately at the drawing-completion trigger (OHIF's own `MEASUREMENT_ADDED`), independent of the area value. Debounce the *value* forwarding per `measurementId`: reset a 200 ms timer on every relevant OHIF `MEASUREMENT_ADDED`/`MEASUREMENT_UPDATED` for that `measurementId`, always keeping the latest event's value as the candidate; once 200 ms pass with no further relevant event, send the bridge's final `MEASUREMENT_ADDED` if the candidate has a finite area and a non-empty unit, otherwise send `MEASUREMENT_FAILED`. **200 ms is a heuristic chosen for this MVP, not a guarantee that no later update exists** — an `MEASUREMENT_UPDATED` arriving after the window closes is not forwarded (documented limitation, not solved in PR 5).

### Protocol additions

- `MEASUREMENT_COMPLETED { rowId, activationId, measurementId }`, viewer → host — sent once, immediately when OHIF's drawing-completion event fires for the armed `EllipticalROI` intent (before the debounce/settling above). Transitions the row `drawing → processing`.
- `MEASUREMENT_ADDED { rowId, activationId, measurementId, toolName, measurement }` (existing type, redefined timing) — sent once the settle-and-replace procedure above concludes with a finite area and valid unit. Transitions `processing → ready`.
- `MEASUREMENT_FAILED { rowId, activationId, reason }`, viewer → host — sent if the settle-and-replace procedure concludes with a non-finite area or missing/invalid unit. Returns the row `processing → waiting`, reason shown, retryable via Activate.
- The three PR 5 messages (`MEASUREMENT_COMPLETED`, `MEASUREMENT_ADDED`, `MEASUREMENT_FAILED`) all carry `activationId`: the host validates `rowId` and `activationId` and drops the message if either does not match the row's current activation, per the existing stale-event rule (§10.1/§10.4). The existing optional `MEASUREMENT_UPDATED` (star task 5.1) is **not** part of this — its payload is `{ rowId, measurementId, measurement }` with no `activationId` (`ARCHITECTURE.md` §5 table); that contract is unchanged by this pass and out of scope here.
- Row states: `waiting → drawing → processing → ready`, with `processing → waiting` on `MEASUREMENT_FAILED`. Full detail and rationale: `ARCHITECTURE.md` §10.12, message table §5.

### Viewer changes

- subscribe to `measurementService.EVENTS.MEASUREMENT_ADDED` and `.MEASUREMENT_UPDATED`; save both `{ unsubscribe }` handles;
- an armed intent is `{ rowId, activationId }` (§4) — it never contains a `measurementId`, since OHIF hasn't assigned an annotation UID until the annotation exists. So the *first* internal `MEASUREMENT_ADDED` cannot be matched by `measurementId`; it is matched by **being the next tool-drawn event while a row is armed and no `measurementId` has been captured for it yet**: filter by `toolName === 'EllipticalROI'` and `source.name === CORNERSTONE_3D_TOOLS_SOURCE_NAME`, and only proceed if a row is currently armed. On that event: capture `measurement.uid` as `measurementId`, establish `rowId ↔ measurementId` correlation, clear armed state, restore `WindowLevel`, and send `MEASUREMENT_COMPLETED` — all before evaluating the area value;
- **this is an assumption, not a proof:** it relies on the existing single-active-drawing-tool/exclusive-activation design (§6) — it does not by itself rule out a concurrent, unrelated `EllipticalROI` being created by some other path at the same moment and being captured instead. No evidence was gathered on that race; it is not covered in PR 5's scope and must not be presented as closed;
- once a `measurementId` is correlated, every subsequent `MEASUREMENT_UPDATED` is matched **only** against that captured `measurementId` (armed state is already cleared by then, so it cannot be used as the match key) — an `MEASUREMENT_UPDATED` whose `uid` doesn't match a known correlation is ignored, including one that arrives *before* the matching internal `MEASUREMENT_ADDED` (observed ordering): it cannot independently create a correlation, since no `measurementId` has been captured for it yet;
- on the correlating `MEASUREMENT_ADDED` and every subsequent matched `MEASUREMENT_UPDATED`: snapshot `area`/`areaUnit` as primitives (never forward the live `cachedStats` reference) and (re)start a 200 ms debounce timer keyed by `measurementId`;
- on debounce settle: if the latest snapshot has a finite area and a non-empty unit, adapt it into `BridgeMeasurementValue` and send the bridge's `MEASUREMENT_ADDED`; otherwise send `MEASUREMENT_FAILED { rowId, activationId, reason }`;
- clear the debounce timer and drop the pending snapshot on disposal (`pagehide`/`beforeunload`/explicit `disposeScoringFormBridge`), alongside the existing subscription/listener cleanup;
- a pending debounce/snapshot for one `measurementId` is independent of the single armed slot (§6 concurrency note, `ARCHITECTURE.md`): activating, drawing, or canceling a *different* row while an earlier row is `processing` must not touch the earlier row's pending state.

### Host changes

- `MEASUREMENT_COMPLETED`: validate `rowId`/`activationId`; if current, move the row `drawing → processing`; store `measurementId` for later correlation checks;
- `MEASUREMENT_ADDED`: validate `rowId`/`activationId` against the row's current activation; if current and the row is `processing`, store value/unit/`measurementId` and move the row `processing → ready`;
- `MEASUREMENT_FAILED`: validate `rowId`/`activationId`; if current, move the row `processing → waiting` and surface `reason`; the row remains retryable via Activate;
- no Cancel action is offered while a row is `processing` — the annotation already exists in OHIF at that point, and Cancel must never delete an already-completed annotation (only an in-progress manipulation, per PR 4's `DEACTIVATE_TOOL` scope);
- a `processing` row is **not** an active drawing intent: it must not block activating a different row, and canceling that *different* row's own activation must not be confused with, or allowed to affect, the earlier row's still-pending `processing` result (`ARCHITECTURE.md` §6 concurrency note);
- ignore stale, duplicate, or unrelated messages per the existing rules;
- preserve the exact unit string; totals remain PR 6.

### Manual toolbar switching bug — browser-reproduced, fixed

**[VERIFIED bug, fixed]** Reproduction: Activate a row → manually pick a different primary tool from OHIF's own toolbar → manually pick `EllipticalROI` again and draw. The original row incorrectly received the new annotation, because nothing invalidated its `armed` state when the user switched away — exactly the gap the toolbar-hijack verification bullet below was written to catch, one step further (armed, not un-armed).

Fix: the bridge subscribes to `toolGroupService.EVENTS.PRIMARY_TOOL_ACTIVATED` (filtered to the `'default'` tool group). When it fires for a `toolName` other than `EllipticalROI` while a row is armed, the bridge clears `armed` immediately and sends a new message, `ACTIVATION_CANCELLED { rowId, activationId, reason }` — deliberately not `restoreDefaultTool()` (the user's chosen tool is left alone) and deliberately not touching `pendingResults` (unrelated, keyed independently). The host moves the matching `drawing` row to `waiting` with the reason shown, and sends nothing back to the viewer (no `DEACTIVATE_TOOL` echo). Full rationale, why this isn't `ACTIVATION_FAILED`, and why no "who triggered this" flag is needed: `ARCHITECTURE.md` §10.13.

### Verification

- create at least three sequential measurements;
- each value lands in the correct row;
- the reported final area matches the value OHIF displays in the viewport (this is the check that catches `cachedStats` staleness — confirmed necessary by the observed 4214.7176 → 26601.9840 px² case above);
- a fast click-drag-release also produces a correct value, or resolves to `MEASUREMENT_FAILED` if the settle window truly never sees a finite value;
- verify that annotations created directly from the OHIF toolbar do not hijack a form row; if this fails, investigate the correlation mechanism before merging PR 5 rather than treating the exclusive-activation assumption as a proven guarantee;
- Activate a row, manually switch to a different primary tool, manually switch back to `EllipticalROI` and draw — the original row must return to `waiting` with a reason (`ACTIVATION_CANCELLED`) and must **not** receive the later draw;
- an Escape-cancelled partial ellipse does not corrupt a row;
- stale activation event cannot overwrite a newer activation;
- Cancel is not offered/has no effect while a row is `processing`, and never deletes a completed annotation;
- an `MEASUREMENT_UPDATED` arriving after the 200 ms settle window is observed to NOT be forwarded (documented limitation, not a bug).

## PR 6 — `feat: add unit-safe totals and final required UX` — ✅ MERGED (Implementation commit: `adf132acc`, Documentation commit: `9fefd7b13`, Merge commit: `a67579597`, GitHub PR #6)

### Goal

Complete the mandatory scenario.

### Implemented

- pure `computeTotals(rows)` in `apps/host-app/src/form/totals.ts` — includes only `status === 'ready'` rows with a finite numeric value and non-empty unit, grouped by the **exact** unit string (`mm²` and `px²` never merged; calibrated suffixes like `mm² ERMF` kept distinct); the accumulator uses `Object.create(null)` so a unit literally named `constructor` cannot collide with an inherited property;
- full-precision calculation — totals are summed unformatted; `.toFixed(2)` is applied only in `App.tsx` at render time, for both per-row ready values and the totals display, per `ARCHITECTURE.md` §7 ("values are stored unformatted; formatting is presentation-only");
- totals UI: a single `Total:` label on the left with a vertical, right-aligned column of `<value> <unit>` lines on the right (one line per unit), a divider above it, and an explicit "No ready measurements yet." empty state;
- sequential row display numbers (`#1, #2, …`), derived from array position (not `row.id`), shown in every row state; ready rows additionally show a small green "Ready" badge next to the number;
- Tailwind CSS integrated into `apps/host-app` only — reused the exact versions already used across `platform/*` (`tailwindcss@3.2.4`, `postcss@8.5.26`, `autoprefixer@10.4.21`, hoisted at the repo root), with a host-app-local `tailwind.config.cjs`/`postcss.config.cjs` so Vite does not fall back to the repo-root `postcss.config.js` (which lacks the `tailwindcss` plugin) — OHIF's own styling is untouched;
- 10 focused unit tests for `computeTotals` in `apps/host-app/src/form/totals.test.ts` (empty rows, non-ready rows excluded, single/multiple same-unit rows, mixed units, calibrated-unit suffix, decimal precision, non-finite/missing value excluded, empty/missing unit excluded, `"constructor"`-named unit) — **10/10 passing** via `node --loader ts-node/esm --test`, run under the documented baseline Node `24.15.0`;
- `apps/host-app` scoped TypeScript check and production build (`vite build`) both pass with **zero errors**.

### Not implemented in this PR

- protocol guard/serialization tests and stale-activation-handling tests — both named as optional extras in the original plan, not written in this pass;
- no new "unsupported unit" UI state was added — `computeTotals` excludes rows with missing or empty units, non-finite values, or non-ready status, and groups all other units by their exact strings. The reducer validates incoming `MEASUREMENT_ADDED` payloads;
- the `packages/message-contract` Jest-project-glob question (`docs/scoring-form/IMPLEMENTATION_NOTES.md` §10 item 5) was not addressed by this PR — it remains open, since totals tests were written for `apps/host-app` via Node's built-in test runner instead.

### Verification

Automated (done): unit tests, scoped TypeScript check, and production build above.

Manual demo script (partially verified; remaining scenarios pending before merge):

1. start both apps;
2. add three rows;
3. measure all three;
4. show totals updating;
5. activate another row and cancel;
6. show early activation while viewer loads;
7. confirm no mixed-unit summation.

Once the manual demo script above is run and confirmed, the mandatory scope should be submission-quality.

## PR 7 — `docs: finalize architecture, runbook, and AI usage`

### Goal

Make the project reproducible on a clean machine and easy to defend.

### Changes

**Setup guide — `docs/scoring-form/README.md`, finalised:**

- exact OHIF baseline: version `3.14.0-beta.29`, commit `1ec01348d`, Node `24.15.0`, pnpm `11.5.2`;
- prerequisites;
- exact install command — `pnpm run install:update-lockfile` (a plain `pnpm install` fails: `pnpm-workspace.yaml:17` `frozenLockfile: true`);
- exact commands for both ports (viewer `3000` via `pnpm run dev`, host `5173`);
- known-good study URL;
- status table removed or fully green — by this PR every step must actually work.

**Discoverable entry point — required before submission:**

- add a short pointer from the repository root `README.md` to `docs/scoring-form/README.md`.
- The root README is upstream OHIF's and has been deliberately untouched until now. **[PDF** p.4 §7.2**]** says the reviewer's steps will be executed literally from a clean clone; a reviewer who opens the root readme must be able to find the task instructions without being told they exist. This is the minimum edit that achieves that — a few lines near the top, not a rewrite.
- This is the **only** intended modification to an upstream OHIF file in the whole task. Call it out explicitly in the PR body.

**`ARCHITECTURE.md`, final pass:** diagram, consolidated message table with payloads, "Accepted Decisions" (every resolved open item folded in with its evidence), known limitations/trade-offs. Keep it to the assignment's 1–2 substantive pages; depth belongs in `docs/scoring-form/IMPLEMENTATION_NOTES.md`.

**`AI-USAGE.md`:** fill in the per-PR table honestly — what AI produced, what was kept, what was rewritten and why. **[PDF** p.4 §7.2**]** the ability to work with AI is *critically assessed*; hiding it is the only penalty.

**Demo-video checklist** (**[PDF** p.5 §7.3**]**, mandatory, 2–4 min, voice-over desirable) — all five scenes required:

1. launching both applications;
2. adding at least **three** measurements in a row;
3. the total updating;
4. **cancelling an activation** (pressed Activate, changed your mind);
5. any implemented star tasks.

### Required before final submission — blocking checklist

All four are hard gates. The assignment states the reviewer's steps will be executed **literally on a clean machine** (**[PDF** p.4 §7.2**]**), and "reproduces from the README without hints" is 25% of the grade (**[PDF** p.6 §10**]**).

- [ ] **Discoverable link from the root `README.md`** to `docs/scoring-form/README.md`. The root README is upstream OHIF's and is untouched until this PR; this is the **only** intended edit to an upstream OHIF file in the whole task, and it must be called out in the PR body. A reviewer opening the root readme must find the task guide without being told it exists.
- [ ] **Replace the placeholder clone command.** `docs/scoring-form/README.md` currently reads `git clone <this-fork>`. Substitute the **actual public fork URL**, and confirm the repository is publicly reachable (the assignment requires an open repository, **[PDF** p.4 §7.1**]**).
- [ ] **Verified exact `StudyInstanceUID` and a working direct viewer URL.** Record the real UID — not a placeholder — and paste the full working URL in the form `http://localhost:3000/viewer?StudyInstanceUIDs=<uid>`. Confirm against the default public DICOMweb source that the study loads and that `EllipticalROI` yields an area in `mm²` on it.
- [ ] **Clean-machine setup verification using only the documented commands.** Fresh clone or clean worktree, no undeclared global dependencies, no hidden local config, nothing carried over from the development checkout. Follow the guide verbatim, top to bottom, and fix the guide — not the machine — wherever it fails. Record in the PR body what was run and on what.

## PR 8 — optional `feat: sync live measurement updates`

Only after PR 1–7 required scope is stable.

### Viewer

- subscribe to `MEASUREMENT_UPDATED`;
- only forward measurements present in `measurementId -> rowId`;
- adapt new area/unit;
- send `MEASUREMENT_UPDATED`.

### Host

- update row from remote event;
- recalculate totals;
- do not emit any reciprocal viewer command from this remote reducer action.

### Performance

OHIF drag updates can be frequent.

Start with direct updates because the UI is tiny.

If actual frequency causes excessive renders, throttle/debounce UI updates while guaranteeing the final update is delivered. Document the trade-off.

## PR 9 — optional `feat: synchronize measurement deletion`

Only if enough time remains.

Requires explicit loop-safe semantics.

Suggested protocol additions:

- `REMOVE_MEASUREMENT` host -> viewer;
- `MEASUREMENT_REMOVED` viewer -> host.

Do not reuse `DEACTIVATE_TOOL` for deletion; activation cancellation and deleting an existing annotation are different operations.

## Final pre-submission checklist

### Required behavior

- [ ] public DICOMweb study loads;
- [ ] direct `StudyInstanceUIDs` URL works;
- [ ] host and viewer use different ports;
- [ ] iframe fills available viewer area;
- [ ] rows can be added indefinitely;
- [ ] Activate triggers EllipticalROI;
- [ ] measurement returns to the correct row;
- [ ] exact unit preserved (open string set; no normalization);
- [ ] unlike units not summed;
- [ ] after a measurement completes or is cancelled, `EllipticalROI` is deactivated automatically and `WindowLevel` (the baseline default primary tool, not `Pan`) is active again;
- [ ] activation is verified by read-back, never assumed;
- [ ] reported area matches what OHIF displays;
- [ ] cancel works;
- [ ] early Activate is not lost;
- [ ] origin checked both ways;
- [ ] source window checked both ways;
- [ ] shared message types;
- [ ] cleanup paths present;
- [ ] no unrelated OHIF annotation correlation.

### Mandatory deliverables (`ASSIGNMENT.pdf` p.4 §7.1–7.2, p.5 §7.3)

- [ ] **≥ 5 feature PRs**, each describing what changed, why exactly this way, and what was verified (a PR described as "changes" is not counted);
- [ ] **setup guide** at `docs/scoring-form/README.md`, tested literally from a clean clone using only the documented commands;
- [ ] **discoverable pointer** from the root `README.md` to that guide;
- [ ] **real public fork URL** in the clone command — no `<this-fork>` placeholder left;
- [ ] **verified exact `StudyInstanceUID`** and a working direct `/viewer?StudyInstanceUIDs=<uid>` URL;
- [ ] **`ARCHITECTURE.md`** containing the diagram, the consolidated message table with payloads, and the "Accepted Decisions" section — kept to 1–2 substantive pages;
- [ ] **`AI-USAGE.md`** filled in honestly per PR (kept / rewritten / why);
- [ ] **video demo**, 2–4 min, voice-over desirable, showing all five required scenes: both apps launching · ≥ 3 measurements in a row · the total updating · **cancelling an activation** · any star tasks.

### Repository quality

- [ ] PR descriptions explain why + verification;
- [ ] `ARCHITECTURE.md` matches code;
- [ ] no documentation claims that unimplemented behaviour already works;
- [ ] no unexplained core OHIF edits; `AGENTS.md` and `CLAUDE.md` untouched;
- [ ] no secrets/local machine paths;
- [ ] `pnpm run build` succeeds;
- [ ] **scoped** typecheck of every app/package we added passes with zero errors (no repository-wide `tsc` claimed — see `docs/scoring-form/IMPLEMENTATION_NOTES.md` §9.1);
- [ ] focused unit tests pass;
- [ ] every `docs/scoring-form/IMPLEMENTATION_NOTES.md` §10 open item is either resolved (recorded as an `ARCHITECTURE.md` §10 Accepted Decision, with evidence) or explicitly listed in `ARCHITECTURE.md` §11 as a known limitation;
- [ ] `ARCHITECTURE.md` still contains the diagram, the consolidated message table with payloads, and the "Accepted Decisions" section required by the assignment (p.4 §7.2);
- [ ] the root `README.md` contains a discoverable pointer to `docs/scoring-form/README.md`.

### Defense rehearsal

Be able to make these changes without architecture rewrite:

- [ ] EllipticalROI -> RectangleROI;
- [ ] add perimeter or mean intensity through viewer adapter, protocol, reducer, UI;
- [ ] remove/break `VIEWER_READY` and explain failure path;
- [ ] explain why `WindowLevel` is activated rather than `Pan`, and why that still satisfies the assignment's «повертається Pan/дефолт» through the *default* option;
- [ ] explain how activation success is confirmed given that `setToolActive` fails silently;
- [ ] explain the `cachedStats` timing risk and the mitigation chosen.
