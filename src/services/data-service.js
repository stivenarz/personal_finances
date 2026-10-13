/**
 * DATA SERVICE — única puerta de entrada a los datos para toda la app.
 *
 * Los componentes sólo usan esta API (save / patch / remove / all / find /
 * subscribe / sync ...) sin saber si por debajo hay Firebase, Google Sheets o
 * nada. Responsabilidades:
 *
 *  1. Mantener el estado en memoria y persistirlo siempre en localStorage
 *     (la app funciona 100% sin nube y offline).
 *  2. Delegar la sincronización en un "proveedor" intercambiable
 *     (providers/firebase.js, providers/sheets.js, providers/local.js), todos con
 *     el mismo contrato:
 *
 *       connect({ onRemote, onReady, onStatus }) -> Promise
 *       save(collection, record)                 -> Promise
 *       patch(collection, id, fields, updatedAt) -> Promise
 *       remove(collection, id, updatedAt)        -> Promise
 *       sync()    -> Promise   (forzar sincronización)
 *       flush()   -> Promise   (esperar escrituras pendientes)
 *       disconnect()
 *       test(config) -> { success, message }
 *
 *  3. Resolver conflictos multi-dispositivo: gana la escritura con `updatedAt`
 *     más reciente (por registro). Los borrados se propagan como "tombstones".
 *  4. Reconciliar tras el primer sync del servidor: sube lo que sólo existe en
 *     local o es más nuevo (cambios hechos sin conexión).
 *
 * IMPORTANTE: aquí sólo se guardan registros "base". Ningún total (saldos,
 * avance de metas, saldo de deudas...) se almacena: se calcula en domain/ledger.js.
 */
import { getConfig, getActiveProvider } from './config-service.js';
import { COLLECTIONS } from './collections.js';

export { COLLECTIONS };

const DATA_KEY = 'app_offline_data';
const TOMBSTONES_KEY = 'app_tombstones';

const emptyData = () => Object.fromEntries(COLLECTIONS.map(name => [name, []]));
const emptyMap = () => Object.fromEntries(COLLECTIONS.map(name => [name, {}]));

let data = emptyData();
let tombstones = emptyMap();   // { collection: { id: updatedAt } } borrados locales
let remoteIndex = emptyMap();  // { collection: { id: { updatedAt, deleted } } } lo que sabemos de la nube
let version = 0;
let lastLocalStamp = 0;

let provider = null;
let providerName = 'local';
let connected = false;
let ready = false;

let status = { provider: 'local', state: 'local', pending: 0, error: null, lastSync: null };
const changeListeners = new Set();
const statusListeners = new Set();
const readyWaiters = [];
let emitTimer = null;
let retryTimer = null;

// ---------------------------------------------------------------- persistencia

let configOverride = null;
let storageImpl = null; // inyectable (pruebas / varios dispositivos simulados)

function storage() {
    if (storageImpl) return storageImpl;
    try {
        return globalThis.localStorage || null;
    } catch {
        return null;
    }
}

function loadFromStorage() {
    data = emptyData();
    tombstones = emptyMap();
    try {
        const saved = JSON.parse(storage()?.getItem(DATA_KEY) || 'null');
        if (saved) COLLECTIONS.forEach(name => { if (Array.isArray(saved[name])) data[name] = saved[name]; });
        const tombs = JSON.parse(storage()?.getItem(TOMBSTONES_KEY) || 'null');
        if (tombs) COLLECTIONS.forEach(name => { if (tombs[name]) tombstones[name] = tombs[name]; });
    } catch (error) {
        console.error('Error cargando datos locales:', error);
    }
}

function persist() {
    try {
        storage()?.setItem(DATA_KEY, JSON.stringify(data));
        storage()?.setItem(TOMBSTONES_KEY, JSON.stringify(tombstones));
    } catch (error) {
        console.error('Error guardando datos locales:', error);
    }
}

// ---------------------------------------------------------------- eventos

function emitChange() {
    version++;
    clearTimeout(emitTimer);
    emitTimer = setTimeout(() => {
        changeListeners.forEach(listener => {
            try { listener(); } catch (error) { console.error(error); }
        });
    }, 30);
}

