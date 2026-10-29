// Theme Switcher Engine: light, dark, system
(function() {
  const saved = localStorage.getItem('theme') || 'system';
  if (saved === 'dark' || (saved === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.documentElement.setAttribute('data-theme', 'light');
  }
})();

function setTheme(pref) {
  localStorage.setItem('theme', pref);
  if (pref === 'system') {
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  } else {
    document.documentElement.setAttribute('data-theme', pref);
  }
  updateThemeSegmentUI(pref);
}

function updateThemeSegmentUI(pref) {
  const current = pref || localStorage.getItem('theme') || 'system';
  document.querySelectorAll('.theme-seg-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.themeVal === current);
  });
}

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
  if ((localStorage.getItem('theme') || 'system') === 'system') {
    document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
  }
});

