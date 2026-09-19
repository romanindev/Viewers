import type { FormRow } from './types';

export type RowsState = FormRow[];

export type RowsAction =
  | { type: 'ADD_ROW'; rowId: string }
  | { type: 'ACTIVATE_REQUESTED'; rowId: string; activationId: string }
  | { type: 'CANCEL_REQUESTED'; rowId: string }
  | { type: 'ACTIVATION_FAILED'; rowId: string; activationId: string; reason: string };

/**
 * Rows move `waiting -> drawing -> waiting` (ARCHITECTURE.md §10.8) — there
 * is no separate `failed` status. `ACTIVATION_FAILED` returns the row to
 * `waiting` (so Activate can be retried) while preserving `failureReason`
 * for display. It is dropped here if `activationId` no longer matches the
 * row's current activation — the stale-event rejection rule (§10.1/§10.4)
 * applied to this message.
 */
export function rowsReducer(state: RowsState, action: RowsAction): RowsState {
  switch (action.type) {
    case 'ADD_ROW':
      return [
        ...state,
        { id: action.rowId, status: 'waiting', activationId: null, failureReason: null },
      ];

    case 'ACTIVATE_REQUESTED':
      return state.map(row =>
        row.id === action.rowId
          ? { ...row, status: 'drawing', activationId: action.activationId, failureReason: null }
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

    default:
      return state;
  }
}