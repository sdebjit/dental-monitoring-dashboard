/**
 * Daybook — Production Frontend Modules
 *
 * Modular Architecture Overview:
 * 1. DaybookCore: DOM, notifications, error mapper, and API transport.
 * 2. DaybookDateUtils: ISO date formatting, billing presets, comparison cycles, and label generators.
 * 3. DaybookMetrics: Throughput calculations, hourly detail aggregation, and conflict resolution.
 * 4. DaybookCharts: SVG daily finished cases bar chart and single/multi-day hourly velocity charts.
 * 5. DaybookFunFacts: Performance milestones, peak/slowest hours, and collapsible section controller.
 * 6. DaybookDateRangePicker: Dual-calendar popover, custom range selection, and PDF export bridge.
 * 7. DaybookFolderExplorer: Google Drive folder tree, dynamic subfolders, and onboarding flow.
 * 8. DaybookApp: Application state orchestrator, authentication lifecycle, and data synchronization.
 */

// ============================================================================
// MODULE 1: DaybookCore (State, DOM Helpers, Error Mapper & API Transport)
// ============================================================================

let csrf = '';
let currentUser = null;
let currentOnboardStep = 1;
const $ = id => document.getElementById(id);
const message = text => {
  const el = $('message');
  if (el) el.textContent = text || '';
  if (text && /failed|error|not found|denied|invalid/i.test(text)) {
    const friendly = formatUserFriendlyError(text);
    if (friendly) showTopError(friendly.title, friendly.desc, friendly.action?.label, friendly.action?.href);
  }
};

function formatUserFriendlyError(raw) {
  if (!raw) return null;
  const str = String(raw).trim();
  if (!str) return null;

  if (/file not found|404|not_found|notFound/i.test(str)) {
    return {
      title: 'Google Drive Folder Not Found',
      desc: 'The designated folder could not be found. It may have been moved, renamed, or deleted in Google Drive.',
      action: { label: 'Reconnect in Settings →', href: '/settings' }
    };
  }
  if (/insufficient.*scope|insufficientpermission|permission_denied|invalid_grant|unauthorized|invalid credentials|token expired/i.test(str)) {
    return {
      title: 'Google Drive Permission Required',
      desc: 'Access to Google Drive was not granted or has expired. Please re-authenticate and ensure Drive permissions are enabled.',
      action: { label: 'Grant Drive Permission →', href: '/auth/login' }
    };
  }
  if (/select a google drive folder|cannot add files|permission|access denied|403/i.test(str)) {
    return {
      title: 'Folder Access Restricted',
      desc: 'The app lacks permission to save files or create the archive directory in this folder.',
      action: { label: 'Select Another Folder →', href: '/settings' }
    };
  }
  if (/exceeds.*limit|20 mib/i.test(str)) {
    return {
      title: 'PDF File Limit Exceeded',
      desc: 'A daily report PDF exceeds the maximum file size limit (20 MB) and could not be imported.',
      action: { label: 'View Import Audit →', href: '/settings' }
    };
  }
  if (/corrupt|failed to parse|invalid report/i.test(str)) {
    return {
      title: 'PDF Parsing Issue',
      desc: 'One of the reports encountered a formatting issue while parsing daily metrics.',
      action: { label: 'View Import Audit →', href: '/settings' }
    };
  }
  return {
    title: 'Sync Notice',
    desc: str.replace(/^Error:\s*/i, ''),
    action: { label: 'Review in Settings →', href: '/settings' }
  };
}

function showTopError(title, desc, actionLabel = '', actionHref = '') {
  const banner = $('top-error-banner');
  if (!banner) return;
  const titleEl = $('top-error-title');
  const descEl = $('top-error-desc');
  if (titleEl) titleEl.textContent = title;
  if (descEl) descEl.textContent = desc;

  const actionEl = $('top-error-action');
  if (actionEl) {
    if (actionLabel && actionHref) {
      actionEl.textContent = actionLabel;
      actionEl.href = actionHref;
      actionEl.classList.remove('hidden');
    } else {
      actionEl.classList.add('hidden');
    }
  }
  banner.classList.remove('hidden');
}

function hideTopError() {
  const banner = $('top-error-banner');
  if (banner) banner.classList.add('hidden');
}

async function checkSourceStatus() {
  const sourceAlertCard = $('source-alert-card');
  const emptySourceAction = $('empty-state-source-action');

  if (!currentUser?.folderId) {
    if (sourceAlertCard) {
      sourceAlertCard.classList.remove('hidden');
      const titleEl = $('source-alert-title');
      const descEl = $('source-alert-desc');
      if (titleEl) titleEl.textContent = 'Google Drive Source Disconnected';
      if (descEl) descEl.textContent = 'No Google Drive folder is currently linked. Connect your folder in Settings to begin importing daily reports.';
    }
    if (emptySourceAction) emptySourceAction.classList.remove('hidden');
    return false;
  }

  try {
    const status = await api('/api/source-status');
    if (!status.available) {
      if (sourceAlertCard) {
        sourceAlertCard.classList.remove('hidden');
        const titleEl = $('source-alert-title');
        const descEl = $('source-alert-desc');
        if (status.reason === 'not_found') {
          if (titleEl) titleEl.textContent = 'Google Drive Folder Not Found';
          if (descEl) descEl.textContent = 'The designated Google Drive folder was removed, moved, or deleted. Connect a source folder in Settings to resume syncing.';
          showTopError(
            'Google Drive Folder Not Found',
            'We could not locate your connected Google Drive folder. It may have been renamed or deleted.',
            'Reconnect in Settings →',
            '/settings'
          );
        } else {
          if (titleEl) titleEl.textContent = 'Google Drive Source Inaccessible';
          if (descEl) descEl.textContent = status.message || 'The connected folder is currently unavailable. Connect or update your folder in Settings.';
          showTopError(
            'Source Inaccessible',
            status.message || 'There was an issue accessing your Google Drive folder.',
            'Update Folder in Settings →',
            '/settings'
          );
        }
      }
      if (emptySourceAction) emptySourceAction.classList.remove('hidden');
      return false;
    } else {
      if (sourceAlertCard) sourceAlertCard.classList.add('hidden');
      if (emptySourceAction) emptySourceAction.classList.add('hidden');
      return true;
    }
  } catch (err) {
    const isError = Boolean(currentUser?.lastScanError && /folder|not found|404|drive/i.test(currentUser.lastScanError));
    if (isError && sourceAlertCard) {
      sourceAlertCard.classList.remove('hidden');
      const titleEl = $('source-alert-title');
      const descEl = $('source-alert-desc');
      if (titleEl) titleEl.textContent = 'Google Drive Folder Inaccessible';
      if (descEl) descEl.textContent = 'The designated folder could not be reached. Update your folder in Settings.';
      if (emptySourceAction) emptySourceAction.classList.remove('hidden');
      return false;
    }
    if (sourceAlertCard) sourceAlertCard.classList.add('hidden');
    if (emptySourceAction) emptySourceAction.classList.add('hidden');
    return true;
  }
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.method === 'POST' ? { 'X-Daybook-CSRF': csrf } : {}),
      ...(options.headers || {})
    }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

const post = (path, data = {}) => api(path, { method: 'POST', body: JSON.stringify(data) });