function setStatus(partial) {
    status = { ...status, ...partial, provider: providerName };
    statusListeners.forEach(listener => {
        try { listener(status); } catch (error) { console.error(error); }
    });
}

function stamp() {
    lastLocalStamp = Math.max(Date.now(), lastLocalStamp + 1);
    return lastLocalStamp;
}

function reportCloudError(error) {
    console.error('Error de sincronización:', error);
    setStatus({ error: error?.message || String(error), state: 'error' });
}

function cloud(promise) {
    if (!connected || !promise) return;
    promise.catch(reportCloudError);
}

// ---------------------------------------------------------------- datos remotos

function applyRemote(collection, changes) {
    const list = data[collection];
    let touched = false;

    changes.forEach(change => {
        remoteIndex[collection][change.id] = { updatedAt: change.updatedAt || 0, deleted: !!change.deleted };
        const index = list.findIndex(item => item.id === change.id);
        const local = index >= 0 ? list[index] : null;
        const localTime = local ? (local.updatedAt || 0) : 0;
        const tombstone = tombstones[collection][change.id];

        if (change.deleted) {
            if (local && localTime <= (change.updatedAt || 0)) {
                list.splice(index, 1);
                touched = true;
            }
            if (!local && tombstone !== undefined && tombstone <= (change.updatedAt || 0)) {
                delete tombstones[collection][change.id];
                touched = true;
            }
            return;
        }

        if (tombstone !== undefined && tombstone >= (change.updatedAt || 0)) return; // borrado local más reciente
        if (local && localTime > (change.updatedAt || 0)) return;                    // local más reciente

        const record = { ...change.data, id: change.id, updatedAt: change.updatedAt || 0 };
        if (local && JSON.stringify(local) === JSON.stringify(record)) return;
        if (index >= 0) list[index] = record;
        else list.push(record);
        delete tombstones[collection][change.id];
        touched = true;
    });

    if (touched) {
        persist();
        emitChange();
    }
}

/** Sube lo que sólo existe en local o es más reciente que lo que hay en la nube. */
function reconcile() {
    COLLECTIONS.forEach(collection => {
        const index = remoteIndex[collection];

        data[collection].forEach(record => {
            const remote = index[record.id];
            if (!remote || (record.updatedAt || 0) > remote.updatedAt) {
                cloud(provider.save(collection, record));
            }
        });

        Object.entries(tombstones[collection]).forEach(([id, time]) => {
            const remote = index[id];
            if (remote && !remote.deleted && time >= remote.updatedAt) {
                cloud(provider.remove(collection, id, time));
            }
        });
    });
}

function handleReady() {
    if (ready) return;
    ready = true;
    reconcile();
    readyWaiters.splice(0).forEach(resolve => resolve());
    emitChange();
}

// ---------------------------------------------------------------- proveedor

async function loadProvider(name) {
    if (name === 'firebase') return (await import('./providers/firebase.js')).default;
    if (name === 'sheets') return (await import('./providers/sheets.js')).default;
    return (await import('./providers/local.js')).default;
}

async function connectProvider() {
    clearTimeout(retryTimer);
    try {
        await provider.connect({
            config: configOverride || getConfig(),
            storage: storage(),
            onRemote: applyRemote,
            onReady: handleReady,
            onStatus: setStatus
        });
        connected = true;
    } catch (error) {
        console.error('No se pudo conectar con el proveedor:', error);
        setStatus({ state: navigator.onLine ? 'error' : 'offline', error: error?.message || String(error) });
        retryTimer = setTimeout(connectProvider, 30000);
    }
}

// ---------------------------------------------------------------- API pública

