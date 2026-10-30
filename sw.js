// Service Worker for KeepVocab (Android, Quest VR & Windows offline support)

const CACHE_NAME = 'keepvocab-v112008';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './quick-add.html',
  './css/styles.css',
  './css/polish.css',
  './css/mobile.css',
  './css/motion.css',
  './css/icons.css',
  './css/quick-add.css',
  './js/app.js',
  './js/utils/mobileViewport.js',
  './js/components/AddWordModal.js',
  './js/services/driveSync.js',
  './js/services/courseProfiles.js',
  './js/services/translationSettings.js',
  './js/services/libraryTranslations.js',
  './js/services/wordEntry.js',
  './js/services/learningDefinitions.js',
  './js/services/dictionaryApi.js',
  './js/services/englishEnrichment.js',
  './js/services/speechService.js',
  './js/services/bulkWords.js',
  './js/services/imageSearch.js',
  './js/services/imageLearning.js',
  './js/services/imageModelStartup.js',
  './js/services/imagePreferences.js',
  './js/services/imageLearningHistory.js',
  './js/services/imagePersonalizer.js',
  './js/services/imagePersonalizerTraining.js',
  './js/services/imagePreprocessing.js',
  './js/ml/imageTrainer.worker.js',
  './js/ml/pretrainedImagePersonalizer.js',
  './js/services/imageChoicePolicy.js',
  './js/ml/clipConfig.js',
  './js/ml/MOBILECLIP-LICENSE.txt',
  './js/ml/MOBILECLIP-MODEL-LICENSE.txt',
  './js/ml/TRANSFORMERS-LICENSE.txt',
  './js/ml/ONNX-RUNTIME-LICENSE.txt',
  './js/ml/clipWorker.bundle.js',
  './js/services/imageThumbnails.js',
  './js/services/exampleSearch.js',
  './js/services/syncPolicy.js',
  './js/services/srsEngine.js',
  './js/services/fsrsConfig.js',
  './js/services/reviewHistory.js',
  './js/services/memoryFeatures.js',
  './js/services/fsrsOptimizer.js',
  './js/services/fsrsLearning.js',
  './js/ml/fsrsTrainer.worker.js',
  './js/vendor/fsrs.js',
  './js/vendor/TS-FSRS-LICENSE.txt',
  './js/services/exerciseResult.js',
  './js/services/wordSelection.js',
  './js/services/wordChoices.js',
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
  './js/components/LibraryView.js',
  './js/components/StatsView.js',
  './js/components/PracticeModes.js',
  './js/components/PracticeElements.js',
  './js/components/MeaningExplanation.js',
  './js/components/ImageReview.js',
  './js/ml/imageTrainingRecipe.js',
  './js/components/StreakCelebration.js',
  './js/components/VisualMatchMode.js',
  './js/components/MatchSprintMode.js',
  './js/components/SpeakingMode.js',
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
  './js/utils/html.js',
  './js/utils/disclosureMotion.js',
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
          if (key.startsWith('keepvocab-v') && key !== CACHE_NAME) return caches.delete(key);
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
