/**
 * SERVICE WORKER - Soporte Offline
 * ================================
 * Proporciona funcionalidad offline y caché de activos
 *
 * Características:
 * - Caché de archivos principales
 * - Fallback a página offline
 * - Sincronización en background (PWA avanzada)
 * - Network-first para datos dinámicos
 */

const CACHE_VERSION = 'finanzas-v1';
const RUNTIME_CACHE = 'finanzas-runtime';

// Archivos críticos que se cachean al instalar
const CORE_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.json',
  '/offline.html'
];

/**
 * EVENTO: Instalación del Service Worker
 * Cachea los archivos críticos para acceso offline
 */
self.addEventListener('install', event => {
  console.log('[SW] Installing Service Worker...');

  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => {
        console.log('[SW] Caching core assets');
        return cache.addAll(CORE_ASSETS);
      })
      .then(() => self.skipWaiting()) // Activar inmediatamente
      .catch(error => console.error('[SW] Install error:', error))
  );
});

/**
 * EVENTO: Activación del Service Worker
 * Limpia cachés antiguos
 */
self.addEventListener('activate', event => {
  console.log('[SW] Activating Service Worker...');

  event.waitUntil(
    caches.keys()
      .then(cacheNames => {
        return Promise.all(
          cacheNames
            .filter(cacheName => cacheName !== CACHE_VERSION && cacheName !== RUNTIME_CACHE)
            .map(cacheName => {
              console.log('[SW] Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            })
        );
      })
      .then(() => self.clients.claim()) // Tomar control de todas las pestañas
  );
});

/**
 * EVENTO: Interceptar solicitudes (fetch)
 * Estrategia: Network-first para dinámico, Cache-first para estático
 */
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Solo interceptar requests HTTP/HTTPS
  if (!url.protocol.startsWith('http')) {
    return;
  }

  // Estrategia 1: Para activos estáticos (CSS, JS, HTML)
  if (isStaticAsset(request.url)) {
    event.respondWith(
      caches.match(request)
        .then(response => {
          // Si está en caché, devolverlo
          if (response) {
            return response;
          }

          // Si no, intentar traer de red
          return fetch(request)
            .then(response => {
              // Cachear la respuesta si es 200 OK
              if (response && response.status === 200) {
                const responseClone = response.clone();
                caches.open(RUNTIME_CACHE)
                  .then(cache => cache.put(request, responseClone));
              }
              return response;
            })
            .catch(() => caches.match('/offline.html'));
        })
    );
  }
  // Estrategia 2: Para datos dinámicos (JSON, API calls)
  else {
    event.respondWith(
      fetch(request)
        .then(response => {
          // Cachear respuesta si es 200 OK
          if (response && response.status === 200) {
            const responseClone = response.clone();
            caches.open(RUNTIME_CACHE)
              .then(cache => cache.put(request, responseClone));
          }
          return response;
        })
        .catch(() => {
          // Si falla la red, intentar caché
          return caches.match(request)
            .then(response => response || caches.match('/offline.html'));
        })
    );
  }
});

/**
 * Determina si una URL es un activo estático
 * @param {string} url - URL a verificar
 * @returns {boolean}
 */
function isStaticAsset(url) {
  return /\.(js|css|html|json|woff|woff2|ttf|eot|svg|png|jpg|jpeg|gif|webp)(\?.*)?$/.test(url);
}

/**
 * EVENTO: Mensajes desde la página principal
 * Para comunicación bidireccional SW ↔ Página
 */
self.addEventListener('message', event => {
  console.log('[SW] Message received:', event.data);

  // Limpiar caché si se solicita
  if (event.data.action === 'clearCache') {
    caches.delete(RUNTIME_CACHE)
      .then(() => console.log('[SW] Runtime cache cleared'));
  }

  // Sincronización manual
  if (event.data.action === 'sync') {
    console.log('[SW] Sync requested');
    // Implementar sincronización de datos pendientes
  }
});

console.log('[SW] Service Worker loaded');
