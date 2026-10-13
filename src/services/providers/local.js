/**
 * Proveedor "solo local": no hay nube, todo vive en localStorage (lo maneja DataService).
 * Implementa el mismo contrato que los demás proveedores.
 */
const noop = () => Promise.resolve();

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
