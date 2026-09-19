# ARCHITECTURE.md — Viewer + Scoring Form

Bridge between an OHIF Viewer fork in an iframe and a React scoring form on a different origin, communicating over `window.postMessage`.

> **Status.** Design document, partially implemented: the host app, the shared message contract, the viewer bridge extension, the `VIEWER_READY` handshake, tool activation/cancellation, and measurement correlation (settle-and-replace debounce, manual-toolbar-switch cancellation) are all merged to `master`. **Totals (§7) are implemented and verified** and merged into master via PR #6 (merge commit a67579597). `IMPLEMENTATION_PLAN.md` is the single source of truth for per-PR status, commit hashes, and scope — see it for the full history rather than duplicating that here.
>
> **Scope.** Deliberately short, as the assignment asks (`ASSIGNMENT.pdf` p.4 §7.2 — *"1–2 pages is enough, but substantive"*). Supporting evidence, `file:line` citations and open technical questions live in **`docs/scoring-form/IMPLEMENTATION_NOTES.md`**.
>
> **Labels.** **[PDF]** = original requirement, with page ref · **[VERIFIED]** = read from OHIF source at `1ec01348d` · **[OURS]** = our decision · **[OPEN]** = undecided, see Known Limitations.
>
> Update this document in the same PR as any code that changes a documented contract or decision.

## 1. Baseline

| Item | Value |
|---|---|
| OHIF | `3.14.0-beta.29` @ commit `1ec01348d` |
| Node / pnpm | `24.15.0` / `11.5.2` |
| Viewer origin | `http://localhost:3000` (`OHIF_PORT`) |
| Host origin | `http://localhost:5173` |
| Data source | public DICOMweb shipped with OHIF **[PDF** p.2 §4.1**]** |
| Tool | `EllipticalROI` **[PDF** p.3 §4.3**]** |

## 2. Topology

```text
Browser tab
┌──────────────────────────────────────────────────────────────────────┐
│  host-app   http://localhost:5173        (React + TypeScript, Vite)  │
│                                                                      │
│  ┌──────────────────────────────┐   ┌─────────────────────────────┐   │
│  │ <iframe>  flexible,          │   │ Scoring form                │   │
│  │           full height        │   │                             │   │
│  │ ┌──────────────────────────┐ │   │  row A  waiting  [Activate] │   │
│  │ │ OHIF Viewer              │ │   │  row B  drawing…            │   │
│  │ │ localhost:3000/viewer    │ │   │  row C  ready   124.5 mm²   │   │
│  │ │   ?StudyInstanceUIDs=…   │ │   │  ─────────────────────────  │   │
│  │ │                          │ │   │  Total   mm²: 124.5         │   │
│  │ │ ┌──────────────────────┐ │ │   │          px²: 3480          │   │
│  │ │ │ scoring-form-bridge  │ │ │   └─────────────────────────────┘   │
│  │ │ │ (OHIF extension)     │ │ │              ▲        │            │
│  │ │ └──────────────────────┘ │ │              │        │            │
│  │ └──────────────────────────┘ │              │        │            │
│  └──────────────────────────────┘              │        │            │
│                  ▲    │                        │        │            │
└──────────────────┼────┼────────────────────────┼────────┼────────────┘
                   │    │                        │        │
     VIEWER_READY  │    │ ACTIVATE_TOOL          │        │
 MEASUREMENT_ADDED │    │ DEACTIVATE_TOOL        └────────┘
MEASUREMENT_UPDATED│    ▼                      reducer state
                   └──── window.postMessage ────
                    exact targetOrigin, never "*"
```

The bridge is an **OHIF extension**, not parent-window poking: OHIF internals are unreachable from outside the iframe **[PDF** p.2 §3**]**. The extension receives `servicesManager` and `commandsManager` in `preRegistration` and owns all OHIF-facing work.

## 3. Responsibility boundaries

| Host app owns | Viewer bridge owns | Shared contract owns |
|---|---|---|
| form rows, `rowId` | OHIF services/commands integration | protocol name + `version` |
| per-activation `activationId` | tool activation / deactivation | message type constants |
| user intent (activate / cancel) | the armed `{ rowId, activationId }` | discriminated TS unions |
| pre-ready command queue | filtering OHIF measurement events | runtime guards |
| row UI state, totals | OHIF → bridge value adaptation | `BridgeMeasurementValue` |
| `rowId → measurementId` | `measurementId → rowId` | |

The host never sees a Cornerstone or OHIF measurement object.

## 4. Identity and correlation

> **[PDF** p.3 §5.3**]** *«Це головне архітектурне рішення завдання»* — **this is the main architectural decision of the task.** Graded under "Bridge architecture" (25%).

| ID | Owner | Lifetime | Why that owner |
|---|---|---|---|
| `rowId` | **host**, `crypto.randomUUID()` on row creation | the row | The host owns the form entity. The viewer must never invent a form identity. |
| `activationId` | **host**, new value on every Activate press | one activation attempt | **[OURS]** Guards against a stale measurement event being accepted after a cancel or re-activate race. |
| `measurementId` | **OHIF / Cornerstone** (the annotation UID) | the annotation | OHIF owns the annotation entity. The host must never invent a native OHIF identity. |

Neither side invents the other side's native ID. The mapping is established once, at `MEASUREMENT_COMPLETED` — sent the instant OHIF's own **internal** `measurementService.EVENTS.MEASUREMENT_ADDED` fires for the armed `EllipticalROI` intent, before any area value is evaluated (§10.12):

