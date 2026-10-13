/**
 * THEME SERVICE — modo claro / oscuro / automático.
 *
 * La preferencia ('auto' | 'light' | 'dark') vive en el localStorage del dispositivo (cada dispositivo
 * puede tener su propio modo; no se sincroniza con la nube). En 'auto' se sigue el modo del sistema
 * (prefers-color-scheme) y se actualiza en vivo si el sistema cambia.
 *
 * El tema resuelto ('light' | 'dark') se aplica como `data-theme` en <html>; el CSS redefine sus
 * variables para el modo oscuro (ver components.css). Un script mínimo en el <head> de index.html lo
 * aplica antes del primer pintado para evitar el "parpadeo" en claro.
 */

const KEY = 'finanzas_theme';
const META_COLORS = { light: '#667eea', dark: '#1e1b4b' };

export const THEME_OPTIONS = [
    { value: 'auto', label: 'Automático', hint: 'Sigue el modo del sistema', icon: '🖥️' },
    { value: 'light', label: 'Claro', hint: 'Siempre claro', icon: '☀️' },
    { value: 'dark', label: 'Oscuro', hint: 'Siempre oscuro', icon: '🌙' }
];

const listeners = new Set();
let resolved = null;
let mediaQuery = null;

function storage() {
    try {
        return globalThis.localStorage || null;
    } catch {
        return null;
    }
}

export function getThemePreference() {
    try {
        const saved = storage()?.getItem(KEY);
        return THEME_OPTIONS.some(o => o.value === saved) ? saved : 'auto';
    } catch {
        return 'auto';
    }
}

export function systemPrefersDark() {
    return !!globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches;
}

/** Tema efectivo ('light' | 'dark') para una preferencia dada. */
export function resolveTheme(preference = getThemePreference()) {
    if (preference === 'dark' || preference === 'light') return preference;
    return systemPrefersDark() ? 'dark' : 'light';
}

export function getResolvedTheme() {
    return resolved || resolveTheme();
}

/** Aplica el tema al documento y avisa a los suscriptores si cambió. */
export function applyTheme() {
    const next = resolveTheme();
    const changed = next !== resolved;
    resolved = next;

    const root = globalThis.document?.documentElement;
    if (root) {
        root.dataset.theme = next;
        root.style.colorScheme = next;
        const meta = globalThis.document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', META_COLORS[next]);
    }

    if (changed) listeners.forEach(listener => {
        try { listener(next); } catch (error) { console.error(error); }
    });
    return next;
}

export function setThemePreference(preference) {
    if (!THEME_OPTIONS.some(o => o.value === preference)) return getThemePreference();
    try {
        storage()?.setItem(KEY, preference);
    } catch (error) {
        console.error('No se pudo guardar el tema:', error);
    }
    applyTheme();
    return preference;
}

/** Aplica el tema guardado y empieza a seguir los cambios del sistema (en modo automático). */
export function initTheme() {
    applyTheme();
    if (!mediaQuery && globalThis.matchMedia) {
        mediaQuery = globalThis.matchMedia('(prefers-color-scheme: dark)');
        const onSystemChange = () => { if (getThemePreference() === 'auto') applyTheme(); };
        if (mediaQuery.addEventListener) mediaQuery.addEventListener('change', onSystemChange);
        else mediaQuery.addListener?.(onSystemChange); // Safari antiguo
    }
}

export function onThemeChange(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** Sólo para pruebas. */
export function _resetTheme() {
    resolved = null;
    mediaQuery = null;
    listeners.clear();
}
