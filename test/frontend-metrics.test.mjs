import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

// Load drive.js functions in a sandbox to unit-test pure calculation logic
const driveJsCode = fs.readFileSync('public/drive.js', 'utf8');

// Mock a lightweight browser environment
const domElements = new Map();
function mockElement(id) {
  if (!domElements.has(id)) {
    domElements.set(id, {
      id,
      classList: {
        classes: new Set(),
        add(c) { this.classes.add(c); },
        remove(c) { this.classes.delete(c); },
        contains(c) { return this.classes.has(c); },
        toggle(c, force) {
          if (force === undefined) {
            if (this.classes.has(c)) { this.classes.delete(c); return false; }
            this.classes.add(c); return true;
          }
          if (force) this.classes.add(c); else this.classes.delete(c);
          return force;
        }
      },
      style: {},
      textContent: '',
      innerHTML: '',
      dataset: {},
      replaceChildren() {},
      append() {},
      setAttribute() {},
      removeAttribute() {}
    });
  }
  return domElements.get(id);
}

const sandbox = {
  console,
  Date,
  Math,
  String,
  Number,
  Array,
  Set,
  Map,
  JSON,
  localStorage: {
    store: new Map(),
    getItem(k) { return this.store.get(k) || null; },
    setItem(k, v) { this.store.set(k, String(v)); },
    removeItem(k) { this.store.delete(k); }
  },
  document: {
    getElementById: (id) => mockElement(id),
    querySelector: (sel) => mockElement(sel.replace(/^[.#]/, '')),
    querySelectorAll: () => [],
    addEventListener() {},
    createElement: (tag) => mockElement(tag),
    createElementNS: (ns, tag) => mockElement(tag)
  },
  window: {},
  location: { href: '' },
  setTimeout,
  clearTimeout
};

vm.createContext(sandbox);
vm.runInContext(driveJsCode, sandbox);

test('getPresetRange calculates billing cycle correctly for dates < 16 and >= 16', () => {
  // Date on 2026-10-29 (>= 16)
  const after16 = new Date(2026, 9, 29); // Oct 29
  const rangeAfter = sandbox.getPresetRange('billingMonth', after16);
  assert.equal(rangeAfter.start, '2026-10-16');
  assert.equal(rangeAfter.end, '2026-11-15');
  assert.equal(rangeAfter.preset, 'billingMonth');

  // Date on 2026-10-16 (exactly 16th)
  const on16 = new Date(2026, 9, 16);
  const rangeOn = sandbox.getPresetRange('billingMonth', on16);
  assert.equal(rangeOn.start, '2026-10-16');
  assert.equal(rangeOn.end, '2026-11-15');

  // Date on 2026-10-05 (< 16)
  const before16 = new Date(2026, 9, 5); // Oct 5
  const rangeBefore = sandbox.getPresetRange('billingMonth', before16);
  assert.equal(rangeBefore.start, '2026-09-16');
  assert.equal(rangeBefore.end, '2026-10-15');
});

test('getPresetRange handles currentMonth, lastMonth, last7, last30, today, yesterday', () => {
  const ref = new Date(2026, 9, 28); // Oct 28, 2026
  assert.equal(sandbox.getPresetRange('today', ref).start, '2026-10-28');
  assert.equal(sandbox.getPresetRange('yesterday', ref).start, '2026-10-27');
  assert.equal(sandbox.getPresetRange('last7', ref).start, '2026-10-22');
  assert.equal(sandbox.getPresetRange('currentMonth', ref).start, '2026-10-01');
  assert.equal(sandbox.getPresetRange('currentMonth', ref).end, '2026-10-31');
  assert.equal(sandbox.getPresetRange('lastMonth', ref).start, '2026-09-01');
  assert.equal(sandbox.getPresetRange('lastMonth', ref).end, '2026-09-30');
});

test('getComparisonPeriod computes matching periods for single days, billing cycles, and months', () => {
  // Single day: compares with day - 1
  const compSingle = sandbox.getComparisonPeriod('2026-10-28', '2026-10-28');
  assert.equal(compSingle.start, '2026-10-27');
  assert.equal(compSingle.end, '2026-10-27');

  // Billing cycle: 2026-10-16 to 2026-11-15 -> compares with 2026-09-16 to 2026-10-15
  const compBilling = sandbox.getComparisonPeriod('2026-10-16', '2026-11-15');
  assert.equal(compBilling.start, '2026-09-16');
  assert.equal(compBilling.end, '2026-10-15');

  // Full calendar month: 2026-10-01 to 2026-10-31 -> compares with 2026-09-01 to 2026-09-30
  const compMonth = sandbox.getComparisonPeriod('2026-10-01', '2026-10-31');
  assert.equal(compMonth.start, '2026-09-01');
  assert.equal(compMonth.end, '2026-09-30');
});

test('computeMetrics accurately sums cases, distinct days, hourly averages, and points', () => {
  const reports = [
    {
      date: '2026-10-27',
      casesFinished: 243,
      individualScore: 2065.5,
      details: [
        { hour: 7, finished: 15 },
        { hour: 8, finished: 30 },
        { hour: 9, finished: 35 },
        { hour: 10, finished: 40 },
        { hour: 11, finished: 35 },
        { hour: 12, finished: 30 },
        { hour: 13, finished: 33 },
        { hour: 14, finished: 25 }
      ]
    },
    {
      date: '2026-10-28',
      casesFinished: 354,
      individualScore: 3009,
      details: [
        { hour: 7, finished: 18 },
        { hour: 8, finished: 35 },
        { hour: 9, finished: 41 },
        { hour: 10, finished: 49 },
        { hour: 11, finished: 43 },
        { hour: 12, finished: 43 },
        { hour: 13, finished: 46 },
        { hour: 14, finished: 43 },
        { hour: 15, finished: 36 }
      ]
    }
  ];

  const metrics = sandbox.computeMetrics(reports);
  assert.equal(metrics.hasData, true);
  assert.equal(metrics.totalCases, 597);
  assert.equal(metrics.avgCasesPerDay, 298.5);
  assert.equal(metrics.totalPoints, 5074.5);
  assert.equal(metrics.reportCount, 2);
  // Report 1: 243 / 8 = 30.375
  // Report 2: 354 / 9 = 39.333333333333336
  // Avg pace: (30.375 + 39.3333) / 2 = 34.854...
  assert.ok(Math.abs(metrics.avgCasesPerHour - 34.854) < 0.01);
});

test('detectDuplicateReports identifies duplicate reports for the same date', () => {
  const reports = [
    { date: '2026-10-28', casesFinished: 354, individualScore: 3009, sourceFileName: 'Report_A.pdf' },
    { date: '2026-10-28', casesFinished: 360, individualScore: 3050, sourceFileName: 'Report_B.pdf' },
    { date: '2026-10-27', casesFinished: 243, individualScore: 2065.5, sourceFileName: 'Report_C.pdf' }
  ];

  const conflicts = sandbox.detectDuplicateReports(reports);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].date, '2026-10-28');
  assert.equal(conflicts[0].versions.length, 2);
});

test('formatHourRangeCompact handles AM/PM transitions seamlessly', () => {
  assert.equal(sandbox.formatHourRangeCompact(10), '10:00 – 11:00 AM');
  assert.equal(sandbox.formatHourRangeCompact(11), '11:00 AM – 12:00 PM');
  assert.equal(sandbox.formatHourRangeCompact(12), '12:00 – 1:00 PM');
  assert.equal(sandbox.formatHourRangeCompact(13), '1:00 – 2:00 PM');
  assert.equal(sandbox.formatHourRangeCompact(7), '7:00 – 8:00 AM');
});

test('renderProductivityFunFacts calculates peak, slowest, best/lowest days, and 350 milestone accurately', () => {
  const reports = [
    {
      date: '2026-10-27',
      casesFinished: 243,
      individualScore: 2065.5,
      details: [
        { hour: 7, finished: 15 },
        { hour: 8, finished: 30 },
        { hour: 13, finished: 33 }
      ]
    },
    {
      date: '2026-10-28',
      casesFinished: 354,
      individualScore: 3009,
      details: [
        { hour: 7, finished: 18 },
        { hour: 8, finished: 35 },
        { hour: 13, finished: 46 }
      ]
    }
  ];

  sandbox.renderProductivityFunFacts(reports);

  // Peak Hour: hour 13 has (33 + 46)/2 = 39.5
  const peakVal = domElements.get('fact-peak-hour-val');
  const peakSub = domElements.get('fact-peak-hour-sub');
  assert.equal(peakVal.textContent, '1:00 – 2:00 PM');
  assert.equal(peakSub.textContent, 'Avg 39.5 cases/hr');

  // Slowest Hour: hour 7 has (15 + 18)/2 = 16.5
  const slowVal = domElements.get('fact-slowest-hour-val');
  const slowSub = domElements.get('fact-slowest-hour-sub');
  assert.equal(slowVal.textContent, '7:00 – 8:00 AM');
  assert.equal(slowSub.textContent, 'Avg 16.5 cases/hr');

  // Best Day: 2026-10-28 with 354 cases
  const bestVal = domElements.get('fact-best-day-val');
  const bestSub = domElements.get('fact-best-day-sub');
  assert.ok(bestVal.textContent.includes('Oct 28') || bestVal.textContent.includes('28 Oct'));
  assert.ok(bestSub.textContent.includes('354 cases'));
  assert.ok(bestSub.textContent.includes('3,009 pts'));

  // Lowest Day: 2026-10-27 with 243 cases
  const lowVal = domElements.get('fact-lowest-day-val');
  const lowSub = domElements.get('fact-lowest-day-sub');
  assert.ok(lowVal.textContent.includes('Oct 27') || lowVal.textContent.includes('27 Oct'));
  assert.ok(lowSub.textContent.includes('243 cases'));
  assert.ok(lowSub.textContent.includes('2,065.5 pts'));

  // Milestone: 1 of 2 days exceeded 350 cases (50%)
  const mVal = domElements.get('fact-benchmark-300-val');
  const mSub = domElements.get('fact-benchmark-300-sub');
  assert.equal(mVal.textContent, '1 of 2 days');
  assert.equal(mSub.textContent, '50% exceeded 350 cases');
});

test('renderProductivityFunFacts handles empty and single report edge cases cleanly', () => {
  // Empty reports array hides the card
  sandbox.renderProductivityFunFacts([]);
  const card = domElements.get('fun-facts-card');
  assert.ok(card.classList.contains('hidden'));

  // Single report handles single day milestone and equal best/lowest day
  const single = [
    {
      date: '2026-10-28',
      casesFinished: 360,
      individualScore: 2950,
      details: [{ hour: 10, finished: 50 }]
    }
  ];
  sandbox.renderProductivityFunFacts(single);
  assert.equal(card.classList.contains('hidden'), false);

  const mVal = domElements.get('fact-benchmark-300-val');
  const mSub = domElements.get('fact-benchmark-300-sub');
  assert.equal(mVal.textContent, '1 of 1 day');
  assert.equal(mSub.textContent, '100% exceeded 350 cases');
});

test('getReportHourlyBreakdown produces fallback distributed hours when details are absent', () => {
  const reportWithoutDetails = {
    date: '2026-10-25',
    casesFinished: 160,
    individualScore: 1200
  };

  const points = sandbox.getReportHourlyBreakdown(reportWithoutDetails);
  assert.equal(points.length, 8);
  const total = points.reduce((sum, p) => sum + p.finished, 0);
  assert.equal(total, 160);
});

test('renderHourlyProductivityLineChart defaults to latest report and switches to selected date', () => {
  const reports = [
    {
      date: '2026-10-27',
      casesFinished: 243,
      details: [{ hour: 9, finished: 30 }]
    },
    {
      date: '2026-10-28',
      casesFinished: 354,
      details: [{ hour: 9, finished: 45 }]
    }
  ];

  // Default: should select latest date (2026-10-28)
  vm.runInContext("selectedChartDate = null", sandbox);
  sandbox.renderHourlyProductivityLineChart(reports);
  const title = domElements.get('hourly-chart-title');
  assert.ok(title.textContent.includes('2026-10-28'));

  // When filtered by user clicking 2026-10-27
  vm.runInContext("selectedChartDate = '2026-10-27'", sandbox);
  sandbox.renderHourlyProductivityLineChart(reports);
  assert.ok(title.textContent.includes('2026-10-27'));

  // Clear selection
  vm.runInContext("selectedChartDate = null", sandbox);
  sandbox.renderHourlyProductivityLineChart(reports);
  assert.ok(title.textContent.includes('2026-10-28'));
});

test('Daybook modular architecture exports modules with clear separation of concerns', () => {
  const Daybook = sandbox.window.Daybook;
  assert.ok(Daybook, 'Daybook module namespace is defined on window');

  // Module 1: Core
  assert.equal(typeof Daybook.Core.api, 'function');
  assert.equal(typeof Daybook.Core.formatUserFriendlyError, 'function');
  assert.equal(typeof Daybook.Core.showTopError, 'function');

  // Module 2: DateUtils
  assert.equal(typeof Daybook.DateUtils.getPresetRange, 'function');
  assert.equal(typeof Daybook.DateUtils.getComparisonPeriod, 'function');
  assert.equal(typeof Daybook.DateUtils.formatHourRangeCompact, 'function');

  // Module 3: Metrics
  assert.equal(typeof Daybook.Metrics.computeMetrics, 'function');
  assert.equal(typeof Daybook.Metrics.getReportHourlyBreakdown, 'function');
  assert.equal(typeof Daybook.Metrics.detectDuplicateReports, 'function');

  // Module 4: Charts
  assert.equal(typeof Daybook.Charts.renderDailyCasesBarChart, 'function');
  assert.equal(typeof Daybook.Charts.renderHourlyProductivityLineChart, 'function');

  // Module 5: FunFacts
  assert.equal(typeof Daybook.FunFacts.renderProductivityFunFacts, 'function');
  assert.equal(typeof Daybook.FunFacts.initFunFactsCollapse, 'function');

  // Module 6: DateRangePicker
  assert.equal(typeof Daybook.DateRangePicker.initDateRangePicker, 'function');
  assert.equal(typeof Daybook.DateRangePicker.renderDualCalendars, 'function');

  // Module 7: FolderExplorer
  assert.equal(typeof Daybook.FolderExplorer.createFolderNode, 'function');
  assert.equal(typeof Daybook.FolderExplorer.initOnboarding, 'function');

  // Module 8: App
  assert.equal(typeof Daybook.App.filterAndRenderDashboard, 'function');
  assert.equal(typeof Daybook.App.loadReports, 'function');
});

test('buildReportPdf generates a valid PDF document embedding report graphs and KPI metrics', async () => {
  const DateRangePicker = sandbox.window.Daybook.DateRangePicker;

  // Test escapePdfText
  assert.equal(DateRangePicker.escapePdfText('Operator (Score: 100) — Active'), 'Operator \\(Score: 100\\) - Active');

  // Test buildReportPdf with dummy 1x1 JPEG images for both report graphs
  const testJpeg = Buffer.from('ffd8ffe000104a46494600010101004800480000ffdb004300030202020202030202020303030304060404040404080606050609080a0a090809090a0c0f0c0a0b0e0b09090d110d0e0f101011100a0c12131210130f101010ffc0000b080001000101011100ffda0008010100003f00d2cf20ffd9', 'hex');

  const pdfBytes = DateRangePicker.buildReportPdf({
    title: 'Dental Monitoring — Performance & Productivity Report',
    dateRangeText: '16 Oct 2026 – 15 Nov 2026',
    generatedAtText: 'October 29, 2026',
    kpis: [
      { label: 'TOTAL VOLUME', value: '597 cases' },
      { label: 'DAILY VELOCITY', value: '298.5 cases/day' }
    ],
    chart1Img: { bytes: testJpeg, width: 1, height: 1 },
    chart1Title: 'Daily Finished Volume (Cases / Day)',
    chart2Img: { bytes: testJpeg, width: 1, height: 1 },
    chart2Title: 'Hourly Productivity Velocity (Cases / Hour)',
    funFacts: [
      { label: 'PEAK HOUR', value: '1:00 - 2:00 PM', sub: 'Avg 44.5/hr' }
    ]
  });

  assert.ok(pdfBytes.byteLength > 0);
  const pdfString = Buffer.from(pdfBytes).toString('latin1');
  assert.ok(pdfString.startsWith('%PDF-1.4'));
  assert.ok(pdfString.includes('/Type /Catalog'));
  assert.ok(pdfString.includes('/Type /Pages'));
  assert.ok(pdfString.includes('/Img1'));
  assert.ok(pdfString.includes('/Img2'));
  assert.ok(pdfString.includes('trailer'));
  assert.ok(pdfString.includes('%%EOF'));

  // Verify that the generated PDF is 100% compliant and parsed by pdfjs
  const doc = await getDocument({ data: new Uint8Array(pdfBytes) }).promise;
  assert.equal(doc.numPages, 1);
  const page = await doc.getPage(1);
  const content = await page.getTextContent();
  const allText = content.items.map(i => i.str).join(' ');
  assert.ok(allText.includes('Dental Monitoring'));
  assert.ok(allText.includes('Daily Finished Volume'));
  assert.ok(allText.includes('Hourly Productivity Velocity'));
});

test('buildReportPdf generates crisp native vector bar and line charts when data is provided', async () => {
  const DateRangePicker = sandbox.window.Daybook.DateRangePicker;
  const reports = [
    { date: '2026-10-27', casesFinished: 243, individualScore: 2065.5 },
    { date: '2026-10-28', casesFinished: 354, individualScore: 3009 }
  ];
  const hourlyPoints = [
    { hour: 7, hourLabel: '07:00', finished: 18 },
    { hour: 8, hourLabel: '08:00', finished: 35 },
    { hour: 13, hourLabel: '13:00', finished: 46 }
  ];

  const pdfBytes = DateRangePicker.buildReportPdf({
    title: 'Dental Monitoring — Performance & Productivity Report',
    dateRangeText: '27 Oct 2026 – 28 Oct 2026',
    generatedAtText: 'October 29, 2026',
    kpis: [
      { label: 'TOTAL VOLUME', value: '597 cases' },
      { label: 'DAILY VELOCITY', value: '298.5 cases/day' }
    ],
    chart1Title: 'Daily Finished Volume (Cases / Day)',
    barChartData: reports,
    selectedDate: '2026-10-28',
    chart2Title: 'Hourly Productivity — 2026-10-28',
    lineChartData: hourlyPoints,
    funFacts: [
      { label: 'PEAK HOUR', value: '1:00 - 2:00 PM', sub: 'Avg 46/hr' },
      { label: '> 350 MILESTONE', value: '1 of 2 days', sub: '50% exceeded 350 cases' }
    ]
  });

  assert.ok(pdfBytes.byteLength > 0);
  const pdfString = Buffer.from(pdfBytes).toString('latin1');
  assert.ok(pdfString.startsWith('%PDF-1.4'));

  // Ensure PDF contains vector commands (re, f, m, l, S)
  assert.ok(pdfString.includes('re f'));
  assert.ok(pdfString.includes('re S'));

  // Parse with pdfjs to verify complete text readability
  const doc = await getDocument({ data: new Uint8Array(pdfBytes) }).promise;
  assert.equal(doc.numPages, 1);
  const page = await doc.getPage(1);
  const content = await page.getTextContent();
  const allText = content.items.map(i => i.str).join(' ');

  // Bar chart labels & values
  assert.ok(allText.includes('243'), 'Contains 243 cases bar label');
  assert.ok(allText.includes('354'), 'Contains 354 cases bar label');
  assert.ok(allText.includes('10/27'), 'Contains 10/27 date label');
  assert.ok(allText.includes('10/28'), 'Contains 10/28 date label');

  // Line chart labels & hours
  assert.ok(allText.includes('07:00'), 'Contains 07:00 hourly node label');
  assert.ok(allText.includes('08:00'), 'Contains 08:00 hourly node label');
  assert.ok(allText.includes('13:00'), 'Contains 13:00 hourly node label');

  // Fun facts & KPIs
  assert.ok(allText.includes('> 350 MILESTONE'));
  assert.ok(allText.includes('TOTAL VOLUME'));
});
