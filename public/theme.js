// Theme Switcher Engine: ReUI Light, ReUI Dark, Unslop Light, Unslop Dark
const THEMES = ['reui-light', 'reui-dark', 'unslop-light', 'unslop-dark'];

function getSystemThemeDefault() {
  const isDark = typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;
  return isDark ? 'reui-dark' : 'reui-light';
}

function resolveTheme(pref) {
  if (!pref || pref === 'system') {
    return getSystemThemeDefault();
  }
  if (pref === 'light') return 'reui-light';
  if (pref === 'dark') return 'reui-dark';
  if (THEMES.includes(pref)) return pref;
  return getSystemThemeDefault();
}

// Immediate initial execution to avoid theme flash
(function() {
  try {
    const saved = localStorage.getItem('theme');
    const initial = resolveTheme(saved);
    document.documentElement.setAttribute('data-theme', initial);
    const isDark = initial.includes('dark');
    document.documentElement.setAttribute('data-theme-mode', isDark ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme-style', initial.includes('unslop') ? 'unslop' : 'reui');
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'reui-light');
  }
})();

function applyTheme(theme, persist) {
  const resolved = resolveTheme(theme);
  if (persist) {
    try {
      localStorage.setItem('theme', resolved);
    } catch (e) {
      // local storage unavailable
    }
  }
  document.documentElement.setAttribute('data-theme', resolved);
  const isDark = resolved.includes('dark');
  document.documentElement.setAttribute('data-theme-mode', isDark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme-style', resolved.includes('unslop') ? 'unslop' : 'reui');
  updateThemeDropdownUI(resolved);
  if (typeof updateWelcomeTitle === 'function') {
    try { updateWelcomeTitle(); } catch (e) {}
  }
}

function setTheme(pref) {
  applyTheme(pref, true);
}

function updateThemeDropdownUI(pref) {
  let current = pref;
  if (!current) {
    try {
      current = resolveTheme(localStorage.getItem('theme'));
    } catch (e) {
      current = getSystemThemeDefault();
    }
  }
  document.querySelectorAll('.theme-select-dropdown').forEach(select => {
    if (select.value !== current) {
      select.value = current;
    }
  });
  // Backward compatibility for any segmented controls if present
  document.querySelectorAll('.theme-seg-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.themeVal === current);
  });
}

function updateThemeSegmentUI(pref) {
  updateThemeDropdownUI(pref);
}

// If user has not explicitly set a theme, follow system changes with ReUI Dark / Light default
if (typeof window !== 'undefined' && window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
    try {
      const saved = localStorage.getItem('theme');
      if (!saved || saved === 'system') {
        const next = e.matches ? 'reui-dark' : 'reui-light';
        applyTheme(next, false);
      }
    } catch (err) {}
  });
}

// Ensure dropdowns are synced when DOM is ready
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => updateThemeDropdownUI());
  } else {
    updateThemeDropdownUI();
  }
}