function element(tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

function createSubfolderLoader() {
  const wrap = document.createElement('div');
  wrap.className = 'tree-subfolder-loader';
  wrap.innerHTML = `
    <svg class="inline-spinner-svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
      <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
    </svg>
    <span class="loader-subtext">Loading subfolders…</span>
  `;
  return wrap;
}

function setSelectButtonState(btn, isSelected) {
  if (!btn) return;
  btn.classList.toggle('active', isSelected);
  btn.setAttribute('aria-pressed', String(isSelected));
  if (isSelected) {
    btn.innerHTML = `
      <svg class="select-check-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
      <span>Selected</span>
    `;
  } else {
    btn.innerHTML = `<span>Select</span>`;
  }
}

// ============================================================================
// MODULE 2: DaybookDateUtils (Calendar Presets, Formatting & Cycle Math)
// ============================================================================

let rawReportsData = [];
let activeDateRange = getPresetRange('billingMonth');
let pendingDateRange = { ...activeDateRange, preset: 'billingMonth' };
let calendarViewDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let isDateRangePickerInitialized = false;
let selectedChartDate = null;

function padZero(n) {
  return String(n).padStart(2, '0');
}

function toIsoDate(d) {
  return `${d.getFullYear()}-${padZero(d.getMonth() + 1)}-${padZero(d.getDate())}`;
}

function getPresetRange(presetKey, now = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();

  switch (presetKey) {
    case 'today': {
      const todayIso = toIsoDate(now);
      return { start: todayIso, end: todayIso, preset: 'today' };
    }
    case 'yesterday': {
      const yest = new Date(y, m, d - 1);
      const yestIso = toIsoDate(yest);
      return { start: yestIso, end: yestIso, preset: 'yesterday' };
    }
    case 'last7': {
      const start = new Date(y, m, d - 6);
      return { start: toIsoDate(start), end: toIsoDate(now), preset: 'last7' };
    }
    case 'last30': {
      const start = new Date(y, m, d - 29);
      return { start: toIsoDate(start), end: toIsoDate(now), preset: 'last30' };
    }
    case 'billingMonth': {
      // Current billing month: current month's 16th till next month's 15th (if date >= 16), else last month's 16th till current month's 15th
      const isCurrentCycle = d >= 16;
      const start = isCurrentCycle ? new Date(y, m, 16) : new Date(y, m - 1, 16);
      const end = isCurrentCycle ? new Date(y, m + 1, 15) : new Date(y, m, 15);
      return { start: toIsoDate(start), end: toIsoDate(end), preset: 'billingMonth' };
    }
    case 'currentMonth': {
      const start = new Date(y, m, 1);
      const lastDay = new Date(y, m + 1, 0);
      return { start: toIsoDate(start), end: toIsoDate(lastDay), preset: 'currentMonth' };
    }
    case 'lastMonth': {
      const start = new Date(y, m - 1, 1);
      const end = new Date(y, m, 0);
      return { start: toIsoDate(start), end: toIsoDate(end), preset: 'lastMonth' };
    }
    case 'ytd': {
      const start = new Date(y, 0, 1);
      return { start: toIsoDate(start), end: toIsoDate(now), preset: 'ytd' };
    }
    case 'lastYear': {
      const start = new Date(y - 1, 0, 1);
      const end = new Date(y - 1, 11, 31);
      return { start: toIsoDate(start), end: toIsoDate(end), preset: 'lastYear' };
    }
    default:
      return getPresetRange('billingMonth', now);
  }
}

function formatRangeLabel(startIso, endIso) {
  if (!startIso || !endIso) return 'All time';
  try {
    const s = new Date(startIso + 'T00:00:00');
    const e = new Date(endIso + 'T00:00:00');
    const opt = { month: 'short', day: 'numeric', year: 'numeric' };
    return `${s.toLocaleDateString(undefined, opt)} – ${e.toLocaleDateString(undefined, opt)}`;
  } catch (_) {
    return `${startIso} – ${endIso}`;
  }
}

async function loadReports() {
  let sourceAvailable = true;

  try {
    const [sourceRes, reportsRes] = await Promise.allSettled([
      checkSourceStatus(),
      api('/api/reports')
    ]);

    if (sourceRes.status === 'fulfilled') {
      sourceAvailable = Boolean(sourceRes.value);
    }
    if (reportsRes.status === 'fulfilled') {
      rawReportsData = reportsRes.value?.reports || [];
    } else {
      const err = reportsRes.reason;
      const friendly = formatUserFriendlyError(err?.message);
      if (friendly) showTopError(friendly.title, friendly.desc, friendly.action?.label, friendly.action?.href);
    }
  } catch (err) {
    const friendly = formatUserFriendlyError(err.message);
    if (friendly) showTopError(friendly.title, friendly.desc, friendly.action?.label, friendly.action?.href);
  }

  initDateRangePicker();
  initFunFactsCollapse();
  filterAndRenderDashboard();

  const emptySourceAction = $('empty-state-source-action');
  if (emptySourceAction) {
    emptySourceAction.classList.toggle('hidden', sourceAvailable);
  }
}

// ============================================================================
// MODULE 3: DaybookMetrics (Aggregations, Throughput & Conflict Detection)
// ============================================================================

function computeMetrics(reports) {
  if (!reports || !reports.length) {
    return {
      hasData: false,
      totalCases: 0,
      avgCasesPerDay: 0,
      avgCasesPerHour: 0,
      totalPoints: 0,
      reportCount: 0
    };
  }

  const totalCases = reports.reduce((sum, r) => sum + (Number(r.casesFinished) || 0), 0);
  const distinctDates = new Set(reports.map(r => r.date).filter(Boolean));
  const daysCount = distinctDates.size || reports.length || 1;
  const avgCasesPerDay = totalCases / daysCount;

  // Average cases per hour (Considering on each file)
  let hourlyRateSum = 0;
  for (const r of reports) {
    let hours = 8;
    if (Array.isArray(r.details) && r.details.length > 0) {
      const uniqueHours = new Set(r.details.map(d => d.hour).filter(h => h !== undefined && h !== null));
      hours = uniqueHours.size || r.details.length || 8;
    }
    const reportCases = Number(r.casesFinished) || 0;
    const rate = reportCases / Math.max(1, hours);
    hourlyRateSum += rate;
  }
  const avgCasesPerHour = hourlyRateSum / reports.length;
  const totalPoints = reports.reduce((sum, r) => sum + (Number(r.individualScore) || 0), 0);

  return {
    hasData: true,
    totalCases,
    avgCasesPerDay,
    avgCasesPerHour,
    totalPoints,
    reportCount: reports.length
  };
}

function getComparisonPeriod(startIso, endIso) {
  if (!startIso || !endIso) return null;
  const s = new Date(startIso + 'T00:00:00');
  const e = new Date(endIso + 'T00:00:00');
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return null;

  // 1. Single day comparison (comparing with that day - 1 day)
  if (startIso === endIso) {
    const prev = new Date(s);
    prev.setDate(prev.getDate() - 1);
    const prevIso = toIsoDate(prev);
    return { start: prevIso, end: prevIso };
  }

  // 2. Month comparison (if range is whole month or month-to-date)
  const isStartFirstOfMonth = s.getDate() === 1;
  const isSameMonth = s.getFullYear() === e.getFullYear() && s.getMonth() === e.getMonth();
  const lastDayOfCurrentMonth = new Date(s.getFullYear(), s.getMonth() + 1, 0).getDate();
  const isFullMonth = isStartFirstOfMonth && isSameMonth && e.getDate() === lastDayOfCurrentMonth;
  const isMonthToDate = isStartFirstOfMonth && isSameMonth;

  if (isFullMonth) {
    const prevMonthStart = new Date(s.getFullYear(), s.getMonth() - 1, 1);
    const prevMonthEnd = new Date(s.getFullYear(), s.getMonth(), 0);
    return { start: toIsoDate(prevMonthStart), end: toIsoDate(prevMonthEnd) };
  }

  if (isMonthToDate) {
    const prevMonthStart = new Date(s.getFullYear(), s.getMonth() - 1, 1);
    const maxDaysPrev = new Date(s.getFullYear(), s.getMonth(), 0).getDate();
    const prevMonthEnd = new Date(s.getFullYear(), s.getMonth() - 1, Math.min(e.getDate(), maxDaysPrev));
    return { start: toIsoDate(prevMonthStart), end: toIsoDate(prevMonthEnd) };
  }

  // 3. Billing cycle comparison (16th of a month to 15th of next month)
  if (s.getDate() === 16 && e.getDate() === 15) {
    const prevBillingStart = new Date(s.getFullYear(), s.getMonth() - 1, 16);
    const prevBillingEnd = new Date(s.getFullYear(), s.getMonth(), 15);
    return { start: toIsoDate(prevBillingStart), end: toIsoDate(prevBillingEnd) };
  }

  // 4. N-day custom range: compare with the immediately preceding N days
  const dayCount = Math.round((e.getTime() - s.getTime()) / (24 * 3600 * 1000)) + 1;
  const compEnd = new Date(s);
  compEnd.setDate(compEnd.getDate() - 1);
  const compStart = new Date(compEnd);
  compStart.setDate(compStart.getDate() - (dayCount - 1));

  return { start: toIsoDate(compStart), end: toIsoDate(compEnd) };
}

function renderDeltaBadge(el, currentVal, compVal, options = {}) {
  if (!el) return;
  if (!options.hasCompData || compVal === null || compVal === undefined || isNaN(compVal)) {
    el.classList.add('hidden');
    el.textContent = '';
    return;
  }

  if (compVal === 0 && currentVal === 0) {
    el.classList.add('hidden');
    el.textContent = '';
    return;
  }

  const diff = currentVal - compVal;
  const pct = compVal !== 0 ? ((diff / compVal) * 100) : (diff > 0 ? 100 : -100);
  const isPositive = diff > 0;
  const isNegative = diff < 0;

  const unit = options.unit || '';
  const decimals = options.decimals !== undefined ? options.decimals : (Math.abs(diff) < 10 && !Number.isInteger(diff) ? 1 : 0);
  const formattedDiff = Math.abs(diff) >= 1000
    ? Math.round(diff).toLocaleString()
    : (decimals === 0 ? String(Math.round(diff)) : diff.toFixed(decimals));
  const signDiff = diff > 0 ? `+${formattedDiff}` : (diff < 0 ? formattedDiff : '0');
  const signPct = (diff > 0 ? '+' : '') + pct.toFixed(1) + '%';

  const unitSuffix = unit ? ` ${unit}` : '';
  el.textContent = `${signPct} (${signDiff}${unitSuffix})`;
  el.className = 'kpi-delta';
  if (isPositive) el.classList.add('delta-positive');
  else if (isNegative) el.classList.add('delta-negative');
  else el.classList.add('delta-neutral');
  el.classList.remove('hidden');
}

function getReportHourlyBreakdown(report) {
  if (!report) return [];
  const details = report.details || [];
  if (!Array.isArray(details) || !details.length) {
    const total = Number(report.casesFinished) || 0;
    const score = Number(report.individualScore) || 0;
    if (total === 0) return [];
    const points = [];
    const baseHour = 9;
    const hours = 8;
    const perHour = Math.floor(total / hours);
    const rem = total % hours;
    for (let i = 0; i < hours; i++) {
      const h = baseHour + i;
      points.push({
        hour: h,
        hourLabel: `${String(h).padStart(2, '0')}:00`,
        finished: perHour + (i === hours - 1 ? rem : 0),
        score: Math.round(score / hours),
        tasks: ['Operational Task']
      });
    }
    return points;
  }

  const hourMap = new Map();
  for (const row of details) {
    const h = Number(row.hour);
    if (isNaN(h)) continue;
    if (!hourMap.has(h)) {
      hourMap.set(h, {
        hour: h,
        hourLabel: `${String(h).padStart(2, '0')}:00`,
        finished: 0,
        score: 0,
        tasks: []
      });
    }
    const entry = hourMap.get(h);
    entry.finished += Number(row.finished) || 0;
    entry.score += Number(row.score) || 0;
    if (row.taskType && !entry.tasks.includes(row.taskType)) {
      entry.tasks.push(row.taskType);
    }
  }

  return [...hourMap.values()].sort((a, b) => a.hour - b.hour);
}

// ============================================================================
// MODULE 4: DaybookCharts (Daily Bar Chart & Hourly SVG Line Charts)
// ============================================================================

function renderDailyCasesBarChart(filteredReports) {
  const container = $('daily-cases-chart-container');
  const tooltip = $('daily-chart-tooltip');
  const activePill = $('daily-chart-active-pill');
  const selectedDateEl = $('daily-chart-selected-date');
  const clearBtn = $('daily-chart-clear-btn');
  if (!container) return;

  container.replaceChildren();

  if (activePill && selectedDateEl) {
    if (selectedChartDate) {
      selectedDateEl.textContent = selectedChartDate;
      activePill.classList.remove('hidden');
    } else {
      activePill.classList.add('hidden');
    }
  }

  if (clearBtn) {
    clearBtn.onclick = (e) => {
      e.stopPropagation();
      selectedChartDate = null;
      renderDailyCasesBarChart(filteredReports);
      renderHourlyProductivityLineChart(filteredReports);
    };
  }

  if (!filteredReports.length) {
    const emptyNotice = element('div', '', 'chart-empty-notice');
    emptyNotice.textContent = 'No report data found for this date range.';
    container.append(emptyNotice);
    return;
  }

  const chron = [...filteredReports].sort((a, b) => a.date.localeCompare(b.date));

  const svgW = 900;
  const svgH = 260;
  const padLeft = 60;
  const padRight = 30;
  const padTop = 30;
  const padBottom = 45;
  const plotW = svgW - padLeft - padRight;
  const plotH = svgH - padTop - padBottom;

  const maxVal = Math.max(...chron.map(r => Number(r.casesFinished) || 0), 10);
  const yTicks = 4;
  const step = Math.ceil(maxVal / yTicks / 10) * 10 || 10;
  const yMax = step * yTicks;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${svgW} ${svgH}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Daily Cases Bar Chart');

  // Background Grid Lines and Y-Axis Ticks
  for (let i = 0; i <= yTicks; i++) {
    const val = yMax - i * step;
    const y = padTop + (i / yTicks) * plotH;

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', padLeft);
    line.setAttribute('y1', y);
    line.setAttribute('x2', padLeft + plotW);
    line.setAttribute('y2', y);
    line.setAttribute('class', i === yTicks ? 'chart-axis-line' : 'chart-grid-line');
    svg.append(line);

    const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    txt.setAttribute('x', padLeft - 10);
    txt.setAttribute('y', y + 4);
    txt.setAttribute('text-anchor', 'end');
    txt.setAttribute('class', 'chart-axis-text');
    txt.textContent = val.toLocaleString();
    svg.append(txt);
  }

  const N = chron.length;
  const slotW = plotW / N;
  const barW = Math.min(Math.max(14, slotW * 0.65), 52);
  const labelInterval = N > 24 ? 4 : (N > 14 ? 2 : 1);

  chron.forEach((r, idx) => {
    const cases = Number(r.casesFinished) || 0;
    const barH = (cases / yMax) * plotH;
    const x = padLeft + idx * slotW + (slotW - barW) / 2;
    const y = padTop + plotH - barH;
    const isSelected = r.date === selectedChartDate;

    // Bar rect
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', x);
    rect.setAttribute('y', y);
    rect.setAttribute('width', barW);
    rect.setAttribute('height', Math.max(3, barH));
    rect.setAttribute('rx', 4);
    rect.setAttribute('ry', 4);
    rect.setAttribute('class', `chart-bar-rect ${isSelected ? 'is-active' : ''}`);
    rect.setAttribute('data-date', r.date);

    // Value label on top of bar (if space permits)
    if (N <= 18 && barH > 15) {
      const valLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      valLabel.setAttribute('x', x + barW / 2);
      valLabel.setAttribute('y', y - 6);
      valLabel.setAttribute('class', 'chart-val-label');
      valLabel.textContent = cases.toLocaleString();
      svg.append(valLabel);
    }

    // X-axis label
    if (idx % labelInterval === 0 || idx === N - 1) {
      const xLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      xLabel.setAttribute('x', x + barW / 2);
      xLabel.setAttribute('y', padTop + plotH + 20);
      xLabel.setAttribute('text-anchor', 'middle');
      xLabel.setAttribute('class', 'chart-axis-text');
      const dParts = r.date.split('-');
      xLabel.textContent = dParts.length === 3 ? `${Number(dParts[1])}/${Number(dParts[2])}` : r.date;
      svg.append(xLabel);
    }

    // Interactive Popover on Hover
    rect.onmouseenter = () => {
      if (!tooltip) return;
      const hourly = getReportHourlyBreakdown(r);
      const hoursCount = hourly.length || 8;
      const avgVelocity = hoursCount ? (cases / hoursCount).toFixed(1) : '0.0';
      const score = r.individualScore ?? '—';
      const prettyDate = new Date(r.date + 'T00:00:00').toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });

      const isCurrentlySelected = selectedChartDate === r.date;
      const hintText = isCurrentlySelected
        ? 'Click to unselect (show latest date) ✕'
        : 'Click to view hourly breakdown ↓';

      tooltip.innerHTML = `
        <div class="chart-tooltip-header">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          <span>${prettyDate}</span>
        </div>
        <div class="chart-tooltip-grid">
          <div class="tooltip-stat">
            <span class="tooltip-stat-label">Cases Done</span>
            <strong class="tooltip-stat-val">${cases.toLocaleString()}</strong>
          </div>
          <div class="tooltip-stat">
            <span class="tooltip-stat-label">Hours of Work</span>
            <strong class="tooltip-stat-val">${hoursCount} hrs</strong>
          </div>
          <div class="tooltip-stat">
            <span class="tooltip-stat-label">Avg Pace</span>
            <strong class="tooltip-stat-val">${avgVelocity} /hr</strong>
          </div>
          <div class="tooltip-stat">
            <span class="tooltip-stat-label">Day Score</span>
            <strong class="tooltip-stat-val">${score} pts</strong>
          </div>
        </div>
        <div class="chart-tooltip-hint">
          <span>${hintText}</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
      `;

      const bodyRect = container.closest('.chart-body')?.getBoundingClientRect() || container.getBoundingClientRect();
      const barRect = rect.getBoundingClientRect();
      const leftPos = (barRect.left - bodyRect.left) + barRect.width / 2;
      const topPos = (barRect.top - bodyRect.top);

      tooltip.style.left = `${leftPos}px`;
      tooltip.style.top = `${topPos}px`;
      if (topPos < 120) {
        tooltip.style.transform = 'translate(-50%, 14px)';
      } else {
        tooltip.style.transform = 'translate(-50%, calc(-100% - 6px))';
      }
      tooltip.classList.remove('hidden');
    };

    rect.onmouseleave = () => {
      if (tooltip) tooltip.classList.add('hidden');
    };

    // Click to filter line chart (or toggle unselect if already active)
    rect.onclick = (e) => {
      e.stopPropagation();
      if (tooltip) tooltip.classList.add('hidden');
      if (selectedChartDate === r.date) {
        selectedChartDate = null;
      } else {
        selectedChartDate = r.date;
      }
      renderDailyCasesBarChart(filteredReports);
      renderHourlyProductivityLineChart(filteredReports);
    };

    svg.append(rect);
  });

  container.append(svg);
}

