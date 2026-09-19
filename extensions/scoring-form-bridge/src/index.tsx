import {
  MESSAGE_TYPE,
  PROTOCOL_NAME,
  PROTOCOL_VERSION,
  isBridgeMessageFromSender,
  type ActivationCancelledMessage,
  type ActivationFailedMessage,
  type BridgeMeasurementValue,
  type MeasurementAddedMessage,
  type MeasurementCompletedMessage,
  type MeasurementFailedMessage,
  type ViewerReadyMessage,
} from '@scoring-form/message-contract';

import { id } from './id';

// [OURS] Dev-only constant. In production this origin comes from runtime
// configuration, not a hardcoded value — see ARCHITECTURE.md §10.6. Mirrors
// the default in apps/host-app/src/config.ts (HOST_ORIGIN).
const HOST_ORIGIN = 'http://localhost:5173';

// [VERIFIED] modes/basic/src/initToolGroups.ts:312 — the default tool
// group's id is the literal string 'default'.
const TOOL_GROUP_ID = 'default';
const REQUIRED_TOOL_NAME = 'EllipticalROI';
// [VERIFIED] modes/basic/src/initToolGroups.ts:20-37 — the baseline default
// primary tool. Fixed restore target, never a captured previous tool —
// ARCHITECTURE.md §6, §10.7.
const DEFAULT_TOOL_NAME = 'WindowLevel';
// [VERIFIED] extensions/cornerstone/src/enums.ts:1 — the source name OHIF's
// measurementService attaches to tool-drawn (not toolbar/API-inserted)
// measurements. ARCHITECTURE.md §5 structure notes.
const CORNERSTONE_3D_TOOLS_SOURCE_NAME = 'Cornerstone3DTools';
// [OURS] Settle-and-replace debounce, ARCHITECTURE.md §10.12 — MVP
// heuristic, not a finality guarantee. See that section for rationale and
// the accepted late-update limitation.
const SETTLE_DEBOUNCE_MS = 200;

type SubscriptionHandle = { unsubscribe: () => void };

type ViewportGridServiceLike = {
  EVENTS: { VIEWPORTS_READY: string };
  subscribe: (eventName: string, callback: () => void) => SubscriptionHandle;
};

type ToolGroupLike = {
  hasTool: (toolName: string) => boolean;
  getActivePrimaryMouseButtonTool: () => string | undefined;
};

// [VERIFIED] extensions/cornerstone/src/services/ToolGroupService/ToolGroupService.ts:510-527 —
// `_onToolActivated` broadcasts this only when the newly active tool has a
// `MouseBindings.Primary` binding; payload mirrors the underlying
// cornerstone-tools `TOOL_ACTIVATED` detail
// (node_modules/@cornerstonejs/tools/dist/esm/store/ToolGroupManager/ToolGroup.js:217-222).
type PrimaryToolActivatedEvent = { toolGroupId?: string; toolName?: string };

type ToolGroupServiceLike = {
  getToolGroup: (toolGroupId: string) => ToolGroupLike | undefined;
  EVENTS: { PRIMARY_TOOL_ACTIVATED: string };
  subscribe: (
    eventName: string,
    callback: (event: PrimaryToolActivatedEvent) => void
  ) => SubscriptionHandle;
};

type CommandsManagerLike = {
  runCommand: (commandName: string, options?: Record<string, unknown>, context?: string) => unknown;
};

// [VERIFIED] extensions/cornerstone/src/utils/measurementServiceMappings/EllipticalROI.ts:61-81 —
// no top-level `area`; `data` is `annotation.data.cachedStats` keyed by an
// opaque Cornerstone targetId, `uid` is the annotationUID.
type OhifMeasurementLike = {
  uid?: unknown;
  toolName?: unknown;
  data?: Record<string, { area?: unknown; areaUnit?: unknown }>;
};

type MeasurementServiceEvent = {
  source?: { name?: string };
  measurement?: OhifMeasurementLike;
};

type MeasurementServiceLike = {
  EVENTS: { MEASUREMENT_ADDED: string; MEASUREMENT_UPDATED: string };
  subscribe: (
    eventName: string,
    callback: (event: MeasurementServiceEvent) => void
  ) => SubscriptionHandle;
};

