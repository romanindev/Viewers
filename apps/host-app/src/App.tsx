import { useEffect, useRef } from 'react';

import { VIEWER_STUDY_URL } from './config';
import { useViewerBridge } from './bridge/useViewerBridge';

export function App() {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Installs the message listener. Declared before the effect below so it
  // runs first on mount — the listener must exist before the iframe `src`
  // is assigned, never the other way around.
  const { ready, viewerInstanceId, resetForNavigation } = useViewerBridge(iframeRef);

  useEffect(() => {
    if (iframeRef.current) {
      // Reset readiness at the point navigation is actually known to start
      // — right before assigning `src` — not via the iframe's `onLoad`
      // event. See useViewerBridge.ts (resetForNavigation) for why.
      resetForNavigation();
      // eslint-disable-next-line no-console
      console.info('[host-app] assigning iframe src after listener install', VIEWER_STUDY_URL);
      iframeRef.current.src = VIEWER_STUDY_URL;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw' }}>
      <div style={{ flex: '1 1 auto', height: '100%' }}>
        <iframe
          ref={iframeRef}
          title="OHIF Viewer"
          style={{ width: '100%', height: '100%', border: 'none' }}
        />
      </div>
      <div
        style={{
          flex: '0 0 320px',
          height: '100%',
          borderLeft: '1px solid #333',
          padding: '1rem',
          overflowY: 'auto',
        }}
      >
        <h2>Scoring Form</h2>
        <p>
          Viewer: {ready ? `ready (${viewerInstanceId})` : 'not ready'}
        </p>
        <p>Placeholder — rows, activation and totals arrive in later PRs.</p>
      </div>
    </div>
  );
}