function renderSingleDateLineChart(container, points, report, tooltip, originalReports) {
  const svgW = 900;
  const svgH = 260;
  const padLeft = 60;
  const padRight = 35;
  const padTop = 30;
  const padBottom = 45;
  const plotW = svgW - padLeft - padRight;
  const plotH = svgH - padTop - padBottom;

  const maxHourly = Math.max(...points.map(p => p.finished), 10);
  const yTicks = 4;
  const step = Math.ceil(maxHourly / yTicks / 5) * 5 || 5;
  const yMax = step * yTicks;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${svgW} ${svgH}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Hourly Productivity Line Chart for ${report.date}`);

  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  defs.innerHTML = `
    <linearGradient id="hourly-area-gradient-single" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#10b981" stop-opacity="0.32" />
      <stop offset="100%" stop-color="#10b981" stop-opacity="0.0" />
    </linearGradient>
  `;
  svg.append(defs);

  // Horizontal Grid Lines & Labels
  for (let i = 0; i <= yTicks; i++) {
    const val = yMax - i * step;
    const y = padTop + (i / yTicks) * plotH;

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', padLeft);
    line.setAttribute('y1', y);
    line.setAttribute('x2', padLeft + plotW);
    line.setAttribute('y2', y);
    line.setAttribute('class', i === yTicks ? 'chart-axis-line' : 'chart-grid-line');
    svg.append(line);

    const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    txt.setAttribute('x', padLeft - 10);
    txt.setAttribute('y', y + 4);
    txt.setAttribute('text-anchor', 'end');
    txt.setAttribute('class', 'chart-axis-text');
    txt.textContent = `${val}`;
    svg.append(txt);
  }

  const N = points.length;
  const coords = points.map((p, i) => {
    const x = N === 1 ? padLeft + plotW / 2 : padLeft + (i / (N - 1)) * plotW;
    const y = padTop + plotH - (p.finished / yMax) * plotH;
    return { x, y, p };
  });

  // Area & Line Path
  if (coords.length > 1) {
    const areaPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const first = coords[0];
    const last = coords[coords.length - 1];
    let d = `M ${first.x} ${first.y}`;
    for (let i = 1; i < coords.length; i++) {
      d += ` L ${coords[i].x} ${coords[i].y}`;
    }
    d += ` L ${last.x} ${padTop + plotH} L ${first.x} ${padTop + plotH} Z`;
    areaPath.setAttribute('d', d);
    areaPath.setAttribute('fill', 'url(#hourly-area-gradient-single)');
    svg.append(areaPath);

    const linePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    let lineD = `M ${first.x} ${first.y}`;
    for (let i = 1; i < coords.length; i++) {
      lineD += ` L ${coords[i].x} ${coords[i].y}`;
    }
    linePath.setAttribute('d', lineD);
    linePath.setAttribute('class', 'chart-line-path');
    svg.append(linePath);
  }

  // Nodes & X-Axis Labels
  coords.forEach((coord) => {
    const { x, y, p } = coord;

    const xLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    xLabel.setAttribute('x', x);
    xLabel.setAttribute('y', padTop + plotH + 20);
    xLabel.setAttribute('text-anchor', 'middle');
    xLabel.setAttribute('class', 'chart-axis-text');
    xLabel.textContent = p.hourLabel;
    svg.append(xLabel);

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', x);
    circle.setAttribute('cy', y);
    circle.setAttribute('r', 5);
    circle.setAttribute('class', 'chart-node-circle');

    circle.onmouseenter = () => {
      if (!tooltip) return;
      const tasksStr = p.tasks.length ? p.tasks.join(', ') : '';
      tooltip.innerHTML = `
        <div class="chart-tooltip-header">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <span>${p.hourLabel} – ${String(p.hour + 1).padStart(2, '0')}:00</span>
        </div>
        <div class="chart-tooltip-grid">
          <div class="tooltip-stat">
            <span class="tooltip-stat-label">Cases Done</span>
            <strong class="tooltip-stat-val">${p.finished.toLocaleString()}</strong>
          </div>
          <div class="tooltip-stat">
            <span class="tooltip-stat-label">Hourly Score</span>
            <strong class="tooltip-stat-val">${p.score} pts</strong>
          </div>
        </div>
        ${tasksStr ? `<div class="chart-tooltip-hint" style="color:var(--zinc-500);"><span>Task: ${tasksStr}</span></div>` : ''}
      `;

      const bodyRect = container.closest('.chart-body')?.getBoundingClientRect() || container.getBoundingClientRect();
      const circleRect = circle.getBoundingClientRect();
      const leftPos = (circleRect.left - bodyRect.left) + circleRect.width / 2;
      const topPos = (circleRect.top - bodyRect.top);

      tooltip.style.left = `${leftPos}px`;
      tooltip.style.top = `${topPos}px`;
      if (topPos < 120) {
        tooltip.style.transform = 'translate(-50%, 14px)';
      } else {
        tooltip.style.transform = 'translate(-50%, calc(-100% - 6px))';
      }
      tooltip.classList.remove('hidden');
    };

    circle.onmouseleave = () => {
      if (tooltip) tooltip.classList.add('hidden');
    };

    svg.append(circle);
  });

  container.append(svg);
}

function renderGroupedDatesLineChart(container, chronReports, tooltip, originalReports) {
  const dayGroups = [];
  let maxHourly = 10;
  for (const r of chronReports) {
    const pts = getReportHourlyBreakdown(r);
    for (const p of pts) {
      if (p.finished > maxHourly) maxHourly = p.finished;
    }
    dayGroups.push({ report: r, points: pts });
  }

  const svgW = 900;
  const svgH = 260;
  const padLeft = 60;
  const padRight = 35;
  const padTop = 30;
  const padBottom = 52;
  const plotW = svgW - padLeft - padRight;
  const plotH = svgH - padTop - padBottom;

  const yTicks = 4;
  const step = Math.ceil(maxHourly / yTicks / 5) * 5 || 5;
  const yMax = step * yTicks;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${svgW} ${svgH}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Hourly Productivity Grouped by Date');

  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  defs.innerHTML = `
    <linearGradient id="hourly-area-gradient-grouped" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#10b981" stop-opacity="0.30" />
      <stop offset="100%" stop-color="#10b981" stop-opacity="0.0" />
    </linearGradient>
  `;
  svg.append(defs);

  // Y-Axis Horizontal Grid Lines and Labels
  for (let i = 0; i <= yTicks; i++) {
    const val = yMax - i * step;
    const y = padTop + (i / yTicks) * plotH;

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', padLeft);
    line.setAttribute('y1', y);
    line.setAttribute('x2', padLeft + plotW);
    line.setAttribute('y2', y);
    line.setAttribute('class', i === yTicks ? 'chart-axis-line' : 'chart-grid-line');
    svg.append(line);

    const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    txt.setAttribute('x', padLeft - 10);
    txt.setAttribute('y', y + 4);
    txt.setAttribute('text-anchor', 'end');
    txt.setAttribute('class', 'chart-axis-text');
    txt.textContent = `${val}`;
    svg.append(txt);
  }

  // Render each date group
  const M = dayGroups.length;
  const dayW = plotW / M;

  dayGroups.forEach((group, j) => {
    const { report, points: pts } = group;
    if (!pts.length) return;

    const dayStartX = padLeft + j * dayW;
    const innerPad = Math.min(22, Math.max(8, dayW * 0.08));
    const usableW = dayW - 2 * innerPad;

    // Day Vertical Divider (if j > 0)
    if (j > 0) {
      const divider = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      divider.setAttribute('x1', dayStartX);
      divider.setAttribute('y1', padTop);
      divider.setAttribute('x2', dayStartX);
      divider.setAttribute('y2', padTop + plotH);
      divider.setAttribute('class', 'chart-grid-line');
      divider.setAttribute('stroke-dasharray', '3 3');
      svg.append(divider);
    }

    // Calculate coordinates for this day's points
    const K = pts.length;
    const coords = pts.map((p, k) => {
      const x = K === 1 ? dayStartX + dayW / 2 : dayStartX + innerPad + (k / (K - 1)) * usableW;
      const y = padTop + plotH - (p.finished / yMax) * plotH;
      return { x, y, p };
    });

    // Day Area Path
    if (coords.length > 1) {
      const area = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const first = coords[0];
      const last = coords[coords.length - 1];
      let d = `M ${first.x} ${first.y}`;
      for (let k = 1; k < coords.length; k++) d += ` L ${coords[k].x} ${coords[k].y}`;
      d += ` L ${last.x} ${padTop + plotH} L ${first.x} ${padTop + plotH} Z`;
      area.setAttribute('d', d);
      area.setAttribute('fill', 'url(#hourly-area-gradient-grouped)');
      svg.append(area);

      // Day Line Path
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      let lineD = `M ${first.x} ${first.y}`;
      for (let k = 1; k < coords.length; k++) lineD += ` L ${coords[k].x} ${coords[k].y}`;
      line.setAttribute('d', lineD);
      line.setAttribute('class', 'chart-line-path');
      svg.append(line);
    }

    // Node circles & tooltips
    coords.forEach((coord) => {
      const { x, y, p } = coord;
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', x);
      circle.setAttribute('cy', y);
      circle.setAttribute('r', M > 8 ? 3.5 : 4.5);
      circle.setAttribute('class', 'chart-node-circle');

      circle.onmouseenter = () => {
        if (!tooltip) return;
        const prettyDate = new Date(report.date + 'T00:00:00').toLocaleDateString(undefined, {
          weekday: 'short',
          month: 'short',
          day: 'numeric'
        });
        const tasksStr = p.tasks.length ? p.tasks.join(', ') : '';
        tooltip.innerHTML = `
          <div class="chart-tooltip-header">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            <span>${prettyDate} · ${p.hourLabel}</span>
          </div>
          <div class="chart-tooltip-grid">
            <div class="tooltip-stat">
              <span class="tooltip-stat-label">Cases Done</span>
              <strong class="tooltip-stat-val">${p.finished.toLocaleString()}</strong>
            </div>
            <div class="tooltip-stat">
              <span class="tooltip-stat-label">Hourly Score</span>
              <strong class="tooltip-stat-val">${p.score} pts</strong>
            </div>
          </div>
          ${tasksStr ? `<div class="chart-tooltip-hint" style="color:var(--zinc-500);"><span>Task: ${tasksStr}</span></div>` : ''}
          <div class="chart-tooltip-hint">Click point to filter ${report.date} ↓</div>
        `;

        const bodyRect = container.closest('.chart-body')?.getBoundingClientRect() || container.getBoundingClientRect();
        const circleRect = circle.getBoundingClientRect();
        const leftPos = (circleRect.left - bodyRect.left) + circleRect.width / 2;
        const topPos = (circleRect.top - bodyRect.top);

        tooltip.style.left = `${leftPos}px`;
        tooltip.style.top = `${topPos}px`;
        if (topPos < 120) {
          tooltip.style.transform = 'translate(-50%, 14px)';
        } else {
          tooltip.style.transform = 'translate(-50%, calc(-100% - 6px))';
        }
        tooltip.classList.remove('hidden');
      };

      circle.onmouseleave = () => {
        if (tooltip) tooltip.classList.add('hidden');
      };

      // Clicking point selects this date
      circle.onclick = (e) => {
        e.stopPropagation();
        selectedChartDate = report.date;
        renderDailyCasesBarChart(originalReports);
        renderHourlyProductivityLineChart(originalReports);
      };

      svg.append(circle);
    });

    // Hour labels: first & last hour of the day
    if (coords.length > 0) {
      const firstCoord = coords[0];
      const lastCoord = coords[coords.length - 1];

      const hLabel1 = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      hLabel1.setAttribute('x', firstCoord.x);
      hLabel1.setAttribute('y', padTop + plotH + 16);
      hLabel1.setAttribute('text-anchor', 'middle');
      hLabel1.setAttribute('class', 'chart-axis-text');
      hLabel1.setAttribute('style', 'font-size: 10px;');
      hLabel1.textContent = firstCoord.p.hourLabel;
      svg.append(hLabel1);

      if (coords.length > 1 && (lastCoord.x - firstCoord.x) > 30) {
        const hLabel2 = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        hLabel2.setAttribute('x', lastCoord.x);
        hLabel2.setAttribute('y', padTop + plotH + 16);
        hLabel2.setAttribute('text-anchor', 'middle');
        hLabel2.setAttribute('class', 'chart-axis-text');
        hLabel2.setAttribute('style', 'font-size: 10px;');
        hLabel2.textContent = lastCoord.p.hourLabel;
        svg.append(hLabel2);
      }
    }

    // Date Group Label below the hours
    const dateLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    dateLabel.setAttribute('x', dayStartX + dayW / 2);
    dateLabel.setAttribute('y', padTop + plotH + 34);
    dateLabel.setAttribute('text-anchor', 'middle');
    dateLabel.setAttribute('class', 'chart-axis-text chart-date-group-label');
    dateLabel.setAttribute('style', 'cursor: pointer;');
    const dParts = report.date.split('-');
    dateLabel.textContent = dParts.length === 3 ? `${Number(dParts[1])}/${Number(dParts[2])}` : report.date;
    dateLabel.onclick = (e) => {
      e.stopPropagation();
      selectedChartDate = report.date;
      renderDailyCasesBarChart(originalReports);
      renderHourlyProductivityLineChart(originalReports);
    };
    svg.append(dateLabel);
  });

  container.append(svg);
}

function renderHourlyProductivityLineChart(filteredReports) {
  const container = $('hourly-productivity-chart-container');
  const tooltip = $('hourly-chart-tooltip');
  const titleEl = $('hourly-chart-title');
  const descEl = $('hourly-chart-desc');
  const dateBadge = $('hourly-chart-date-badge');
  if (!container) return;

  container.replaceChildren();

  const reportsList = Array.isArray(filteredReports) ? filteredReports : (filteredReports ? [filteredReports] : []);
  if (!reportsList.length) {
    if (dateBadge) {
      dateBadge.textContent = 'No data';
      dateBadge.classList.remove('is-clickable');
      dateBadge.onclick = null;
    }
    const empty = element('div', '', 'chart-empty-notice');
    empty.textContent = 'No hourly productivity data available for this date range.';
    container.append(empty);
    return;
  }

  const chron = [...reportsList].sort((a, b) => a.date.localeCompare(b.date));
  const isSelected = Boolean(selectedChartDate && chron.some(r => r.date === selectedChartDate));
  const activeReport = isSelected
    ? chron.find(r => r.date === selectedChartDate)
    : chron[chron.length - 1]; // Latest date by default

  if (!activeReport) return;

  const prettyDate = new Date(activeReport.date + 'T00:00:00').toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });

  if (titleEl) {
    titleEl.textContent = `Hourly Productivity — ${activeReport.date}`;
  }
  if (descEl) {
    descEl.textContent = isSelected
      ? `Cases finished per working hour on ${prettyDate}. Click bar above to switch or unselect.`
      : `Cases finished per working hour on ${prettyDate} (latest report in range). Click any bar above to inspect another date.`;
  }
  if (dateBadge) {
    dateBadge.textContent = prettyDate;
    if (isSelected) {
      dateBadge.classList.add('is-clickable');
      dateBadge.title = 'Click to unselect and return to the latest date view';
      dateBadge.onclick = (e) => {
        e.stopPropagation();
        selectedChartDate = null;
        renderDailyCasesBarChart(reportsList);
        renderHourlyProductivityLineChart(reportsList);
      };
    } else {
      dateBadge.classList.remove('is-clickable');
      dateBadge.title = '';
      dateBadge.onclick = null;
    }
  }

  const points = getReportHourlyBreakdown(activeReport);
  if (!points.length) {
    const empty = element('div', '', 'chart-empty-notice');
    empty.textContent = `No hourly details recorded for ${activeReport.date}.`;
    container.append(empty);
    return;
  }

  renderSingleDateLineChart(container, points, activeReport, tooltip, reportsList);
}

function formatFactDate(dateStr) {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    });
  } catch {
    return dateStr;
  }
}

function formatHourRangeCompact(h) {
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = (h % 12) === 0 ? 12 : (h % 12);
  const nextH = h + 1;
  const nextPeriod = nextH >= 12 ? 'PM' : 'AM';
  const nextH12 = (nextH % 12) === 0 ? 12 : (nextH % 12);
  if (period !== nextPeriod) {
    return `${h12}:00 ${period} – ${nextH12}:00 ${nextPeriod}`;
  }
  return `${h12}:00 – ${nextH12}:00 ${nextPeriod}`;
}

// ============================================================================
// MODULE 5: DaybookFunFacts (Telemetry Highlights & Collapsible Section)
// ============================================================================

function renderProductivityFunFacts(filteredReports) {
  const card = $('fun-facts-card');
  if (!card) return;

  if (!filteredReports || !filteredReports.length) {
    card.classList.add('hidden');
    return;
  }

  card.classList.remove('hidden');

  const rangeBadge = $('fun-facts-active-range-badge');
  if (rangeBadge) {
    const n = filteredReports.length;
    rangeBadge.textContent = n === 1 ? '1 day in view' : `${n} days in view`;
  }

  // 1. Hourly Stats across all filtered reports
  const hourMap = new Map();
  filteredReports.forEach(r => {
    const breakdown = getReportHourlyBreakdown(r);
    breakdown.forEach(p => {
      const h = Number(p.hour);
      if (isNaN(h)) return;
      if (!hourMap.has(h)) {
        hourMap.set(h, { hour: h, totalFinished: 0, countDays: 0, label: p.hourLabel });
      }
      const entry = hourMap.get(h);
      entry.totalFinished += (Number(p.finished) || 0);
      entry.countDays += 1;
    });
  });

  const hourlyAverages = [...hourMap.values()].map(entry => ({
    hour: entry.hour,
    label: entry.label,
    avg: entry.countDays ? (entry.totalFinished / entry.countDays) : 0,
    totalFinished: entry.totalFinished,
    countDays: entry.countDays
  })).filter(entry => entry.countDays > 0);

  // Peak Hour (Avg)
  const peakHourVal = $('fact-peak-hour-val');
  const peakHourSub = $('fact-peak-hour-sub');
  if (hourlyAverages.length) {
    const peak = hourlyAverages.reduce((max, h) => (h.avg > max.avg ? h : max), hourlyAverages[0]);
    if (peakHourVal) peakHourVal.textContent = formatHourRangeCompact(peak.hour);
    if (peakHourSub) peakHourSub.textContent = `Avg ${peak.avg.toFixed(1)} cases/hr`;
  } else {
    if (peakHourVal) peakHourVal.textContent = '—';
    if (peakHourSub) peakHourSub.textContent = 'No hourly data';
  }

  // Slowest Hour (Avg)
  const slowestHourVal = $('fact-slowest-hour-val');
  const slowestHourSub = $('fact-slowest-hour-sub');
  if (hourlyAverages.length) {
    const slowest = hourlyAverages.reduce((min, h) => (h.avg < min.avg ? h : min), hourlyAverages[0]);
    if (slowestHourVal) slowestHourVal.textContent = formatHourRangeCompact(slowest.hour);
    if (slowestHourSub) slowestHourSub.textContent = `Avg ${slowest.avg.toFixed(1)} cases/hr`;
  } else {
    if (slowestHourVal) slowestHourVal.textContent = '—';
    if (slowestHourSub) slowestHourSub.textContent = 'No hourly data';
  }

  // 2. Highest Productivity Day & Lowest Productivity Day
  const sortedByCases = [...filteredReports].sort((a, b) => (Number(b.casesFinished) || 0) - (Number(a.casesFinished) || 0));
  const bestDay = sortedByCases[0];
  const lowestDay = sortedByCases[sortedByCases.length - 1];

  const bestDayVal = $('fact-best-day-val');
  const bestDaySub = $('fact-best-day-sub');
  if (bestDay) {
    const bestCases = Number(bestDay.casesFinished) || 0;
    const bestDateStr = formatFactDate(bestDay.date);
    if (bestDayVal) bestDayVal.textContent = bestDateStr;
    const ptsStr = bestDay.individualScore !== undefined ? ` · ${Number(bestDay.individualScore).toLocaleString()} pts` : '';
    if (bestDaySub) bestDaySub.textContent = `${bestCases.toLocaleString()} cases${ptsStr}`;
  } else {
    if (bestDayVal) bestDayVal.textContent = '—';
    if (bestDaySub) bestDaySub.textContent = 'No data';
  }

  const lowestDayVal = $('fact-lowest-day-val');
  const lowestDaySub = $('fact-lowest-day-sub');
  if (lowestDay) {
    const lowestCases = Number(lowestDay.casesFinished) || 0;
    const lowestDateStr = formatFactDate(lowestDay.date);
    if (lowestDayVal) lowestDayVal.textContent = lowestDateStr;
    const ptsStr = lowestDay.individualScore !== undefined ? ` · ${Number(lowestDay.individualScore).toLocaleString()} pts` : '';
    const singleDaySuffix = filteredReports.length === 1 ? ' · Single day' : '';
    if (lowestDaySub) lowestDaySub.textContent = `${lowestCases.toLocaleString()} cases${ptsStr}${singleDaySuffix}`;
  } else {
    if (lowestDayVal) lowestDayVal.textContent = '—';
    if (lowestDaySub) lowestDaySub.textContent = 'No data';
  }

  // 3. Days with Productivity Higher Than 350 (Static Benchmark)
  const benchmarkVal = 350;
  const daysOver350 = filteredReports.filter(r => (Number(r.casesFinished) || 0) > benchmarkVal);
  const countOver350 = daysOver350.length;
  const totalDays = filteredReports.length;
  const pctOver350 = totalDays > 0 ? Math.round((countOver350 / totalDays) * 100) : 0;

  const benchmark350Val = $('fact-benchmark-300-val');
  const benchmark350Sub = $('fact-benchmark-300-sub');
  if (benchmark350Val) {
    benchmark350Val.textContent = `${countOver350} of ${totalDays} ${totalDays === 1 ? 'day' : 'days'}`;
  }
  if (benchmark350Sub) {
    benchmark350Sub.textContent = countOver350 > 0
      ? `${pctOver350}% exceeded 350 cases`
      : `0% exceeded 350 cases`;
  }
}

let isFunFactsCollapseInitialized = false;
function initFunFactsCollapse() {
  if (isFunFactsCollapseInitialized) return;
  isFunFactsCollapseInitialized = true;

  const card = $('fun-facts-card');
  const header = document.querySelector('.fun-facts-header');
  const toggleBtn = $('fun-facts-toggle-btn');
  const toggleLabel = $('fun-facts-toggle-label');
  if (!card || !header) return;

  // Default is collapsed unless the user explicitly chose to expand it ('false')
  let isExplicitlyExpanded = false;
  try {
    isExplicitlyExpanded = localStorage.getItem('daybook_fun_facts_collapsed') === 'false';
  } catch {}
  if (isExplicitlyExpanded) {
    card.classList.remove('is-collapsed');
    if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'true');
    if (toggleLabel) toggleLabel.textContent = 'Hide';
  } else {
    card.classList.add('is-collapsed');
    if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'false');
    if (toggleLabel) toggleLabel.textContent = 'Show';
  }

  const toggle = (e) => {
    if (e && e.target && e.target.closest('a')) return;
    const isCollapsed = card.classList.toggle('is-collapsed');
    if (toggleBtn) toggleBtn.setAttribute('aria-expanded', String(!isCollapsed));
    if (toggleLabel) toggleLabel.textContent = isCollapsed ? 'Show' : 'Hide';
    try {
      localStorage.setItem('daybook_fun_facts_collapsed', String(isCollapsed));
    } catch {}
  };

  header.onclick = toggle;
}

function filterAndRenderDashboard() {
  const emptyStateView = $('empty-state-view');
  const toolbar = $('dashboard-toolbar');
  const funFactsCard = $('fun-facts-card');
  const kpiGrid = $('telemetry-kpis');
  const dailyChartCard = $('daily-cases-chart-card');
  const hourlyChartCard = $('hourly-productivity-chart-card');

  if (!rawReportsData.length) {
    const conflictContainer = $('duplicate-conflicts-container');
    if (conflictContainer) {
      conflictContainer.classList.add('hidden');
      conflictContainer.replaceChildren();
    }
    if (toolbar) toolbar.classList.add('hidden');
    if (emptyStateView) emptyStateView.classList.remove('hidden');
    if (funFactsCard) funFactsCard.classList.add('hidden');
    if (kpiGrid) kpiGrid.classList.add('hidden');
    if (dailyChartCard) dailyChartCard.classList.add('hidden');
    if (hourlyChartCard) hourlyChartCard.classList.add('hidden');
    return;
  }

  if (toolbar) toolbar.classList.remove('hidden');
  if (emptyStateView) emptyStateView.classList.add('hidden');
  if (kpiGrid) kpiGrid.classList.remove('hidden');
  if (dailyChartCard) dailyChartCard.classList.remove('hidden');
  if (hourlyChartCard) hourlyChartCard.classList.remove('hidden');

  // Filter reports according to active date range
  const filtered = rawReportsData.filter(r => {
    if (!r.date) return false;
    if (activeDateRange.start && r.date < activeDateRange.start) return false;
    if (activeDateRange.end && r.date > activeDateRange.end) return false;
    return true;
  });

  // Render Productivity Fun Facts on top of data
  renderProductivityFunFacts(filtered);

  // Check duplicate conflicts within filtered data
  const duplicateConflicts = detectDuplicateReports(filtered);
  renderDuplicateConflicts(duplicateConflicts);

  // 1. Compute Metrics for Filtered Date Range
  const currentMetrics = computeMetrics(filtered);

  // 2. Compute Metrics for Comparison Period
  const compPeriod = getComparisonPeriod(activeDateRange.start, activeDateRange.end);
  const compReports = compPeriod
    ? rawReportsData.filter(r => r.date && r.date >= compPeriod.start && r.date <= compPeriod.end)
    : [];
  const compMetrics = computeMetrics(compReports);

  // 3. Update 4 KPI Cards Matching Reference Design
  const totalCasesVal = $('kpi-total-cases-val');
  const totalCasesDelta = $('kpi-total-cases-delta');
  const totalCasesSubhead = $('kpi-total-cases-subhead');
  const totalCasesUnit = $('kpi-total-cases-unit');

  const avgDayVal = $('kpi-avg-day-val');
  const avgDayDelta = $('kpi-avg-day-delta');
  const avgDaySubhead = $('kpi-avg-day-subhead');
  const avgDayUnit = $('kpi-avg-day-unit');

  const avgHourVal = $('kpi-avg-hour-val');
  const avgHourDelta = $('kpi-avg-hour-delta');
  const avgHourSubhead = $('kpi-avg-hour-subhead');
  const avgHourUnit = $('kpi-avg-hour-unit');

  const totalPointsVal = $('kpi-total-points-val');
  const totalPointsDelta = $('kpi-total-points-delta');
  const totalPointsSubhead = $('kpi-total-points-subhead');
  const totalPointsUnit = $('kpi-total-points-unit');

  if (currentMetrics.hasData) {
    const reportCount = currentMetrics.reportCount || filtered.length;
    const distinctDates = new Set(filtered.map(r => r.date).filter(Boolean));
    const daysCount = distinctDates.size || reportCount || 1;

    if (totalCasesVal) totalCasesVal.textContent = currentMetrics.totalCases.toLocaleString();
    if (totalCasesUnit) totalCasesUnit.classList.remove('hidden');
    if (totalCasesSubhead) {
      totalCasesSubhead.textContent = `Verified cases finished across ${reportCount} ${reportCount === 1 ? 'report' : 'reports'}`;
    }
    renderDeltaBadge(totalCasesDelta, currentMetrics.totalCases, compMetrics.totalCases, {
      hasCompData: compMetrics.hasData
    });

    if (avgDayVal) {
      avgDayVal.textContent = currentMetrics.avgCasesPerDay.toLocaleString(undefined, {
        maximumFractionDigits: 1,
        minimumFractionDigits: Number.isInteger(currentMetrics.avgCasesPerDay) ? 0 : 1
      });
    }
    if (avgDayUnit) avgDayUnit.classList.remove('hidden');
    if (avgDaySubhead) {
      avgDaySubhead.textContent = `Mean throughput per active day (${daysCount} ${daysCount === 1 ? 'day' : 'days'})`;
    }
    renderDeltaBadge(avgDayDelta, currentMetrics.avgCasesPerDay, compMetrics.avgCasesPerDay, {
      hasCompData: compMetrics.hasData,
      decimals: 1
    });

    if (avgHourVal) {
      avgHourVal.textContent = currentMetrics.avgCasesPerHour.toLocaleString(undefined, {
        maximumFractionDigits: 1,
        minimumFractionDigits: 1
      });
    }
    if (avgHourUnit) avgHourUnit.classList.remove('hidden');
    if (avgHourSubhead) {
      avgHourSubhead.textContent = `Mean throughput per active working hour`;
    }
    renderDeltaBadge(avgHourDelta, currentMetrics.avgCasesPerHour, compMetrics.avgCasesPerHour, {
      hasCompData: compMetrics.hasData,
      decimals: 1,
      unit: '/hr'
    });

    if (totalPointsVal) totalPointsVal.textContent = currentMetrics.totalPoints.toLocaleString();
    if (totalPointsUnit) totalPointsUnit.classList.remove('hidden');
    if (totalPointsSubhead) {
      totalPointsSubhead.textContent = `Cumulative performance score across completed cases`;
    }
    renderDeltaBadge(totalPointsDelta, currentMetrics.totalPoints, compMetrics.totalPoints, {
      hasCompData: compMetrics.hasData,
      unit: 'pts'
    });
  } else {
    if (totalCasesVal) totalCasesVal.textContent = '—';
    if (avgDayVal) avgDayVal.textContent = '—';
    if (avgHourVal) avgHourVal.textContent = '—';
    if (totalPointsVal) totalPointsVal.textContent = '—';

    if (totalCasesUnit) totalCasesUnit.classList.add('hidden');
    if (avgDayUnit) avgDayUnit.classList.add('hidden');
    if (avgHourUnit) avgHourUnit.classList.add('hidden');
    if (totalPointsUnit) totalPointsUnit.classList.add('hidden');

    if (totalCasesSubhead) totalCasesSubhead.textContent = 'Verified finished cases across period';
    if (avgDaySubhead) avgDaySubhead.textContent = 'Mean volume completed per active working day';
    if (avgHourSubhead) avgHourSubhead.textContent = 'Mean throughput per active working hour';
    if (totalPointsSubhead) totalPointsSubhead.textContent = 'Cumulative performance score across completed cases';

    renderDeltaBadge(totalCasesDelta, 0, 0, { hasCompData: false });
    renderDeltaBadge(avgDayDelta, 0, 0, { hasCompData: false });
    renderDeltaBadge(avgHourDelta, 0, 0, { hasCompData: false });
    renderDeltaBadge(totalPointsDelta, 0, 0, { hasCompData: false });
  }

  // 4. Render Daily Cases Bar Chart & Hourly Productivity Line Chart
  if (selectedChartDate && !filtered.some(r => r.date === selectedChartDate)) {
    selectedChartDate = null;
  }
  renderDailyCasesBarChart(filtered);
  renderHourlyProductivityLineChart(filtered);
}

// ============================================================================
// MODULE 6: DaybookDateRangePicker (Dual Calendar Popover & Custom Ranges)
// ============================================================================

function initDateRangePicker() {
  if (isDateRangePickerInitialized) return;
  isDateRangePickerInitialized = true;

  const trigger = $('date-range-trigger');
  const popover = $('date-range-popover');
  const label = $('date-range-label');
  const prevBtn = $('cal-prev-month');
  const nextBtn = $('cal-next-month');
  const resetBtn = $('cal-reset-btn');
  const cancelBtn = $('cal-cancel-btn');
  const applyBtn = $('cal-apply-btn');
  const exportBtn = $('dashboard-export-pdf-btn');

  // Set initial label
  if (label) {
    label.textContent = formatRangeLabel(activeDateRange.start, activeDateRange.end);
  }

  // Toggle popover
  if (trigger && popover) {
    trigger.onclick = (e) => {
      e.stopPropagation();
      const isHidden = popover.classList.contains('hidden');
      if (isHidden) {
        const userMenu = document.querySelector('.user-menu-popover');
        if (userMenu) userMenu.classList.add('hidden');
        pendingDateRange = { ...activeDateRange };
        if (activeDateRange.start) {
          const s = new Date(activeDateRange.start + 'T00:00:00');
          calendarViewDate = new Date(s.getFullYear(), s.getMonth(), 1);
        }
        updatePresetButtonsUI();
        renderDualCalendars();
        popover.classList.remove('hidden');
        trigger.setAttribute('aria-expanded', 'true');
      } else {
        popover.classList.add('hidden');
        trigger.setAttribute('aria-expanded', 'false');
      }
    };
  }

  // Presets
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const preset = btn.dataset.preset;
      const range = getPresetRange(preset);
      pendingDateRange = { ...range, preset };
      if (range.start) {
        const s = new Date(range.start + 'T00:00:00');
        calendarViewDate = new Date(s.getFullYear(), s.getMonth(), 1);
      }
      updatePresetButtonsUI();
      renderDualCalendars();
    };
  });

  // Calendar month navigation
  if (prevBtn) {
    prevBtn.onclick = (e) => {
      e.stopPropagation();
      calendarViewDate = new Date(calendarViewDate.getFullYear(), calendarViewDate.getMonth() - 1, 1);
      renderDualCalendars();
    };
  }
  if (nextBtn) {
    nextBtn.onclick = (e) => {
      e.stopPropagation();
      calendarViewDate = new Date(calendarViewDate.getFullYear(), calendarViewDate.getMonth() + 1, 1);
      renderDualCalendars();
    };
  }

  // Reset
  if (resetBtn) {
    resetBtn.onclick = (e) => {
      e.stopPropagation();
      const current = getPresetRange('billingMonth');
      pendingDateRange = { ...current, preset: 'billingMonth' };
      const s = new Date(current.start + 'T00:00:00');
      calendarViewDate = new Date(s.getFullYear(), s.getMonth(), 1);
      updatePresetButtonsUI();
      renderDualCalendars();
    };
  }

  // Cancel
  if (cancelBtn) {
    cancelBtn.onclick = (e) => {
      e.stopPropagation();
      if (popover) popover.classList.add('hidden');
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
    };
  }

  // Apply
  if (applyBtn) {
    applyBtn.onclick = (e) => {
      e.stopPropagation();
      if (pendingDateRange.start && !pendingDateRange.end) {
        pendingDateRange.end = pendingDateRange.start;
      }
      activeDateRange = { ...pendingDateRange };
      if (label) {
        label.textContent = formatRangeLabel(activeDateRange.start, activeDateRange.end);
      }
      if (popover) popover.classList.add('hidden');
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
      filterAndRenderDashboard();
    };
  }

  // Export PDF Button
  if (exportBtn) {
    exportBtn.onclick = exportDashboardPdf;
  }

  // Close popover on document click
  document.addEventListener('click', (e) => {
    if (popover && !popover.classList.contains('hidden')) {
      const container = trigger?.closest('.dashboard-toolbar-right') || trigger?.parentElement;
      if (container && !container.contains(e.target)) {
        popover.classList.add('hidden');
        if (trigger) trigger.setAttribute('aria-expanded', 'false');
      }
    }
  });

  // Escape key closes popover
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && popover && !popover.classList.contains('hidden')) {
      popover.classList.add('hidden');
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
    }
  });
}

function updatePresetButtonsUI() {
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.preset === pendingDateRange.preset);
  });
}

function renderDualCalendars() {
  const m1El = $('cal-month-1');
  const m2El = $('cal-month-2');
  const t1El = $('cal-month-1-title');
  const t2El = $('cal-month-2-title');
  if (!m1El || !m2El) return;

  const m1Year = calendarViewDate.getFullYear();
  const m1Month = calendarViewDate.getMonth();

  const m2Date = new Date(m1Year, m1Month + 1, 1);
  const m2Year = m2Date.getFullYear();
  const m2Month = m2Date.getMonth();

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  if (t1El) t1El.textContent = `${monthNames[m1Month]} ${m1Year}`;
  if (t2El) t2El.textContent = `${monthNames[m2Month]} ${m2Year}`;

  m1El.replaceChildren(renderMonthGrid(m1Year, m1Month));
  m2El.replaceChildren(renderMonthGrid(m2Year, m2Month));
}

function renderMonthGrid(year, month) {
  const wrap = document.createElement('div');
  wrap.className = 'month-grid-content';

  // Weekdays
  const weekdaysRow = document.createElement('div');
  weekdaysRow.className = 'cal-weekdays-row';
  ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].forEach(d => {
    const cell = document.createElement('span');
    cell.className = 'cal-weekday';
    cell.textContent = d;
    weekdaysRow.append(cell);
  });
  wrap.append(weekdaysRow);

  const daysGrid = document.createElement('div');
  daysGrid.className = 'cal-days-grid';

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevMonthDays = new Date(year, month, 0).getDate();

  for (let i = 0; i < 42; i++) {
    const cell = document.createElement('button');
    cell.className = 'cal-day-cell';
    cell.type = 'button';

    let cellDate;
    if (i < firstDay) {
      const dayNum = prevMonthDays - firstDay + 1 + i;
      const d = new Date(year, month - 1, dayNum);
      cellDate = toIsoDate(d);
      cell.textContent = String(dayNum);
      cell.classList.add('is-other-month');
    } else if (i < firstDay + daysInMonth) {
      const dayNum = i - firstDay + 1;
      const d = new Date(year, month, dayNum);
      cellDate = toIsoDate(d);
      cell.textContent = String(dayNum);
    } else {
      const dayNum = i - (firstDay + daysInMonth) + 1;
      const d = new Date(year, month + 1, dayNum);
      cellDate = toIsoDate(d);
      cell.textContent = String(dayNum);
      cell.classList.add('is-other-month');
    }

    cell.dataset.date = cellDate;

    const start = pendingDateRange.start;
    const end = pendingDateRange.end;

    if (start && cellDate === start) {
      cell.classList.add('is-endpoint', 'is-start');
    }
    if (end && cellDate === end) {
      cell.classList.add('is-endpoint', 'is-end');
    }
    if (start && end && cellDate > start && cellDate < end) {
      cell.classList.add('is-in-range');
    }

    cell.onclick = (e) => {
      e.stopPropagation();
      handleDayCellClick(cellDate);
    };

    daysGrid.append(cell);
  }

  wrap.append(daysGrid);
  return wrap;
}

function handleDayCellClick(isoDate) {
  if (!pendingDateRange.start || (pendingDateRange.start && pendingDateRange.end)) {
    pendingDateRange.start = isoDate;
    pendingDateRange.end = null;
    pendingDateRange.preset = 'custom';
  } else {
    if (isoDate < pendingDateRange.start) {
      pendingDateRange.end = pendingDateRange.start;
      pendingDateRange.start = isoDate;
    } else {
      pendingDateRange.end = isoDate;
    }
    pendingDateRange.preset = 'custom';
  }

  updatePresetButtonsUI();
  renderDualCalendars();
}

function escapePdfText(str) {
  return String(str || '')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

async function svgToImageData(svgElement, width = 1046, height = 310) {
  if (!svgElement || typeof Image === 'undefined') return null;
  return new Promise((resolve) => {
    try {
      const clonedSvg = svgElement.cloneNode(true);
      clonedSvg.setAttribute('width', width);
      clonedSvg.setAttribute('height', height);
      if (!clonedSvg.getAttribute('xmlns')) {
        clonedSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      }

      // Prepend white background rect so transparency is never rendered black
      const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      bgRect.setAttribute('x', '0');
      bgRect.setAttribute('y', '0');
      bgRect.setAttribute('width', '100%');
      bgRect.setAttribute('height', '100%');
      bgRect.setAttribute('fill', '#ffffff');
      clonedSvg.insertBefore(bgRect, clonedSvg.firstChild);

      const xml = new XMLSerializer().serializeToString(clonedSvg);
      const dataUri = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);

      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);

          const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.95);
          const binaryStr = atob(jpegDataUrl.split(',')[1]);
          const bytes = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
          }
          resolve({ bytes, width, height });
        } catch (_) {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = dataUri;
    } catch (_) {
      resolve(null);
    }
  });
}

function buildReportPdf({
  title = 'Dental Monitoring — Performance Report',
  dateRangeText = '',
  generatedAtText = '',
  kpis = [],
  chart1Img = null,
  chart1Title = 'Daily Finished Volume (Cases / Day)',
  chart2Img = null,
  chart2Title = 'Hourly Productivity Velocity (Cases / Hour)',
  funFacts = [],
  barChartData = null,
  selectedDate = null,
  lineChartData = null
} = {}) {
  const parts = [];
  const offsets = [];
  let pos = 0;

  function write(chunk) {
    let buf;
    if (chunk instanceof Uint8Array || (typeof Buffer !== 'undefined' && Buffer.isBuffer?.(chunk))) {
      buf = chunk;
    } else {
      const s = String(chunk);
      buf = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) {
        buf[i] = s.charCodeAt(i) & 0xff;
      }
    }
    parts.push(buf);
    pos += buf.length;
  }

  write('%PDF-1.4\n');

  let objCount = 0;
  function startObj() {
    objCount++;
    offsets[objCount] = pos;
    write(`${objCount} 0 obj\n`);
    return objCount;
  }

  // 1: Catalog
  startObj();
  write('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  // 2: Pages
  startObj();
  write('<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');

  const fontBoldObj = 4;
  const fontRegObj = 5;
  const img1Obj = chart1Img ? 6 : null;
  const img2Obj = chart2Img ? (chart1Img ? 7 : 6) : null;
  const contentsObj = 3 + 2 + (chart1Img ? 1 : 0) + (chart2Img ? 1 : 0) + 1;

  // 3: Page
  startObj();
  let xobjectsStr = '';
  if (img1Obj) xobjectsStr += `/Img1 ${img1Obj} 0 R `;
  if (img2Obj) xobjectsStr += `/Img2 ${img2Obj} 0 R `;

  write(`<<
  /Type /Page
  /Parent 2 0 R
  /MediaBox [0 0 595.28 841.89]
  /Resources <<
    /Font <<
      /F1 ${fontBoldObj} 0 R
      /F2 ${fontRegObj} 0 R
    >>
    ${xobjectsStr ? `/XObject << ${xobjectsStr} >>` : ''}
  >>
  /Contents ${contentsObj} 0 R
>>\nendobj\n`);

  // 4: Font Bold
  startObj();
  write('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n');

  // 5: Font Regular
  startObj();
  write('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n');

  // 6: Chart 1 Image
  if (chart1Img) {
    startObj();
    write(`<< /Type /XObject /Subtype /Image /Width ${chart1Img.width} /Height ${chart1Img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${chart1Img.bytes.length} >>\nstream\n`);
    write(chart1Img.bytes);
    write('\nendstream\nendobj\n');
  }

  // 7: Chart 2 Image
  if (chart2Img) {
    startObj();
    write(`<< /Type /XObject /Subtype /Image /Width ${chart2Img.width} /Height ${chart2Img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${chart2Img.bytes.length} >>\nstream\n`);
    write(chart2Img.bytes);
    write('\nendstream\nendobj\n');
  }

  // Contents Stream
  let stream = '';

  // Header
  stream += '0.04 0.04 0.05 rg\n';
  stream += `BT /F1 16 Tf 36 792 Td (${escapePdfText(title)}) Tj ET\n`;
  stream += '0.45 0.45 0.48 rg\n';
  stream += `BT /F2 8.5 Tf 36 777 Td (Date Range: ${escapePdfText(dateRangeText)}   |   Generated: ${escapePdfText(generatedAtText)}) Tj ET\n`;
  stream += '0.88 0.88 0.90 rg 36 767 523 0.75 re f\n';

  // KPIs
  const kpiY = 718;
  const kpiH = 40;
  const kpiW = (523 - 3 * 8) / 4;
  kpis.forEach((kpi, idx) => {
    const x = 36 + idx * (kpiW + 8);
    stream += `0.98 0.98 0.99 rg ${x} ${kpiY} ${kpiW} ${kpiH} re f\n`;
    stream += `0.88 0.88 0.91 RG 0.5 w ${x} ${kpiY} ${kpiW} ${kpiH} re S\n`;
    stream += `0.45 0.45 0.48 rg BT /F1 6.5 Tf ${x + 8} ${kpiY + 26} Td (${escapePdfText(kpi.label)}) Tj ET\n`;
    stream += `0.05 0.05 0.06 rg BT /F1 11 Tf ${x + 8} ${kpiY + 10} Td (${escapePdfText(kpi.value)}) Tj ET\n`;
  });

  // Chart 1: Daily Cases Bar Chart
  stream += `0.05 0.05 0.06 rg BT /F1 10 Tf 36 695 Td (${escapePdfText(chart1Title)}) Tj ET\n`;

  if (Array.isArray(barChartData) && barChartData.length > 0) {
    const boxX = 36;
    const boxY = 532;
    const boxW = 523;
    const boxH = 155;

    // Card background & border
    stream += `0.99 0.99 1.00 rg ${boxX} ${boxY} ${boxW} ${boxH} re f\n`;
    stream += `0.88 0.88 0.91 RG 0.5 w ${boxX} ${boxY} ${boxW} ${boxH} re S\n`;

    const padLeft = 45;
    const padRight = 20;
    const padBottom = 26;
    const padTop = 20;
    const plotX = boxX + padLeft;
    const plotY = boxY + padBottom;
    const plotW = boxW - padLeft - padRight;
    const plotH = boxH - padBottom - padTop;

    const chron = [...barChartData].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const maxVal = Math.max(...chron.map(r => Number(r.casesFinished) || 0), 10);
    const yTicks = 4;
    const step = Math.ceil(maxVal / yTicks / 10) * 10 || 10;
    const yMax = step * yTicks;

    // Horizontal grid lines and Y-axis labels
    for (let i = 0; i <= yTicks; i++) {
      const val = yMax - i * step;
      const y = plotY + plotH - (i / yTicks) * plotH;

      if (i === yTicks) {
        stream += `0.85 0.85 0.88 RG 0.75 w [] 0 d ${plotX} ${y.toFixed(1)} m ${(plotX + plotW).toFixed(1)} ${y.toFixed(1)} l S\n`;
      } else {
        stream += `0.92 0.92 0.94 RG 0.5 w [2 2] 0 d ${plotX} ${y.toFixed(1)} m ${(plotX + plotW).toFixed(1)} ${y.toFixed(1)} l S [] 0 d\n`;
      }

      const valStr = String(val);
      const textX = plotX - 6 - valStr.length * 3.8;
      stream += `0.48 0.48 0.52 rg BT /F2 6.5 Tf ${textX.toFixed(1)} ${(y - 2.5).toFixed(1)} Td (${escapePdfText(valStr)}) Tj ET\n`;
    }

    // Bars
    const N = chron.length;
    const slotW = plotW / N;
    const barW = Math.min(Math.max(8, slotW * 0.65), 38);
    const labelInterval = N > 24 ? 4 : (N > 14 ? 2 : 1);

    chron.forEach((r, idx) => {
      const cases = Number(r.casesFinished) || 0;
      const barH = Math.max(2, (cases / yMax) * plotH);
      const barX = plotX + idx * slotW + (slotW - barW) / 2;
      const barY = plotY;
      const isSelected = r.date === selectedDate;

      // Fill color: #10b981 emerald if selected, else #3b82f6 blue
      const rgb = isSelected ? '0.06 0.73 0.51' : '0.23 0.51 0.96';
      stream += `${rgb} rg ${barX.toFixed(1)} ${barY.toFixed(1)} ${barW.toFixed(1)} ${barH.toFixed(1)} re f\n`;

      // Value label on top (if space permits)
      if (N <= 20 && barH > 10) {
        const valStr = String(cases);
        const textX = barX + barW / 2 - valStr.length * 2.1;
        stream += `0.20 0.20 0.24 rg BT /F1 6.5 Tf ${textX.toFixed(1)} ${(barY + barH + 3).toFixed(1)} Td (${escapePdfText(valStr)}) Tj ET\n`;
      }

      // Date label below axis
      if (idx % labelInterval === 0 || idx === N - 1) {
        const dParts = (r.date || '').split('-');
        const shortDate = dParts.length === 3 ? `${Number(dParts[1])}/${Number(dParts[2])}` : (r.date || '');
        const dateX = barX + barW / 2 - shortDate.length * 2.1;
        stream += `0.45 0.45 0.48 rg BT /F2 6.5 Tf ${dateX.toFixed(1)} ${(plotY - 12).toFixed(1)} Td (${escapePdfText(shortDate)}) Tj ET\n`;
      }
    });
  } else if (img1Obj) {
    stream += `q 523 0 0 155 36 532 cm /Img1 Do Q\n`;
    stream += '0.90 0.90 0.92 RG 0.5 w 36 532 523 155 re S\n';
  } else {
    stream += '0.99 0.99 1.00 rg 36 532 523 155 re f\n';
    stream += '0.90 0.90 0.92 RG 0.5 w 36 532 523 155 re S\n';
    stream += '0.50 0.50 0.53 rg BT /F2 8 Tf 200 605 Td (No report data available for this date range) Tj ET\n';
  }

  // Chart 2: Hourly Productivity Line Chart
  stream += `0.05 0.05 0.06 rg BT /F1 10 Tf 36 512 Td (${escapePdfText(chart2Title)}) Tj ET\n`;

  if (Array.isArray(lineChartData) && lineChartData.length > 0) {
    const boxX = 36;
    const boxY = 349;
    const boxW = 523;
    const boxH = 155;

    // Card background & border
    stream += `0.99 0.99 1.00 rg ${boxX} ${boxY} ${boxW} ${boxH} re f\n`;
    stream += `0.88 0.88 0.91 RG 0.5 w ${boxX} ${boxY} ${boxW} ${boxH} re S\n`;

    const padLeft = 45;
    const padRight = 20;
    const padBottom = 26;
    const padTop = 20;
    const plotX = boxX + padLeft;
    const plotY = boxY + padBottom;
    const plotW = boxW - padLeft - padRight;
    const plotH = boxH - padBottom - padTop;

    const points = lineChartData;
    const maxVal = Math.max(...points.map(p => p.finished || 0), 10);
    const yTicks = 4;
    const step = Math.ceil(maxVal / yTicks / 5) * 5 || 5;
    const yMax = step * yTicks;

    // Horizontal grid lines and Y-axis labels
    for (let i = 0; i <= yTicks; i++) {
      const val = yMax - i * step;
      const y = plotY + plotH - (i / yTicks) * plotH;

      if (i === yTicks) {
        stream += `0.85 0.85 0.88 RG 0.75 w [] 0 d ${plotX} ${y.toFixed(1)} m ${(plotX + plotW).toFixed(1)} ${y.toFixed(1)} l S\n`;
      } else {
        stream += `0.92 0.92 0.94 RG 0.5 w [2 2] 0 d ${plotX} ${y.toFixed(1)} m ${(plotX + plotW).toFixed(1)} ${y.toFixed(1)} l S [] 0 d\n`;
      }

      const valStr = String(val);
      const textX = plotX - 6 - valStr.length * 3.8;
      stream += `0.48 0.48 0.52 rg BT /F2 6.5 Tf ${textX.toFixed(1)} ${(y - 2.5).toFixed(1)} Td (${escapePdfText(valStr)}) Tj ET\n`;
    }

    const N = points.length;
    const coords = points.map((p, idx) => {
      const x = N === 1 ? plotX + plotW / 2 : plotX + (idx / (N - 1)) * plotW;
      const y = plotY + ((p.finished || 0) / yMax) * plotH;
      return { x, y, p };
    });

    if (N > 1) {
      // Light emerald area fill under trend curve (#ecfdf5)
      stream += '0.92 0.97 0.94 rg\n';
      stream += `${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)} m\n`;
      for (let i = 1; i < coords.length; i++) {
        stream += `${coords[i].x.toFixed(1)} ${coords[i].y.toFixed(1)} l\n`;
      }
      stream += `${coords[N - 1].x.toFixed(1)} ${plotY.toFixed(1)} l\n`;
      stream += `${coords[0].x.toFixed(1)} ${plotY.toFixed(1)} l h f\n`;

      // Crisp emerald trend stroke (#10b981)
      stream += '0.06 0.73 0.51 RG 1.8 w [] 0 d\n';
      stream += `${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)} m\n`;
      for (let i = 1; i < coords.length; i++) {
        stream += `${coords[i].x.toFixed(1)} ${coords[i].y.toFixed(1)} l\n`;
      }
      stream += 'S\n';
    }

    // Nodes and labels
    coords.forEach((c) => {
      // White node dot with emerald stroke
      stream += `1 1 1 rg 0.06 0.73 0.51 RG 1.2 w ${(c.x - 2.5).toFixed(1)} ${(c.y - 2.5).toFixed(1)} 5 5 re B\n`;

      // Hour label below axis
      const hourStr = c.p.hourLabel || '';
      const textX = c.x - hourStr.length * 2.1;
      stream += `0.45 0.45 0.48 rg BT /F2 6.5 Tf ${textX.toFixed(1)} ${(plotY - 12).toFixed(1)} Td (${escapePdfText(hourStr)}) Tj ET\n`;
    });
  } else if (img2Obj) {
    stream += `q 523 0 0 155 36 349 cm /Img2 Do Q\n`;
    stream += '0.90 0.90 0.92 RG 0.5 w 36 349 523 155 re S\n';
  } else {
    stream += '0.99 0.99 1.00 rg 36 349 523 155 re f\n';
    stream += '0.90 0.90 0.92 RG 0.5 w 36 349 523 155 re S\n';
    stream += '0.50 0.50 0.53 rg BT /F2 8 Tf 200 422 Td (No hourly telemetry data available) Tj ET\n';
  }

  // Fun Facts
  if (funFacts && funFacts.length) {
    stream += '0.05 0.05 0.06 rg BT /F1 10 Tf 36 328 Td (Productivity Insights & Milestones) Tj ET\n';
    const ffY = 270;
    const ffH = 48;
    const ffW = (523 - 4 * 6) / 5;
    funFacts.forEach((ff, idx) => {
      const x = 36 + idx * (ffW + 6);
      stream += `0.98 0.98 0.99 rg ${x} ${ffY} ${ffW} ${ffH} re f\n`;
      stream += `0.88 0.88 0.91 RG 0.5 w ${x} ${ffY} ${ffW} ${ffH} re S\n`;
      stream += `0.50 0.50 0.53 rg BT /F1 6 Tf ${x + 6} ${ffY + 34} Td (${escapePdfText(ff.label)}) Tj ET\n`;
      stream += `0.06 0.06 0.07 rg BT /F1 8 Tf ${x + 6} ${ffY + 21} Td (${escapePdfText(ff.value)}) Tj ET\n`;
      stream += `0.45 0.45 0.48 rg BT /F2 6.5 Tf ${x + 6} ${ffY + 9} Td (${escapePdfText(ff.sub)}) Tj ET\n`;
    });
  }

  // Footer
  stream += '0.88 0.88 0.90 rg 36 50 523 0.75 re f\n';
  stream += '0.50 0.50 0.53 rg BT /F2 7.5 Tf 36 38 Td (Daybook Intelligence  •  Automated Google Drive Telemetry Export) Tj ET\n';
  stream += '0.50 0.50 0.53 rg BT /F2 7.5 Tf 516 38 Td (Page 1 of 1) Tj ET\n';

  // Contents Obj
  startObj();
  write(`<< /Length ${stream.length} >>\nstream\n`);
  write(stream);
  write('\nendstream\nendobj\n');

  // xref
  const xrefPos = pos;
  write(`xref\n0 ${objCount + 1}\n0000000000 65535 f \n`);
  for (let i = 1; i <= objCount; i++) {
    write(String(offsets[i]).padStart(10, '0') + ' 00000 n \n');
  }
  write(`trailer\n<< /Size ${objCount + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`);

  // Concatenate parts
  let totalLen = 0;
  for (const p of parts) totalLen += p.length;
  const result = new Uint8Array(totalLen);
  let cur = 0;
  for (const p of parts) {
    result.set(p, cur);
    cur += p.length;
  }
  return result;
}

async function exportDashboardPdf() {
  const exportBtn = $('dashboard-export-pdf-btn');
  const originalHtml = exportBtn ? exportBtn.innerHTML : '';

  if (exportBtn) {
    exportBtn.disabled = true;
    exportBtn.innerHTML = `
      <svg class="inline-spinner-svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
        <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
      </svg>
      <span>Exporting PDF…</span>
    `;
  }

  try {
    const filteredReports = rawReportsData.filter(r => {
      if (!r || !r.date) return false;
      if (activeDateRange.start && r.date < activeDateRange.start) return false;
      if (activeDateRange.end && r.date > activeDateRange.end) return false;
      return true;
    });

    if (!filteredReports.length) {
      message('No report graphs available to export for this date range.');
      return;
    }

    const chronReports = [...filteredReports].sort((a, b) => a.date.localeCompare(b.date));

    // Determine active hourly report (selected date or latest report)
    let activeReport = null;
    if (selectedChartDate) {
      activeReport = chronReports.find(r => r.date === selectedChartDate);
    }
    if (!activeReport) {
      activeReport = chronReports[chronReports.length - 1];
    }

    const hourlyPoints = activeReport ? getReportHourlyBreakdown(activeReport) : [];
    const hourlyTitle = activeReport?.date
      ? `Hourly Productivity — ${activeReport.date}`
      : ($('hourly-chart-title')?.textContent || 'Hourly Productivity Velocity');

    const dateRangeLabel = $('date-range-label')?.textContent || `${activeDateRange.start} – ${activeDateRange.end}`;
    const generatedAtText = new Date().toLocaleDateString(undefined, {
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });

    const kpis = [
      {
        label: 'TOTAL VOLUME',
        value: `${$('kpi-total-cases-val')?.textContent || '0'} cases`
      },
      {
        label: 'DAILY VELOCITY',
        value: `${$('kpi-avg-day-val')?.textContent || '0'} cases/day`
      },
      {
        label: 'OPERATIONAL PACE',
        value: `${$('kpi-avg-hour-val')?.textContent || '0'} cases/hr`
      },
      {
        label: 'PERFORMANCE SCORE',
        value: `${$('kpi-total-points-val')?.textContent || '0'} pts`
      }
    ];

    const funFacts = [
      {
        label: 'PEAK HOUR',
        value: $('fact-peak-hour-val')?.textContent || '—',
        sub: $('fact-peak-hour-sub')?.textContent || ''
      },
      {
        label: 'SLOWEST HOUR',
        value: $('fact-slowest-hour-val')?.textContent || '—',
        sub: $('fact-slowest-hour-sub')?.textContent || ''
      },
      {
        label: 'HIGHEST DAY',
        value: $('fact-best-day-val')?.textContent || '—',
        sub: $('fact-best-day-sub')?.textContent || ''
      },
      {
        label: 'LOWEST DAY',
        value: $('fact-lowest-day-val')?.textContent || '—',
        sub: $('fact-lowest-day-sub')?.textContent || ''
      },
      {
        label: '> 350 MILESTONE',
        value: $('fact-benchmark-300-val')?.textContent || '—',
        sub: $('fact-benchmark-300-sub')?.textContent || ''
      }
    ];

    const pdfBytes = buildReportPdf({
      title: 'Dental Monitoring — Performance & Productivity Report',
      dateRangeText: dateRangeLabel,
      generatedAtText,
      kpis,
      chart1Title: 'Daily Finished Volume (Cases / Day)',
      barChartData: chronReports,
      selectedDate: selectedChartDate,
      chart2Title: hourlyTitle,
      lineChartData: hourlyPoints,
      funFacts
    });

    const startSlug = activeDateRange.start || 'all';
    const endSlug = activeDateRange.end || 'all';
    const fileName = `Dental-Monitoring-Report-${startSlug}-to-${endSlug}.pdf`;

    if (typeof Blob !== 'undefined' && typeof URL !== 'undefined' && typeof document !== 'undefined') {
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
      message(`Report exported: ${fileName}`);
    }
  } catch (err) {
    message(err.message || 'Could not export PDF report.');
  } finally {
    if (exportBtn) {
      exportBtn.disabled = false;
      exportBtn.innerHTML = originalHtml;
    }
  }
}

function detectDuplicateReports(reports) {
  if (!Array.isArray(reports)) return [];
  const conflictsByDate = new Map();

  for (const rep of reports) {
    if (!rep || !rep.date) continue;

    // 1. Explicitly flagged by backend with multiple stored versions
    if (rep.hasConflict && !rep.conflictResolved && Array.isArray(rep.versions) && rep.versions.length > 1) {
      conflictsByDate.set(rep.date, {
        date: rep.date,
        versions: rep.versions
      });
      continue;
    }

    // 2. Incoming reports array contains multiple entries for the same date
    const allForDate = reports.filter(r => r && r.date === rep.date);
    if (allForDate.length > 1 && !conflictsByDate.has(rep.date)) {
      const isDiff = allForDate.some(m =>
        m.casesFinished !== allForDate[0].casesFinished ||
        m.individualScore !== allForDate[0].individualScore ||
        m.sourceFileName !== allForDate[0].sourceFileName
      );
      if (isDiff) {
        conflictsByDate.set(rep.date, {
          date: rep.date,
          versions: allForDate.map((m, idx) => ({
            versionId: m.sourceFileId || m.id || `v-${idx + 1}`,
            date: m.date,
            casesFinished: m.casesFinished,
            individualScore: m.individualScore,
            sourceFileName: m.sourceFileName || `Report File ${idx + 1}`,
            ingestedAt: m.ingestedAt || m.date,
            sha256: m.sha256 || ''
          }))
        });
      }
    }
  }

  return Array.from(conflictsByDate.values());
}

function renderDuplicateConflicts(conflicts) {
  const container = $('duplicate-conflicts-container');
  if (!container) return;

  if (!conflicts || !conflicts.length) {
    container.classList.add('hidden');
    container.replaceChildren();
    return;
  }

  container.classList.remove('hidden');
  container.replaceChildren();

  for (const conflict of conflicts) {
    const card = document.createElement('div');
    card.className = 'duplicate-conflict-card';
    card.dataset.date = conflict.date;

    const formattedDate = formatDateDisplay(conflict.date);

    // Header with alert badge & description
    const header = document.createElement('div');
    header.className = 'conflict-card-header';
    header.innerHTML = `
      <div class="conflict-badge-wrap">
        <span class="conflict-badge">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
            <line x1="12" y1="9" x2="12" y2="13"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          Duplicate Report Flagged
        </span>
        <span class="conflict-date-title">Action required for <strong>${formattedDate}</strong></span>
      </div>
      <p class="conflict-explanation">
        Multiple reports were found for <strong>${formattedDate}</strong>. Choose which version of the data you want to keep as verified telemetry.
      </p>
    `;

    // Versions comparison grid
    const grid = document.createElement('div');
    grid.className = 'conflict-versions-grid';

    conflict.versions.forEach((ver, idx) => {
      const vCard = document.createElement('div');
      vCard.className = 'conflict-version-card';

      const tagLetter = String.fromCharCode(65 + (idx % 26)); // 'A', 'B', 'C'
      const fileName = ver.sourceFileName || 'PDF Report';
      const cases = ver.casesFinished ?? 0;
      const score = ver.individualScore ?? 0;
      const ingestedText = ver.ingestedAt ? formatDateDisplay(ver.ingestedAt) : 'Recently synced';

      vCard.innerHTML = `
        <div class="version-card-head">
          <span class="version-tag">Version ${tagLetter}</span>
          <span class="version-file-name" title="${fileName}">${fileName}</span>
        </div>
        <div class="version-metrics-row">
          <div class="metric-item">
            <span class="metric-label">Cases Finished</span>
            <span class="metric-val">${cases}</span>
          </div>
          <div class="metric-item">
            <span class="metric-label">Efficiency</span>
            <span class="metric-val">${score} pts</span>
          </div>
        </div>
        <div class="version-ingested-meta">Ingested: ${ingestedText}</div>
      `;

      const keepBtn = document.createElement('button');
      keepBtn.className = 'btn btn-primary btn-keep-version';
      keepBtn.type = 'button';
      keepBtn.textContent = 'Keep This Version';
      keepBtn.onclick = () => resolveConflict(conflict.date, ver.versionId || ver.sourceFileId, keepBtn);

      vCard.append(keepBtn);
      grid.append(vCard);
    });

    card.append(header, grid);
    container.append(card);
  }
}

async function resolveConflict(date, keepVersionId, btn) {
  if (!btn || btn.disabled) return;
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Keeping…';

  try {
    await api('/api/reports/resolve-conflict', {
      method: 'POST',
      body: JSON.stringify({ date, keepVersionId })
    });
    message(`Version kept for ${date}. Dashboard refreshed.`);
    await loadReports();
  } catch (err) {
    message(err.message || 'Could not resolve duplicate report.');
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

function formatDateDisplay(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  } catch (_) {
    return iso;
  }
}

function formatLastRefreshed(iso) {
  if (!iso) return 'Never refreshed';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return 'Never refreshed';
    const now = Date.now();
    const diffSec = Math.floor((now - d.getTime()) / 1000);

    if (diffSec < 45) {
      return 'Last refreshed: Just now';
    }
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) {
      return `Last refreshed: ${diffMin}m ago`;
    }
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) {
      return `Last refreshed: ${diffHours}h ago`;
    }
    return `Last refreshed: ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} at ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
  } catch (_) {
    return 'Never refreshed';
  }
}

