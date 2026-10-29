let csrf = '';
let currentUser = null;
const $ = id => document.getElementById(id);

async function checkUserSession() {
  const container = $('account');
  if (!container) return;

  try {
    const res = await fetch('/api/me');
    if (!res.ok) {
      // User is not logged in
      renderLoggedOutMenu(container);
      return;
    }
    const { user, csrf: token } = await res.json();
    csrf = token;
    currentUser = user;
    renderUserMenu(user);
  } catch {
    renderLoggedOutMenu(container);
  }
}

function renderLoggedOutMenu(container) {
  container.replaceChildren();
  const loginLink = document.createElement('a');
  loginLink.className = 'btn btn-secondary btn-sm';
  loginLink.href = '/';
  loginLink.textContent = 'Log In';
  container.append(loginLink);
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

  // Popover Menu
  const popover = document.createElement('div');
  popover.className = 'user-menu-popover hidden';

  // Profile Header
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

  // Divider
  const divider2 = document.createElement('div');
  divider2.className = 'menu-divider';

  // Theme Row
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
      await fetch('/api/logout', { method: 'POST', headers: { 'X-Daybook-CSRF': csrf } });
    } finally {
      window.location.href = '/';
    }
  };

  popover.append(profileSection, divider1, dashLink, settingsLink, divider2, themeRow, divider3, logoutBtn);
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

document.addEventListener('DOMContentLoaded', checkUserSession);

