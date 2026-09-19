import { useCallback, useEffect, useRef, useState } from 'react';
import { MESSAGE_TYPE, isBridgeMessageFromSender } from '@scoring-form/message-contract';

import { VIEWER_ORIGIN } from '../config';
import { CommandQueue, type QueuedCommand } from './commandQueue';

export type ViewerReadiness = {
  ready: boolean;
  viewerInstanceId: string | null;
};

export type ActivationFailedEvent = {
  messageId: string;
  rowId: string;
  activationId: string;
  reason: string;
};

export type ViewerBridge = ViewerReadiness & {
  resetForNavigation: () => void;
  sendCommand: (command: QueuedCommand) => void;
  cancelQueuedActivation: (rowId: string) => boolean;
  activationFailed: ActivationFailedEvent | null;
};

const NOT_READY: ViewerReadiness = { ready: false, viewerInstanceId: null };

/**
 * Installs a validating `message` listener before the iframe `src` is
 * assigned, so an early `VIEWER_READY` cannot be missed by timing. Handles
 * `VIEWER_READY` (stores readiness + `viewerInstanceId`, flushes the
 * pre-ready command queue) and `ACTIVATION_FAILED` (surfaced via
 * `activationFailed`, a fresh object per message so callers can key a
 * `useEffect` off it). Also owns outbound `ACTIVATE_TOOL` / `DEACTIVATE_TOOL`
 * dispatch: `sendCommand` posts immediately when ready, otherwise queues.
 */
export function useViewerBridge(iframeRef: React.RefObject<HTMLIFrameElement>): ViewerBridge {
  const [readiness, setReadiness] = useState<ViewerReadiness>(NOT_READY);
  const [activationFailed, setActivationFailed] = useState<ActivationFailedEvent | null>(null);
  const readyRef = useRef(false);
  const queueRef = useRef(new CommandQueue());

  const postToViewer = useCallback(
    (command: QueuedCommand) => {
      iframeRef.current?.contentWindow?.postMessage(command, VIEWER_ORIGIN);
    },
    [iframeRef]
  );

  const sendCommand = useCallback(
    (command: QueuedCommand) => {
      if (readyRef.current) {
        postToViewer(command);
        return;
      }
      queueRef.current.enqueue(command);
    },
    [postToViewer]
  );

  const cancelQueuedActivation = useCallback((rowId: string) => {
    return queueRef.current.removeActivation(rowId);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line no-console
    console.info('[viewer-bridge] message listener installed before iframe src is set');

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== VIEWER_ORIGIN) {
        // eslint-disable-next-line no-console
        console.warn('[viewer-bridge] rejected message: unexpected origin', event.origin);
        return;
      }

      if (event.source !== iframeRef.current?.contentWindow) {
        // eslint-disable-next-line no-console
        console.warn('[viewer-bridge] rejected message: unexpected source window');
        return;
      }

      const data = event.data;
      if (!isBridgeMessageFromSender(data, 'viewer')) {
        // eslint-disable-next-line no-console
        console.warn('[viewer-bridge] rejected message: failed protocol/version/shape guard');
        return;
      }

      if (data.type === MESSAGE_TYPE.VIEWER_READY) {
        const { viewerInstanceId } = data.payload;
        // eslint-disable-next-line no-console
        console.info('[viewer-bridge] VIEWER_READY received', viewerInstanceId);
        // A later VIEWER_READY (e.g. a fresh handshake after a reload) always
        // replaces the stored instance id, even if one was already recorded —
        // see ARCHITECTURE.md §10.2/§6 for the idempotency guarantee this
        // relies on from the viewer side.
        readyRef.current = true;
        setReadiness({ ready: true, viewerInstanceId });
        queueRef.current.flush().forEach(postToViewer);
        return;
      }

      if (data.type === MESSAGE_TYPE.ACTIVATION_FAILED) {
        const { rowId, activationId, reason } = data.payload;
        // eslint-disable-next-line no-console
        console.warn('[viewer-bridge] ACTIVATION_FAILED received', { rowId, activationId, reason });
        setActivationFailed({ messageId: data.messageId, rowId, activationId, reason });
        return;
      }

      // MEASUREMENT_ADDED / MEASUREMENT_UPDATED handling lands in PR 5.
      // eslint-disable-next-line no-console
      console.info('[viewer-bridge] discarded valid message (handling lands in a later PR)', data);
    };

    window.addEventListener('message', handleMessage);

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [iframeRef, postToViewer]);

  // Call this immediately before the host itself (re)assigns the iframe
  // `src` — i.e. at the one point a navigation is actually known to start,
  // not on the iframe's `load` event. `load` fires once a document finishes
  // loading, which can happen well *before* OHIF's own extensions/viewports
  // finish initializing and a fresh VIEWER_READY arrives; resetting on
  // `load` risked clearing a handshake that had already completed. There is
  // currently no call site other than the initial mount (no reload UI
  // exists yet), so this is a no-op today, but it is the correct place for
  // any future host-triggered reload to reset readiness deterministically.
  //
  // Known limitation: a reload/navigation NOT initiated by the host (a
  // manual iframe reload, or the OHIF app performing its own full-page
  // navigation) cannot be reliably detected from here — there is no
  // cross-origin signal for "a navigation just started" available to the
  // parent, and `onLoad` cannot substitute for one (see above). If that
  // happens, the host will show stale readiness until the new page's
  // handshake completes and a new VIEWER_READY (with a different
  // viewerInstanceId) arrives, which still correctly replaces the stored
  // state (see the VIEWER_READY branch above). Not solved in PR 3 — no
  // polling, state machine, or new message type introduced for it.
  const resetForNavigation = useCallback(() => {
    readyRef.current = false;
    queueRef.current.clear();
    setReadiness(NOT_READY);
  }, []);

  return { ...readiness, resetForNavigation, sendCommand, cancelQueuedActivation, activationFailed };
}