```text
host: rowId=R1, activationId=A1
  │ ACTIVATE_TOOL { R1, A1 }
  ▼
bridge arms { R1, A1 } ──▶ user draws ──▶ OHIF annotationUID = M1
  │ MEASUREMENT_COMPLETED { R1, A1, M1 }
  ▼
host accepts only if the row's current activationId === A1
  └─▶ stores R1 ↔ M1          bridge stores M1 → R1 (for later updates)
```

**Naming collision, not a typo.** OHIF's own internal `measurementService.EVENTS.MEASUREMENT_ADDED` (the drawing-completion trigger above, viewer-internal, never crosses the bridge under that name) is a different thing from this protocol's own `MEASUREMENT_ADDED` message (§5) — the latter is sent later, once the 200 ms settle-and-replace debounce (§10.12) concludes with a finalized value, and it carries the already-correlated `measurementId` rather than establishing the correlation.

A stale event carrying a superseded `activationId` is dropped by the host. An annotation drawn from the OHIF toolbar while nothing is armed is never assigned to a row.

## 5. Message contract

Names are fixed by the assignment; payloads are ours **[PDF** p.3 §4.4**]**.

### Envelope

Every message is wrapped:

```ts
type BridgeEnvelope<TType extends string, TPayload> = {
  protocol: 'viewer-scoring-bridge';  // ignore unrelated postMessage traffic
  version: 1;                         // [PDF] required
  sender: 'host' | 'viewer';           // direction validation + debugging
  type: TType;
  messageId: string;                   // diagnostics / log correlation
  sentAt: number;                      // diagnostic ONLY — never used for ordering
  payload: TPayload;
};

type BridgeMeasurementValue = {
  kind: 'area';
  value: number;
  unit: string;   // exact string from OHIF — see §7
};
```

Ordering relies on the browser's `postMessage` delivery order between the same two windows; correctness relies on state and IDs, never on `sentAt`.

### Consolidated message table

| Type | Direction | Payload | Sent when | Receiver effect |
|---|---|---|---|---|
| `VIEWER_READY` | viewer → host | `{ viewerInstanceId: string }` | Bridge installed **and** a viewport/tool group can accept a drawing command. Emitted **once** — the underlying OHIF event can fire repeatedly (§6). | Host marks viewer ready, flushes the queued commands in order. |
| `ACTIVATE_TOOL` | host → viewer | `{ rowId: string; activationId: string; toolName: SupportedTool }` | User presses **Activate** on a row. Queued if the viewer is not ready. | Bridge activates the tool, **verifies activation took effect**, and only then arms `{ rowId, activationId }` (§6). Row → `drawing`. |
| `DEACTIVATE_TOOL` | host → viewer | `{ rowId: string; activationId: string }` | User cancels an activation, or activates a different row while one is armed, **and the corresponding `ACTIVATE_TOOL` was already dispatched to the viewer**. If that `ACTIVATE_TOOL` is still sitting in the pre-ready queue, it is removed from the queue instead and `DEACTIVATE_TOOL` is never sent (§6, §10.3). | Bridge clears armed state if it matches, cancels any in-progress drawing, restores the default tool (§6). Emits **no** measurement event. |
| `MEASUREMENT_COMPLETED` | viewer → host | `{ rowId: string; activationId: string; measurementId: string }` | **[PR 5, merged]** OHIF's own drawing-completion event (`measurementService.EVENTS.MEASUREMENT_ADDED`, viewer-internal — not this table's `MEASUREMENT_ADDED`) fires for the armed `EllipticalROI` intent. Sent immediately, before the area value is evaluated. | Host validates `rowId`/`activationId`; if current, moves the row `drawing → processing` and remembers `measurementId` (§10.12). |
| `MEASUREMENT_ADDED` | viewer → host | `{ rowId: string; activationId: string; measurementId: string; toolName: SupportedTool; measurement: BridgeMeasurementValue }` | **[PR 5, merged; timing redefined from PR 4-era draft]** The 200 ms settle-and-replace debounce (§10.12) concludes with a finite area and valid unit for a `measurementId` already correlated via `MEASUREMENT_COMPLETED`. | Host stores value + unit + `measurementId` and moves the row `processing → ready`, **only if** `activationId` is still current. Totals recalculate (PR 6). |
| `MEASUREMENT_FAILED` | viewer → host | `{ rowId: string; activationId: string; reason: string }` | **[PR 5, merged]** The settle-and-replace debounce (§10.12) concludes with a non-finite area or missing/invalid unit. | Host validates `rowId`/`activationId`; if current, moves the row `processing → waiting` and surfaces `reason` (retryable via Activate). |
| `MEASUREMENT_UPDATED` | viewer → host | `{ rowId: string; measurementId: string; measurement: BridgeMeasurementValue }` | **Optional — star task 5.1 only.** An already-correlated annotation is edited *after* the row has already reached `ready`. Not the same signal as the pre-settle `MEASUREMENT_UPDATED` observations consumed internally during §10.12's debounce, which never cross the bridge as their own message. | Host updates the row value and totals. Emits **nothing** back (§9). |
| `ACTIVATION_FAILED` | viewer → host | `{ rowId: string; activationId: string; reason: string }` | `ACTIVATE_TOOL` handling throws/rejects, **or** the post-activation read-back of the tool group's active primary tool does not match the requested tool (§6, §10.11). | Host drops the event if `activationId` is not the row's current activation (§10.1/§10.4); otherwise moves the row back to `waiting` and surfaces `reason`. Never re-sent automatically. |
| `ACTIVATION_CANCELLED` | viewer → host | `{ rowId: string; activationId: string; reason: string }` | `toolGroupService.EVENTS.PRIMARY_TOOL_ACTIVATED` fires for the `'default'` tool group with a `toolName` other than `EllipticalROI` while a row is still armed — i.e. the user manually switched OHIF's active primary tool via its own toolbar, not through `DEACTIVATE_TOOL` (§6 "manual toolbar switching", §10.13). | Host drops the event if `activationId` is not the row's current activation; otherwise moves the matching `drawing` row to `waiting` and surfaces `reason`. Never sends `DEACTIVATE_TOOL` back — the viewer already cleared its own armed state and left the user's chosen tool alone (§9 echo-loop prevention). |

