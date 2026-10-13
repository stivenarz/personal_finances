/** Registra el service worker (modo offline) y recarga cuando una versión nueva toma el control. */
export function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) {
        console.warn('[App] Service Workers no soportados en este navegador');
        return;
    }

    const hadController = !!navigator.serviceWorker.controller;

    window.addEventListener('load', () => {
        navigator.serviceWorker.register('service-worker.js')
            .then(registration => {
                setInterval(() => registration.update(), 60000);
            })
            .catch(error => console.error('[App] Error registrando Service Worker:', error));
    });

    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (hadController) location.reload();
    });
}
