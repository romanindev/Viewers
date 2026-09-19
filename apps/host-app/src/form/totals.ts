import type { FormRow } from './types';

/**
 * Grouped by the exact unit string (ARCHITECTURE.md §7) — never normalized,
 * so `mm²` and a calibrated `mm² ERMF` never merge into one total.
 */
export type Totals = Record<string, number>;

export function computeTotals(rows: FormRow[]): Totals {
  const totals: Totals = Object.create(null);

  for (const row of rows) {
    if (row.status !== 'ready') {
      continue;
    }
    if (typeof row.value !== 'number' || !Number.isFinite(row.value)) {
      continue;
    }
    if (typeof row.unit !== 'string' || row.unit.length === 0) {
      continue;
    }

    totals[row.unit] = (totals[row.unit] ?? 0) + row.value;
  }

  return totals;
}