`toolName` is typed as a `SupportedTool` union rather than the literal `'EllipticalROI'`, so swapping in `RectangleROI` is a one-line change — one of the assignment's live-change exercises **[PDF** p.5 §9**]**.

**[PR 5, merged]** The bridge stores `measurementId → rowId`, clears its armed state, and restores the default tool at `MEASUREMENT_COMPLETED` time — immediately when drawing ends — not when the final `MEASUREMENT_ADDED`/`MEASUREMENT_FAILED` is later sent after the settle-and-replace debounce (§6, §10.12). Value forwarding and tool/armed-state cleanup are deliberately decoupled.

### Runtime validation

TypeScript does not cross a `postMessage` boundary, so both sides validate at runtime, in order: value is an object → `protocol` matches → `version === 1` → `sender` is the expected peer → `type` is known → payload fields have the expected primitive shapes. Anything failing is dropped silently (logged in development).

Small explicit guards in the shared package, no schema library — the protocol has nine message types (six shipped in PR 4; `MEASUREMENT_COMPLETED`, `MEASUREMENT_FAILED` and `ACTIVATION_CANCELLED` shipped in PR 5). If it grows across teams, Zod or JSON-Schema-generated types become worthwhile; that is a documented future step, not a present need.

## 6. Handshake, activation, and returning to the default tool

**Early commands.** The host installs its `message` listener **before** the iframe `src` is assigned, so an early `VIEWER_READY` cannot be missed; commands issued before readiness go to an in-memory FIFO and flush in order on `VIEWER_READY` **[PDF** p.3 §5.1 — the command must not be lost**]**. Cancellation before flush is a queue edit, not a second command: if a queued `ACTIVATE_TOOL` is canceled, or superseded by activating a different row, before the queue flushes, it is **removed from the queue** and no `DEACTIVATE_TOOL` is ever sent — the viewer never received the `ACTIVATE_TOOL` it would be undoing. `DEACTIVATE_TOOL` is sent only when the `ACTIVATE_TOOL` being canceled has already been dispatched to the viewer (§10.3).

**Handshake — browser-verified (PR 3).** On branch `feat/ohif-bridge-extension`: a normal CT load sends exactly one `VIEWER_READY`, received once by the host; a page reload re-establishes readiness with a fresh `viewerInstanceId`; a layout change re-fires the underlying `VIEWPORTS_READY` event but does **not** produce a duplicate `VIEWER_READY` (`readyEmitted` guard); an HMR edit-and-save smoke test showed no duplicate READY after a subsequent layout change. See `docs/scoring-form/README.md` for the full observed-results list.

