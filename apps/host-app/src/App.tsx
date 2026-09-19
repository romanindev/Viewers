import { useEffect, useRef } from 'react';

import { VIEWER_STUDY_URL } from './config';
import { useViewerBridge } from './bridge/useViewerBridge';
import { useScoringForm } from './form/useScoringForm';
import { computeTotals } from './form/totals';

export function App() {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Installs the message listener. Declared before the effect below so it
  // runs first on mount — the listener must exist before the iframe `src`
  // is assigned, never the other way around.
  const bridge = useViewerBridge(iframeRef);
  const { ready, viewerInstanceId, resetForNavigation } = bridge;
  const { rows, addRow, activate, cancel } = useScoringForm(bridge);
  const totals = computeTotals(rows);
  const totalUnits = Object.keys(totals);

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
    <div className="flex h-screen w-screen flex-col bg-slate-900 text-slate-100 sm:flex-row">
      <div className="min-h-0 flex-1">
        <iframe
          ref={iframeRef}
          title="OHIF Viewer"
          className="h-full w-full border-0"
        />
      </div>
      <div className="flex w-full flex-none flex-col overflow-y-auto border-t border-slate-700 p-4 sm:w-80 sm:border-l sm:border-t-0">
        <h2 className="text-lg font-semibold">Scoring Form</h2>
        <p className="mt-1 text-sm text-slate-400">
          Viewer: {ready ? `ready (${viewerInstanceId})` : 'not ready'}
        </p>
        <button
          onClick={addRow}
          className="mt-3 self-start rounded bg-slate-700 px-3 py-1.5 text-sm hover:bg-slate-600"
        >
          Add Measurement
        </button>
        <ul className="mt-3 flex flex-col gap-2">
          {rows.map((row, index) => (
            <li
              key={row.id}
              className="flex items-center justify-between gap-2 text-sm"
            >
              {row.status === 'ready' && row.value !== null ? (
                <>
                  <span className="flex items-center gap-2 tabular-nums">
                    #{index + 1}
                    <span className="rounded bg-green-600 px-1.5 py-0.5 text-xs font-medium text-white">
                      ready
                    </span>
                  </span>
                  <span className="flex-1 text-right tabular-nums">
                    {row.value.toFixed(2)} {row.unit}
                  </span>
                </>
              ) : (
                <span className="flex-1 tabular-nums">
                  #{index + 1} {row.status}
                  {row.failureReason ? ` — ${row.failureReason}` : ''}
                </span>
              )}
              {row.status === 'drawing' && (
                <button
                  onClick={() => cancel(row.id)}
                  className="rounded bg-slate-700 px-2 py-1 text-xs hover:bg-slate-600"
                >
                  Cancel
                </button>
              )}
              {row.status === 'waiting' && (
                <button
                  onClick={() => activate(row.id)}
                  className="rounded bg-slate-700 px-2 py-1 text-xs hover:bg-slate-600"
                >
                  Activate
                </button>
              )}
            </li>
          ))}
        </ul>
        <div className="mt-4 border-t border-slate-700 pt-3">
          {totalUnits.length === 0 ? (
            <p className="text-sm text-slate-400">No ready measurements yet.</p>
          ) : (
            <div className="flex items-start justify-between text-sm font-medium">
              <span>Total:</span>
              <div className="flex flex-col items-end gap-1 tabular-nums">
                {totalUnits.map(unit => (
                  <span key={unit}>
                    {totals[unit].toFixed(2)} {unit}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}