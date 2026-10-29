import { createHash } from 'node:crypto';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

export class UnsupportedFormatError extends Error {
  constructor(message = 'The file is not a supported Daily Performance Report format.') {
    super(message);
    this.name = 'UnsupportedFormatError';
    this.code = 'UNSUPPORTED_FORMAT';
    this.isUnsupportedFormat = true;
  }
}

export function isUnsupportedReportError(error) {
  if (!error) return false;
  if (error instanceof UnsupportedFormatError || error.code === 'UNSUPPORTED_FORMAT' || error.isUnsupportedFormat) {
    return true;
  }
  const msg = String(error.message || '').toLowerCase();
  return msg.includes('not a supported') ||
         msg.includes('unsupported format') ||
         msg.includes('daily report date is missing') ||
         msg.includes('choose a pdf report no larger than') ||
         msg.includes('the report must contain 1 to 10 pages') ||
         msg.includes('missing its individual score or cases total') ||
         msg.includes('does not contain hourly details');
}

export function isDashboardReportFormat(items) {
  if (!Array.isArray(items) || !items.length) return false;
  const hasDailyDate = items.some(item => typeof item.str === 'string' && item.str.toLowerCase() === 'daily report date');
  const hasScore = items.some(item => typeof item.str === 'string' && (item.str.toLowerCase() === 'individual_score' || item.str.toLowerCase() === 'individual score'));
  const hasTotal = items.some(item => typeof item.str === 'string' && item.str.toLowerCase() === 'total');
  return hasDailyDate && hasScore && hasTotal;
}

function parseReportingDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new UnsupportedFormatError('Daily Report Date is invalid.');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new UnsupportedFormatError('Daily Report Date is invalid.');
  return value;
}

const MAX_BYTES = 20 * 1024 * 1024;
const MONTHS = new Map(Object.entries({
  jan: 1, janv: 1, feb: 2, fev: 2, fév: 2, mar: 3, mars: 3, apr: 4, avr: 4,
  may: 5, mai: 5, jun: 6, juin: 6, jul: 7, juil: 7, aug: 8, aou: 8, août: 8,
  sep: 9, sept: 9, oct: 10, nov: 11, dec: 12, déc: 12,
}));

function amount(text) {
  const cleaned = String(text || '').replace(/[\s,]/g, '');
  return /^\d+(?:\.\d+)?$/.test(cleaned) ? Number(cleaned) : null;
}

function displayedDate(text) {
  const value = String(text || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return parseReportingDate(value);
  const match = value.match(/^([\p{L}]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/u);
  const month = match && MONTHS.get(match[1].toLowerCase().slice(0, 4)) || (match && MONTHS.get(match[1].toLowerCase().slice(0, 3)));
  if (!month) throw new UnsupportedFormatError('Daily Report Date is missing or uses an unsupported format.');
  return parseReportingDate(`${match[3]}-${String(month).padStart(2, '0')}-${String(Number(match[2])).padStart(2, '0')}`);
}

function groupedLines(items) {
  const lines = [];
  for (const item of items.filter(item => item.str.trim()).sort((a, b) => b.y - a.y || a.x - b.x)) {
    let line = lines.find(candidate => candidate.page === item.page && Math.abs(candidate.y - item.y) <= 2);
    if (!line) { line = { page: item.page, y: item.y, items: [] }; lines.push(line); }
    line.items.push(item);
  }
  for (const line of lines) line.items.sort((a, b) => a.x - b.x);
  return lines;
}

function nearestBelow(items, label, { maxX = 300, maxY = 60, numeric = false } = {}) {
  if (!label) return null;
  return items.filter(item => item.page === label.page && item.y < label.y - 4 && item.y >= label.y - maxY
      && item.x >= label.x - 8 && item.x <= label.x + maxX && item.str.trim()
      && (!numeric || amount(item.str) !== null))
    .sort((a, b) => b.y - a.y || Math.abs(a.x - label.x) - Math.abs(b.x - label.x))[0]?.str.trim() || null;
}

function dailyRecord(date, metric, value, unit, aggregation = 'latest') {
  return { reportDate: date, hour: null, granularity: 'daily', metric, value, unit, aggregation, dimensions: {} };
}

export async function parseDashboardPdf(input) {
  const bytes = Buffer.from(input);
  if (bytes.length < 100 || bytes.length > MAX_BYTES || bytes.subarray(0, 5).toString() !== '%PDF-') {
    throw new UnsupportedFormatError('Choose a PDF report no larger than 20 MiB.');
  }
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, stopAtErrors: true });
  const items = [];
  try {
    const pdf = await task.promise;
    if (pdf.numPages < 1 || pdf.numPages > 10) throw new UnsupportedFormatError('The report must contain 1 to 10 pages.');
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      for (const item of (await page.getTextContent()).items) {
        if (typeof item.str === 'string') items.push({ str: item.str.trim(), x: item.transform[4], y: item.transform[5], page: pageNumber });
      }
      page.cleanup();
    }
  } catch (err) {
    if (err instanceof UnsupportedFormatError) throw err;
    throw new UnsupportedFormatError(`Failed to read PDF document: ${err.message}`);
  } finally { await task.destroy(); }

  return parseDashboardItems(items, bytes);
}

