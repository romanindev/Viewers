import {
  MESSAGE_TYPE,
  PROTOCOL_NAME,
  PROTOCOL_VERSION,
  isBridgeMessageFromSender,
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

type SubscriptionHandle = { unsubscribe: () => void };

type ViewportGridServiceLike = {
  EVENTS: { VIEWPORTS_READY: string };
  subscribe: (eventName: string, callback: () => void) => SubscriptionHandle;
};

type ToolGroupLike = {
  hasTool: (toolName: string) => boolean;
};

type ToolGroupServiceLike = {
  getToolGroup: (toolGroupId: string) => ToolGroupLike | undefined;
};

type BridgeServices = {
  viewportGridService: ViewportGridServiceLike;
  toolGroupService: ToolGroupServiceLike;
};

type PreRegistrationParams = {
  servicesManager: {
    services: BridgeServices;
  };
};

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

function preRegistration({ servicesManager }: PreRegistrationParams): void {
  if (installed) {
    // eslint-disable-next-line no-console
    console.warn('[scoring-form-bridge] preRegistration called while already installed; skipping');
    return;
  }
  installed = true;

  const viewerInstanceId = crypto.randomUUID();
  let readyEmitted = false;

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

    // ACTIVATE_TOOL / DEACTIVATE_TOOL handling lands in PR 4 — for now the
    // bridge only validates and logs a correctly-shaped host message.
    // eslint-disable-next-line no-console
    console.info(
      '[scoring-form-bridge] discarded valid host message (handling lands in a later PR)',
      event.data
    );
  };

  window.addEventListener('message', handleMessage);

  const { viewportGridService, toolGroupService } = servicesManager.services;
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
    installed = false;
    readyEmitted = false;
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