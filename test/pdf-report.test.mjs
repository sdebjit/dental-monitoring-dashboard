import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDashboardItems } from '../src/pdf-report.mjs';

const item = (str, x, y) => ({ str, x, y, page: 1 });
const items = [
  item('Daily Report Date', 30, 1400), item('oct. 27, 2026', 80, 1380),
  item('Operator', 260, 1400), item('Operator One', 420, 1365),
  item('Shift', 900, 1400), item('MA - clinical - 1', 950, 1365),
  item('individual_score', 24, 1300), item('2,065.5', 24, 1285),
  item('goal_score_individual', 137, 1300), item('3,000', 214, 1285),
  item('Total', 900, 1220), item('19', 1180, 1220),
  item('MA', 31, 700), item('2026-10-27 07:00:00', 91, 700),
  item('2026-10-27 08:00:00', 254, 700), item('Clinical | 2D Validation', 409, 700),
  item('19', 722, 700), item('162', 818, 700), item('2066', 1138, 700),
];

test('PDF text parser keeps the report date, exact score, and hourly detail separate', () => {
  const report = parseDashboardItems(items);
  assert.equal(report.date, '2026-10-27');
  assert.equal(report.casesFinished, 19);
  assert.equal(report.individualScore, 2065.5);
  assert.equal(report.details.length, 1);
  assert.equal(report.details[0].score, 162);
  assert.equal(report.metadata.operator, 'Operator One');
  assert.equal(report.metadata.shift, 'MA - clinical - 1');
  assert.equal(report.records.find(row => row.metric === 'Individual score').value, 2065.5);
  assert.equal(report.records.find(row => row.metric === 'Details score').value, 162);
});

test('PDF text parser rejects an incomplete or inconsistent report before archiving', () => {
  assert.throws(() => parseDashboardItems(items.filter(entry => entry.str !== 'oct. 27, 2026')), /Daily Report Date/);
  assert.throws(() => parseDashboardItems(items.map(entry => entry.x === 1180 ? { ...entry, str: '20' } : entry)), /do not match/);
});
