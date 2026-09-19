import {
  MESSAGE_TYPE,
  PROTOCOL_NAME,
  PROTOCOL_VERSION,
  isBridgeMessageFromSender,
  type ActivationFailedMessage,
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

type SubscriptionHandle = { unsubscribe: () => void };

type ViewportGridServiceLike = {
  EVENTS: { VIEWPORTS_READY: string };
  subscribe: (eventName: string, callback: () => void) => SubscriptionHandle;
};

type ToolGroupLike = {
  hasTool: (toolName: string) => boolean;
  getActivePrimaryMouseButtonTool: () => string | undefined;
};

type ToolGroupServiceLike = {
  getToolGroup: (toolGroupId: string) => ToolGroupLike | undefined;
};

type CommandsManagerLike = {
  runCommand: (commandName: string, options?: Record<string, unknown>, context?: string) => unknown;
};

type BridgeServices = {
  viewportGridService: ViewportGridServiceLike;
  toolGroupService: ToolGroupServiceLike;
};

type PreRegistrationParams = {
  servicesManager: {
    services: BridgeServices;
  };
  commandsManager: CommandsManagerLike;
};

type ArmedActivation = { rowId: string; activationId: string };

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

  const { viewportGridService, toolGroupService } = servicesManager.services;

  const postToHost = (message: ActivationFailedMessage) => {
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

  const dispose = () => {
    window.removeEventListener('message', handleMessage);
    window.removeEventListener('pagehide', dispose);
    window.removeEventListener('beforeunload', dispose);
    unsubscribe();

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