type BridgeServices = {
  viewportGridService: ViewportGridServiceLike;
  toolGroupService: ToolGroupServiceLike;
  measurementService: MeasurementServiceLike;
};

type PreRegistrationParams = {
  servicesManager: {
    services: BridgeServices;
  };
  commandsManager: CommandsManagerLike;
};

type ArmedActivation = { rowId: string; activationId: string };

// ARCHITECTURE.md §10.12 — a pending result is keyed by `measurementId`,
// independent of the single armed slot: it survives a different row being
// activated, drawn, or canceled while this one settles.
type PendingResult = {
  rowId: string;
  activationId: string;
  area: number | null;
  areaUnit: string | null;
  timeoutHandle: ReturnType<typeof setTimeout>;
};

type AreaSnapshot = { area: number | null; areaUnit: string | null };

// [OURS] docs/scoring-form/IMPLEMENTATION_NOTES.md §5.4 adapter contract —
// copy primitives out immediately, never forward the live `cachedStats`
// reference. Non-finite area or a missing/empty unit both come back `null`.
function extractAreaSnapshot(measurement: OhifMeasurementLike | undefined): AreaSnapshot {
  const firstTarget = measurement?.data ? Object.values(measurement.data)[0] : undefined;
  const area = firstTarget?.area;
  const areaUnit = firstTarget?.areaUnit;

  return {
    area: typeof area === 'number' && Number.isFinite(area) ? area : null,
    areaUnit: typeof areaUnit === 'string' && areaUnit.length > 0 ? areaUnit : null,
  };
}

//  Guards against duplicate installation if this module is re-executed by dev
// server HMR. Cleared by the disposer, so a later re-registration after an
// explicit dispose can install again — see ARCHITECTURE.md §8.
let installed = false;
let disposeBridge: (() => void) | null = null;

/**
 * Read-only check that the default tool group exists and has the required
 * tool registered — the same gate `setToolActive` silently relies on
 * (extensions/cornerstone/src/commandsModule.ts:1214-1228). Never activates
 * anything.
 *
 * Does NOT re-check viewport/content readiness: this is only ever called
 * from the `VIEWPORTS_READY` handler below, and that event's own publisher
 * (platform/app/src/components/ViewportGrid.tsx:143-150) already gates on
 * `getGridViewportsReady()` — a ready, content-bearing viewport is
 * guaranteed to exist at the moment the event fires. Re-reading viewport
 * readiness here via `viewportGridService.getState()` was found to return a
 * stale value: `_getState` is rebound by a `useEffect` in
 * `ViewportGridProvider` (platform/ui-next/src/contextProviders/ViewportGridProvider.tsx:493-509),
 * a *parent* of the component that publishes the event
 * (platform/app/src/components/ViewportGrid.tsx:143-150); React runs child
 * effects before parent effects in the same commit, so a synchronous read
 * inside our event handler observed the previous render's `isReady` — always
 * `false` — even though the event's own (correct) gate had just verified it
 * `true`. Trusting the event for viewport readiness avoids that race.
 */
function isViewerUsable(toolGroupService: ToolGroupServiceLike): boolean {
  const toolGroup = toolGroupService.getToolGroup(TOOL_GROUP_ID);
  if (!toolGroup) {
    return false;
  }

  return toolGroup.hasTool(REQUIRED_TOOL_NAME);
}

function createViewerReadyMessage(viewerInstanceId: string): ViewerReadyMessage {
  return {
    protocol: PROTOCOL_NAME,
    version: PROTOCOL_VERSION,
    sender: 'viewer',
    type: MESSAGE_TYPE.VIEWER_READY,
    messageId: crypto.randomUUID(),
    sentAt: Date.now(),
    payload: { viewerInstanceId },
  };
}

function createActivationFailedMessage(
  rowId: string,
  activationId: string,
  reason: string
): ActivationFailedMessage {
  return {
    protocol: PROTOCOL_NAME,
    version: PROTOCOL_VERSION,
    sender: 'viewer',
    type: MESSAGE_TYPE.ACTIVATION_FAILED,
    messageId: crypto.randomUUID(),
    sentAt: Date.now(),
    payload: { rowId, activationId, reason },
  };
}

