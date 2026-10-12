# KeepVocab 1.8.1

English definitions remain the default. Settings also offers Ukrainian translation hints.
Switching modes preserves saved vocabulary, English examples, definitions, and review progress.
The app now contains one English course and one routed dashboard. Retired curriculum modules,
course-specific speaking/audio code, duplicate dashboard controls, unused styles, and duplicate
PNG mascot images were removed.

Settings presents language, routine, and backup first, with optional AI, image, and update settings
in disclosures. Dictionary lookup initially shows five meanings with all remaining choices
available. Ukrainian lookup, manual and bulk entries, saved-word backfill, flashcards, practice,
and authored speaking expressions use the selected mode. Translation is optional when offline;
English mode makes no translation requests.

## Fixes

- English form matching handles irregular verbs, regular past forms, and plural possessives.
- Cancelling speech cannot restart browser audio; leaving a speaking session closes connecting
  sockets and ignores late microphone grants. Empty conversations do not complete a lesson.
- Context caching follows the current meaning/language and rejects stale or invalid exercise sets.
- Drive sync merges the actual speaking-progress schema and retains completed lessons, newer
  preferences, and phrase progress. Removed vocabulary has deletion evidence to prevent restore.
- Routine settings refresh after saving; returning after midnight refreshes date-sensitive progress.
- Flashcards expose only the currently revealed side to assistive technology.

## Release verification

- 296 automated tests pass; `git diff --check` passes.
- Android `assembleDebug` and `lintDebug` succeed; package version 1.8.1, versionCode 30.
- Android signing certificate matches the published 1.8.0 debug APK.
- Universal macOS DMG/ZIP build succeeds; executable includes x86_64 and arm64.
- Packaged macOS source and all 82 Android web assets match the current checkout.
- Browser checks cover persisted language choices, live Ukrainian dictionary lookup, saved
  translation hints, English-mode hiding, flashcard recording, speaking keyboard fallback,
  routine saving, and settings widths 360, 390, 768, and 1280 without horizontal overflow.
- macOS remains an unsigned personal build; Android retains the existing debug signing key.
  Physical-device notifications and credentialed AI/Drive sessions were not exercised.
