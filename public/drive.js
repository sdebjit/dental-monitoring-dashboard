let csrf = '';
const $ = id => document.getElementById(id);
const message = text => { $('message').textContent = text || ''; };
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.method === 'POST' ? { 'X-Daybook-CSRF': csrf } : {}), ...(options.headers || {}) } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}
const post = (path, data = {}) => api(path, { method: 'POST', body: JSON.stringify(data) });
function element(tag, text, className) { const node = document.createElement(tag); node.textContent = text; if (className) node.className = className; return node; }
function scanStatus(user) {
  const result = user.lastScanResult;
  const at = user.lastScanAt ? new Date(user.lastScanAt).toLocaleString() : 'Never';
  const errors = result?.errors?.map(item => `${item.file}: ${item.message}`).join(' · ') || '';
  $('scan-status').textContent = user.lastScanError || errors || `Last check: ${at}${result ? ` · ${result.imported} imported · ${result.archived} archived` : ''}`;
}
async function loadReports() {
  const { reports } = await api('/api/reports');
  const box = $('reports'); box.replaceChildren();
  if (!reports.length) { box.append(element('p', 'No reports imported yet. Add a PDF to your selected folder and refresh.', 'muted')); return; }
  for (const report of reports) {
    const row = element('div', '', 'report');
    const main = element('div', '');
    main.append(element('strong', report.date), element('small', report.sourceFileName || 'PDF report'));
    const stats = element('div', '', 'stats');
    const cases = element('div', ''); cases.append(element('strong', String(report.casesFinished)), element('small', ' cases'));
    const score = element('div', ''); score.append(element('strong', String(report.individualScore)), element('small', ' pts'));
    stats.append(cases, score); row.append(main, stats); box.append(row);
  }
}
async function load() {
  const response = await fetch('/api/me');
  if (response.status === 401) { $('signin').classList.remove('hidden'); return; }
  const { csrf: token, user } = await response.json(); csrf = token;
  $('workspace').classList.remove('hidden');
  $('account').replaceChildren();
  const account = element('div', '', 'account');
  account.append(element('span', user.email));
  const signout = element('button', 'Sign out'); signout.onclick = async () => { await post('/api/logout'); location.reload(); };
  account.append(signout); $('account').append(account);
  $('current-folder').textContent = user.folderName ? `Current folder: ${user.folderName}` : 'No folder selected yet.';
  $('schedule').value = String(Math.max(user.scheduleMinutes || 1440, 1440));
  scanStatus(user);
  await Promise.all([loadReports(), loadFolders()]);
}
async function loadFolders() {
  const list = $('folders');
  try {
    const { folders } = await api('/api/folders');
    list.replaceChildren(new Option('Select a folder', ''));
    for (const folder of folders.sort((a, b) => a.name.localeCompare(b.name))) list.add(new Option(folder.name, folder.id));
    if (!folders.length) message('No writable Google Drive folders found. Create one in Drive, then reload this page.');
  } catch (error) { list.replaceChildren(new Option('Folders unavailable', '')); message(error.message); }
}
async function action(button, fn) {
  button.disabled = true; message('');
  try { await fn(); } catch (error) { message(error.message); }
  finally { button.disabled = false; }
}
$('choose-folder').onclick = () => action($('choose-folder'), async () => {
  const folderId = $('folders').value;
  if (!folderId) throw new Error('Select a folder.');
  const { folder } = await post('/api/folder', { folderId });
  $('current-folder').textContent = `Current folder: ${folder.name}`;
  message('Folder saved. Add a PDF there, then choose Refresh now.');
});
$('save-schedule').onclick = () => action($('save-schedule'), async () => { await post('/api/schedule', { minutes: Number($('schedule').value) }); message('Refresh schedule saved.'); });
$('refresh').onclick = () => action($('refresh'), async () => {
  $('scan-status').textContent = 'Checking your folder…';
  const { result } = await post('/api/refresh');
  $('scan-status').textContent = `${result.checked} PDFs checked · ${result.imported} imported · ${result.archived} archived${result.errors.length ? ` · ${result.errors.length} failed` : ''}`;
  if (result.errors.length) message(result.errors.map(item => `${item.file}: ${item.message}`).join(' · '));
  await loadReports();
});
$('stop-sync').onclick = () => action($('stop-sync'), async () => { await post('/api/stop-sync'); location.reload(); });
load().catch(error => message(error.message));
