import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDashboardItems, parseDashboardPdf, isDashboardReportFormat, isUnsupportedReportError, UnsupportedFormatError } from '../src/pdf-report.mjs';

const item = (str, x, y, page = 1) => ({ str, x, y, page });
const items = [
  item('Daily Report Date', 30, 1400), item('oct. 27, 2026', 80, 1380),
  item('Operator', 260, 1400), item('Operator One', 420, 1365),
  item('Shift', 900, 1400), item('MA - clinical - 1', 950, 1365),
  item('individual_score', 24, 1300), item('2,065.5', 24, 1285),
  item('goal_score_individual', 137, 1300), item('3,000', 214, 1285),
  item('shift score', 137, 1250), item('2,100', 214, 1235),
  item('site score', 137, 1200), item('2,050', 214, 1185),
  item('global score', 137, 1150), item('2,000', 214, 1135),
  item('2066 pts', 137, 1100),
  item('Total', 900, 1220), item('19', 1180, 1220),
  item('MA', 31, 700), item('2026-10-27 07:00:00', 91, 700),
  item('2026-10-27 08:00:00', 254, 700), item('Clinical | 2D Validation', 409, 700),
  item('19', 722, 700), item('162', 818, 700), item('2066', 1138, 700),
  item('Last refresh was', 30, 200),
  item('2026-10-27 15:30:00', 130, 200),
  item('2026 15:30 PM (GMT)', 30, 150)
];

test('PDF text parser keeps the report date, exact score, and hourly detail separate', () => {
  const report = parseDashboardItems(items);
  assert.equal(report.date, '2026-10-27');
  assert.equal(report.casesFinished, 19);
  assert.equal(report.individualScore, 2065.5);
  assert.equal(report.details.length, 1);
  assert.equal(report.details[0].score, 162);
  assert.equal(report.cases2D, 19);
  assert.equal(report.cases3D, 0);
  assert.equal(report.metadata.operator, 'Operator One');
  assert.equal(report.metadata.shift, 'MA - clinical - 1');
  assert.equal(report.metadata.goalScoreIndividual, 3000);
  assert.equal(report.metadata.shiftScore, 2100);
  assert.equal(report.metadata.siteScore, 2050);
  assert.equal(report.metadata.globalScore, 2000);
  assert.equal(report.metadata.scoreBreakdown, 2066);
  assert.ok(report.metadata.lastRefreshText.includes('Last refresh was'));
  assert.ok(report.records.find(row => row.metric === 'Individual score').value, 2065.5);
  assert.ok(report.records.find(row => row.metric === 'Details score').value, 162);
});

test('PDF text parser parses # Cases finished table rows for 2D and 3D breakdown', () => {
  const tableItems = [
    item('Daily Report Date', 30, 1400), item('oct. 27, 2026', 80, 1380),
    item('Operator', 260, 1400), item('Operator One', 420, 1365),
    item('Shift', 900, 1400), item('MA - clinical - 1', 950, 1365),
    item('individual score', 24, 1300), item('2,065.5', 24, 1285),
    item('goal_score_individual', 137, 1300), item('3,000', 214, 1285),
    item('# Cases finished', 900, 1260),
    item('Lignes', 900, 1245), item('#', 1180, 1245),
    item('Clinical | 3D Validation', 900, 1230), item('100', 1180, 1230),
    item('Clinical | 2D Validation', 900, 1215), item('218', 1180, 1215),
    item('Total', 900, 1200), item('318', 1180, 1200),
    item('MA', 31, 700), item('2026-10-27 07:00:00', 91, 700),
    item('2026-10-27 08:00:00', 254, 700), item('Clinical | 3D Validation', 409, 700),
    item('318', 722, 700), item('2065.5', 818, 700),
  ];

  const report = parseDashboardItems(tableItems);
  assert.equal(report.casesFinished, 318);
  assert.equal(report.cases2D, 218);
  assert.equal(report.cases3D, 100);
  assert.equal(report.taskBreakdown['Clinical | 2D Validation'], 218);
  assert.equal(report.taskBreakdown['Clinical | 3D Validation'], 100);
  assert.equal(report.records.find(r => r.metric === 'Cases 3D finished')?.value, 100);
});