**Readiness reset is navigation-initiated, not `onLoad`-initiated.** The host resets its readiness state at the point it itself (re)assigns the iframe `src` (`apps/host-app/src/App.tsx`, via `useViewerBridge`'s `resetForNavigation`), not on the iframe's `load` event. `load` fires once the document finishes loading, which happens well before OHIF's own extension registration and viewport init complete and a real `VIEWER_READY` arrives — resetting on `load` risked clearing an already-valid handshake if a reload's `load` event landed after a fresh `VIEWER_READY` had already been processed. **[OPEN, accepted limitation]** a reload/navigation *not* initiated by the host (a manual iframe reload, or the OHIF app performing its own full-page navigation) cannot be reliably detected by the parent — there is no cross-origin "navigation started" signal available, and `onLoad` cannot substitute for one given the timing problem above. If this happens, the host shows stale readiness until the new page's handshake completes; a later `VIEWER_READY` (with a different `viewerInstanceId`) still correctly overwrites the stale state once it arrives (§10.2). Not solved by polling, a state machine, or a new message type in PR 3 — deliberately deferred.

**Invalid study — accepted MVP fallback (PR 3).** Browser-verified: an invalid `StudyInstanceUID` never produces `VIEWPORTS_READY`, so no `VIEWER_READY` is ever sent and the host correctly remains "not ready" indefinitely. OHIF surfaces its own error UI inside the iframe for this case. **Accepted for PR 3:** no diagnostic timeout, no new failure message type, no contract change — the host simply has no way to distinguish "still loading" from "failed to load," and that gap is left open rather than papered over with a guess. See §10.10 for the accepted decision and rationale. The MVP decision is closed; host-side failure detection remains deferred.

**Exclusive activation.** Only one row may be pending or armed. Activating row B while row A is pending (queued or armed) cancels A first, per the same still-queued-vs-already-dispatched rule above, so two rows can never both show `drawing`. **[PR 5, merged]** A row in `processing` is neither pending nor armed — it has already been cleared out of the armed slot at `MEASUREMENT_COMPLETED` time (§10.12) — so it does not occupy this exclusivity slot and does not block activating a different row.

**Readiness means usable, not loaded.** **[VERIFIED]** `setToolActive` has three silent early returns (no viewports / no tool group / tool absent) and `runCommand` returns `undefined` either way — a completed activation call proves nothing. The bridge therefore calls `setToolActiveToolbar`, then **reads back** `toolGroup.getActivePrimaryMouseButtonTool()` on the `'default'` tool group, and **only stores the armed `{ rowId, activationId }` state once that read-back confirms `EllipticalROI` is active**. An exception during activation or a read-back mismatch is treated as failure: the row is never armed, and `ACTIVATION_FAILED { rowId, activationId, reason }` is sent to the host instead (§10.11). Details and citations: `docs/scoring-form/IMPLEMENTATION_NOTES.md` §3.

**Returning to the default interaction.** After a measurement completes, or after `DEACTIVATE_TOOL`, the bridge deactivates `EllipticalROI` and **always** activates the fixed **`WindowLevel`** constant — there is no capture of a previously active tool and no restore step (§10.7).

**[PR 5, merged]** "A measurement completes" means the moment OHIF's own drawing-completion event fires for the armed intent — the bridge clears `armed` and restores `WindowLevel` **then**, and sends `MEASUREMENT_COMPLETED` at that same instant. It does **not** wait for the settle-and-replace debounce that determines the final area value (§10.12). The row still shows `processing` in the host UI after the tool has already switched back to `WindowLevel` — the user is free to look at the next row while the last measurement's value settles.

**[PR 5, merged] Concurrency: pending results are independent of the currently armed intent.** Because `armed` is cleared as soon as `MEASUREMENT_COMPLETED` is sent, a row can sit in `processing` — with its debounce timer and pending snapshot still live — while a *different* row is activated, drawn, and even canceled or superseded, all before the first row's value settles. Canceling or superseding that second, newly-armed drawing runs the normal `DEACTIVATE_TOOL`/re-arm path (§6 above) and must not touch the first row's pending debounce, snapshot, or `measurementId ↔ rowId` correlation — they are keyed independently, per `measurementId`, not per the single armed slot. The host must not treat a `processing` row as an active drawing: it does not block a new Activate, and canceling the *new* activation must not be mistaken for canceling the *earlier, already-completed* measurement, since that measurement's annotation already exists in OHIF and must never be deleted by a cancel (§10 Host changes, `IMPLEMENTATION_PLAN.md` PR 5).

**Manual toolbar switching invalidates an armed intent (PR 5).** **[VERIFIED bug, fixed]** Browser-reproduced: Activate a row, manually pick a *different* primary tool from OHIF's own toolbar (not via `DEACTIVATE_TOOL`), then manually pick `EllipticalROI` again and draw — the original row incorrectly received that new annotation, because nothing had cleared its `armed` state when the user switched away. Fixed by subscribing to `toolGroupService.EVENTS.PRIMARY_TOOL_ACTIVATED` (`extensions/cornerstone/src/services/ToolGroupService/ToolGroupService.ts:510-527`, itself re-broadcasting cornerstone-tools' `Events.TOOL_ACTIVATED` — `node_modules/@cornerstonejs/tools/dist/esm/store/ToolGroupManager/ToolGroup.js:217-222`, `{ toolGroupId, toolName }`) and, when it fires for the `'default'` tool group with a `toolName` other than `EllipticalROI` while a row is armed, immediately clearing `armed` and sending `ACTIVATION_CANCELLED { rowId, activationId, reason }` (§10.13). Every existing tool-changing call site already clears `armed` *before* changing the tool, so a bridge-initiated change (e.g. the `WindowLevel` restore below) is never mistaken for this — the `!armed` guard sees it already cleared. Deliberately does **not** call `restoreDefaultTool()` — the user's manually chosen tool is left alone, not fought.

**[VERIFIED]** `WindowLevel` — not `Pan` — is the baseline's default primary-mouse tool; `Pan` is bound to the auxiliary (middle) button (`modes/basic/src/initToolGroups.ts:20-37`).

**[PDF** p.3 §4.3 step 6**]** requires *«інструмент у переглядачі вимикається сам (повертається Pan/дефолт)»* — "the tool switches itself off (returns to Pan/default)". The binding obligation is the automatic switch-off; "Pan/default" is a parenthetical offering two options, and its slash shows the author treats them as the same thing. Restoring `WindowLevel` **satisfies that requirement through the «дефолт» (default) option** — it is not a deviation. The target tool is a single named constant in the bridge, so it can be changed live in seconds. Rejected alternatives, including the capture-and-restore design this replaces: `docs/scoring-form/IMPLEMENTATION_NOTES.md` §4.

> **[CLOSED]** `IMPLEMENTATION_PLAN.md` PR 4 previously described the deactivation path as "restore what was captured" — the capture-and-restore design this Accepted Decision rejects. That wording has been aligned to "always activate the fixed `WindowLevel` constant, no capture" in this documentation pass.

## 7. Units and totals

**[PDF** p.3 §5.6**]** area arrives in `mm²` or `px²` depending on DICOM pixel spacing; units must not be lost and unlike units must not be summed.

**[VERIFIED]** the unit is an **open string set**, not an enum: `'mm²'` / `'px²'` (with `²` = U+00B2), plus a calibration suffix when present (`'mm² ERMF'`, `'cm² US Region'`). Hence `unit: string` at the protocol boundary.

Totals are therefore grouped by the exact unit string:

```ts
Record<string, number>   // { 'mm²': 212.7, 'px²': 1480 }
```

