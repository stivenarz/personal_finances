import test from 'node:test';
import assert from 'node:assert/strict';
import { installBrowserShims } from './helpers.mjs';

installBrowserShims();

const attrs = {};
const meta = { content: '', setAttribute(name, value) { this[name] = value; } };
globalThis.document = {
    documentElement: { dataset: attrs, style: {} },
    querySelector: () => meta
};

let systemDark = false;
let mediaListener = null;
globalThis.matchMedia = () => ({
    get matches() { return systemDark; },
    addEventListener: (event, fn) => { mediaListener = fn; }
});

const theme = await import('../src/services/theme-service.js');

test('automático sigue el modo del sistema y reacciona a sus cambios', () => {
    localStorage.clear();
    theme._resetTheme();
    const seen = [];
    theme.onThemeChange(t => seen.push(t));

    assert.equal(theme.getThemePreference(), 'auto');
    systemDark = false;
    theme.initTheme();
    assert.equal(attrs.theme, 'light');

    systemDark = true;
    mediaListener();
    assert.equal(attrs.theme, 'dark');
    assert.equal(document.documentElement.style.colorScheme, 'dark');
    assert.equal(meta.content, '#1e1b4b');
    assert.deepEqual(seen, ['light', 'dark']);
});

test('preferencia fija ignora el sistema y se guarda en este dispositivo', () => {
    localStorage.clear();
    theme._resetTheme();
    systemDark = true;
    theme.initTheme();

    theme.setThemePreference('light');
    assert.equal(attrs.theme, 'light');
    assert.equal(localStorage.getItem('finanzas_theme'), 'light');

    mediaListener();
    assert.equal(attrs.theme, 'light');

    theme.setThemePreference('auto');
    assert.equal(attrs.theme, 'dark', 'al volver a automático toma el del sistema');
    assert.equal(theme.getThemePreference(), 'auto');
});

test('valores inválidos se ignoran', () => {
    localStorage.clear();
    theme._resetTheme();
    localStorage.setItem('finanzas_theme', 'morado');
    assert.equal(theme.getThemePreference(), 'auto');
    assert.equal(theme.setThemePreference('morado'), 'auto');
});
