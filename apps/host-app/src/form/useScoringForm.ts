import { useCallback, useEffect, useLayoutEffect, useReducer, useRef } from 'react';
import {
  MESSAGE_TYPE,
  PROTOCOL_NAME,
  PROTOCOL_VERSION,
  type ActivateToolMessage,
  type DeactivateToolMessage,
} from '@scoring-form/message-contract';

import type { ViewerBridge } from '../bridge/useViewerBridge';
import { rowsReducer, type RowsState } from './rowsReducer';

const TOOL_NAME = 'EllipticalROI';

type ActiveActivation = { rowId: string; activationId: string };

function createActivateMessage(rowId: string, activationId: string): ActivateToolMessage {
  return {
    protocol: PROTOCOL_NAME,
    version: PROTOCOL_VERSION,
    sender: 'host',
    type: MESSAGE_TYPE.ACTIVATE_TOOL,
    messageId: crypto.randomUUID(),
    sentAt: Date.now(),
    payload: { rowId, activationId, toolName: TOOL_NAME },
  };
}

function createDeactivateMessage(rowId: string, activationId: string): DeactivateToolMessage {
  return {
    protocol: PROTOCOL_NAME,
    version: PROTOCOL_VERSION,
    sender: 'host',
    type: MESSAGE_TYPE.DEACTIVATE_TOOL,
    messageId: crypto.randomUUID(),
    sentAt: Date.now(),
    payload: { rowId, activationId },
  };
}

/**
 * Row model + host -> viewer command dispatch (ARCHITECTURE.md §10.8).
 * `activeRef` tracks the single row allowed to be pending/armed at a time
 * (exclusive activation, §6): activating a different row cancels it first.
 */
export function useScoringForm(bridge: ViewerBridge) {
  const [rows, dispatch] = useReducer(rowsReducer, [] as RowsState);
  const activeRef = useRef<ActiveActivation | null>(null);

  // Destructured rather than closing over `bridge` itself: `useViewerBridge`
  // returns a fresh object every render, but these specific functions are
  // individually stable (each is its own `useCallback` with a fixed
  // dependency). Depending on the whole object would make `cancel`/`activate`
  // change identity every render too, which would in turn re-fire the
  // mount/unmount effect below on every render instead of only on unmount.
  const { sendCommand, cancelQueuedActivation } = bridge;

  const cancel = useCallback(
    (rowId: string) => {
      const active = activeRef.current;
      if (!active || active.rowId !== rowId) {
        return;
      }

      const wasStillQueued = cancelQueuedActivation(rowId);
      if (!wasStillQueued) {
        sendCommand(createDeactivateMessage(rowId, active.activationId));
      }

      activeRef.current = null;
      dispatch({ type: 'CANCEL_REQUESTED', rowId });
    },
    [cancelQueuedActivation, sendCommand]
  );

  const activate = useCallback(
    (rowId: string) => {
      const active = activeRef.current;
      if (active?.rowId === rowId) {
        // Already the pending/armed row for this activation attempt — a
        // repeated Activate press on the same row is a no-op, not a
        // re-arm with a fresh activationId.
        return;
      }
      if (active) {
        cancel(active.rowId);
      }

      const activationId = crypto.randomUUID();
      activeRef.current = { rowId, activationId };
      dispatch({ type: 'ACTIVATE_REQUESTED', rowId, activationId });
      sendCommand(createActivateMessage(rowId, activationId));
    },
    [cancel, sendCommand]
  );

  const addRow = useCallback(() => {
    dispatch({ type: 'ADD_ROW', rowId: crypto.randomUUID() });
  }, []);

  useEffect(() => {
    const failure = bridge.activationFailed;
    if (!failure) {
      return;
    }

    if (
      activeRef.current?.rowId === failure.rowId &&
      activeRef.current.activationId === failure.activationId
    ) {
      activeRef.current = null;
    }

    dispatch({
      type: 'ACTIVATION_FAILED',
      rowId: failure.rowId,
      activationId: failure.activationId,
      reason: failure.reason,
    });
  }, [bridge.activationFailed]);

  // Cancels any pending/armed drawing intent on unmount, mirroring the
  // viewer's own dispose-time cleanup (extensions/scoring-form-bridge) —
  // ARCHITECTURE.md §8. `cancel` is stable (see above), so this only runs
  // its cleanup on a real unmount, not on every render.
  //
  // `useLayoutEffect`, not `useEffect`: `cancel` -> `sendCommand` ->
  // `postToViewer` reads `iframeRef.current` at call time, and React nulls
  // refs to removed DOM nodes during the synchronous commit/mutation phase,
  // before any `useEffect` cleanup runs (those are deferred passive
  // effects). By the time a `useEffect` cleanup fired here, `iframeRef`
  // would already be null and the `DEACTIVATE_TOOL` would be silently
  // dropped. A layout effect's cleanup runs synchronously in that same
  // commit, before descendant refs are cleared, so `iframeRef.current` is
  // still valid when this fires. This does not help if the iframe itself is
  // being torn down in the very same unmount (its browsing context is
  // discarded regardless of when we read the ref) — that case is not
  // fixable from the host side and is not currently reachable anyway, since
  // the iframe and the scoring form always mount/unmount together in
  // `App.tsx`.
  useLayoutEffect(() => {
    return () => {
      if (activeRef.current) {
        cancel(activeRef.current.rowId);
      }
    };
  }, [cancel]);

  return { rows, addRow, activate, cancel };
}