import type { FormRow } from './types';

export type RowsState = FormRow[];

export type RowsAction =
  | { type: 'ADD_ROW'; rowId: string }
  | { type: 'ACTIVATE_REQUESTED'; rowId: string; activationId: string }
  | { type: 'CANCEL_REQUESTED'; rowId: string }
  | { type: 'ACTIVATION_FAILED'; rowId: string; activationId: string; reason: string }
  | { type: 'MEASUREMENT_COMPLETED'; rowId: string; activationId: string; measurementId: string }
  | {
      type: 'MEASUREMENT_ADDED';
      rowId: string;
      activationId: string;
      measurementId: string;
      value: number;
      unit: string;
    }
  | { type: 'MEASUREMENT_FAILED'; rowId: string; activationId: string; reason: string }
  | { type: 'ACTIVATION_CANCELLED'; rowId: string; activationId: string; reason: string };

/**
 * Rows move `waiting -> drawing -> processing -> ready` (ARCHITECTURE.md
 * §10.8, §10.12) — there is no separate `failed` status; `ACTIVATION_FAILED`,
 * `MEASUREMENT_FAILED` and `ACTIVATION_CANCELLED` all return the row to
 * `waiting` (so Activate can be retried) while preserving `failureReason`
 * for display. Every correlated action is dropped here if `activationId` no
 * longer matches the row's current activation — the stale-event rejection
 * rule (§10.1/§10.4). `MEASUREMENT_ADDED` additionally checks
 * `measurementId` against the one captured at `MEASUREMENT_COMPLETED` time,
 * as defense in depth.
 *
 * `ACTIVATION_CANCELLED` is viewer-originated (the bridge detected a manual
 * OHIF toolbar switch away from `EllipticalROI` while the row was armed —
 * ARCHITECTURE.md §6 "manual toolbar switching") and is intentionally kept
 * separate from `CANCEL_REQUESTED` (host-user-initiated Cancel/Escape,
 * which also sends `DEACTIVATE_TOOL`). Dispatching this action never sends
 * anything back to the viewer — the viewer already tore down its own
 * `armed` state and left the user's newly chosen tool alone; echoing
 * `DEACTIVATE_TOOL` here would be a pointless, and incorrect, round trip
 * (§9 echo-loop prevention).
 */
export function rowsReducer(state: RowsState, action: RowsAction): RowsState {
  switch (action.type) {
    case 'ADD_ROW':
      return [
        ...state,
        {
          id: action.rowId,
          status: 'waiting',
          activationId: null,
          measurementId: null,
          value: null,
          unit: null,
          failureReason: null,
        },
      ];

    case 'ACTIVATE_REQUESTED':
      return state.map(row =>
        row.id === action.rowId
          ? {
              ...row,
              status: 'drawing',
              activationId: action.activationId,
              measurementId: null,
              value: null,
              unit: null,
              failureReason: null,
            }
          : row
      );

    case 'CANCEL_REQUESTED':
      return state.map(row =>
        row.id === action.rowId
          ? { ...row, status: 'waiting', activationId: null, failureReason: null }
          : row
      );

    case 'ACTIVATION_FAILED':
      return state.map(row =>
        row.id === action.rowId && row.activationId === action.activationId
          ? { ...row, status: 'waiting', activationId: null, failureReason: action.reason }
          : row
      );

    case 'MEASUREMENT_COMPLETED':
      return state.map(row =>
        row.id === action.rowId && row.status === 'drawing' && row.activationId === action.activationId
          ? { ...row, status: 'processing', measurementId: action.measurementId, failureReason: null }
          : row
      );

    case 'MEASUREMENT_ADDED':
      return state.map(row =>
        row.id === action.rowId &&
        row.status === 'processing' &&
        row.activationId === action.activationId &&
        row.measurementId === action.measurementId
          ? { ...row, status: 'ready', value: action.value, unit: action.unit, failureReason: null }
          : row
      );

    case 'MEASUREMENT_FAILED':
      return state.map(row =>
        row.id === action.rowId && row.status === 'processing' && row.activationId === action.activationId
          ? {
              ...row,
              status: 'waiting',
              activationId: null,
              measurementId: null,
              failureReason: action.reason,
            }
          : row
      );

    case 'ACTIVATION_CANCELLED':
      return state.map(row =>
        row.id === action.rowId && row.status === 'drawing' && row.activationId === action.activationId
          ? { ...row, status: 'waiting', activationId: null, failureReason: action.reason }
          : row
      );

    default:
      return state;
  }
}