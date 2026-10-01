# KeepVocab 1.7.6 practice correction

The Practice navigation tab and Today’s Start workout button now open one
practice session. Old `#daily` links, including previously scheduled Android
notifications, redirect to the canonical `#review` route. The separate typed
review implementation has been removed.

Restored the 1.7.4 scheduler's ten-exercise limit, selection order, and selection
mix (35% due, 50% weak, 15% growth, with the same available-pool fallbacks).
There is no compulsory second round. Small libraries keep the earlier lengths:
one task for one word, four tasks for two words, six tasks for three words,
and ten tasks for larger pools. Any repeats remain separated by other words.

The main session uses only typed recall from saved descriptions and Visual Match
questions. When enough selected words have images, a ten-task session contains
seven typed tasks and three visual questions, spaced through the selected queue.
Missing or failed images fall back to typed recall without replacing selected
words. Task assignment does not alter the restored word-selection behavior.
Use It and Weak Words remain separate optional manual exercises.

The full streak message and routine action have moved from Today into Settings.
Today keeps its compact daily-progress and streak counters. Android-only
reminder scheduling remains enabled; macOS has no reminder controls, notification
permission requests, or native notification scheduling.

## Validation

- 284 Node tests passed, including the restored selection fixture, 70/30 task
  mix, missing-image fallback, and original small-library session lengths.
- 36 desktop UI checks passed. Both entry points and legacy links open the same
  Practice screen with active navigation. A ten-answer session completes and
  duplicate choices count once. Streak status is absent from Today and present
  in Settings. Today, Practice, and Settings fit widths 360, 390, 768, and 1280
  without horizontal overflow or blank content.
- 27 simulated Android UI checks passed, including the same practice behavior,
  reminder opt-in and dated scheduling, cancellation after activity, and old
  notification links opening the unified session. The notification bridge is a
  test double; real OS delivery requires an Android device.
- Android assembleDebug and lintDebug succeeded with no lint errors. APK
  identity is com.keepvocab.app, version 1.7.6, version code 24; its signing
  certificate matches 1.7.5.
- Universal macOS build, native Apple Silicon and Rosetta Intel launch checks,
  DMG checksum, ZIP integrity, and updater metadata hashes passed. Packaged
  sources match the reviewed code on both platforms, and the old ReviewView
  renderer is absent from both installers.
- Broken visual clues fall back to a description task in the running app.
  Speaking keyboard fallback and the first Lithuanian course lesson still work.

The release builds use the existing Android debug signing key and unsigned
universal macOS configuration. Native notification delivery and live AI/Drive
services require device credentials and were not exercised here. Local screenshots
and isolated-profile flow logs are under `work/release-1.7.6/`.
