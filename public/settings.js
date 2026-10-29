let csrf = '';
let currentUser = null;
const $ = id => document.getElementById(id);
const message = text => { $('message').textContent = text || ''; };

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

function action(button, handler) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = 'Saving…';
  return handler()
    .catch(error => message(error.message))
    .finally(() => {
      button.disabled = false;
      button.textContent = original;
    });
}

function formatDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

/* User Menu Setup */
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
  const dashLink = document.createElement('a');
  dashLink.className = 'menu-action-item';
  dashLink.href = '/';
  dashLink.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="3" width="7" height="7"/>
      <rect x="14" y="3" width="7" height="7"/>
      <rect x="14" y="14" width="7" height="7"/>
      <rect x="3" y="14" width="7" height="7"/>
    </svg>
    <span>Dashboard</span>
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

  // Theme Row (Segmented control matching reference image)
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

  themeRow.querySelectorAll('.theme-seg-btn').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      if (typeof setTheme === 'function') setTheme(btn.dataset.themeVal);
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
      window.location.href = '/';
    }
  };

  popover.append(profileSection, divider1, dashLink, termsLink, divider2, themeRow, divider3, logoutBtn);
  menuWrap.append(triggerBtn, popover);
  container.append(menuWrap);

  if (typeof updateThemeSegmentUI === 'function') updateThemeSegmentUI();

  // Toggle behavior
  triggerBtn.onclick = (e) => {
    e.stopPropagation();
    const isHidden = popover.classList.contains('hidden');
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

/* Schedule Controls */
function initSchedule(minutes) {
  const val = String(minutes ?? 1440);
  const radios = document.querySelectorAll('input[name="settings-schedule"]');
  radios.forEach(radio => {
    const isMatch = radio.value === val;
    radio.checked = isMatch;
    radio.closest('.schedule-radio-card')?.classList.toggle('active', isMatch);
    radio.onchange = () => {
      radios.forEach(r => r.closest('.schedule-radio-card')?.classList.toggle('active', r.checked));
    };
  });

  $('save-schedule-btn').onclick = () => action($('save-schedule-btn'), async () => {
    const checked = document.querySelector('input[name="settings-schedule"]:checked');
    const selectedMinutes = Number(checked ? checked.value : 1440);
    await post('/api/schedule', { minutes: selectedMinutes });
    const statusEl = $('schedule-save-status');
    statusEl.textContent = 'Schedule saved';
    statusEl.classList.add('success');
    setTimeout(() => { statusEl.textContent = ''; }, 3500);
  });
}

/* Folder Selection Controls */
function initFolderView(user) {
  const nameEl = $('settings-folder-name');
  nameEl.textContent = user.folderName || 'No folder connected yet';
  const badgeEl = $('settings-folder-badge');
  badgeEl.textContent = user.folderName ? 'Connected & Active' : 'Not Connected';
  badgeEl.classList.toggle('inactive', !user.folderName);

  const minView = $('folder-minimized-view');
  const expView = $('folder-expanded-view');

  $('edit-folder-btn').onclick = () => {
    minView.classList.add('hidden');
    expView.classList.remove('hidden');
    loadSettingsFolderTree();
  };

  $('cancel-folder-btn').onclick = () => {
    expView.classList.add('hidden');
    minView.classList.remove('hidden');
  };

  $('settings-custom-btn').onclick = () => action($('settings-custom-btn'), async () => {
    const raw = ($('settings-custom-folder-id').value || '').trim();
    if (!raw) throw new Error('Enter a Google Drive folder link or ID.');
    await setFolder(raw);
    expView.classList.add('hidden');
    minView.classList.remove('hidden');
  });

  $('settings-refresh-folders').onclick = () => loadSettingsFolderTree();
}

async function setFolder(folderId) {
  message('');
  const { folder } = await post('/api/folder', { folderId });
  currentUser.folderId = folder.id;
  currentUser.folderName = folder.name;
  $('settings-folder-name').textContent = folder.name;
  const badgeEl = $('settings-folder-badge');
  badgeEl.textContent = 'Connected & Active';
  badgeEl.classList.remove('inactive');
  message(`Folder "${folder.name}" connected successfully.`);
}

function createFolderNode(folder) {
  const group = document.createElement('div');
  group.className = 'tree-item-group';
  group.dataset.folderId = folder.id;

  const row = document.createElement('div');
  row.className = 'tree-item-row';
  if (currentUser?.folderId === folder.id) row.classList.add('selected');

  // Modern Borderless Chevron Button
  const chevron = document.createElement('button');
  chevron.className = 'tree-chevron';
  chevron.type = 'button';
  chevron.setAttribute('aria-label', `Expand ${folder.name}`);
  chevron.title = 'Expand subfolders';
  chevron.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;

  // Google Drive Style SVG Folder Icon
  const icon = document.createElement('span');
  icon.className = 'tree-folder-icon';
  icon.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6.59l-2-2H5a2 2 0 0 0-2 2z" fill="#f59e0b" fill-opacity="0.18" stroke="#d97706" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  const label = document.createElement('span');
  label.className = 'tree-folder-name';
  label.textContent = folder.name;
  label.title = folder.name;

  const selectBtn = document.createElement('button');
  selectBtn.className = 'tree-select-btn';
  selectBtn.type = 'button';
  const isSelected = currentUser?.folderId === folder.id;
  setSelectButtonState(selectBtn, isSelected);

  const onSelect = async () => {
    await setFolder(folder.id);
    document.querySelectorAll('#settings-folder-tree .tree-item-row').forEach(r => {
      const match = r === row;
      r.classList.toggle('selected', match);
      const b = r.querySelector('.tree-select-btn');
      if (b) {
        setSelectButtonState(b, match);
      }
    });
    $('folder-expanded-view').classList.add('hidden');
    $('folder-minimized-view').classList.remove('hidden');
  };

  selectBtn.onclick = (e) => {
    e.stopPropagation();
    onSelect();
  };
  row.onclick = () => onSelect();

  row.append(chevron, icon, label, selectBtn);
  group.append(row);

  const subContainer = document.createElement('div');
  subContainer.className = 'tree-subfolders hidden';
  group.append(subContainer);

  let loaded = false;
  chevron.onclick = async (e) => {
    e.stopPropagation();
    const isExpanded = chevron.classList.contains('expanded');
    if (isExpanded) {
      chevron.classList.remove('expanded');
      subContainer.classList.add('hidden');
    } else {
      chevron.classList.add('expanded');
      subContainer.classList.remove('hidden');
      if (!loaded) {
        subContainer.replaceChildren(createSubfolderLoader());
        try {
          const { folders } = await api(`/api/folders?parentId=${encodeURIComponent(folder.id)}`);
          subContainer.replaceChildren();
          if (!folders.length) {
            subContainer.append(element('div', '(Empty folder)', 'tree-empty-inline'));
          } else {
            for (const child of folders) {
              subContainer.append(createFolderNode(child));
            }
          }
          loaded = true;
        } catch (err) {
          const isAuth = /insufficient.*scope|insufficientpermission|permission_denied|unauthorized|403/i.test(err.message);
          subContainer.replaceChildren(element('div', isAuth ? 'Permission required to view subfolders' : 'Could not load subfolders', 'tree-empty-inline'));
        }
      }
    }
  };

  return group;
}

function renderFolderTreeWithSections(container, ownFolders, sharedFolders) {
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
    emptyOwn.textContent = 'No top-level folders found in Own Drive.';
    ownGroup.append(emptyOwn);
  } else {
    for (const folder of ownFolders) {
      ownGroup.append(createFolderNode(folder));
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
      sharedGroup.append(createFolderNode(folder));
    }
  }
  container.append(sharedGroup);
}

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

