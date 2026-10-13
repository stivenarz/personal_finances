/**
 * Configuración de la app (proveedor de datos y credenciales).
 * Vive SOLO en localStorage del dispositivo: nunca se sube a la nube.
 */

const KEY = 'finanzas_config';

export const PROVIDERS = {
    local: { id: 'local', label: 'Solo local (este dispositivo)' },
    firebase: { id: 'firebase', label: 'Firebase (Firestore)' },
    sheets: { id: 'sheets', label: 'Google Sheets (Apps Script)' }
};

const emptyFirebase = () => ({
    apiKey: '', authDomain: '', projectId: '', storageBucket: '', messagingSenderId: '', appId: ''
});

function storage() {
    try {
        return globalThis.localStorage || null;
    } catch {
        return null;
    }
}

function readJson(key) {
    try {
        return JSON.parse(storage()?.getItem(key) || 'null');
    } catch {
        return null;
    }
}

export function isFirebaseConfigured(cfg) {
    return !!(cfg && cfg.apiKey && cfg.projectId && cfg.authDomain);
}

/** URL de despliegue de Apps Script (se admite localhost sólo para desarrollo y pruebas). */
export const SHEETS_URL_PATTERN = /^(https:\/\/script\.google(usercontent)?\.com\/|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/)/;

export function isSheetsConfigured(cfg) {
    return !!(cfg && SHEETS_URL_PATTERN.test(cfg.url || ''));
}

export function getConfig() {
    let saved = readJson(KEY);

    if (!saved) {
        // Migración desde versiones anteriores (claves sueltas)
        const legacyFirebase = readJson('firebaseConfig');
        const legacyScriptUrl = storage()?.getItem('gasScriptUrl') || '';
        saved = {
            provider: isFirebaseConfigured(legacyFirebase) ? 'firebase' : 'local',
            firebase: legacyFirebase || emptyFirebase(),
            sheets: { url: legacyScriptUrl }
        };
    }

    return {
        provider: PROVIDERS[saved.provider] ? saved.provider : 'local',
        firebase: { ...emptyFirebase(), ...(saved.firebase || {}) },
        sheets: { url: '', ...(saved.sheets || {}) }
    };
}

export function saveConfig(partial) {
    const next = { ...getConfig(), ...partial };
    try {
        storage()?.setItem(KEY, JSON.stringify(next));
    } catch (error) {
        console.error('No se pudo guardar la configuración:', error);
    }
    return next;
}

/** Proveedor realmente utilizable: si faltan credenciales se cae a modo local. */
export function getActiveProvider(cfg = getConfig()) {
    if (cfg.provider === 'firebase' && isFirebaseConfigured(cfg.firebase)) return 'firebase';
    if (cfg.provider === 'sheets' && isSheetsConfigured(cfg.sheets)) return 'sheets';
    return 'local';
}
