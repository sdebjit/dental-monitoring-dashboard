import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const themeJsCode = fs.readFileSync('public/theme.js', 'utf8');

function setupThemeEnvironment(initialStorage = {}, systemDark = false) {
  const storage = new Map(Object.entries(initialStorage));
  const docAttrs = new Map();
  const selectElements = [];
  const mediaListeners = [];

  const context = {
    localStorage: {
      getItem(k) { return storage.get(k) ?? null; },
      setItem(k, v) { storage.set(k, String(v)); },
      removeItem(k) { storage.delete(k); }
    },
    document: {
      readyState: 'complete',
      documentElement: {
        setAttribute(k, v) { docAttrs.set(k, v); },
        getAttribute(k) { return docAttrs.get(k); }
      },
      querySelectorAll(selector) {
        if (selector === '.theme-select-dropdown') return selectElements;
        return [];
      },
      addEventListener() {}
    },
    window: {
      matchMedia(query) {
        return {
          matches: systemDark,
          addEventListener(evt, cb) {
            mediaListeners.push(cb);
          }
        };
      }
    }
  };

  vm.createContext(context);
  vm.runInContext(themeJsCode, context);

  return { context, docAttrs, storage, selectElements, mediaListeners };
}

test('theme engine defaults to ReUI Dark when system is dark and no preference is stored', () => {
  const env = setupThemeEnvironment({}, true);
  assert.equal(env.docAttrs.get('data-theme'), 'reui-dark');
  assert.equal(env.docAttrs.get('data-theme-mode'), 'dark');
  assert.equal(env.docAttrs.get('data-theme-style'), 'reui');
});

test('theme engine defaults to ReUI Light when system is light and no preference is stored', () => {
  const env = setupThemeEnvironment({}, false);
  assert.equal(env.docAttrs.get('data-theme'), 'reui-light');
  assert.equal(env.docAttrs.get('data-theme-mode'), 'light');
  assert.equal(env.docAttrs.get('data-theme-style'), 'reui');
});

test('theme engine migrates legacy light, dark, and system preferences smoothly', () => {
  const envDark = setupThemeEnvironment({ theme: 'dark' }, false);
  assert.equal(envDark.docAttrs.get('data-theme'), 'reui-dark');

  const envLight = setupThemeEnvironment({ theme: 'light' }, true);
  assert.equal(envLight.docAttrs.get('data-theme'), 'reui-light');

  const envSysDark = setupThemeEnvironment({ theme: 'system' }, true);
  assert.equal(envSysDark.docAttrs.get('data-theme'), 'reui-dark');

  const envSysLight = setupThemeEnvironment({ theme: 'system' }, false);
  assert.equal(envSysLight.docAttrs.get('data-theme'), 'reui-light');
});

test('theme engine sets and persists all 4 themes cleanly', () => {
  const env = setupThemeEnvironment({}, false);

  env.context.setTheme('unslop-dark');
  assert.equal(env.docAttrs.get('data-theme'), 'unslop-dark');
  assert.equal(env.docAttrs.get('data-theme-mode'), 'dark');
  assert.equal(env.docAttrs.get('data-theme-style'), 'unslop');
  assert.equal(env.storage.get('theme'), 'unslop-dark');

  env.context.setTheme('unslop-light');
  assert.equal(env.docAttrs.get('data-theme'), 'unslop-light');
  assert.equal(env.docAttrs.get('data-theme-mode'), 'light');
  assert.equal(env.docAttrs.get('data-theme-style'), 'unslop');
  assert.equal(env.storage.get('theme'), 'unslop-light');

  env.context.setTheme('reui-dark');
  assert.equal(env.docAttrs.get('data-theme'), 'reui-dark');
  assert.equal(env.docAttrs.get('data-theme-mode'), 'dark');
  assert.equal(env.docAttrs.get('data-theme-style'), 'reui');
  assert.equal(env.storage.get('theme'), 'reui-dark');

  env.context.setTheme('reui-light');
  assert.equal(env.docAttrs.get('data-theme'), 'reui-light');
  assert.equal(env.docAttrs.get('data-theme-mode'), 'light');
  assert.equal(env.docAttrs.get('data-theme-style'), 'reui');
  assert.equal(env.storage.get('theme'), 'reui-light');
});

test('theme dropdown elements reflect the current active theme', () => {
  const env = setupThemeEnvironment({}, false);
  const mockSelect = { value: '' };
  env.selectElements.push(mockSelect);

  env.context.setTheme('unslop-dark');
  assert.equal(mockSelect.value, 'unslop-dark');

  env.context.setTheme('reui-light');
  assert.equal(mockSelect.value, 'reui-light');
});

