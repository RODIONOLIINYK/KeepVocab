// Service Worker for KeepVocab (Android, Quest VR & Windows offline support)

const CACHE_NAME = 'keepvocab-v54';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './css/styles.css',
  './css/styles.css?v=47',
  './css/styles.css?v=48',
  './css/styles.css?v=49',
  './css/styles.css?v=50',
  './css/styles.css?v=51',
  './js/app.js',
  './js/app.js?v=47',
  './js/app.js?v=49',
  './js/app.js?v=50',
  './js/app.js?v=51',
  './js/app.js?v=52',
  './js/app.js?v=53',
  './js/app.js?v=54',
  './js/services/driveSync.js',
  './js/services/driveSync.js?v=42',
  './js/services/driveSync.js?v=46',
  './js/services/dictionaryApi.js',
  './js/services/dictionaryApi.js?v=45',
  './js/services/speechService.js',
  './js/services/speechService.js?v=43',
  './js/services/bulkWords.js',
  './js/services/bulkWords.js?v=45',
  './js/services/imageSearch.js',
  './js/services/imageSearch.js?v=42',
  './js/services/exampleSearch.js',
  './js/services/exampleSearch.js?v=42',
  './js/services/syncPolicy.js',
  './js/services/syncPolicy.js?v=42',
  './js/services/srsEngine.js',
  './js/services/srsEngine.js?v=42',
  './js/services/interactionSound.js',
  './js/services/interactionSound.js?v=46',
  './js/services/interactionSound.js?v=49',
  './js/services/reminderService.js',
  './js/services/reminderService.js?v=46',
  './js/services/reminderService.js?v=52',
  './js/services/reminderService.js?v=54',
  './js/services/geminiLive.js',
  './js/services/geminiLive.js?v=43',
  './js/components/ReviewView.js',
  './js/components/ReviewView.js?v=43',
  './js/components/ReviewView.js?v=47',
  './js/components/ReviewView.js?v=49',
  './js/components/LibraryView.js',
  './js/components/LibraryView.js?v=43',
  './js/components/LibraryView.js?v=50',
  './js/components/LibraryView.js?v=51',
  './js/components/StatsView.js',
  './js/components/StatsView.js?v=42',
  './js/components/PracticeModes.js',
  './js/components/PracticeModes.js?v=43',
  './js/components/PracticeModes.js?v=47',
  './js/components/PracticeModes.js?v=49',
  './js/components/VisualMatchMode.js',
  './js/components/VisualMatchMode.js?v=42',
  './js/components/VisualMatchMode.js?v=49',
  './js/components/MatchSprintMode.js',
  './js/components/MatchSprintMode.js?v=42',
  './js/components/MatchSprintMode.js?v=49',
  './js/components/SpeakingMode.js',
  './js/components/SpeakingMode.js?v=43',
  './js/data/speakingLessons.js',
  './js/data/speakingLessons.js?v=42',
  './js/utils/html.js',
  './assets/fonts/inter-latin.woff2',
  './assets/fonts/inter-latin-ext.woff2',
  './assets/fonts/outfit-latin.woff2',
  './assets/fonts/outfit-latin-ext.woff2',
  './assets/keepvocab-sprout-mascot.png',
  './assets/keepvocab-sprig-thinking.png',
  './assets/keepvocab-sprig-celebrate.png',
  './assets/keepvocab-sprig-reminder.png',
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
