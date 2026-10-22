# KeepVocab 1.9.0

- Local image learning enables automatically when installed. Missing files require
  a one-time download choice; skipping persists, and Settings can install later.
- Choose among up to six photos per meaning. Conservative automatic selections
  require enough real preference ratings and never train on their own choices.
- Good/Wrong ratings and saved replacements teach the local logistic model;
  More like this adjusts searches only. Training follows successful saves.
- Examples are optional for single and bulk additions. Bulk saving can skip slow
  image searches; late responses cannot change the saved words.
- Library cards omit recall statistics, secondary tools stay collapsed, and
  routine image searches use public providers/local scoring without Gemini calls.
- Bulk clarity rewrites share smaller requests for selected meanings, and saving
  never repeats paid explanation repair. Dictionary providers are unchanged.
- Review queues retain urgency order instead of shuffling after prioritization.

Validation: 447 automated tests and the web build pass. Browser checks cover
startup consent, persisted refusal, optional examples, and simplified Library UI.
Automatic image-selection thresholds are heuristics; real-world accuracy has not
been measured for this release.

macOS: Apple Silicon arm64 only. Android version code: 39. Web cache: v19000.
Local model weights and runtime are downloaded separately after consent.

Package validation: all 99 web assets match in both the macOS ASAR and Android
APK. All 15 macOS Mach-O executables/libraries are arm64 only. The DMG passed
image verification; the APK retains the previous release's signing certificate.
The Android download is the same debug-signed APK format used in prior releases.
macOS packages remain unsigned, matching the existing release configuration.
