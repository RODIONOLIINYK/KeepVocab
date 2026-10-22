# macOS builds

The user's standing preference is Apple Silicon only. Build and validate macOS
artifacts for `arm64` only. Never compile Intel (`x64`) or universal macOS builds,
including verification runs, command-line overrides, or release checks. Do not
restore Intel/universal targets or scripts or disable the architecture guard.

Test rejected architectures with synthetic hook contexts; do not invoke an Intel
or universal build to test the guard. Historical universal update assets may still
be accepted by the updater without generating new universal builds.

# Post-Change Release Workflow (Mandatory After Major Changes)

After any major change:
1. Bump version in `package.json` (and `package-lock.json`), increment `versionCode` in `android/app/build.gradle`, and bump `CACHE_NAME` in `sw.js`.
2. Run `npm test` and `npm run build:web` (which updates `js/services/version.js`).
3. Compile the macOS (`arm64` only) release (`npm run mac:build`) and Android APK (`npm run android:apk`), and copy/rename the Android APK to `dist/KeepVocab-<version>-Android-debug.apk` alongside `SHA256SUMS.txt`.
4. Commit all changes, create tag `v<version>`, push `main` and the tag to `origin`, and publish the Mac (`dmg`, `dmg.blockmap`, `zip`, `zip.blockmap`, `latest-mac.yml`, `SHA256SUMS.txt`) and Android (`KeepVocab-<version>-Android-debug.apk`) assets to GitHub Releases via `gh release create v<version>`.

# Codebase File Map (Read Only Relevant Files)

To avoid unnecessary file reads, jump directly to the relevant module:

- **Styles & Theme**
  - `css/styles.css` — Core design tokens (`:root`), layout, header/nav, Library cards (`.library-grid`, `.library-word-card`, `.library-meaning`), practice modes, Match Sprint (`.match-board`, `.match-tile`), and Today base styles.
  - `css/polish.css` — Tactile 3D Duolingo/Brilliant-style surfaces, `.today-view` hero & quick-practice cards, `.library-view` card/action overrides, `.image-review` gallery, and `.image-training-table`.
- **Views & UI Components (`js/components/`)**
  - `DashboardView.js` — Today view (`.today-view`, `.daily-workout-card`, `.practice-launchpad`, `.today-insights`).
  - `LibraryView.js` — Vocabulary library, grouped word cards (`wordCard`), meaning cards (`meaningCard`), inline meaning editor (`#library-edit-form`), image chooser, and `Fits meaning` / `Wrong meaning` feedback buttons.
  - `AddWordModal.js` — Single-word and bulk-word import modal, sense selection, and post-save image review hook (`reviewPreparedImages`, `saveImageFeedback`).
  - `ImageReview.js` — Interactive image chooser (`mountImageReview`) for confirming/replacing candidate images and emitting `imageReplacementLabels`.
  - `SettingsView.js` — App settings, Google Drive sync, Gemini/Pexels keys, local CLIP image model controls, and training dataset inspector.
  - `DailySessionView.js`, `FlashcardMode.js`, `SpellingMode.js`, `ChooseWordMode.js`, `VisualMatchMode.js`, `MatchSprintMode.js`, `ContextMode.js`, `UseItMode.js`, `SpeakingView.js`, `StatsView.js` — Practice and stats screens.
- **Services (`js/services/`)**
  - `imageLearning.js` — Local MobileCLIP worker RPC, `rankImagesLocally`, `recordImagePreference` (persists positive/negative labels and replaces prior positive entries when an image is changed), and `getImageLearningTrainingData`.
  - `imagePreferences.js` — Logistic-regression preference model (`fitPreferences`, `updatePreferenceModel`, `mergeImageLearning`, `encodeFeatures`/`decodeFeatures`).
  - `imageChoicePolicy.js` — `canAutoSelectImage`, `imageChoiceGuidance`, and `imageReplacementLabels` (emits `'wrong'` for replaced image + `'good'` for newly chosen image).
  - `imageSearch.js` — Multi-provider image search (`findRelevantImages`), scene generation (`prepareImageScenes`), `imageSelectionPatch`, and per-word `updateImageFeedback`.
  - `wordEntry.js` & `bulkWords.js` — Dictionary/AI lookup and `prepareWordsForLibrary` pipeline.
  - `driveSync.js` — LocalStorage persistence (`keepvocab_words`, `keepvocab_settings`) and Google Drive sync.
  - `fsrs.js`, `dailySession.js`, `wordSelection.js`, `exerciseResult.js` — Spaced repetition scheduling and session selection.

