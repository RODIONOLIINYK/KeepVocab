// Service Worker for KeepVocab (Android, Quest VR & Windows offline support)

const CACHE_NAME = 'keepvocab-v86';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './css/styles.css',
  './css/styles.css?v=86',
  './js/app.js',
  './js/app.js?v=86',
  './js/services/driveSync.js',
  './js/services/driveSync.js?v=86',
  './js/services/dictionaryApi.js',
  './js/services/dictionaryApi.js?v=86',
  './js/services/speechService.js',
  './js/services/speechService.js?v=86',
  './js/services/bulkWords.js',
  './js/services/bulkWords.js?v=86',
  './js/services/imageSearch.js',
  './js/services/imageSearch.js?v=86',
  './js/services/exampleSearch.js',
  './js/services/exampleSearch.js?v=86',
  './js/services/syncPolicy.js',
  './js/services/syncPolicy.js?v=86',
  './js/services/srsEngine.js',
  './js/services/srsEngine.js?v=86',
  './js/services/exerciseResult.js',
  './js/services/exerciseResult.js?v=86',
  './js/services/exerciseEvaluation.js',
  './js/services/exerciseEvaluation.js?v=86',
  './js/services/useItEvaluation.js',
  './js/services/useItEvaluation.js?v=86',
  './js/services/dailySession.js',
  './js/services/dailySession.js?v=86',
  './js/services/learningStats.js',
  './js/services/learningStats.js?v=86',
  './js/services/speakingVocabulary.js',
  './js/services/speakingVocabulary.js?v=86',
  './js/services/geminiSettings.js',
  './js/services/geminiSettings.js?v=86',
  './js/services/contextExercises.js',
  './js/services/contextExercises.js?v=86',
  './js/services/speechInput.js',
  './js/services/speechInput.js?v=86',
  './js/services/interactionSound.js',
  './js/services/interactionSound.js?v=86',
  './js/services/reminderService.js',
  './js/services/reminderService.js?v=86',
  './js/services/geminiLive.js',
  './js/services/geminiLive.js?v=86',
  './js/components/ReviewView.js',
  './js/components/ReviewView.js?v=86',
  './js/components/LibraryView.js',
  './js/components/LibraryView.js?v=86',
  './js/components/StatsView.js',
  './js/components/StatsView.js?v=86',
  './js/components/PracticeModes.js',
  './js/components/PracticeModes.js?v=86',
  './js/components/VisualMatchMode.js',
  './js/components/VisualMatchMode.js?v=86',
  './js/components/MatchSprintMode.js',
  './js/components/MatchSprintMode.js?v=86',
  './js/components/SpeakingMode.js',
  './js/components/SpeakingMode.js?v=86',
  './js/components/DashboardView.js',
  './js/components/DashboardView.js?v=86',
  './js/components/DailySessionMode.js',
  './js/components/DailySessionMode.js?v=86',
  './js/components/FlashcardsMode.js',
  './js/components/FlashcardsMode.js?v=86',
  './js/components/ContextQuizMode.js',
  './js/components/ContextQuizMode.js?v=86',
  './js/components/UseItMode.js',
  './js/components/UseItMode.js?v=86',
  './js/components/UseItExercise.js',
  './js/components/UseItExercise.js?v=86',
  './js/components/SettingsView.js',
  './js/components/SettingsView.js?v=86',
  './js/data/speakingLessons.js',
  './js/data/speakingLessons.js?v=86',
  './js/utils/html.js',
  './js/utils/wordForms.js',
  './js/utils/wordForms.js?v=86',
  './assets/fonts/inter-latin.woff2',
  './assets/fonts/inter-latin-ext.woff2',
  './assets/fonts/outfit-latin.woff2',
  './assets/fonts/outfit-latin-ext.woff2',
  './assets/keepvocab-sprout-mascot.webp',
  './assets/keepvocab-sprig-thinking.webp',
  './assets/keepvocab-sprig-celebrate.webp',
  './assets/keepvocab-sprig-reminder.webp',
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
