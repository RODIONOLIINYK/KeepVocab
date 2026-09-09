// Service Worker for KeepVocab (Android, Quest VR & Windows offline support)

const CACHE_NAME = 'keepvocab-v1700';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './quick-add.html',
  './css/styles.css',
  './css/quick-add.css',
  './js/app.js',
  './js/services/driveSync.js',
  './js/services/courseProfiles.js',
  './js/services/adaptiveLessons.js',
  './js/services/lessonEngine.js',
  './js/services/lessonVocabulary.js',
  './js/services/lithuanianEnrichment.js',
  './js/services/lithuanianDictionary.js',
  './js/data/lithuanianSpeakingScenarios.js',
  './js/services/geminiTts.js',
  './js/services/dictionaryApi.js',
  './js/services/speechService.js',
  './js/services/bulkWords.js',
  './js/services/imageSearch.js',
  './js/services/exampleSearch.js',
  './js/services/syncPolicy.js',
  './js/services/srsEngine.js',
  './js/services/exerciseResult.js',
  './js/services/wordSelection.js',
  './js/services/exerciseEvaluation.js',
  './js/services/useItEvaluation.js',
  './js/services/dailySession.js',
  './js/services/learningStats.js',
  './js/services/studyActivity.js',
  './js/services/appUpdates.js',
  './js/services/version.js',
  './js/services/speakingVocabulary.js',
  './js/services/speakingPhrases.js',
  './js/services/geminiSettings.js',
  './js/services/contextExercises.js',
  './js/services/speechInput.js',
  './js/services/interactionSound.js',
  './js/services/reminderService.js',
  './js/services/geminiLive.js',
  './js/components/ReviewView.js',
  './js/components/LibraryView.js',
  './js/components/StatsView.js',
  './js/components/PracticeModes.js',
  './js/components/VisualMatchMode.js',
  './js/components/MatchSprintMode.js',
  './js/components/SpeakingMode.js',
  './js/components/LearningPathView.js',
  './js/components/LessonMode.js',
  './js/components/DashboardView.js',
  './js/components/DailySessionMode.js',
  './js/components/FlashcardsMode.js',
  './js/components/ContextQuizMode.js',
  './js/components/UseItMode.js',
  './js/components/UseItExercise.js',
  './js/components/SettingsView.js',
  './js/quickAdd.js',
  './js/data/speakingLessons.js',
  './js/data/courses.js',
  './js/data/lithuanianCurriculum.js',
  './js/data/lithuanianForms.js',
  './js/utils/html.js',
  './js/utils/collections.js',
  './js/utils/dates.js',
  './js/utils/navigation.js',
  './js/utils/wordForms.js',
  './js/utils/base64.js',
  './js/utils/storageCache.js',
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
  './icons/keepvocab-menubar-template.svg',
  './icons/keepvocab-menubarTemplate.png',
  './icons/keepvocab-menubarTemplate@2x.png',
  './manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );

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
      // Version query strings are cache-busters, not distinct files. Matching
      // by path keeps one offline copy instead of downloading every old alias.
      .catch(() => caches.match(event.request, { ignoreSearch: true }).then((cached) => cached || caches.match('./index.html')))
  );
});

self.addEventListener('message', event => {
  if (event.data?.type === 'ACTIVATE_UPDATE') self.skipWaiting();
});
