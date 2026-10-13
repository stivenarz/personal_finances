import { getConfig, getActiveProvider } from './config-service.js';
import { COLLECTIONS } from './collections.js';

/**
 * Contrato que cumplen los proveedores de sincronización (providers/local.js, firebase.js y sheets.js).
 * Todos los registros llevan `updatedAt` (ms): gana la escritura más reciente por registro.
 *
 * @typedef {Object} Provider
 * @property {string} name
 * @property {(handlers: {config: Object, storage: Storage, onRemote: Function, onReady: Function, onStatus: Function}) => Promise<void>} connect
 *   `onRemote(colección, cambios[{id, updatedAt, deleted, data}])` entrega lo que llega de la nube;
 *   `onReady()` se llama al terminar el primer sync confirmado por el servidor.
 * @property {(collection: string, record: Object) => Promise<void>} save
 * @property {(collection: string, id: string, fields: Object, updatedAt: number) => Promise<void>} patch
 * @property {(collection: string, id: string, updatedAt: number) => Promise<void>} remove
 * @property {() => Promise<void>} sync
 * @property {() => Promise<void>} flush
 * @property {() => Promise<void>} disconnect
 * @property {(config: Object) => Promise<{success: boolean, message: string}>} test
 */

const DATA_KEY = 'app_offline_data';
const TOMBSTONES_KEY = 'app_tombstones';

const emptyData = () => Object.fromEntries(COLLECTIONS.map(name => [name, []]));
const emptyMap = () => Object.fromEntries(COLLECTIONS.map(name => [name, {}]));

let data = emptyData();
let tombstones = emptyMap();
let remoteIndex = emptyMap();
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

let configOverride = null;
let storageImpl = null;

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

/** Aplica cambios llegados de la nube resolviendo conflictos por `updatedAt` y respetando los borrados locales. */
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

        if (tombstone !== undefined && tombstone >= (change.updatedAt || 0)) return;
        if (local && localTime > (change.updatedAt || 0)) return;

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

/**
 * Única puerta de entrada a los datos. Mantiene el estado en memoria y en localStorage (la app funciona
 * sin nube y sin conexión) y lo sincroniza a través del proveedor activo. Sólo guarda registros base:
 * los totales se calculan en domain/ledger.js.
 */
export const DataService = {
    /**
     * Carga los datos locales y conecta en segundo plano con el proveedor configurado. No espera a la nube.
     * `providerOverride`, `storage` y `config` permiten inyectar dependencias (pruebas, varios dispositivos simulados).
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

    /** Contador que sube con cada cambio de datos; permite cachear cálculos. */
    get version() { return version; },

    /** Resuelve cuando el primer sync con la nube terminó (de inmediato en modo local). */
    whenReady() {
        return ready ? Promise.resolve() : new Promise(resolve => readyWaiters.push(resolve));
    },

    /** Registros de una colección. Es la lista viva: no se debe modificar directamente. */
    all(collection) { return data[collection]; },

    find(collection, id) { return data[collection].find(item => item.id === id) || null; },

    /** Crea o reemplaza un registro completo. Devuelve el registro guardado (con `updatedAt`). */
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

    /** Actualiza sólo `fields` de un registro (en la nube se fusionan con los de otros dispositivos). */
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

    /** Elimina un registro y deja un borrado (tombstone) para que los demás dispositivos no lo recreen. */
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

    /** Suscripción a cambios de datos, locales o remotos. Devuelve la función para cancelar. */
    subscribe(listener) {
        changeListeners.add(listener);
        return () => changeListeners.delete(listener);
    },

    /** Suscripción al estado de sincronización; se llama de inmediato con el estado actual. */
    onStatus(listener) {
        statusListeners.add(listener);
        listener(status);
        return () => statusListeners.delete(listener);
    },

    /** @returns {{provider: string, state: string, pending: number, error: string|null, lastSync: number|null}} */
    getStatus() { return status; },

    /** Fuerza la sincronización con la nube. */
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

    /** Espera a que se envíen los cambios pendientes. */
    async flush() {
        if (provider && connected) await provider.flush();
    },

    /** Prueba las credenciales de un proveedor sin conectarlo. */
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
        } catch {}
        emitChange();
    },

    /** Detiene la sincronización; los datos locales se conservan. */
    async disconnect() {
        clearTimeout(retryTimer);
        connected = false;
        await provider?.disconnect?.();
    },

    /** Gancho de pruebas: reinicia el estado interno. */
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