function updateLastRefreshedUI(iso) {
  const el = $('workspace-last-refresh');
  if (!el) return;
  const timestamp = iso || currentUser?.lastScanAt;
  el.textContent = formatLastRefreshed(timestamp);
  if (timestamp) {
    try {
      const d = new Date(timestamp);
      if (!isNaN(d.getTime())) {
        el.title = d.toLocaleString();
      }
    } catch (_) {}
  } else {
    el.removeAttribute('title');
  }
}

async function triggerSourceRefresh() {
  const btn = $('workspace-refresh-btn');
  const label = $('workspace-refresh-label');
  const icon = btn?.querySelector('.refresh-btn-icon');
  if (!btn || btn.disabled) return;

  btn.disabled = true;
  if (icon) icon.classList.add('spinning');
  if (label) label.textContent = 'Refreshing…';

  try {
    const { result, lastScanAt } = await api('/api/refresh', { method: 'POST' });
    const imported = result?.imported || 0;
    const errors = result?.errors || [];

    if (currentUser) {
      currentUser.lastScanAt = lastScanAt || new Date().toISOString();
    }
    updateLastRefreshedUI(currentUser?.lastScanAt);

    // Reload dashboard reports and KPI state
    await loadReports();

    if (errors.length) {
      message(`Processed folder: ${imported} report(s) ingested, ${errors.length} file(s) had issues.`);
      if (label) label.textContent = 'Issues found';
    } else if (imported > 0) {
      message(`Refresh complete: ${imported} new report(s) imported from Google Drive.`);
      if (label) label.textContent = `Synced (${imported})`;
    } else {
      message('Up to date. No new PDF reports found in Google Drive.');
      if (label) label.textContent = 'Up to date';
    }
    setTimeout(() => {
      if (label && !btn.disabled) label.textContent = 'Refresh Data';
    }, 2500);
  } catch (err) {
    message(err.message || 'Refresh failed.');
    if (label) label.textContent = 'Failed';
    const friendly = formatUserFriendlyError(err.message);
    if (friendly) {
      showTopError(friendly.title, friendly.desc, friendly.action?.label, friendly.action?.href);
    }
    setTimeout(() => {
      if (label && !btn.disabled) label.textContent = 'Refresh Data';
    }, 2500);
  } finally {
    btn.disabled = false;
    if (icon) icon.classList.remove('spinning');
  }
}