test('PDF text parser handles fallback 3D cases from details rows', () => {
  const detailsItems = [
    item('Daily Report Date', 30, 1400), item('2026-10-27', 80, 1380),
    item('individual_score', 24, 1300), item('100', 24, 1285),
    item('Total', 900, 1220), item('20', 1180, 1220),
    item('MA', 31, 700), item('2026-10-27 07:00:00', 91, 700),
    item('2026-10-27 08:00:00', 254, 700), item('Clinical | 3D Model Review', 409, 700),
    item('20', 722, 700), item('100', 818, 700),
  ];

  const report = parseDashboardItems(detailsItems);
  assert.equal(report.casesFinished, 20);
  assert.equal(report.cases3D, 20);
  assert.equal(report.cases2D, 0);
});

test('PDF text parser handles French and alternative month names in displayedDate', () => {
  const frenchDates = [
    { str: 'févr. 15, 2026', expected: '2026-02-15' },
    { str: 'mars 20, 2026', expected: '2026-03-20' },
    { str: 'août 10, 2026', expected: '2026-08-10' },
    { str: 'déc. 25, 2026', expected: '2026-12-25' },
    { str: 'avr. 5, 2026', expected: '2026-04-05' },
    { str: 'mai 1, 2026', expected: '2026-05-01' },
    { str: 'juin 18, 2026', expected: '2026-06-18' },
    { str: 'juil 14, 2026', expected: '2026-07-14' },
    { str: 'sept. 30, 2026', expected: '2026-09-30' },
    { str: 'nov 11, 2026', expected: '2026-11-11' },
    { str: 'janv. 2, 2026', expected: '2026-01-02' }
  ];

  for (const { str, expected } of frenchDates) {
    const testItems = [
      item('Daily Report Date', 30, 1400), item(str, 80, 1380),
      item('individual_score', 24, 1300), item('100', 24, 1285),
      item('Total', 900, 1220), item('10', 1180, 1220),
      item('MA', 31, 700), item(`${expected} 07:00:00`, 91, 700),
      item(`${expected} 08:00:00`, 254, 700), item('2D Check', 409, 700),
      item('10', 722, 700), item('100', 818, 700)
    ];
    const report = parseDashboardItems(testItems);
    assert.equal(report.date, expected);
  }
});

test('PDF text parser rejects an incomplete or inconsistent report before archiving', () => {
  // Missing date
  assert.throws(() => parseDashboardItems(items.filter(entry => entry.str !== 'oct. 27, 2026')), /Daily Report Date/);
  // Missing score
  assert.throws(() => parseDashboardItems(items.filter(entry => entry.str !== 'individual_score')), /individual score/);
  // Mismatched total
  assert.throws(() => parseDashboardItems(items.map(entry => entry.x === 1180 ? { ...entry, str: '20' } : entry)), /do not match/);
  // Invalid date format
  const badDate = [
    item('Daily Report Date', 30, 1400), item('unknown month 99, 2026', 80, 1380),
    item('individual_score', 24, 1300), item('10', 24, 1285),
    item('Total', 900, 1220), item('1', 1180, 1220)
  ];
  assert.throws(() => parseDashboardItems(badDate), /Daily Report Date/);
  // Invalid calendar date (e.g. Feb 31)
  const invalidCal = [
    item('Daily Report Date', 30, 1400), item('2026-02-31', 80, 1380),
    item('individual_score', 24, 1300), item('10', 24, 1285),
    item('Total', 900, 1220), item('1', 1180, 1220)
  ];
  assert.throws(() => parseDashboardItems(invalidCal), /Daily Report Date is invalid/);
  // Details line with timestamps not matching report date
  const mismatchDetails = [
    item('Daily Report Date', 30, 1400), item('2026-10-27', 80, 1380),
    item('individual_score', 24, 1300), item('10', 24, 1285),
    item('Total', 900, 1220), item('1', 1180, 1220),
    item('MA', 31, 700), item('2026-10-28 07:00:00', 91, 700),
    item('2026-10-28 08:00:00', 254, 700), item('Task', 409, 700),
    item('1', 722, 700), item('10', 818, 700)
  ];
  assert.throws(() => parseDashboardItems(mismatchDetails), /Details rows do not match/);
  // Incomplete details row: missing TZ or invalid numbers
  const incompleteDetails = [
    item('Daily Report Date', 30, 1400), item('2026-10-27', 80, 1380),
    item('individual_score', 24, 1300), item('10', 24, 1285),
    item('Total', 900, 1220), item('1', 1180, 1220),
    item('2026-10-27 07:00:00', 91, 700), item('2026-10-27 08:00:00', 254, 700),
    item('1', 722, 700)
  ];
  assert.throws(() => parseDashboardItems(incompleteDetails), /A Details row is incomplete/);
});

