# KeepVocab 1.7.8 adaptive Practice selection

Practice was repeatedly choosing the same words because the session builder
included vocabulary whose next review was still in the future, padded short
pools with unconditional repeats, and ranked lifetime mistakes above recovery.
It also did not record which words had been selected for Practice.

Restored the earlier due-word eligibility rule. Practice now selects at most ten
distinct words, with one meaning per spelling and no filler repetitions. Each
answer updates the word's review interval using the existing recall evidence,
difficulty, stability, and repetition statistics. Misses return sooner, after
their scheduled delay; correct answers earn longer breaks. Every new session
reads the latest persisted results and review dates. Recent unresolved mistakes
and lateness influence priority, while selection history rotates the remainder.
Successful answers reduce the influence of earlier mistakes. Selecting a word
does not count as answering it, and dashboard previews do not change statistics.
Typed and visual answers share Practice statistics. Legacy results still apply.

The compact Practice design, common entry point, active Library month/course,
and seven typed / three visual task mix remain. Short sessions use the same
proportion where images permit; broken images fall back to typing. Today and
Practice show “All caught up” when nothing is due. Optional manual exercise
modes can still use vocabulary for extra practice. Reminders remain Android-only.

Validation: all 293 Node tests passed, including consecutive sessions covering
27 words without repeated successful words, small libraries, scheduled retry
boundaries, recovery, legacy records, selection tracking, and read-only previews.
77 desktop and 68 simulated Android UI checks passed. The actual application
completed sessions of ten, ten, and seven words without overlap, saved one answer
per word, and displayed the caught-up state. Checks also cover both entry points,
mixed task types, duplicate-submit protection, broken-image fallback, manual
modes after completion, Settings, and Android notification scheduling through
a test double. Desktop layouts fit widths 360, 390, 768, and 1280; reviewed
screenshots are saved locally under work/release-1.7.8/qa/.

Android assembleDebug and lintDebug passed, with zero lint errors and 19 existing
warnings. APK version 1.7.8 uses version code 26 and the previous signing key.
Universal macOS builds passed Apple Silicon and Rosetta Intel launch checks,
DMG checksum and ZIP integrity checks, and updater metadata verification.
Both packages contain the reviewed sources. Real Android OS notification
delivery and authenticated AI/Drive services were not exercised in these checks.
