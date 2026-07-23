// Service Worker for KeepVocab (Android, Quest VR & Windows offline support)

const CACHE_NAME = 'keepvocab-v42';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './css/styles.css',
  './css/styles.css?v=39',
  './js/app.js',
  './js/app.js?v=42',
  './js/services/driveSync.js',
  './js/services/driveSync.js?v=42',
  './js/services/dictionaryApi.js',
  './js/services/dictionaryApi.js?v=42',
  './js/services/speechService.js',
  './js/services/imageSearch.js',
  './js/services/imageSearch.js?v=42',
  './js/services/exampleSearch.js',
  './js/services/exampleSearch.js?v=42',
  './js/services/syncPolicy.js',
  './js/services/syncPolicy.js?v=42',
  './js/services/srsEngine.js',
  './js/services/srsEngine.js?v=42',
  './js/services/geminiLive.js',
  './js/services/geminiLive.js?v=42',
  './js/components/ReviewView.js',
  './js/components/ReviewView.js?v=42',
  './js/components/LibraryView.js',
  './js/components/LibraryView.js?v=42',
  './js/components/StatsView.js',
  './js/components/StatsView.js?v=42',
  './js/components/PracticeModes.js',
  './js/components/PracticeModes.js?v=42',
  './js/components/VisualMatchMode.js',
  './js/components/VisualMatchMode.js?v=42',
  './js/components/MatchSprintMode.js',
  './js/components/MatchSprintMode.js?v=42',
  './js/components/SpeakingMode.js',
  './js/components/SpeakingMode.js?v=42',
  './js/data/speakingLessons.js',
  './js/data/speakingLessons.js?v=42',
  './js/utils/html.js',
  './assets/fonts/inter-latin.woff2',
  './assets/fonts/inter-latin-ext.woff2',
  './assets/fonts/outfit-latin.woff2',
  './assets/fonts/outfit-latin-ext.woff2',
  './icons/keepvocab-mark-v2-180.png',
  './icons/keepvocab-mark-v2-192.png',
  './icons/keepvocab-mark-v2-512.png',
  './manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match('./index.html')))
  );
});