Values are stored unformatted; formatting is presentation-only. Unit aliases are **not** normalized — `'mm²'` and `'mm² ERMF'` have different provenance, and collapsing them would silently merge unlike measurements. If only one unit is present the UI may show a single total. Evidence: `docs/scoring-form/IMPLEMENTATION_NOTES.md` §6.

## 8. Cleanup and lifecycle

**[PDF** p.3 §5.5**]** requires cleanup **on unmount**: `removeEventListener`, `measurementService` unsubscribes, clearing the armed state.

**Host — applies literally.** React components unmount, so on unmount the host removes its `message` listener, clears the queue, and resets armed/correlation state. No exceptions.

**Viewer — no unmount hook exists.** **[VERIFIED]** `ExtensionManager` exposes only `onModeEnter`/`onModeExit`, and upstream itself subscribes in `preRegistration` and never unsubscribes (`extensions/default/src/init.ts:53-77`). The bridge therefore: captures every `subscribe()` handle and listener in one disposer; runs it on `pagehide`/`beforeunload` and exposes it for explicit invocation; and **guards installation with a module-level flag** so hot reload cannot accumulate duplicate listeners or subscriptions. This is a platform-imposed deviation from the literal wording, documented rather than waved away. Details: `docs/scoring-form/IMPLEMENTATION_NOTES.md` §7.

**[PR 5, merged]** The same disposer also clears any pending settle-and-replace debounce timers (§10.12) and drops their pending snapshots — a `Map<measurementId, timeoutHandle>` cleared alongside the existing subscription handles, not a separate lifecycle mechanism.

## 9. Echo-loop prevention

**[PDF** p.3 §5.4**]** — conditional: *"if you implement star task 5.1"* (live update), ensure host → viewer → host does not ping-pong. The required one-way scope (command → event) cannot loop.

The rule for any two-way feature: **remote events update local state and never trigger an outbound command.** Reducer actions are named by origin — a remote-sourced action is a distinct action type from a local user intent — so "update the row" and "tell the viewer to change" can never be the same code path.

Worked example for a future two-way delete (star task 5.2):

```text
user clicks Delete in host → REMOVE_MEASUREMENT → viewer removes M1
  → OHIF emits MEASUREMENT_REMOVED → viewer sends MEASUREMENT_REMOVED
  → host reducer clears the row and STOPS. It must not re-send REMOVE_MEASUREMENT.
```

## 10. Accepted Decisions

*Required section per **[PDF** p.4 §7.2**]**.*

### 10.1 Who issues which ID

The host issues `rowId` and `activationId`; OHIF issues `measurementId` (the annotation UID); the correlation `rowId ↔ measurementId` is established once at `MEASUREMENT_COMPLETED` and stored on both sides (§4) — not at this protocol's own `MEASUREMENT_ADDED`, which is sent later, after the value settles, and reuses the already-established correlation rather than creating it. **Rationale:** each side owns the identity of the entity it owns, so neither has to invent or guess a foreign ID; and `activationId` makes stale-event rejection a comparison rather than a guess. **If flipped** — host-issued measurement IDs — the bridge would have to map a host ID onto a Cornerstone annotation UID it does not control, and every OHIF-originated event (toolbar-drawn, deleted, restored annotations) would need a reverse lookup that can miss. That is the failure mode this split avoids.

### 10.2 How the handshake works

`VIEWER_READY` is emitted once, from the bridge, only when a viewport and tool group can actually accept a drawing command — not merely when the extension module executed. The host installs its listener before assigning the iframe `src`, so the one-shot message cannot be missed (§6).

### 10.3 What happens to commands that arrive too early

They are queued, not dropped. An in-memory FIFO holds outbound commands until `VIEWER_READY`, then flushes in order. Because activation is exclusive, the host's reducer still emits coherent transitions while queued: switching from row A to row B before readiness cancels A explicitly rather than leaving both `drawing`. Canceling a still-queued `ACTIVATE_TOOL` removes it from the FIFO outright — no `DEACTIVATE_TOOL` is queued or sent for it, since the viewer never saw the activation it would be undoing (§6).

### 10.4 How the echo loop is avoided

Remote events only ever update local state; outbound commands originate only from explicit local user intent. Reducer actions are separated by origin so the two cannot share a path (§9). For the mandatory scope the traffic is one-way and cannot loop.

### 10.5 One repository rather than two

The host app lives in the OHIF fork under `apps/host-app`, with the contract in `packages/message-contract`. **Rationale:** one clone for the reviewer, the TypeScript contract is physically shared rather than copied, and host+viewer changes land atomically in one PR. **Trade-off:** it enlarges the fork's surface and couples the host's tooling to OHIF's workspace. For a real product with independent release cadences, two repositories plus a published `@company/viewer-contract` package would be preferable. The assignment explicitly permits either, provided the choice is explained **[PDF** p.4 §7.1**]**.

### 10.6 Origin validation — required vs. added

**[PDF** p.3 §5.2**]** requires **`event.origin`** checks on both sides; a hardcoded origin in config is acceptable, absence is not. We implement that, and **[OURS]** additionally check `event.source`:

| Side | Required **[PDF]** | Added **[OURS]** | Send |
|---|---|---|---|
| Host | `event.origin === VIEWER_ORIGIN` | `event.source === iframe.contentWindow` | `iframe.contentWindow.postMessage(msg, VIEWER_ORIGIN)` |
| Viewer | `event.origin === HOST_ORIGIN` | `event.source === window.parent` | `window.parent.postMessage(msg, HOST_ORIGIN)` |