test('isUnsupportedReportError handles all error shapes and messages', () => {
  assert.equal(isUnsupportedReportError(null), false);
  assert.equal(isUnsupportedReportError(undefined), false);
  assert.equal(isUnsupportedReportError(new UnsupportedFormatError()), true);
  assert.equal(isUnsupportedReportError({ code: 'UNSUPPORTED_FORMAT' }), true);
  assert.equal(isUnsupportedReportError({ isUnsupportedFormat: true }), true);
  assert.equal(isUnsupportedReportError(new Error('daily report date is missing')), true);
  assert.equal(isUnsupportedReportError(new Error('Choose a PDF report no larger than 20 MiB.')), true);
  assert.equal(isUnsupportedReportError(new Error('The report must contain 1 to 10 pages.')), true);
  assert.equal(isUnsupportedReportError(new Error('missing its individual score or cases total')), true);
  assert.equal(isUnsupportedReportError(new Error('does not contain hourly details')), true);
  assert.equal(isUnsupportedReportError(new Error('unsupported format')), true);
  assert.equal(isUnsupportedReportError(new Error('Database connection failed')), false);
});

test('isDashboardReportFormat distinguishes daily reports from arbitrary PDFs', () => {
  assert.equal(isDashboardReportFormat(items), true);
  assert.equal(isDashboardReportFormat(null), false);
  assert.equal(isDashboardReportFormat([]), false);
  assert.equal(isDashboardReportFormat([item('hello', 10, 10)]), false);

  const invoiceItems = [
    item('Invoice #INV-2026', 10, 1000),
    item('Customer: Acme Corp', 10, 950),
    item('Subtotal: $400.00', 10, 900),
    item('Total: $420.00', 10, 850)
  ];
  assert.equal(isDashboardReportFormat(invoiceItems), false);

  const noScore = items.filter(e => e.str !== 'individual_score');
  assert.equal(isDashboardReportFormat(noScore), false);

  const noDate = items.filter(e => e.str !== 'Daily Report Date');
  assert.equal(isDashboardReportFormat(noDate), false);

  const noTotal = items.filter(e => e.str !== 'Total');
  assert.equal(isDashboardReportFormat(noTotal), false);
});

test('parseDashboardPdf validates input buffer constraints and throws on invalid buffers', async () => {
  // Less than 100 bytes
  await assert.rejects(
    async () => parseDashboardPdf(Buffer.from('tiny')),
    /Choose a PDF report no larger than 20 MiB/
  );

  // Exceeds 20 MiB
  await assert.rejects(
    async () => parseDashboardPdf(Buffer.alloc(21 * 1024 * 1024)),
    /Choose a PDF report no larger than 20 MiB/
  );

  // Does not start with %PDF-
  await assert.rejects(
    async () => parseDashboardPdf(Buffer.alloc(200, 'A')),
    /Choose a PDF report no larger than 20 MiB/
  );

  // Invalid PDF bytes starting with %PDF- but corrupted
  const corruptPdf = Buffer.concat([Buffer.from('%PDF-1.4\nCorrupt header with invalid syntax'), Buffer.alloc(200)]);
  await assert.rejects(
    async () => parseDashboardPdf(corruptPdf),
    /Failed to read PDF document/
  );

  // Valid PDF format structure parsed by pdfjs text stream
  const contentStream = 'BT /F1 12 Tf 72 712 Td (Invoice Document Total) Tj ET';
  const streamLen = Buffer.byteLength(contentStream);
  const validPdf = Buffer.from(
    `%PDF-1.4\n` +
    `1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n` +
    `2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n` +
    `3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> >> endobj\n` +
    `4 0 obj << /Length ${streamLen} >> stream\n${contentStream}\nendstream endobj\n` +
    `xref\n0 5\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000300 00000 n \n` +
    `trailer << /Size 5 /Root 1 0 R >>\nstartxref\n400\n%%EOF\n`
  );

  await assert.rejects(
    async () => parseDashboardPdf(validPdf),
    /Daily Report Date is missing or uses an unsupported format/
  );
});

test('handles zero cases finished cleanly hitting fallback line', () => {
  const zeroItems = [
    item('Daily Report Date', 30, 1400), item('2026-10-27', 80, 1380),
    item('individual_score', 24, 1300), item('0', 24, 1285),
    item('Total', 900, 1220), item('0', 1180, 1220),
    item('MA', 31, 700), item('2026-10-27 07:00:00', 91, 700),
    item('2026-10-27 08:00:00', 254, 700), item('General Review', 409, 700),
    item('0', 722, 700), item('0', 818, 700),
  ];
  const report = parseDashboardItems(zeroItems);
  assert.equal(report.casesFinished, 0);
  assert.equal(report.cases2D, 0);
});
