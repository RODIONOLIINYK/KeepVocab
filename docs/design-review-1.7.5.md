# KeepVocab 1.7.5 design and release review

Reviewed on 1 October 2026. The existing Sprig artwork, green palette, navigation,
and card system remain consistent across phone and desktop layouts. Today's
Workout now explains the number of distinct words, two rounds, exercise count,
and estimated duration. A separate streak card makes the next action explicit;
feedback includes icons and status announcements as well as color.

## Changes and reproduced bugs

- Expanded the workout to up to ten distinct words, each encountered twice.
  Recognition includes word, meaning, and available image choices; the second
  round uses typed recall, listening, and gaps in saved examples. Use It and
  Weak Words remain separate manual modes. Tiny libraries and unusable examples
  fall back to supported exercises.
- Fixed the empty Flashcards Add vocabulary button, which referenced a missing
  modal instead of opening the shared word composer.
- Preserved unsaved Library word fields when image selection or search results
  rerender the editor. Previously those changes reverted to the saved record.
- Cancelled Match Sprint intervals and delayed feedback when leaving the mode.
  Previously a delayed answer callback could replace the next screen.
- Counted selected words once in the workout composition instead of counting
  both encounters. The dashboard now distinguishes words from exercises.
- Added the missing daily-goal control to Routine & sound, validated its range,
  and refreshed Today after saving it. Goal changes no longer record a study
  start or leave the displayed target stale.
- Removed Library of Congress from direct renderer image requests because its
  catalog rejected these cross-origin requests. Other image providers and
  explicit custom transports remain available.
- Increased the routine dialog's close target to 44 pixels and allowed long
  workout choices to wrap.

## Android reminders and macOS behavior

Android reminders are opt-in. Smart timing learns recent study starts, with
separate weekday and weekend medians once sufficient samples exist. A rolling
week of dated reminders avoids indefinite repetition. One evening safeguard
warns about the next unprotected streak day. Any completed exercise removes
that day's pending and delivered reminders. Later messages avoid stale streak
counts and offer an encouraging return to practice.

macOS and browser builds have only daily-goal and sound controls. They request
no notification permission and schedule no reminders. The macOS native
permission handler also rejects notifications.

## Verification

- All 283 Node tests passed; source diff whitespace checks passed.
- Rendered 14 screens at widths 360, 390, 768, and 1280 pixels: Today, workout,
  Library, Progress, Settings, Flashcards, Choose Word, spelling, Match Sprint,
  context, Use It, Weak Words, visual practice, and Speak. No blank screens or
  horizontal page overflow. The routine dialog was checked at all four widths.
- 62 design checks passed, including preservation of Library drafts and leaving
  Match Sprint during delayed correct-answer feedback.
- 27 desktop flow checks and 30 simulated Android flow checks passed: empty
  Flashcards action, goal saving, platform controls, complete 20-answer workout,
  duplicate-submit protection, speaking keyboard fallback, Lithuanian course
  and first lesson at phone width. Android checks used a notification bridge
  double to verify permission opt-in, dated schedules, cancellation after the
  first answer, and notification navigation.
- Android `assembleDebug` and `lintDebug` succeeded. Lint reports zero errors
  and 19 existing warnings concerning resources, manifest ordering, and a
  newer Gradle patch. The merged manifest includes notification permission,
  alarm permission, boot receivers, and the registered Local Notifications
  plugin. APK package is `com.keepvocab.app`, version 1.7.5, version code 23.
- APK certificate SHA-256 matches the downloaded 1.7.4 release:
  `28678699d967dc3ec933e0187870259f7966db9296c4c8af908cf552bbfa46cd`.
- Universal macOS build succeeded. The main executable contains `x86_64` and
  `arm64`; bundle ID is `com.keepvocab.app`, version 1.7.5. The packaged app
  launched with an isolated profile and loaded the app shell and service worker.
  DMG checksum and ZIP integrity passed. Update metadata sizes and SHA-512
  values match both installers. Packaged application sources match the reviewed
  source files and contain no macOS notification integration.

## Limits

No Android device or emulator was attached, so real OS delivery, notification
permission prompts, battery restrictions, and installation were not exercised.
The Android bridge checks do not replace those device checks. Live AI speaking,
private Google Drive authorization, and paid API providers were not exercised
with a user's credentials. A transient Openverse CORS response occurred during
live image searches; the app retained its fallback behavior. macOS distribution
continues to use the repository's unsigned personal-build configuration.

Screenshots and isolated-profile test logs are local under
`work/release-1.7.5/`; they are not included in the source repository or installers.