// ============================================================================
// MODULE 7: DaybookFolderExplorer (Drive Folder Hierarchy & Onboarding Flow)
// ============================================================================

async function selectFolder(folderId, folderName) {
  message('');
  try {
    const { folder } = await post('/api/folder', { folderId });
    window._currentFolderId = folder.id;
    if (currentUser) {
      currentUser.folderId = folder.id;
      currentUser.folderName = folder.name;
    }
    const displayName = folder.name || folderName || folder.id;
    const currentFolderEl = $('current-folder');
    if (currentFolderEl) currentFolderEl.textContent = `Current folder: ${displayName}`;
    const onboardFolderStatusEl = $('onboard-folder-status');
    if (onboardFolderStatusEl) onboardFolderStatusEl.textContent = `Connected folder: ${displayName}`;
    const onboardFinalEl = $('onboard-final-folder-name');
    if (onboardFinalEl) onboardFinalEl.textContent = displayName;

    // Update active highlight across all tree items
    document.querySelectorAll('.tree-item-row').forEach(row => {
      const group = row.closest('.tree-item-group');
      const isMatch = group && group.dataset.folderId === folder.id;
      row.classList.toggle('selected', isMatch);
      const btn = row.querySelector('.tree-select-btn');
      if (btn) {
        setSelectButtonState(btn, isMatch);
      }
    });

    message(`Folder "${displayName}" connected successfully.`);
    const btn3 = $('onboard-btn-step-3');
    if (btn3) btn3.disabled = false;
  } catch (error) {
    message(error.message);
  }
}

