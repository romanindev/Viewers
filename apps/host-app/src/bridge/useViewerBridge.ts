import { useEffect } from 'react';
import { isBridgeMessageFromSender } from '@scoring-form/message-contract';

import { VIEWER_ORIGIN } from '../config';

/**
 * PR 1 scope: install a validating `message` listener before the iframe `src`
 * is assigned, so a handshake message sent in a later PR can never be missed
 * by timing. It only logs and discards — no queueing, no reducer, no
 * VIEWER_READY handling yet (see IMPLEMENTATION_PLAN.md PR 1 / PR 2).
 */
export function useViewerBridge(iframeRef: React.RefObject<HTMLIFrameElement>) {
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

      if (!isBridgeMessageFromSender(event.data, 'viewer')) {
        // eslint-disable-next-line no-console
        console.warn('[viewer-bridge] rejected message: failed protocol/version/shape guard');
        return;
      }

      // No handshake or reducer yet — PR 1 only proves the listener and its
      // guards are real. Later PRs replace this log with actual handling.
      // eslint-disable-next-line no-console
      console.info('[viewer-bridge] discarded valid message (handling lands in a later PR)', event.data);
    };

    window.addEventListener('message', handleMessage);

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [iframeRef]);
}