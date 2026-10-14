const CACHE_VERSION = 'finanzas-v30';
const RUNTIME_CACHE = 'finanzas-runtime-v30';

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
  './src/services/theme-service.js',
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
  './src/features/categories/index.js',
  './src/features/settings/appearance.js',
  './src/features/settings/provider-panel.js',
  './src/features/settings/danger-zone.js'
];

const CACHEABLE_CDNS = ['cdn.jsdelivr.net', 'www.gstatic.com'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
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

/** Sólo se interceptan archivos propios y las CDN conocidas: las llamadas de sincronización van siempre directo a la red. */
self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (!url.protocol.startsWith('http')) return;

  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && !CACHEABLE_CDNS.includes(url.hostname)) return;

  event.respondWith(networkFirst(request));
});

/** Red primero (siempre revalidando) y caché como respaldo sin conexión; las navegaciones caen en offline.html. */
async function networkFirst(request) {
  try {
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
