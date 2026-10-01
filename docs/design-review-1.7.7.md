# KeepVocab 1.7.7 practice design restoration

Restored the compact Practice card from 1.7.4 for the unified main session:
notebook header, back button, question counter, score, thin progress bar,
keyboard icon, definition block, part-of-speech hint, plain answer field,
and Check button. Feedback again shows the answer and saved example with
Hear answer and Next word controls. The completion screen uses the earlier
compact result and score display.

Visual Match questions use the same card header and progress row with the
existing Visual Match image and choice styles. The main session no longer
uses the tall workout stage, large display heading, or Sprig illustration.
The default and Weak Words layouts share their existing scoring, submission,
progress, speech, and broken-image handlers; no second practice route exists.

The ten-exercise limit, 1.7.4 word-selection rules, and seven typed / three
visual task mix remain. Missing images fall back to typed descriptions.
Streak messaging remains in Settings and reminders remain Android-only.

Validation: all 284 Node tests passed. 37 desktop and 28 simulated Android UI
checks passed, including both entry points, old links, the full mixed session,
duplicate-submit protection, broken-image fallback, Settings placement, and
notification navigation. Desktop layouts were checked at 360, 390, 768, and
1280 pixels without blank content or horizontal overflow. Screenshots include
typed and visual questions, answer feedback, and the completion screen, saved
locally in work/design-restore/ with isolated test profiles and sample vocabulary.
The Android notification bridge checks use a test double; real OS delivery
and live AI/Drive services still require device credentials.

Android assembleDebug and lintDebug passed. APK version is 1.7.7, code 25,
with the same signing certificate as previous releases. Universal macOS builds
passed native Apple Silicon and Rosetta Intel launch checks, DMG checksum and
ZIP integrity checks, and updater metadata hash verification. Both packages
contain the reviewed sources.
