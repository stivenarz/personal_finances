import { COLLECTIONS } from '../collections.js';

const POLL_VISIBLE_MS = 4000;
const POLL_HIDDEN_MS = 60000;
const OUTBOX_KEY = 'sheets_outbox';
const BATCH_SIZE = 40;

let url = '';
let handlers = null;
let outbox = [];
let cursor = 0;
let readyFired = false;
let timer = null;
let busy = false;
let rerun = false;
let connected = false;
let lastError = null;
let lastSync = null;
let listeners = [];

let storageImpl = null;

function storage() {
    if (storageImpl) return storageImpl;
    try {
        return globalThis.localStorage || null;
    } catch {
        return null;
    }
}

function loadOutbox() {
    try {
        const saved = JSON.parse(storage()?.getItem(OUTBOX_KEY) || '[]');
        return Array.isArray(saved) ? saved : [];
    } catch {
        return [];
    }
}

function saveOutbox() {
    try {
        storage()?.setItem(OUTBOX_KEY, JSON.stringify(outbox));
    } catch (error) {
        console.error('No se pudo guardar la cola de Sheets:', error);
    }
}

function isOffline() {
    return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function publish(forceState) {
    if (!handlers) return;
    let state = forceState;
    if (!state) {
        if (lastError) state = 'error';
        else if (isOffline()) state = 'offline';
        else if (busy || outbox.length) state = 'syncing';
        else state = readyFired ? 'synced' : 'connecting';
    }
    handlers.onStatus({ state, pending: outbox.length, error: lastError, lastSync });
}

function endpoint(params) {
    const target = new URL(url);
    Object.entries(params).forEach(([key, value]) => target.searchParams.set(key, value));
    return target.toString();
}

async function request(target, options) {
    const response = await fetch(target, { redirect: 'follow', cache: 'no-store', ...options });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    let body;
    try {
        body = await response.json();
    } catch {
        throw new Error('Respuesta inválida: revisa que la URL sea la del despliegue "Aplicación web" (/exec) y que el acceso sea "Cualquier usuario".');
    }
    if (!body || body.ok !== true) {
        const error = new Error(body?.error || 'El script devolvió un error');
        error.server = true;
        throw error;
    }
    return body;
}

function post(payload) {
    return request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
    });
}

async function flushOutbox() {
    while (outbox.length) {
        const batch = outbox.slice(0, BATCH_SIZE);
        await post({ action: 'batch', ops: batch });
        outbox.splice(0, batch.length);
        saveOutbox();
        publish('syncing');
    }
}

async function pull() {
    const body = await request(endpoint({ action: 'pull', since: cursor }), { method: 'GET' });

    const byCollection = {};
    (body.rows || []).forEach(row => {
        if (!COLLECTIONS.includes(row.c)) return;
        (byCollection[row.c] ||= []).push({
            id: row.id,
            updatedAt: Number(row.updatedAt) || 0,
            deleted: !!row.deleted,
            data: row.data || {}
        });
    });
    Object.entries(byCollection).forEach(([collection, changes]) => handlers.onRemote(collection, changes));

    cursor = Math.max(cursor, Number(body.version) || 0);
    if (!readyFired) {
        readyFired = true;
        handlers.onReady();
    }
}

function schedule(delay) {
    clearTimeout(timer);
    if (!connected) return;
    const wait = delay ?? (typeof document !== 'undefined' && document.hidden ? POLL_HIDDEN_MS : POLL_VISIBLE_MS);
    timer = setTimeout(cycle, wait);
}

async function cycle() {
    if (!connected) return;
    if (busy) {
        rerun = true;
        return;
    }
    busy = true;
    publish('syncing');
    try {
        if (!isOffline()) {
            await flushOutbox();
            await pull();
            lastError = null;
            lastSync = Date.now();
        }
    } catch (error) {
        console.warn('Sync Sheets:', error.message);
        lastError = error.server ? error.message : null;
        if (!error.server) publish('offline');
    } finally {
        busy = false;
        publish();
        schedule(rerun ? 100 : undefined);
        rerun = false;
    }
}

