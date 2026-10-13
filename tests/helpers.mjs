// Utilidades de prueba: localStorage en memoria y navegador mínimo para Node.
export function installBrowserShims() {
    const store = new Map();
    globalThis.localStorage = {
        getItem: k => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: k => store.delete(k),
        clear: () => store.clear(),
        _store: store
    };
    if (!globalThis.navigator) Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
    return store;
}
