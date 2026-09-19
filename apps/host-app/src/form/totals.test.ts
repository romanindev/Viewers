import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeTotals } from './totals.js';
import type { FormRow } from './types.js';

function row(overrides: Partial<FormRow>): FormRow {
  return {
    id: 'r1',
    status: 'ready',
    activationId: null,
    measurementId: null,
    value: null,
    unit: null,
    failureReason: null,
    ...overrides,
  };
}

// `computeTotals` returns a null-prototype object (see totals.ts), so it is
// spread into a plain object before comparison — `assert.deepEqual` from
// `node:assert/strict` checks prototypes and would otherwise fail even when
// the own enumerable properties match.
function plain(totals: ReturnType<typeof computeTotals>) {
  return { ...totals };
}

test('empty rows produce empty totals', () => {
  assert.deepEqual(plain(computeTotals([])), {});
});

test('non-ready rows are excluded regardless of value/unit', () => {
  const rows = [
    row({ id: 'a', status: 'waiting', value: null, unit: null }),
    row({ id: 'b', status: 'drawing', value: null, unit: null }),
    row({ id: 'c', status: 'processing', value: 12, unit: 'mm²' }),
  ];
  assert.deepEqual(plain(computeTotals(rows)), {});
});

test('a single ready row with a valid value and unit contributes to its unit total', () => {
  const rows = [row({ id: 'a', status: 'ready', value: 10, unit: 'mm²' })];
  assert.deepEqual(plain(computeTotals(rows)), { 'mm²': 10 });
});

test('multiple ready rows with the same unit are summed', () => {
  const rows = [
    row({ id: 'a', status: 'ready', value: 10, unit: 'mm²' }),
    row({ id: 'b', status: 'ready', value: 5.5, unit: 'mm²' }),
    row({ id: 'c', status: 'ready', value: 1.25, unit: 'mm²' }),
  ];
  assert.deepEqual(plain(computeTotals(rows)), { 'mm²': 16.75 });
});

test('mixed units are grouped separately, never summed together', () => {
  const rows = [
    row({ id: 'a', status: 'ready', value: 10, unit: 'mm²' }),
    row({ id: 'b', status: 'ready', value: 3480, unit: 'px²' }),
  ];
  assert.deepEqual(plain(computeTotals(rows)), { 'mm²': 10, 'px²': 3480 });
});

test('a calibrated unit suffix is kept distinct from the plain unit', () => {
  const rows = [
    row({ id: 'a', status: 'ready', value: 10, unit: 'mm²' }),
    row({ id: 'b', status: 'ready', value: 20, unit: 'mm² ERMF' }),
  ];
  assert.deepEqual(plain(computeTotals(rows)), { 'mm²': 10, 'mm² ERMF': 20 });
});

test('decimal values keep full precision, not rounded', () => {
  const rows = [
    row({ id: 'a', status: 'ready', value: 0.1, unit: 'mm²' }),
    row({ id: 'b', status: 'ready', value: 0.2, unit: 'mm²' }),
  ];
  const totals = computeTotals(rows);
  assert.equal(totals['mm²'], 0.1 + 0.2);
});

test('a ready row with a non-finite or missing value is excluded', () => {
  const rows = [
    row({ id: 'a', status: 'ready', value: null, unit: 'mm²' }),
    row({ id: 'b', status: 'ready', value: Number.NaN, unit: 'mm²' }),
    row({ id: 'c', status: 'ready', value: Number.POSITIVE_INFINITY, unit: 'mm²' }),
  ];
  assert.deepEqual(plain(computeTotals(rows)), {});
});

test('a ready row with an empty or missing unit is excluded', () => {
  const rows = [
    row({ id: 'a', status: 'ready', value: 10, unit: null }),
    row({ id: 'b', status: 'ready', value: 10, unit: '' }),
  ];
  assert.deepEqual(plain(computeTotals(rows)), {});
});

test('a unit literally named "constructor" is grouped safely, not treated as an inherited property', () => {
  const rows = [row({ id: 'a', status: 'ready', value: 10, unit: 'constructor' })];
  const totals = computeTotals(rows);
  assert.equal(totals.constructor, 10);
  assert.deepEqual(plain(totals), { constructor: 10 });
});