function enqueue(op) {
    const last = outbox[outbox.length - 1];
    if (last && last.op === 'save' && op.op === 'save' && last.c === op.c && last.id === op.id) {
        outbox[outbox.length - 1] = op;
    } else {
        outbox.push(op);
    }
    saveOutbox();
    publish();
    if (connected) {
        clearTimeout(timer);
        timer = setTimeout(cycle, 150);
    }
    return Promise.resolve();
}

function addListener(target, name, fn) {
    target?.addEventListener?.(name, fn);
    listeners.push(() => target?.removeEventListener?.(name, fn));
}

/**
 * Google Sheets a través de un Apps Script (google-apps-script/Code.gs).
 *
 * Protocolo:
 *   GET  ?action=ping                 → { ok, app, version }
 *   GET  ?action=pull&since=<seq>     → { ok, version, rows: [{ c, id, updatedAt, deleted, seq, data }] }
 *   POST (text/plain) { action: 'batch', ops: [{ op: 'save'|'patch'|'remove', c, id, data|fields, updatedAt }] }
 *
 * `seq` es un contador del servidor: cada dispositivo recibe sólo lo nuevo aunque sus relojes difieran.
 * Las escrituras van a una cola persistente que se reintenta hasta que el servidor la confirma, y el
 * servidor las aplica de forma idempotente (gana el `updatedAt` más reciente). La sincronización "en vivo"
 * es un sondeo periódico, inmediato al volver a primer plano o recuperar la conexión.
 *
 * @type {import('../data-service.js').Provider}
 */
export default {
    name: 'sheets',

    async connect(options) {
        handlers = options;
        storageImpl = options.storage || null;
        url = options.config.sheets.url;
        outbox = loadOutbox();
        cursor = 0;
        readyFired = false;
        lastError = null;
        connected = true;

        addListener(globalThis, 'online', () => cycle());
        addListener(globalThis, 'offline', () => publish());
        addListener(globalThis.document, 'visibilitychange', () => { if (!document.hidden) cycle(); });

        publish('connecting');
        cycle();
    },

    save(collection, record) {
        return enqueue({ op: 'save', c: collection, id: record.id, data: record, updatedAt: record.updatedAt });
    },

    patch(collection, id, fields, updatedAt) {
        return enqueue({ op: 'patch', c: collection, id, fields, updatedAt });
    },

    remove(collection, id, updatedAt) {
        return enqueue({ op: 'remove', c: collection, id, updatedAt });
    },

    async sync() {
        clearTimeout(timer);
        while (busy) await new Promise(resolve => setTimeout(resolve, 50));
        await cycle();
        if (lastError) throw new Error(lastError);
        if (isOffline() || outbox.length) throw new Error('Sin conexión: los cambios se enviarán al reconectar');
    },

    async flush(timeout = 15000) {
        const deadline = Date.now() + timeout;
        while ((outbox.length || busy) && Date.now() < deadline) {
            if (!busy) await cycle();
            else await new Promise(resolve => setTimeout(resolve, 100));
        }
        if (outbox.length) throw new Error('Quedan cambios pendientes por enviar');
    },

    async disconnect() {
        connected = false;
        clearTimeout(timer);
        listeners.forEach(remove => remove());
        listeners = [];
    },

    async test(config) {
        const target = config?.url ? config : config?.sheets;
        try {
            const probe = new URL(target.url);
            probe.searchParams.set('action', 'ping');
            const body = await request(probe.toString(), { method: 'GET' });
            if (body.app !== 'finanzas-sheets') throw new Error('La URL responde, pero no es el script de Finanzas');
            return { success: true, message: 'Conexión exitosa con Google Sheets' };
        } catch (error) {
            return { success: false, message: 'Error: ' + error.message };
        }
    }
};