export function parseDashboardItems(items, bytes = Buffer.alloc(0)) {
  const lines = groupedLines(items);
  const label = (name) => items.filter(item => item.str.toLowerCase() === name.toLowerCase()).sort((a, b) => b.y - a.y)[0];
  const dateLabel = label('Daily Report Date');
  if (!dateLabel) {
    throw new UnsupportedFormatError('Daily Report Date is missing or uses an unsupported format.');
  }
  const date = displayedDate(nearestBelow(items, dateLabel, { maxX: 180, maxY: 45 }));
  const scoreLabel = label('individual_score') || label('individual score');
  if (!scoreLabel) {
    throw new UnsupportedFormatError('The report is missing its individual score or cases total.');
  }
  const individualScore = amount(nearestBelow(items, scoreLabel, { maxX: 120, maxY: 30, numeric: true }));
  const totalLine = lines.find(line => line.items.some(item => item.str === 'Total'));
  const totalLabel = totalLine?.items.find(item => item.str === 'Total');
  const casesFinished = amount(totalLine?.items.find(item => item.x > totalLabel.x && amount(item.str) !== null)?.str);
  if (individualScore === null || casesFinished === null) throw new UnsupportedFormatError('The report is missing its individual score or cases total.');

  const details = [];
  const dateTime = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
  for (const line of lines) {
    const stamps = line.items.filter(item => dateTime.test(item.str));
    if (stamps.length !== 2) continue;
    const [start, end] = stamps;
    if (!start.str.startsWith(date) || !end.str.startsWith(date)) throw new Error('Details rows do not match the Daily Report Date.');
    const hour = Number(start.str.slice(11, 13));
    const tz = line.items.find(item => item.x < start.x && /^[A-Za-z]{1,5}$/.test(item.str))?.str;
    const numbers = line.items.filter(item => item.x > end.x && amount(item.str) !== null).sort((a, b) => a.x - b.x).slice(0, 2);
    const taskType = line.items.filter(item => item.x > end.x && item.x < (numbers[0]?.x ?? Infinity) && amount(item.str) === null)
      .map(item => item.str).join(' ').trim();
    if (!tz || !taskType || numbers.length !== 2 || !Number.isInteger(hour) || hour > 23) throw new Error('A Details row is incomplete.');
    details.push({ tz, hour, start: start.str, end: end.str, taskType, finished: amount(numbers[0].str), score: amount(numbers[1].str) });
  }
  if (!details.length || details.reduce((sum, row) => sum + row.finished, 0) !== casesFinished) {
    throw new Error('Details rows are missing or their finished cases do not match the total.');
  }

  const benchmark = (name) => amount(nearestBelow(items, label(name), { maxX: 120, maxY: 30, numeric: true }));
  const scoreBreakdown = amount(items.find(item => /^\d[\d ]* pts$/.test(item.str))?.str.replace(/ pts$/, ''));
  const refreshLine = lines.find(line => line.items.some(item => item.str === 'Last refresh was'));
  const lastRefreshText = refreshLine?.items.map(item => item.str).join(' ').replace(/\s+/g, ' ').trim() || '';
  const exportedAt = items.find(item => /\b\d{4}\s+\d{1,2}:\d{2}\s*[AP]M\s*\(GMT\)/i.test(item.str))?.str || '';
  const metadata = {
    operator: nearestBelow(items, label('Operator'), { maxX: 300, maxY: 60 }) || '',
    shift: nearestBelow(items, label('Shift'), { maxX: 300, maxY: 60 }) || '',
    taskType: [...new Set(details.map(row => row.taskType))].join(', '),
    goalScoreIndividual: benchmark('goal_score_individual'),
    shiftScore: benchmark('shift score'), siteScore: benchmark('site score'), globalScore: benchmark('global score'),
    scoreBreakdown, sourceExportedAt: exportedAt, lastRefreshText,
  };
  const records = [
    dailyRecord(date, 'Cases finished', casesFinished, 'cases', 'sum'),
    dailyRecord(date, 'Individual score', individualScore, 'pts'),
  ];
  for (const [field, metric] of [['goalScoreIndividual', 'Goal score individual'], ['shiftScore', 'Shift score'], ['siteScore', 'Site score'], ['globalScore', 'Global score'], ['scoreBreakdown', 'Score breakdown']]) {
    if (metadata[field] !== null) records.push(dailyRecord(date, metric, metadata[field], 'pts'));
  }
  for (const row of details) {
    const dimensions = { TZ: row.tz, End: row.end, 'Task Type': row.taskType };
    records.push({ reportDate: date, hour: row.hour, granularity: 'hourly', metric: 'Cases finished', value: row.finished, unit: 'cases', aggregation: 'sum', dimensions });
    records.push({ reportDate: date, hour: row.hour, granularity: 'hourly', metric: 'Details score', value: row.score, unit: 'pts', aggregation: 'sum', dimensions });
  }
  return { date, casesFinished, individualScore, details, metadata, records, sha256: createHash('sha256').update(bytes).digest('hex') };
}