`targetOrigin` is never `'*'`. The `event.source` check is what makes two simultaneously open host tabs safe: both tabs share an origin, so origin alone cannot distinguish them, but each window pair is distinct. In production these origins come from runtime configuration rather than constants.

### 10.7 Tool restored after a measurement

`WindowLevel`, the verified baseline default — satisfying the assignment's "Pan/default" through the *default* option (§6).

### 10.8 Form state model

React `useReducer`, not Redux or Zustand. One page, small state, explicit event-driven transitions, and stale-event handling that is easy to read and to explain live. Rows move `waiting → drawing → processing → ready`; actions are explicit (`ADD_ROW`, `ACTIVATE_REQUESTED`, `ACTIVATION_QUEUED`, `ACTIVATION_CANCELLED`, `MEASUREMENT_COMPLETED`, `MEASUREMENT_ADDED`, `MEASUREMENT_FAILED`, …) rather than scattered booleans.

**[PR 5, merged]** extends the earlier `waiting → drawing → ready` model to `waiting → drawing → processing → ready`, with `processing → waiting` on a reported failure — the same "return to waiting with a surfaced reason, never a separate terminal `failed` status" pattern already used for `ACTIVATION_FAILED` in PR 4. `processing` is entered on `MEASUREMENT_COMPLETED` and left on `MEASUREMENT_ADDED` (→ `ready`) or `MEASUREMENT_FAILED` (→ `waiting`). Details: §10.12. See `apps/host-app/src/form/rowsReducer.ts`.

### 10.9 Why `postMessage`

It is the mechanism for cross-origin parent/iframe communication, needs no backend, and makes the trust boundary explicit via `targetOrigin` plus origin checks. Same-origin would technically allow direct object access, but that couples two independently developed apps to each other's internals — a message contract stays worthwhile even then. `BroadcastChannel` suits same-origin tab fan-out rather than targeted parent↔child request/response; a WebSocket or backend adds infrastructure for two contexts on one client; Module Federation solves code composition, not this runtime integration.

### 10.9a `esbuild` build script and the `vite>rollup` override — closed in PR 2

`allowBuilds: { esbuild: true }` was required: without it `pnpm install --no-frozen-lockfile` fails with `ERR_PNPM_IGNORED_BUILDS`, because Vite depends on esbuild's postinstall to fetch its platform binary.

A second, unanticipated issue surfaced only once the host app's dev server was actually started: the workspace's blanket `rollup: 2.80.0` override (synced from upstream OHIF, `pnpm-workspace.yaml`) is older than what Vite 5's bundled Rollup requires — it lacks the `./parseAst` subpath export, so `vite` crashed on boot with `ERR_PACKAGE_PATH_NOT_EXPORTED`. **Rationale for the fix:** rather than bump the shared `rollup` override (which upstream OHIF's own tooling may depend on staying at `2.80.0`), a more specific selector override, `'vite>rollup': 4.24.0`, was added alongside it — pnpm applies the most specific matching override, so this only changes the Rollup that Vite itself resolves, leaving every other consumer of the shared pin untouched. Verified: host dev server boots and serves `200` on `:5173`; `pnpm run build` (the viewer) still succeeds unaffected.

### 10.10 Readiness fallback for an unavailable study — accepted MVP scope, PR 3

Closes `docs/scoring-form/IMPLEMENTATION_NOTES.md` §10 item 4 for the mandatory MVP scope, browser-verified: with an invalid `StudyInstanceUID`, OHIF's hanging protocol never matches any display sets, `VIEWPORTS_READY` never fires (§6), so the bridge never sends `VIEWER_READY` and the host correctly stays "not ready" indefinitely. OHIF renders its own error state inside the iframe, visible to the user directly. **Accepted:** no diagnostic timeout, no new failure/error message type, no contract change. **Rationale:** the assignment's mandatory scope does not require the host to distinguish "still loading" from "failed" — OHIF's own error UI already communicates the failure to whoever is looking at the iframe, and inventing a host-side timeout would guess at a threshold with no evidence for what's correct, or a new message type would be a real contract change made without the assignment requiring it. **Trade-off, left open:** if the host UI genuinely needs to detect and surface this itself (not just rely on the visible OHIF error), a future PR would need either a bounded host-side timeout or a viewer-emitted failure message — deliberately not built now.

### 10.11 Activation API and failure reporting — closed, PR 4

**Activation API:** `commandsManager.runCommand('setToolActiveToolbar', { toolName: 'EllipticalROI' }, 'CORNERSTONE')` (`extensions/cornerstone/src/commandsModule.ts:1198-1207`), not `toolbarService.recordInteraction`. **Rationale:** it is the `commandsManager` path, matching the API the assignment names, and it already fans the activation out over tool groups and keeps the toolbar highlight in sync — `recordInteraction` adds no capability the bridge needs beyond that. **Verification is mandatory regardless of API choice:** the bridge reads back `toolGroup.getActivePrimaryMouseButtonTool()` on the `'default'` tool group after calling it and treats a mismatch as failure (§6).

**Failure reporting:** a new message, `ACTIVATION_FAILED { rowId, activationId, reason }`, viewer → host (§5). Sent when the activation call throws/rejects, or when the read-back check fails; in both cases the row is never armed (§6). **Rationale:** silently leaving the row `waiting` gives the user no signal that anything happened; a retry-on-next-`VIEWPORTS_READY` policy doesn't apply here since the viewer is already ready when activation is attempted — the failure is about the tool/toolGroup, not viewer readiness. A dedicated message keeps the failure path explicit and typed, consistent with how every other state transition in this contract is a named message rather than an inferred timeout. The host applies the same stale-event rule as every other correlated message (§10.1/§10.4): an `ACTIVATION_FAILED` whose `activationId` no longer matches the row's current activation is dropped.