async function loadSettingsFolderTree() {
  const treeBox = $('settings-folder-tree');
  treeBox.replaceChildren(element('div', 'Loading Google Drive folders…', 'tree-loading'));
  try {
    const data = await api('/api/folders?parentId=root');
    const folders = data.folders || [];
    const ownFolders = data.ownFolders || folders.filter(f => !f.isShared);
    const sharedFolders = data.sharedFolders || folders.filter(f => Boolean(f.isShared));

    if (!folders.length) {
      treeBox.replaceChildren(element('div', 'No folders found in Google Drive root.', 'tree-empty'));
      return;
    }

    renderFolderTreeWithSections(treeBox, ownFolders, sharedFolders);
  } catch (err) {
    renderTreeError(treeBox, err, () => loadSettingsFolderTree());
  }
}

/* Import Stats & Recent 5 Details */
async function loadImportStats() {
  const successfulEl = $('stat-successful-count');
  const errorsEl = $('stat-errors-count');
  const listEl = $('recent-imports-list');

  try {
    const stats = await api('/api/import-stats');
    successfulEl.textContent = String(stats.totalSuccessful ?? 0);
    errorsEl.textContent = String(stats.totalErrors ?? 0);

    listEl.replaceChildren();
    const items = stats.recentImports || [];
    if (!items.length) {
      listEl.append(element('div', 'No reports imported yet. Place daily PDFs in your Google Drive folder.', 'tree-empty'));
      return;
    }

    const table = document.createElement('div');
    table.className = 'imports-table';

    // Table Header
    const thead = document.createElement('div');
    thead.className = 'imports-table-row header';
    thead.innerHTML = `
      <span class="col-when">When</span>
      <span class="col-file">File</span>
      <span class="col-location">Drive Location</span>
      <span class="col-metrics">Status / Metrics</span>
    `;
    table.append(thead);

    for (const item of items) {
      const row = document.createElement('div');
      row.className = `imports-table-row${item.status === 'error' ? ' is-error' : ''}`;

      const whenCol = document.createElement('span');
      whenCol.className = 'col-when';
      whenCol.textContent = formatDate(item.when);

      const fileCol = document.createElement('span');
      fileCol.className = 'col-file';
      fileCol.textContent = item.fileName || 'report.pdf';
      fileCol.title = item.fileName || 'report.pdf';

      const locCol = document.createElement('span');
      locCol.className = 'col-location';
      locCol.textContent = item.location || 'archive';
      locCol.title = item.location || 'archive';

      const metCol = document.createElement('span');
      metCol.className = 'col-metrics';
      if (item.status === 'error') {
        const errorText = item.error || 'Import failed';
        metCol.innerHTML = `<span class="stat-indicator-pill error">Failed</span><span class="error-inline-desc" title="${errorText}">${errorText}</span>`;
      } else {
        metCol.innerHTML = `<strong>${item.casesFinished ?? 0}</strong> cases · <strong>${item.individualScore ?? 0}</strong> pts`;
      }

      row.append(whenCol, fileCol, locCol, metCol);
      table.append(row);
    }

    listEl.append(table);
  } catch (err) {
    listEl.replaceChildren(element('div', `Could not load stats: ${err.message}`, 'tree-empty'));
  }
}

/* Delete All Data Modal Controls */
function initDeleteModal() {
  const modal = $('delete-modal');
  const openBtn = $('open-delete-modal-btn');
  const cancelBtn = $('cancel-delete-modal-btn');
  const confirmBtn = $('confirm-delete-modal-btn');

  openBtn.onclick = () => {
    modal.classList.remove('hidden');
  };

  cancelBtn.onclick = () => {
    modal.classList.add('hidden');
  };

  modal.onclick = (e) => {
    if (e.target === modal) modal.classList.add('hidden');
  };

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
      modal.classList.add('hidden');
    }
  });

  confirmBtn.onclick = () => action(confirmBtn, async () => {
    await post('/api/delete-all-data');
    window.location.href = '/';
  });
}

/* Page Bootstrapper */
async function load() {
  try {
    const { user, csrf: token } = await api('/api/me');
    csrf = token;
    currentUser = user;
    renderUserMenu(user);
    initSchedule(user.scheduleMinutes);
    initFolderView(user);
    initDeleteModal();
    await loadImportStats();
  } catch (err) {
    // If not logged in, redirect to login page
    window.location.href = '/';
  }
}

load();