export const DataService = {
    COLLECTIONS,

    /**
     * Carga datos locales y conecta con el proveedor activo.
     * Devuelve cuando el estado local está disponible (no espera a la nube).
     */
    async init({ providerOverride = null, storage: customStorage = null, config = null } = {}) {
        storageImpl = customStorage;
        configOverride = config;
        loadFromStorage();
        remoteIndex = emptyMap();
        ready = false;
        connected = false;

        providerName = providerOverride ? providerOverride.name : getActiveProvider();
        provider = providerOverride || await loadProvider(providerName);
        setStatus({ state: providerName === 'local' ? 'local' : 'connecting', error: null, pending: 0 });

        if (providerName === 'local') {
            ready = true;
            connected = false;
            return;
        }

        globalThis.addEventListener?.('online', () => {
            if (!connected) connectProvider();
        });
        connectProvider();
    },

    get version() { return version; },
    get providerName() { return providerName; },
    get isReady() { return ready; },

    /** Resuelve cuando el primer sync con la nube terminó (o ya, en modo local). */
    whenReady() {
        return ready ? Promise.resolve() : new Promise(resolve => readyWaiters.push(resolve));
    },

    all(collection) { return data[collection]; },
    find(collection, id) { return data[collection].find(item => item.id === id) || null; },
    snapshot() { return data; },

    save(collection, record) {
        const next = { ...record, updatedAt: stamp() };
        const list = data[collection];
        const index = list.findIndex(item => item.id === next.id);
        if (index >= 0) list[index] = next;
        else list.push(next);
        delete tombstones[collection][next.id];
        persist();
        emitChange();
        cloud(provider?.save(collection, next));
        return next;
    },

    patch(collection, id, fields) {
        const record = data[collection].find(item => item.id === id);
        if (!record) return null;
        const updatedAt = stamp();
        Object.assign(record, fields, { updatedAt });
        persist();
        emitChange();
        cloud(provider?.patch(collection, id, fields, updatedAt));
        return record;
    },

    remove(collection, id) {
        const before = data[collection].length;
        data[collection] = data[collection].filter(item => item.id !== id);
        if (data[collection].length === before) return false;
        const updatedAt = stamp();
        tombstones[collection][id] = updatedAt;
        persist();
        emitChange();
        cloud(provider?.remove(collection, id, updatedAt));
        return true;
    },

    /** Suscripción a cambios de datos (locales o remotos). Devuelve la función para desuscribir. */
    subscribe(listener) {
        changeListeners.add(listener);
        return () => changeListeners.delete(listener);
    },

    onStatus(listener) {
        statusListeners.add(listener);
        listener(status);
        return () => statusListeners.delete(listener);
    },

    getStatus() { return status; },

    async sync() {
        if (!provider || providerName === 'local') return { success: false, message: 'Sin proveedor de nube configurado' };
        try {
            if (!connected) await connectProvider();
            await provider.sync();
            return { success: true, message: 'Sincronizado' };
        } catch (error) {
            reportCloudError(error);
            return { success: false, message: error.message };
        }
    },

    async flush() {
        if (provider && connected) await provider.flush();
    },

    async testConnection(name, config) {
        try {
            const target = await loadProvider(name);
            return await target.test(config);
        } catch (error) {
            return { success: false, message: 'Error: ' + error.message };
        }
    },

    /** Borra todos los registros (propaga el borrado a la nube) y limpia el almacenamiento local. */
    async clearAll() {
        COLLECTIONS.forEach(collection => {
            [...data[collection]].forEach(record => this.remove(collection, record.id));
        });
        try {
            await Promise.race([
                this.flush(),
                new Promise(resolve => setTimeout(resolve, 10000))
            ]);
        } catch (error) {
            console.error(error);
        }
        data = emptyData();
        tombstones = emptyMap();
        try {
            storage()?.removeItem(DATA_KEY);
            storage()?.removeItem(TOMBSTONES_KEY);
        } catch { /* sin almacenamiento */ }
        emitChange();
    },

    async disconnect() {
        clearTimeout(retryTimer);
        connected = false;
        await provider?.disconnect?.();
    },

    /** Sólo para pruebas. */
    _reset() {
        data = emptyData();
        tombstones = emptyMap();
        remoteIndex = emptyMap();
        version = 0;
        connected = false;
        ready = false;
        provider = null;
        providerName = 'local';
        changeListeners.clear();
        statusListeners.clear();
    }
};