The restore target after activation ends is the fixed `WindowLevel` constant, never a captured previous tool — already decided in §10.7; this section adds no separate decision on that point.

### 10.12 `cachedStats` finalization timing — closed with runtime evidence, PR 5 (merged)

**Observed evidence** (manual verification, not assumption): `MEASUREMENT_UPDATED` can arrive either before or after `MEASUREMENT_ADDED` for the same annotation. In one recorded case, `MEASUREMENT_ADDED` reported `4214.7176 px²`; `MEASUREMENT_UPDATED` 51 ms later reported `26601.9840 px²`; OHIF's own viewport display showed `26602 px²` — the later event, not the first, matched the final geometry. This confirms `docs/scoring-form/IMPLEMENTATION_NOTES.md` §5.3's certain claim (the `cachedStats` reference keeps mutating after the event fires) and its previously unmeasured consequence: a finite area at `MEASUREMENT_ADDED` is not necessarily the final one.

**Decision — settle-and-replace debounce, 200 ms:** the bridge treats OHIF's own drawing-completion event as the correlation/cleanup trigger only — `rowId ↔ measurementId` correlation, clearing `armed`, and restoring `WindowLevel` all happen immediately at that point, and the bridge sends `MEASUREMENT_COMPLETED` then. The *value* is handled separately: every relevant OHIF `MEASUREMENT_ADDED`/`MEASUREMENT_UPDATED` for that `measurementId` resets a 200 ms timer and replaces a held primitive snapshot (`area`, `areaUnit`) with the latest one. When 200 ms pass with no further relevant event, the bridge sends the final bridge-protocol `MEASUREMENT_ADDED` if the snapshot has a finite area and non-empty unit, otherwise `MEASUREMENT_FAILED { rowId, activationId, reason }`. Timers/snapshots are keyed **per `measurementId`**, independently of the single armed slot — a still-pending debounce for one `measurementId` is unaffected by activating, drawing, or canceling a different row in the meantime (§6 concurrency note).

**Rationale:** decoupling tool/armed cleanup from value forwarding satisfies the assignment's "tool switches off automatically" requirement (§6) without making that cleanup wait on an arbitrary settling window; a short debounce keyed by `measurementId` is the cheapest way to collapse the observed out-of-order/late-arriving updates into a single outbound message without guessing a "final" flag OHIF doesn't provide. **Caveat on correlation itself:** the first internal `MEASUREMENT_ADDED` while a row is armed is treated as completing that intent because it is the next tool-drawn `EllipticalROI` event, not because OHIF tags it with the armed `rowId`/`activationId` — this relies on the exclusive-activation assumption (§6) and is not proven safe against a concurrent, unrelated `EllipticalROI` appearing at the same moment; that race is unevidenced and out of PR 5's scope, not claimed to be handled.

**Explicitly not a guarantee.** 200 ms is an MVP heuristic picked from one observed 51 ms gap plus margin, not a proven bound — Cornerstone's `_throttledCalculateCachedStats` is 100 ms trailing (`IMPLEMENTATION_NOTES.md` §5.3), so 200 ms covers one throttle cycle with margin, but nothing in the source guarantees an upper bound on how long updates can keep arriving. **Accepted limitation:** an `MEASUREMENT_UPDATED` arriving after the window has already closed and the bridge message has already been sent is **not** forwarded in PR 5 — the row stays `ready` with a possibly-stale value. Live re-sync of an already-`ready` row is star-task territory (§11), deliberately out of scope here.

