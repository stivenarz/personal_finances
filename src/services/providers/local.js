const noop = () => Promise.resolve();

/** Proveedor sin nube: todo vive en localStorage (lo gestiona DataService). @type {import('../data-service.js').Provider} */
export default {
    name: 'local',
    async connect({ onStatus, onReady }) {
        onStatus?.({ state: 'local', pending: 0, error: null });
        onReady?.();
    },
    save: noop,
    patch: noop,
    remove: noop,
    sync: noop,
    flush: noop,
    async disconnect() {},
    async test() {
        return { success: true, message: 'Modo local: no requiere conexión' };
    }
};