function createFolderNode(folder, depth = 0) {
  const group = document.createElement('div');
  group.className = 'tree-item-group';
  group.dataset.folderId = folder.id;

  const isSelected = window._currentFolderId === folder.id;

  const row = document.createElement('div');
  row.className = `tree-item-row${isSelected ? ' selected' : ''}`;
  if (depth > 0) {
    row.style.paddingLeft = `${depth * 14}px`;
  }

  // Modern Borderless Chevron Button
  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'tree-chevron';
  toggleBtn.type = 'button';
  toggleBtn.setAttribute('aria-label', `Expand ${folder.name}`);
  toggleBtn.title = 'Expand subfolders';
  toggleBtn.innerHTML = `
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="9 18 15 12 9 6"></polyline>
    </svg>
  `;

  // Google Drive Style SVG Folder Icon
  const icon = document.createElement('span');
  icon.className = 'tree-folder-icon';
  icon.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6.59l-2-2H5a2 2 0 0 0-2 2z" fill="#f59e0b" fill-opacity="0.18" stroke="#d97706" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;

  // Folder Name
  const nameSpan = document.createElement('span');
  nameSpan.className = 'tree-folder-name';
  nameSpan.textContent = folder.name;
  nameSpan.title = folder.name;

  // Select Action Button
  const selectBtn = document.createElement('button');
  selectBtn.className = 'tree-select-btn';
  selectBtn.type = 'button';
  setSelectButtonState(selectBtn, isSelected);

  row.append(toggleBtn, icon, nameSpan, selectBtn);

  // Subfolders Container
  const subContainer = document.createElement('div');
  subContainer.className = 'tree-subfolders hidden';

  let subfoldersLoaded = false;

  const toggleExpand = async (e) => {
    e.stopPropagation();
    const isExpanding = subContainer.classList.contains('hidden');

    if (isExpanding) {
      toggleBtn.classList.add('expanded');
      subContainer.classList.remove('hidden');

      if (!subfoldersLoaded) {
        subContainer.replaceChildren(createSubfolderLoader());
        try {
          const { folders: subfolders } = await api(`/api/folders?parentId=${encodeURIComponent(folder.id)}`);
          subContainer.replaceChildren();
          if (!subfolders.length) {
            subContainer.append(element('div', '(Empty folder)', 'tree-empty-inline'));
          } else {
            for (const sub of subfolders) {
              subContainer.append(createFolderNode(sub, depth + 1));
            }
          }
          subfoldersLoaded = true;
        } catch (err) {
          const isAuth = /insufficient.*scope|insufficientpermission|permission_denied|unauthorized|403/i.test(err.message);
          subContainer.replaceChildren(element('div', isAuth ? 'Permission required to view subfolders' : 'Could not load subfolders', 'tree-error-inline'));
        }
      }
    } else {
      toggleBtn.classList.remove('expanded');
      subContainer.classList.add('hidden');
    }
  };

  toggleBtn.onclick = toggleExpand;
  selectBtn.onclick = (e) => {
    e.stopPropagation();
    selectFolder(folder.id, folder.name);
  };
  row.onclick = () => selectFolder(folder.id, folder.name);

  group.append(row, subContainer);
  return group;
}

