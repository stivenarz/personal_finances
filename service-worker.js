/**
 * SERVICE WORKER - Soporte Offline
 * ================================
 * - Precachea el "shell" de la app (HTML, CSS, módulos JS) para abrir sin conexión.
 * - Estrategia network-first para los archivos de la app: si hay red se usa la versión
 *   más nueva (y se actualiza la caché); sin red se sirve la caché.
 * - Librerías de CDN (Chart.js, SDK de Firebase): se cachean al usarse la primera vez.
 * - NO intercepta las llamadas de sincronización (Apps Script, Firestore): esas
 *   deben ir siempre a la red para que los dispositivos se mantengan sincronizados.
 */

const CACHE_VERSION = 'finanzas-v25';
const RUNTIME_CACHE = 'finanzas-runtime-v25';

// Rutas relativas al service worker: la app puede vivir en la raíz o en una subruta (GitHub Pages)
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './offline.html',
  './src/main.js',
  './src/styles/main.css',
  './src/styles/components.css',
  './src/assets/header-art.svg',
  './src/core/utils.js',
  './src/core/state.js',
  './src/core/notifications.js',
  './src/core/modal.js',
  './src/core/ui.js',
  './src/core/router.js',
  './src/core/menu.js',
  './src/core/pwa.js',
  './src/services/collections.js',
  './src/services/config-service.js',
  './src/services/data-service.js',
  './src/services/export-service.js',
  './src/services/providers/local.js',
  './src/services/providers/firebase.js',
  './src/services/providers/sheets.js',
  './src/domain/ledger.js',
  './src/domain/migrations.js',
  './src/domain/transactions.js',
  './src/domain/accounts.js',
  './src/features/shared/options.js',
  './src/features/dashboard/index.js',
  './src/features/accounts/index.js',
  './src/features/accounts/forms.js',
  './src/features/expenses/index.js',
  './src/features/income/index.js',
  './src/features/debts/index.js',
  './src/features/savings/index.js',
  './src/features/planning/index.js',
  './src/features/transactions/index.js',
  './src/features/transactions/forms.js',
  './src/features/shared/export-dialog.js',
  './src/features/settings/index.js',
  './src/features/settings/categories.js',
  './src/features/settings/provider-panel.js',
  './src/features/settings/danger-zone.js'
];

// Hosts externos cuyos archivos estáticos sí se cachean
const CACHEABLE_CDNS = ['cdn.jsdelivr.net', 'www.gstatic.com'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      // Una a una: si un archivo falla no se pierde todo el precacheo
      .then(cache => Promise.all(CORE_ASSETS.map(asset => cache.add(asset).catch(error => console.warn('[SW] No se pudo precachear', asset, error)))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(
        names
          .filter(name => name !== CACHE_VERSION && name !== RUNTIME_CACHE)
          .map(name => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (!url.protocol.startsWith('http')) return;

  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && !CACHEABLE_CDNS.includes(url.hostname)) return; // sincronización: directo a la red

  event.respondWith(networkFirst(request));
});

async function networkFirst(request) {
  try {
    // 'no-cache': siempre revalida contra el servidor (evita servir una versión vieja de la caché HTTP)
    const response = await fetch(request, { cache: 'no-cache' });
    if (response && response.status === 200) {
      const copy = response.clone();
      caches.open(RUNTIME_CACHE).then(cache => cache.put(request, copy));
    }
    return response;
  } catch (error) {
    const cached = (await caches.match(request)) || (await caches.match(request, { ignoreSearch: true }));
    if (cached) return cached;
    if (request.mode === 'navigate') return caches.match('./offline.html');
    throw error;
  }
}

self.addEventListener('message', event => {
  if (event.data && event.data.action === 'clearCache') {
    caches.delete(RUNTIME_CACHE);
  }
});