function createMeasurementCompletedMessage(
  rowId: string,
  activationId: string,
  measurementId: string
): MeasurementCompletedMessage {
  return {
    protocol: PROTOCOL_NAME,
    version: PROTOCOL_VERSION,
    sender: 'viewer',
    type: MESSAGE_TYPE.MEASUREMENT_COMPLETED,
    messageId: crypto.randomUUID(),
    sentAt: Date.now(),
    payload: { rowId, activationId, measurementId },
  };
}

function createMeasurementAddedMessage(
  rowId: string,
  activationId: string,
  measurementId: string,
  measurement: BridgeMeasurementValue
): MeasurementAddedMessage {
  return {
    protocol: PROTOCOL_NAME,
    version: PROTOCOL_VERSION,
    sender: 'viewer',
    type: MESSAGE_TYPE.MEASUREMENT_ADDED,
    messageId: crypto.randomUUID(),
    sentAt: Date.now(),
    payload: { rowId, activationId, measurementId, toolName: REQUIRED_TOOL_NAME, measurement },
  };
}

function createMeasurementFailedMessage(
  rowId: string,
  activationId: string,
  reason: string
): MeasurementFailedMessage {
  return {
    protocol: PROTOCOL_NAME,
    version: PROTOCOL_VERSION,
    sender: 'viewer',
    type: MESSAGE_TYPE.MEASUREMENT_FAILED,
    messageId: crypto.randomUUID(),
    sentAt: Date.now(),
    payload: { rowId, activationId, reason },
  };
}

function createActivationCancelledMessage(
  rowId: string,
  activationId: string,
  reason: string
): ActivationCancelledMessage {
  return {
    protocol: PROTOCOL_NAME,
    version: PROTOCOL_VERSION,
    sender: 'viewer',
    type: MESSAGE_TYPE.ACTIVATION_CANCELLED,
    messageId: crypto.randomUUID(),
    sentAt: Date.now(),
    payload: { rowId, activationId, reason },
  };
}