function renderDriveFolderSections(container, ownFolders, sharedFolders) {
  container.replaceChildren();

  // 1. Own Drive Section
  const ownHeader = document.createElement('div');
  ownHeader.className = 'tree-section-header';
  ownHeader.innerHTML = `
    <div class="tree-section-title-wrap">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M22 12H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" y1="16" x2="6.01" y2="16"/><line x1="10" y1="16" x2="10.01" y2="16"/></svg>
      <span class="tree-section-title">Own Drive</span>
    </div>
    <span class="tree-section-badge">${ownFolders.length}</span>
  `;
  container.append(ownHeader);

  const ownGroup = document.createElement('div');
  ownGroup.className = 'tree-category-group';
  if (!ownFolders.length) {
    const emptyOwn = document.createElement('div');
    emptyOwn.className = 'tree-empty-section';
    emptyOwn.textContent = 'No top-level folders in your Own Drive.';
    ownGroup.append(emptyOwn);
  } else {
    for (const folder of ownFolders) {
      ownGroup.append(createFolderNode(folder, 0));
    }
  }
  container.append(ownGroup);

  // 2. Shared Section
  const sharedHeader = document.createElement('div');
  sharedHeader.className = 'tree-section-header';
  sharedHeader.innerHTML = `
    <div class="tree-section-title-wrap">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
      <span class="tree-section-title">Shared</span>
    </div>
    <span class="tree-section-badge">${sharedFolders.length}</span>
  `;
  container.append(sharedHeader);

  const sharedGroup = document.createElement('div');
  sharedGroup.className = 'tree-category-group';
  if (!sharedFolders.length) {
    const emptyShared = document.createElement('div');
    emptyShared.className = 'tree-empty-section';
    emptyShared.textContent = 'No shared folders found.';
    sharedGroup.append(emptyShared);
  } else {
    for (const folder of sharedFolders) {
      sharedGroup.append(createFolderNode(folder, 0));
    }
  }
  container.append(sharedGroup);
}

function renderTreeError(container, error, retryFn) {
  const raw = String(error?.message || error || '').trim();
  const isAuthError = /insufficient.*scope|insufficientpermission|permission_denied|invalid_grant|unauthorized|invalid credentials|token expired|403|401/i.test(raw);

  const card = document.createElement('div');
  card.className = 'tree-error-state-card';

  const iconWrap = document.createElement('div');
  iconWrap.className = 'tree-error-icon-wrap';
  iconWrap.innerHTML = `
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
      <line x1="12" y1="8" x2="12" y2="12"/>
      <line x1="12" y1="16" x2="12.01" y2="16"/>
    </svg>
  `;

  const titleEl = document.createElement('h4');
  titleEl.className = 'tree-error-title';
  titleEl.textContent = isAuthError ? 'Google Drive Permission Required' : 'Unable to Load Folders';

  const descEl = document.createElement('p');
  descEl.className = 'tree-error-desc';
  descEl.textContent = isAuthError
    ? 'Access to Google Drive was not granted or has expired. Please re-authenticate with Google and ensure Drive access is selected to browse and connect folders.'
    : (raw.startsWith('Google Drive') ? 'Google Drive service returned an error while listing folders. Please try again.' : raw);

  const actions = document.createElement('div');
  actions.className = 'tree-error-actions';

  const reauthBtn = document.createElement('a');
  reauthBtn.href = '/auth/login';
  reauthBtn.className = 'btn btn-primary btn-sm tree-reauth-btn';
  reauthBtn.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
      <polyline points="10 17 15 12 10 7"/>
      <line x1="15" y1="12" x2="3" y2="12"/>
    </svg>
    <span>Grant Drive Permission</span>
  `;
  actions.append(reauthBtn);

  if (typeof retryFn === 'function') {
    const retryBtn = document.createElement('button');
    retryBtn.type = 'button';
    retryBtn.className = 'btn btn-secondary btn-sm tree-retry-btn';
    retryBtn.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
      </svg>
      <span>Retry</span>
    `;
    retryBtn.onclick = () => retryFn();
    actions.append(retryBtn);
  }

  card.append(iconWrap, titleEl, descEl, actions);
  container.replaceChildren(card);
}

async function loadFolderTree(containerId) {
  const container = $(containerId);
  if (!container) return;

  container.replaceChildren(element('div', 'Loading Google Drive folders…', 'tree-loading'));
  try {
    const data = await api('/api/folders?parentId=root');
    const folders = data.folders || [];
    const ownFolders = data.ownFolders || folders.filter(f => !f.isShared);
    const sharedFolders = data.sharedFolders || folders.filter(f => Boolean(f.isShared));

    if (!folders.length) {
      container.replaceChildren(element('div', 'No folders found in Google Drive root.', 'tree-empty-state'));
      return;
    }

    renderDriveFolderSections(container, ownFolders, sharedFolders);
  } catch (error) {
    renderTreeError(container, error, () => loadFolderTree(containerId));
  }
}

async function loadFolders() {
  await Promise.all([
    loadFolderTree('onboard-folder-tree'),
    loadFolderTree('workspace-folder-tree')
  ]);
}

async function action(button, fn) {
  button.disabled = true;
  message('');
  try {
    await fn();
  } catch (error) {
    message(error.message);
  } finally {
    button.disabled = false;
  }
}

/* ReUI Stepper & Onboarding Manager (Images 1, 2, 3) */
function updateOnboardingView() {
  for (let i = 1; i <= 5; i++) {
    const pane = $(`onboard-step-${i}`);
    if (pane) {
      pane.classList.toggle('active', i === currentOnboardStep);
      pane.classList.toggle('hidden', i !== currentOnboardStep);
    }

    const railItem = $(`rail-step-${i}`);
    if (railItem) {
      railItem.classList.toggle('active', i === currentOnboardStep);
      railItem.classList.toggle('completed', i < currentOnboardStep);

      const dot = railItem.querySelector('.step-dot');
      if (dot) {
        if (i < currentOnboardStep) {
          dot.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
        } else {
          dot.innerHTML = '';
        }
      }
    }
  }

  // Pre-fill profile if available on Step 1
  if (currentOnboardStep === 1 && currentUser) {
    const nameInput = $('onboard-name-input');
    if (nameInput && (!nameInput.value || nameInput.value === currentUser.email)) {
      nameInput.value = currentUser.name || '';
    }
    const emailBadge = $('onboard-user-email-badge');
    if (emailBadge) emailBadge.textContent = currentUser.email || 'user@example.com';
    const avatarPreview = $('onboard-avatar-preview');
    if (avatarPreview && currentUser.picture) {
      avatarPreview.innerHTML = `<img src="${currentUser.picture}" alt="" class="onboard-avatar-img">`;
    } else if (avatarPreview) {
      const initial = (currentUser.name || currentUser.email || 'U').charAt(0).toUpperCase();
      avatarPreview.innerHTML = `<span id="onboard-avatar-fallback">${initial}</span>`;
    }
  }

  // Step 2 Terms validation
  if (currentOnboardStep === 2) {
    const btn = $('onboard-btn-step-2');
    if (btn) btn.disabled = !$('terms-checkbox').checked;
  }

  // Step 3 Folder validation
  if (currentOnboardStep === 3) {
    const btn3 = $('onboard-btn-step-3');
    if (btn3) {
      const hasFolder = Boolean(currentUser?.folderId || window._currentFolderId);
      btn3.disabled = !hasFolder;
    }
  }
}

