# KeepVocab 1.8.9

“Understand meaning” opens a guide beside the word: plain meaning, a concrete
situation, a modern example, and why that example fits. Optional usage and related
words remain collapsed. Ask a specific follow-up when needed. Saving retains the
meaning's review history; reopening a saved guide works offline. Complete cached
responses avoid repeated calls. Partial responses retry only incomplete items
once, and provider errors appear on the affected word rather than an empty
review-and-apply screen. Structured output binds results to the requested meaning
and rejects missing support, circular wording and lost source restrictions.

FSRS-6 now schedules each meaning, with separate recall, recognition and assisted
states. Settings provides a retention target and local personal fitting from dated
review history. A bounded fitter and optional prior-context calibration adopt only
improvements on later held-out reviews; training diagnostics expose actual
parameter changes. See [the scheduler design and limits](fsrs-scheduling.md).
The daily goal never prevents additional due practice.

The design review covers all fourteen routes at 390/1280 pixels, plus key forms,
settings panels, empty and feedback states. Fixes address Library card/action
spacing, Progress tile balance, mobile Speaking filter visibility, text/focus
contrast, dialog keyboard focus, empty-library guidance and misleading daily-goal
copy. A failed Speaking startup now has working setup and return actions. Icons
are bundled locally for offline use. Detailed evidence
and coverage are recorded in [the review](design-review-1.8.9.md).

Validation: 422 automated tests pass. Isolated
Electron checks verify the inline guide, errors, offline reuse, real IndexedDB,
worker fitting, parameter diagnostics and persistence. The approved live Gemini
test could not identify a configured key; no external request was sent. Fixture
tests do not establish the quality of actual Gemini output.

macOS: Apple Silicon arm64 only. Android version code: 38. Web cache: v18900.
Optional image model downloads remain separate from the installers.

All 98 web files match in the macOS ASAR and Android APK. All 15 macOS Mach-O
executables/libraries are arm64. The app contains no ONNX weights, WASM binaries,
Transformers development dependency or native ML library. The DMG is 112,686,675
bytes; the ZIP is 111,038,237 bytes; the APK is 8,322,989 bytes and retains the
existing Android signing certificate. The app bundle is 248,440,838 bytes.