function preRegistration({ servicesManager, commandsManager }: PreRegistrationParams): void {
  if (installed) {
    // eslint-disable-next-line no-console
    console.warn('[scoring-form-bridge] preRegistration called while already installed; skipping');
    return;
  }
  installed = true;

  const viewerInstanceId = crypto.randomUUID();
  let readyEmitted = false;
  let armed: ArmedActivation | null = null;
  // measurementId -> pending result, ARCHITECTURE.md §10.12. Independent of
  // `armed`: a row can be `processing` here while a different row is armed.
  const pendingResults = new Map<string, PendingResult>();

  const { viewportGridService, toolGroupService, measurementService } = servicesManager.services;

  const postToHost = (
    message:
      | ActivationFailedMessage
      | MeasurementCompletedMessage
      | MeasurementAddedMessage
      | MeasurementFailedMessage
      | ActivationCancelledMessage
  ) => {
    window.parent.postMessage(message, HOST_ORIGIN);
  };

  // Restores the fixed default tool — never a captured previous tool
  // (ARCHITECTURE.md §6, §10.7) — after a drawing intent ends, whether by
  // cancellation, a failed activation, or (in a later PR) a completed
  // measurement. Errors here are logged, not thrown: a cleanup failure must
  // never mask the original failure reason reported to the host.
  const restoreDefaultTool = () => {
    try {
      commandsManager.runCommand(
        'setToolActiveToolbar',
        { toolName: DEFAULT_TOOL_NAME },
        'CORNERSTONE'
      );
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[scoring-form-bridge] failed to restore default tool during cleanup', error);
    }
  };

  // Activates EllipticalROI via the toolbar-aware command (decided,
  // ARCHITECTURE.md §10.11), then reads back the tool group's active
  // primary tool — `setToolActive` fails silently on three separate guards
  // (docs/scoring-form/IMPLEMENTATION_NOTES.md §3.2), so a completed call
  // proves nothing on its own. Arms only once the read-back confirms
  // success; otherwise restores the default tool and reports
  // ACTIVATION_FAILED, and never arms the row.
  const handleActivateTool = (rowId: string, activationId: string) => {
    let failureReason: string | null = null;

    try {
      commandsManager.runCommand(
        'setToolActiveToolbar',
        { toolName: REQUIRED_TOOL_NAME },
        'CORNERSTONE'
      );

      const toolGroup = toolGroupService.getToolGroup(TOOL_GROUP_ID);
      const activeToolName = toolGroup?.getActivePrimaryMouseButtonTool();

      if (activeToolName !== REQUIRED_TOOL_NAME) {
        failureReason = `Activation read-back mismatch: expected ${REQUIRED_TOOL_NAME}, got ${activeToolName ?? 'none'}`;
      }
    } catch (error) {
      failureReason = error instanceof Error ? error.message : 'Unknown activation error';
    }

    if (failureReason === null) {
      armed = { rowId, activationId };
      return;
    }

    // Best-effort: whatever state the failed activation left the tool group
    // in, try to fall back to the default tool rather than leaving
    // EllipticalROI (or nothing) active. A cleanup error is logged and does
    // not change `failureReason` reported below.
    restoreDefaultTool();
    postToHost(createActivationFailedMessage(rowId, activationId, failureReason));
  };

  // Cancels the in-progress manipulation and restores the default tool.
  // `cancelMeasurement` is not guarded by the platform the way
  // `setToolActiveToolbar` is, so it can throw; if it does, the `finally`
  // still restores WindowLevel rather than leaving EllipticalROI active
  // with no way back to it (a thrown error here must not skip cleanup).
  const cancelArmedManipulation = () => {
    try {
      commandsManager.runCommand('cancelMeasurement', {}, 'CORNERSTONE');
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[scoring-form-bridge] cancelMeasurement threw during deactivation', error);
    } finally {
      restoreDefaultTool();
    }
  };

  const handleDeactivateTool = (rowId: string, activationId: string) => {
    if (!armed || armed.rowId !== rowId || armed.activationId !== activationId) {
      // Stale or already-cleared cancel; nothing armed to tear down.
      return;
    }

    // Clear armed state before cancelMeasurement: EllipticalROITool.cancel()
    // can synchronously fire ANNOTATION_COMPLETED [VERIFIED]
    // (node_modules/@cornerstonejs/tools/dist/esm/tools/annotation/EllipticalROITool.js:332),
    // and MEASUREMENT_ADDED filtering (PR 5) checks `armed` — it must
    // already be cleared by the time that synchronous event is observed.
    armed = null;
    cancelArmedManipulation();
  };

  // Fires for ANY primary-mouse-bound tool becoming active in this tool
  // group — our own `setToolActiveToolbar` calls above included. Every
  // existing call site clears `armed` *before* changing the tool
  // (`handleDeactivateTool` above, `handleInternalMeasurementAdded` and
  // `dispose` below), so by the time a bridge-initiated change reaches
  // here, `armed` is already `null` and the guard below skips it — no "who
  // triggered this" flag needed. What's left through is exactly a manual,
  // external tool change while a row was still armed: the user activated a
  // row, then picked a *different* primary tool from OHIF's own toolbar
  // before drawing anything. That invalidates the armed intent immediately
  // — a later, manually re-selected EllipticalROI draw must not be
  // attributed to it, and `handleInternalMeasurementAdded`'s own `!armed`
  // guard already enforces that once `armed` is cleared here.
  const handlePrimaryToolActivated = ({ toolGroupId, toolName }: PrimaryToolActivatedEvent) => {
    if (toolGroupId !== TOOL_GROUP_ID || !armed || toolName === REQUIRED_TOOL_NAME) {
      return;
    }

    const { rowId, activationId } = armed;
    armed = null;

    // Deliberately no `restoreDefaultTool()` call: the user just chose
    // `toolName` themselves, so forcing WindowLevel back would fight that
    // choice. Deliberately no `pendingResults` interaction either — this
    // only ever invalidates the single armed slot, never an
    // already-correlated, still-settling measurement for a different row.
    postToHost(
      createActivationCancelledMessage(
        rowId,
        activationId,
        `Primary tool manually changed to ${toolName ?? 'unknown'} while armed`
      )
    );
  };

  // Sends the final bridge message for `measurementId` and stops tracking
  // it — settling twice, or after disposal, is impossible once the entry is
  // removed here (§10.12 "prevent duplicate final messages").
  const settlePendingResult = (measurementId: string) => {
    const pending = pendingResults.get(measurementId);
    if (!pending) {
      return;
    }
    pendingResults.delete(measurementId);

    const { rowId, activationId, area, areaUnit } = pending;
    if (area !== null && areaUnit !== null) {
      postToHost(
        createMeasurementAddedMessage(rowId, activationId, measurementId, {
          kind: 'area',
          value: area,
          unit: areaUnit,
        })
      );
      return;
    }

    postToHost(
      createMeasurementFailedMessage(
        rowId,
        activationId,
        `Non-finite area or missing unit after settling (area=${String(area)}, unit=${areaUnit ?? 'none'})`
      )
    );
  };

  // Starts tracking a newly-correlated `measurementId`: one 200 ms debounce
  // (§10.12), independent of the single armed slot.
  const trackPendingResult = (
    measurementId: string,
    rowId: string,
    activationId: string,
    snapshot: AreaSnapshot
  ) => {
    pendingResults.set(measurementId, {
      rowId,
      activationId,
      area: snapshot.area,
      areaUnit: snapshot.areaUnit,
      timeoutHandle: setTimeout(() => settlePendingResult(measurementId), SETTLE_DEBOUNCE_MS),
    });
  };

  // Replaces the held snapshot and resets the debounce — "settle-and-replace".
  const updatePendingResult = (measurementId: string, snapshot: AreaSnapshot) => {
    const pending = pendingResults.get(measurementId);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timeoutHandle);
    pending.area = snapshot.area;
    pending.areaUnit = snapshot.areaUnit;
    pending.timeoutHandle = setTimeout(() => settlePendingResult(measurementId), SETTLE_DEBOUNCE_MS);
  };

  // OHIF's own drawing-completion trigger (viewer-internal
  // `measurementService.EVENTS.MEASUREMENT_ADDED` — not this bridge's
  // outbound `MEASUREMENT_ADDED`, ARCHITECTURE.md §5 naming note). Accepted
  // only for the currently armed `EllipticalROI` intent: correlation is
  // established, `armed` is cleared, and `WindowLevel` is restored here,
  // immediately, independent of whether the area value is usable yet
  // (§10.12; §6 "Returning to the default interaction").
  const handleInternalMeasurementAdded = (event: MeasurementServiceEvent) => {
    const measurement = event.measurement;

    if (
      event.source?.name !== CORNERSTONE_3D_TOOLS_SOURCE_NAME ||
      measurement?.toolName !== REQUIRED_TOOL_NAME
    ) {
      return;
    }

    if (!armed) {
      // Not armed: either a toolbar-drawn annotation with nothing to
      // correlate it to, or the completion event for a manipulation that
      // was just canceled — `handleDeactivateTool` above clears `armed`
      // *before* calling `cancelMeasurement`, precisely so this check sees
      // it already cleared and never fabricates a correlation for a
      // canceled drawing.
      return;
    }

    const measurementId = typeof measurement?.uid === 'string' ? measurement.uid : null;
    if (!measurementId) {
      return;
    }

    const { rowId, activationId } = armed;
    armed = null;
    restoreDefaultTool();
    postToHost(createMeasurementCompletedMessage(rowId, activationId, measurementId));

    trackPendingResult(measurementId, rowId, activationId, extractAreaSnapshot(measurement));
  };

  // Only ever affects a `measurementId` already tracked by the handler
  // above — an unrelated or not-yet-correlated update is ignored, and
  // cannot itself create a correlation (§10.12, "first-event correlation").
  const handleInternalMeasurementUpdated = (event: MeasurementServiceEvent) => {
    const measurement = event.measurement;
    const measurementId = typeof measurement?.uid === 'string' ? measurement.uid : null;

    if (!measurementId || !pendingResults.has(measurementId)) {
      return;
    }

    updatePendingResult(measurementId, extractAreaSnapshot(measurement));
  };

  const handleMessage = (event: MessageEvent) => {
    if (event.origin !== HOST_ORIGIN) {
      // eslint-disable-next-line no-console
      console.warn('[scoring-form-bridge] rejected message: unexpected origin', event.origin);
      return;
    }

    if (event.source !== window.parent) {
      // eslint-disable-next-line no-console
      console.warn('[scoring-form-bridge] rejected message: unexpected source window');
      return;
    }

    if (!isBridgeMessageFromSender(event.data, 'host')) {
      // eslint-disable-next-line no-console
      console.warn('[scoring-form-bridge] rejected message: failed protocol/version/shape guard');
      return;
    }

    const { data } = event;

    if (data.type === MESSAGE_TYPE.ACTIVATE_TOOL) {
      handleActivateTool(data.payload.rowId, data.payload.activationId);
      return;
    }

    if (data.type === MESSAGE_TYPE.DEACTIVATE_TOOL) {
      handleDeactivateTool(data.payload.rowId, data.payload.activationId);
      return;
    }

    // eslint-disable-next-line no-console
    console.info(
      '[scoring-form-bridge] discarded valid host message (handling lands in a later PR)',
      data
    );
  };

  window.addEventListener('message', handleMessage);

  const { unsubscribe } = viewportGridService.subscribe(
    viewportGridService.EVENTS.VIEWPORTS_READY,
    () => {
      if (readyEmitted) {
        return;
      }

      if (!isViewerUsable(toolGroupService)) {
        return;
      }

      readyEmitted = true;
      window.parent.postMessage(createViewerReadyMessage(viewerInstanceId), HOST_ORIGIN);
      // eslint-disable-next-line no-console
      console.info('[scoring-form-bridge] VIEWER_READY sent', viewerInstanceId);
    }
  );

  const { unsubscribe: unsubscribeMeasurementAdded } = measurementService.subscribe(
    measurementService.EVENTS.MEASUREMENT_ADDED,
    handleInternalMeasurementAdded
  );
  const { unsubscribe: unsubscribeMeasurementUpdated } = measurementService.subscribe(
    measurementService.EVENTS.MEASUREMENT_UPDATED,
    handleInternalMeasurementUpdated
  );
  const { unsubscribe: unsubscribePrimaryToolActivated } = toolGroupService.subscribe(
    toolGroupService.EVENTS.PRIMARY_TOOL_ACTIVATED,
    handlePrimaryToolActivated
  );

  const dispose = () => {
    window.removeEventListener('message', handleMessage);
    window.removeEventListener('pagehide', dispose);
    window.removeEventListener('beforeunload', dispose);
    unsubscribe();
    unsubscribeMeasurementAdded();
    unsubscribeMeasurementUpdated();
    unsubscribePrimaryToolActivated();

    // Drop every pending debounce/snapshot — none of them settle after
    // disposal, and none leak a timer.
    pendingResults.forEach(pending => clearTimeout(pending.timeoutHandle));
    pendingResults.clear();

    // On a real page unload this is moot (the tool group is torn down with
    // the page). But `disposeScoringFormBridge` is also exposed for
    // explicit invocation with no navigation involved — e.g. a future
    // mode/extension teardown — and without this, a row left armed would
    // leave EllipticalROI (and any in-progress manipulation) active in the
    // viewport with no way back to it, since `armed` below is cleared
    // without ever telling Cornerstone to stop.
    if (armed) {
      armed = null;
      cancelArmedManipulation();
    }

    installed = false;
    readyEmitted = false;
    armed = null;
    disposeBridge = null;
  };

  window.addEventListener('pagehide', dispose);
  window.addEventListener('beforeunload', dispose);
  disposeBridge = dispose;
}

/**
 * Exposed for explicit invocation — see ARCHITECTURE.md §8. No-op if the
 * bridge was never installed or was already disposed.
 */
function disposeScoringFormBridge(): void {
  disposeBridge?.();
}

const scoringFormBridgeExtension = {
  id,
  preRegistration,
};

export { id, preRegistration, disposeScoringFormBridge };
export default scoringFormBridgeExtension;