**Rejected alternatives** (from `IMPLEMENTATION_NOTES.md` §5.3's candidate table): sending the raw `MEASUREMENT_ADDED` value immediately — rejected, directly contradicted by the observed evidence above; waiting for exactly one `MEASUREMENT_UPDATED` before ever sending — rejected, fails whenever no update event arrives (the common case for a slow, deliberate draw per the same evidence); re-reading `cachedStats` on the next animation frame — rejected, relies on frame timing rather than the event stream, and doesn't handle the 51 ms case either given the throttle can exceed one frame.

### 10.13 Manual toolbar switching invalidates the armed intent — closed with a browser-verified bug, PR 5

**[VERIFIED bug]** Browser-reproduced: Activate a row (armed for `EllipticalROI`) → manually select a different primary tool from OHIF's own toolbar → manually select `EllipticalROI` again and draw → the drawn annotation was incorrectly attributed to the original row, because nothing had told the bridge the armed intent was no longer valid once the user switched away. This is the sequential, non-concurrent instance of the "not proven safe against ... a concurrent, unrelated `EllipticalROI`" caveat in §10.12 above — it narrows that caveat but does not fully close it (see remaining gap below).

**Decision:** subscribe to `toolGroupService.EVENTS.PRIMARY_TOOL_ACTIVATED` (`extensions/cornerstone/src/services/ToolGroupService/ToolGroupService.ts:510-527`) — the same tool group service already used for `getToolGroup`/read-back — filtered to the `'default'` tool group. When it fires with `toolName !== 'EllipticalROI'` while a row is armed: capture `{ rowId, activationId }`, clear `armed` immediately (before anything else), and send a **new** message, `ACTIVATION_CANCELLED { rowId, activationId, reason }` (§5 table). Deliberately does **not** call `restoreDefaultTool()` — the user already chose a tool, and forcing `WindowLevel` back would fight that choice — and does **not** touch `pendingResults`, which is keyed independently per `measurementId` and unrelated to the single armed slot (§6 concurrency note).

**Why a new message, not `ACTIVATION_FAILED`:** `ACTIVATION_FAILED`'s documented scope (§5 table, §10.11) is the *synchronous* `ACTIVATE_TOOL` handling window — the call threw, or the read-back mismatched, right after activation. This case is temporally and causally different: activation **succeeded**, the row was correctly armed, and it was invalidated *later* by an unrelated, external action. Reusing `ACTIVATION_FAILED` would blur that distinction for anyone debugging from the wire log. `MEASUREMENT_FAILED` doesn't fit either — its trigger is the settle debounce concluding badly *after* a measurement already exists (row `processing`); here no measurement exists yet (row is still `drawing`).

**Why no "who triggered this" flag is needed:** every existing tool-changing call site (`handleDeactivateTool`, `handleInternalMeasurementAdded`, `dispose`) already clears `armed = null` *before* changing the tool. Because `PRIMARY_TOOL_ACTIVATED` dispatch is synchronous, a bridge-initiated change is guaranteed to observe `armed === null` by the time the new handler's `if (!armed) return;` guard runs — self-triggered restorations are excluded by this existing invariant, not by a new sentinel.

**No echo loop:** the host's reducer handles `ACTIVATION_CANCELLED` as a purely local state update (`drawing → waiting`, reason shown) and never sends anything back to the viewer — mirrors the §9 rule and is kept as its own reducer action, distinct from the host-user-initiated `CANCEL_REQUESTED` (Escape/Cancel button, which *does* send `DEACTIVATE_TOOL`).

**Remaining gap, not solved here:** this detects the tool group's active tool changing, not a *concurrent* unrelated `EllipticalROI` created via some other path while the original stays armed and no tool-switch event ever fires — that race (already flagged as unevidenced in §10.12) is unaffected by this fix. Also unaddressed: a manual tool switch *mid-drag* (before mouse-up) rather than between arming and drawing — Cornerstone's behavior for that exact sequence was not verified.

## 11. Known limitations and open items

Recorded honestly rather than hidden. Each is tracked with its target PR in `docs/scoring-form/IMPLEMENTATION_NOTES.md` §10, and each must become a decision in §10 above before submission.

| **[OPEN]** item | Target PR |
|---|---|
| ~~`cachedStats` timing — whether the area is final at `MEASUREMENT_ADDED`, or `null`/stale for a fast draw.~~ Closed with runtime evidence: settle-and-replace 200 ms debounce (§10.12). | PR 5 (closed, merged) |
| An `MEASUREMENT_UPDATED` arriving after the 200 ms settle window has already closed and the final message already sent is not forwarded — the row can display a stale value with no further correction in PR 5. | PR 5 (accepted MVP limitation, §10.12) |
| ~~Activation API — the `commandsManager` path the assignment names vs. `toolbarService.recordInteraction`.~~ Closed: `setToolActiveToolbar` with mandatory read-back (§10.11). | PR 4 (closed) |
| ~~How an activation failure is reported to the host.~~ Closed: new `ACTIVATION_FAILED { rowId, activationId, reason }` message (§5, §10.11). | PR 4 (closed) |
| ~~Readiness fallback when the study or hanging protocol fails~~ — accepted for MVP as "no fallback, rely on OHIF's own error UI" (§10.10). Left open only if the host later needs to detect this itself. | PR 3 (closed for MVP) |
| ~~Manual toolbar switching while a row is armed could let a later, manually-drawn `EllipticalROI` be misattributed to the original row.~~ Closed: `PRIMARY_TOOL_ACTIVATED` subscription invalidates the armed intent immediately, `ACTIVATION_CANCELLED` message (§10.13). | PR 5 (closed) |
| A *concurrent* unrelated `EllipticalROI` created via some other path while the original stays armed, with no tool-switch event ever firing, is still unevidenced and unhandled (§10.12, §10.13). | Not scheduled — documented limitation |
| Contract test location — `packages/*` sits outside the root Jest project globs. **[PR 6, implemented]** added totals tests in `apps/host-app` via Node's built-in test runner (`node --test`), not Jest — this item itself, about `packages/message-contract`, was not addressed and remains open. | Not scheduled — documented limitation |
| A reload/navigation of the iframe not initiated by the host (manual reload, or an internal OHIF full-page navigation) cannot be reliably detected by the parent — no cross-origin "navigation started" signal exists, and `onLoad` cannot substitute (§6). Self-heals once a new `VIEWER_READY` arrives; no polling/state machine/new message type added. | Not scheduled — documented limitation |

Accepted scope limits: one host page with one viewer iframe (multiple iframes would need a channel ID in the envelope); no acknowledgements, retries or idempotency keys; no state persistence across reload unless star task 5.6 is done; `MEASUREMENT_UPDATED` is delivered unthrottled on the assumption that a tiny form can absorb drag-rate updates — to be revisited if measured otherwise.

## 12. Further reading

| Document | Purpose |
|---|---|
| `docs/scoring-form/README.md` | How to run both applications; current status of each step |
| `docs/scoring-form/IMPLEMENTATION_NOTES.md` | Verified OHIF source findings with `file:line`, evidence, open items |
| `TASK.md` | Requirements extracted from `ASSIGNMENT.pdf`, with page references |
| `IMPLEMENTATION_PLAN.md` | PR-by-PR plan and acceptance criteria |
| `AI-USAGE.md` | How AI was used |