function initOnboarding() {
  // Sync name changes in real time to avatar fallback and user menu
  const nameInput = $('onboard-name-input');
  if (nameInput) {
    nameInput.addEventListener('input', () => {
      const val = nameInput.value.trim();
      if (val && currentUser) {
        currentUser.name = val;
        renderUserMenu(currentUser);
        const fallback = $('onboard-avatar-fallback');
        if (fallback && !currentUser.picture) {
          fallback.textContent = val.charAt(0).toUpperCase();
        }
      }
    });
  }

  // Step 1 Profile Continue
  const btn1 = $('onboard-btn-step-1');
  if (btn1) {
    btn1.onclick = async () => {
      const name = ($('onboard-name-input').value || '').trim();
      if (!name) {
        message('Please enter your full name to continue.');
        $('onboard-name-input').focus();
        return;
      }
      if (currentUser) currentUser.name = name;
      renderUserMenu(currentUser);
      try {
        await post('/api/profile', { name });
      } catch (_) {}
      currentOnboardStep = 2;
      updateOnboardingView();
    };
  }

  // Step 2 Terms Checkbox & Continue
  const termsCb = $('terms-checkbox');
  if (termsCb) {
    termsCb.onchange = () => {
      const btn2 = $('onboard-btn-step-2');
      if (btn2) btn2.disabled = !termsCb.checked;
    };
  }
  const btn2 = $('onboard-btn-step-2');
  if (btn2) {
    btn2.onclick = () => {
      if (!$('terms-checkbox').checked) return;
      currentOnboardStep = 3;
      updateOnboardingView();
      loadFolders();
    };
  }

  // Step 3 Folder Selection Continue
  const btn3 = $('onboard-btn-step-3');
  if (btn3) {
    btn3.onclick = () => {
      const hasFolder = Boolean(currentUser?.folderId || window._currentFolderId);
      if (!hasFolder) {
        btn3.disabled = true;
        message('Please select or paste your Google Drive folder before continuing.');
        return;
      }
      currentOnboardStep = 4;
      updateOnboardingView();
    };
  }

  // Step 4 Schedule Continue
  const btn4 = $('onboard-btn-step-4');
  if (btn4) {
    btn4.onclick = async () => {
      const selected = document.querySelector('input[name="onboard-schedule"]:checked');
      if (selected) {
        const minutes = Number(selected.value);
        await post('/api/schedule', { minutes });
        const schedEl = $('schedule');
        if (schedEl) schedEl.value = String(minutes);
      }
      currentOnboardStep = 5;
      updateOnboardingView();
    };
  }

  // Step 5 Ready: Option A - Go to Dashboard (Image 3)
  const goDashboardBtn = $('onboard-go-dashboard-btn');
  if (goDashboardBtn) {
    goDashboardBtn.onclick = async () => {
      const name = ($('onboard-name-input')?.value || currentUser?.name || '').trim();
      if (name && currentUser) currentUser.name = name;
      renderUserMenu(currentUser);
      await post('/api/onboarded', { termsAccepted: true, completed: true, name });
      document.body.classList.remove('onboarding-mode');
      $('onboarding').classList.add('hidden');
      $('workspace').classList.remove('hidden');
      message('Setup complete! Your dashboard is active.');
      await loadReports();
    };
  }

  // Step 5 Ready: Option B - Review Settings (Image 3)
  const reviewSettingsBtn = $('onboard-review-settings-btn');
  if (reviewSettingsBtn) {
    reviewSettingsBtn.onclick = async () => {
      const name = ($('onboard-name-input')?.value || currentUser?.name || '').trim();
      if (name && currentUser) currentUser.name = name;
      await post('/api/onboarded', { termsAccepted: true, completed: true, name });
      document.body.classList.remove('onboarding-mode');
      window.location.href = '/settings';
    };
  }

  // Allow clicking completed sidebar steps to navigate back
  document.querySelectorAll('.stepper-step-item').forEach(item => {
    item.onclick = () => {
      const step = Number(item.dataset.step);
      if (step < currentOnboardStep) {
        currentOnboardStep = step;
        updateOnboardingView();
      }
    };
  });

  const onboardCustomBtn = $('onboard-custom-btn');
  if (onboardCustomBtn) {
    onboardCustomBtn.onclick = () => action(onboardCustomBtn, async () => {
      const raw = ($('onboard-custom-folder-id').value || '').trim();
      if (!raw) throw new Error('Enter a Google Drive folder link or ID.');
      await selectFolder(raw, '');
      await loadFolders();
    });
  }

  const onboardRefreshBtn = $('onboard-refresh-folders');
  if (onboardRefreshBtn) {
    onboardRefreshBtn.onclick = () => loadFolderTree('onboard-folder-tree');
  }

  const reopenBtn = $('reopen-onboarding');
  if (reopenBtn) {
    reopenBtn.onclick = () => {
      currentOnboardStep = 1;
      updateOnboardingView();
      $('workspace').classList.add('hidden');
      $('onboarding').classList.remove('hidden');
    };
  }
}

// ============================================================================
// MODULE 8: DaybookApp (Lifecycle, Sync Orchestration & User Navigation)
// ============================================================================

function hidePageLoader() {
  const loader = $('app-page-loader');
  if (!loader) return;
  loader.classList.add('fade-out');
  setTimeout(() => {
    loader.classList.add('hidden');
    loader.style.display = 'none';
  }, 220);
}

async function load() {
  let response;
  try {
    response = await fetch('/api/me');
  } catch (err) {
    hidePageLoader();
    $('signin').classList.remove('hidden');
    return;
  }

  if (response.status === 401) {
    document.body.classList.add('signin-mode');
    $('signin').classList.remove('hidden');
    hidePageLoader();
    return;
  }
  document.body.classList.remove('signin-mode');

  const { csrf: token, user } = await response.json();
  csrf = token;
  currentUser = user;
  window._currentFolderId = user.folderId || '';

  renderUserMenu(user);
  initOnboarding();

  // Wire top error banner dismiss button
  const closeBtn = $('top-error-close');
  if (closeBtn) closeBtn.onclick = hideTopError;

  // Set personalized welcome title
  const welcomeTitle = $('welcome-title');
  if (welcomeTitle) {
    welcomeTitle.textContent = user.name ? `Welcome, ${user.name}` : 'Welcome';
  }

  // Wire workspace refresh button (fetches live source and ingests)
  const refreshBtn = $('workspace-refresh-btn');
  if (refreshBtn) {
    refreshBtn.onclick = triggerSourceRefresh;
  }
  updateLastRefreshedUI(user.lastScanAt);
  setInterval(() => updateLastRefreshedUI(), 30000);

  // Display user-friendly banner if there was an active backend scan error
  if (user.lastScanError) {
    const friendly = formatUserFriendlyError(user.lastScanError);
    if (friendly) {
      showTopError(friendly.title, friendly.desc, friendly.action?.label, friendly.action?.href);
    }
  }

  // Determine whether to display Onboarding (first-time login) or Workspace
  const hasCompletedOnboarding = Boolean(user.onboardedAt || (user.folderId && user.termsAcceptedAt));
  if (hasCompletedOnboarding) {
    document.body.classList.remove('onboarding-mode');
    $('workspace').classList.remove('hidden');
    $('onboarding').classList.add('hidden');
    try {
      await loadReports();
    } finally {
      hidePageLoader();
    }
  } else {
    document.body.classList.add('onboarding-mode');
    $('workspace').classList.add('hidden');
    $('onboarding').classList.remove('hidden');
    if (user.folderName) {
      const statusEl = $('onboard-folder-status');
      if (statusEl) statusEl.textContent = `Connected folder: ${user.folderName}`;
    }
    updateOnboardingView();
    hidePageLoader();
  }
}

function renderUserMenu(user) {
  const container = $('account');
  if (!container) return;
  container.replaceChildren();

  const menuWrap = document.createElement('div');
  menuWrap.className = 'user-menu-wrap';

  // Round Avatar Trigger Button (Top Right Corner)
  const triggerBtn = document.createElement('button');
  triggerBtn.className = 'user-avatar-trigger';
  triggerBtn.type = 'button';
  triggerBtn.setAttribute('aria-haspopup', 'true');
  triggerBtn.setAttribute('aria-expanded', 'false');
  triggerBtn.setAttribute('aria-label', `Account menu for ${user.name || user.email}`);

  if (user.picture) {
    const img = document.createElement('img');
    img.className = 'nav-avatar-img';
    img.src = user.picture;
    img.alt = user.name || 'User';
    triggerBtn.append(img);
  } else {
    const fallback = document.createElement('div');
    fallback.className = 'nav-avatar-fallback';
    fallback.textContent = (user.name || user.email || 'U').charAt(0).toUpperCase();
    triggerBtn.append(fallback);
  }
  const statusDot = document.createElement('span');
  statusDot.className = 'avatar-status-dot';
  triggerBtn.append(statusDot);

  // Popover Menu matching Reference Image
  const popover = document.createElement('div');
  popover.className = 'user-menu-popover hidden';

  // Profile Header (Readable: Photo, Name, Email)
  const profileSection = document.createElement('div');
  profileSection.className = 'menu-profile-section';

  const avatarWrap = document.createElement('div');
  avatarWrap.className = 'menu-avatar-wrap';
  if (user.picture) {
    const headImg = document.createElement('img');
    headImg.className = 'menu-avatar-img';
    headImg.src = user.picture;
    headImg.alt = '';
    avatarWrap.append(headImg);
  } else {
    const headFallback = document.createElement('div');
    headFallback.className = 'menu-avatar-fallback';
    headFallback.textContent = (user.name || user.email || 'U').charAt(0).toUpperCase();
    avatarWrap.append(headFallback);
  }
  const innerDot = document.createElement('span');
  innerDot.className = 'avatar-status-dot';
  avatarWrap.append(innerDot);

  const detailsCol = document.createElement('div');
  detailsCol.className = 'menu-user-details';
  const profName = document.createElement('span');
  profName.className = 'menu-user-name';
  profName.textContent = user.name || 'User';
  const profEmail = document.createElement('span');
  profEmail.className = 'menu-user-email';
  profEmail.textContent = user.email;
  detailsCol.append(profName, profEmail);
  profileSection.append(avatarWrap, detailsCol);

  // Divider
  const divider1 = document.createElement('div');
  divider1.className = 'menu-divider';

  // Navigation Links
  const settingsLink = document.createElement('a');
  settingsLink.className = 'menu-action-item';
  settingsLink.href = '/settings';
  settingsLink.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
    <span>Settings</span>
  `;

  const termsLink = document.createElement('a');
  termsLink.className = 'menu-action-item';
  termsLink.href = '/terms';
  termsLink.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="16" y1="13" x2="8" y2="13"/>
      <line x1="16" y1="17" x2="8" y2="17"/>
    </svg>
    <span>Terms &amp; Conditions</span>
  `;

  // Divider
  const divider2 = document.createElement('div');
  divider2.className = 'menu-divider';

  // Theme Row (Matching Reference Screenshot)
  const themeRow = document.createElement('div');
  themeRow.className = 'menu-theme-row';
  themeRow.innerHTML = `
    <div class="menu-theme-label">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/>
        <circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/>
        <circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/>
        <circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/>
        <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>
      </svg>
      <span>Theme</span>
    </div>
    <div class="theme-segmented-control" role="radiogroup" aria-label="Theme selection">
      <button type="button" class="theme-seg-btn" data-theme-val="light" title="Light theme" aria-label="Light mode">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
      </button>
      <button type="button" class="theme-seg-btn" data-theme-val="dark" title="Dark theme" aria-label="Dark mode">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
      </button>
      <button type="button" class="theme-seg-btn" data-theme-val="system" title="System theme" aria-label="System mode">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
      </button>
    </div>
  `;

  // Wire theme buttons
  themeRow.querySelectorAll('.theme-seg-btn').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      setTheme(btn.dataset.themeVal);
    };
  });

  // Divider
  const divider3 = document.createElement('div');
  divider3.className = 'menu-divider';

  // Logout Button
  const logoutBtn = document.createElement('button');
  logoutBtn.className = 'menu-action-item logout';
  logoutBtn.type = 'button';
  logoutBtn.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
      <polyline points="16 17 21 12 16 7"/>
      <line x1="21" y1="12" x2="9" y2="12"/>
    </svg>
    <span>Sign Out</span>
  `;
  logoutBtn.onclick = async () => {
    try {
      await post('/api/logout');
    } finally {
      window.location.reload();
    }
  };

  popover.append(profileSection, divider1, settingsLink, termsLink, divider2, themeRow, divider3, logoutBtn);
  menuWrap.append(triggerBtn, popover);
  container.append(menuWrap);

  updateThemeSegmentUI();

  // Toggle behavior
  triggerBtn.onclick = (e) => {
    e.stopPropagation();
    const isHidden = popover.classList.contains('hidden');
    if (isHidden) {
      const datePopover = $('date-range-popover');
      if (datePopover) {
        datePopover.classList.add('hidden');
        const dateTrigger = $('date-range-trigger');
        if (dateTrigger) dateTrigger.setAttribute('aria-expanded', 'false');
      }
    }
    popover.classList.toggle('hidden', !isHidden);
    triggerBtn.setAttribute('aria-expanded', String(isHidden));
  };

  document.addEventListener('click', (e) => {
    if (!menuWrap.contains(e.target)) {
      popover.classList.add('hidden');
      triggerBtn.setAttribute('aria-expanded', 'false');
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      popover.classList.add('hidden');
      triggerBtn.setAttribute('aria-expanded', 'false');
    }
  });
}

// ============================================================================
// DAYBOOK MODULE REGISTRY & EXPORTS
// ============================================================================

const DaybookCore = {
  $,
  message,
  formatUserFriendlyError,
  showTopError,
  hideTopError,
  checkSourceStatus,
  api,
  post,
  element,
  action,
  get csrf() { return csrf; },
  set csrf(val) { csrf = val; }
};

const DaybookDateUtils = {
  padZero,
  toIsoDate,
  getPresetRange,
  formatRangeLabel,
  getComparisonPeriod,
  formatFactDate,
  formatHourRangeCompact,
  formatDateDisplay,
  formatLastRefreshed
};

const DaybookMetrics = {
  computeMetrics,
  renderDeltaBadge,
  getReportHourlyBreakdown,
  detectDuplicateReports,
  renderDuplicateConflicts,
  resolveConflict
};

const DaybookCharts = {
  renderDailyCasesBarChart,
  renderSingleDateLineChart,
  renderGroupedDatesLineChart,
  renderHourlyProductivityLineChart,
  get selectedChartDate() { return selectedChartDate; },
  set selectedChartDate(val) { selectedChartDate = val; }
};

const DaybookFunFacts = {
  renderProductivityFunFacts,
  initFunFactsCollapse
};

const DaybookDateRangePicker = {
  initDateRangePicker,
  updatePresetButtonsUI,
  renderDualCalendars,
  renderMonthGrid,
  handleDayCellClick,
  exportDashboardPdf,
  buildReportPdf,
  escapePdfText,
  svgToImageData
};

const DaybookFolderExplorer = {
  createSubfolderLoader,
  setSelectButtonState,
  createFolderNode,
  renderDriveFolderSections,
  renderTreeError,
  loadFolderTree,
  loadFolders,
  selectFolder,
  updateOnboardingView,
  initOnboarding
};

const DaybookApp = {
  filterAndRenderDashboard,
  loadReports,
  triggerSourceRefresh,
  updateLastRefreshedUI,
  renderUserMenu,
  hidePageLoader,
  load,
  get currentUser() { return currentUser; },
  set currentUser(val) { currentUser = val; },
  get rawReportsData() { return rawReportsData; },
  set rawReportsData(val) { rawReportsData = val; }
};

if (typeof window !== 'undefined') {
  window.Daybook = {
    Core: DaybookCore,
    DateUtils: DaybookDateUtils,
    Metrics: DaybookMetrics,
    Charts: DaybookCharts,
    FunFacts: DaybookFunFacts,
    DateRangePicker: DaybookDateRangePicker,
    FolderExplorer: DaybookFolderExplorer,
    App: DaybookApp
  };
}

load().catch(error => message(error.message));
