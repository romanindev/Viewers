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

  // Viewer-originated: the bridge detected a manual OHIF toolbar switch
  // away from EllipticalROI while this row was armed (ARCHITECTURE.md §6
  // "manual toolbar switching"). The viewer has already torn down its own
  // `armed` state and left the user's newly chosen tool alone — this effect
  // must only update local state, never call `cancel`/`sendCommand`
  // (no `DEACTIVATE_TOOL` echo, §9 echo-loop prevention). Kept as its own
  // reducer action, distinct from the host-initiated `CANCEL_REQUESTED`
  // path `cancel()` above dispatches.
  useEffect(() => {
    const cancelled = bridge.activationCancelled;
    if (!cancelled) {
      return;
    }

    if (
      activeRef.current?.rowId === cancelled.rowId &&
      activeRef.current.activationId === cancelled.activationId
    ) {
      activeRef.current = null;
    }

    dispatch({
      type: 'ACTIVATION_CANCELLED',
      rowId: cancelled.rowId,
      activationId: cancelled.activationId,
      reason: cancelled.reason,
    });
  }, [bridge.activationCancelled]);

  // Drawing ends here, not when the value later settles (ARCHITECTURE.md
  // §6, §10.12): clear the single armed/pending slot now so a different row
  // can be activated immediately, exactly mirroring the viewer clearing its
  // own `armed` at the same instant.
  useEffect(() => {
    const completed = bridge.measurementCompleted;
    if (!completed) {
      return;
    }

    if (
      activeRef.current?.rowId === completed.rowId &&
      activeRef.current.activationId === completed.activationId
    ) {
      activeRef.current = null;
    }

    dispatch({
      type: 'MEASUREMENT_COMPLETED',
      rowId: completed.rowId,
      activationId: completed.activationId,
      measurementId: completed.measurementId,
    });
  }, [bridge.measurementCompleted]);

  // The row is already `processing` (armed slot cleared above) by the time
  // this arrives, so there is nothing to do to `activeRef` here.
  useEffect(() => {
    const added = bridge.measurementAdded;
    if (!added) {
      return;
    }

    dispatch({
      type: 'MEASUREMENT_ADDED',
      rowId: added.rowId,
      activationId: added.activationId,
      measurementId: added.measurementId,
      value: added.measurement.value,
      unit: added.measurement.unit,
    });
  }, [bridge.measurementAdded]);

  useEffect(() => {
    const failed = bridge.measurementFailed;
    if (!failed) {
      return;
    }

    dispatch({
      type: 'MEASUREMENT_FAILED',
      rowId: failed.rowId,
      activationId: failed.activationId,
      reason: failed.reason,
    });
  }, [bridge.measurementFailed]);

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