/**
 * Registro del Service Worker (funcionamiento offline / PWA).
 */
export function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) {
        console.warn('[App] Service Workers no soportados en este navegador');
        return;
    }

    const hadController = !!navigator.serviceWorker.controller;

    window.addEventListener('load', () => {
        navigator.serviceWorker.register('service-worker.js') // relativo a la página: funciona en la raíz y en subrutas (GitHub Pages)
            .then(registration => {
                setInterval(() => registration.update(), 60000);
            })
            .catch(error => console.error('[App] Error registrando Service Worker:', error));
    });

    // Nueva versión disponible: recargar para usarla (no en la primera instalación)
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (hadController) location.reload();
    });
}
