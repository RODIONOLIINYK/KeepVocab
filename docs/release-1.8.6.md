# KeepVocab 1.8.6

## Understandable meanings and useful examples

The previous extra short-clue field is removed. Dictionary intake now produces
one learner explanation, a matching modern example, and practical usage guidance
where useful. Clarity takes priority over a word limit. Difficult wording,
circular definitions, unexplained jargon, and missing or unsuitable examples
trigger optional Gemini assistance. Original dictionary wording remains source
evidence, with a stable source fingerprint; it is not a competing practice clue.

The supplied historical quotation containing “Ladyſhip”, “outlandiſh”, and
“Rara avis” is a regression case. Historical quotations, verse/citation blocks,
multi-sentence speeches, and overlong examples are excluded from practice.
Modern examples must contain the word or a recognized inflection. Known
wrong-sense conflicts are rejected. New vocabulary requires a usable example;
without Gemini, it can be entered manually. Existing incomplete entries have an
explicit missing-example state and can be repaired from Library.

Near-identical dictionary senses are grouped conservatively by wording, part of
speech, register, domain and essential qualifiers. Existing duplicates can be
reviewed and merged in Library. The merge keeps a stable ID, actual lifetime
counters, latest recall state, mistakes, productive samples and a conservative
schedule. Removed IDs receive Drive tombstones so stale backups cannot resurrect
the duplicate. Separate meanings, grammatical families and months stay separate.

**Improve explanations** previews changes to saved vocabulary; **Explain clearly**
can also revisit an individual confusing meaning. Apply updates only explanation
metadata and checks for intervening edits. Review history, IDs and schedules are
preserved. Generated explanations remain suggestions requiring review; automatic
checks cannot prove arbitrary semantic equivalence.

Dictionary misses still fall through to Gemini. Structured output validation,
thought-part exclusion, apostrophe normalization, and a bounded retry for explicit
token truncation remain covered by tests.

## Image plan and packaging

The non-ML image optimizations are implemented: exact-sense persistent/synced
scenes, safe object/curated shortcuts, batching, bounded retries, corrected scene
selection, wider candidate pools, diversity and duplicate suppression,
sense-specific feedback, smaller provider previews, explicit batch review, a
small-thumbnail optional Gemini comparison and an offline evaluation script.
See [Image picking implementation](image-picking-review.md) for exact limits.

The adaptive practice changes from 1.8.4 remain: a completed daily goal does not
block useful exercises; recently and reliably recalled words rest until due;
last successful unaided recall dates are recorded. The scheduler uses adaptive
rules. FSRS is a possible follow-up; adoption should use reliable event history
and chronological evaluation rather than claimed gains.

macOS builds remain Apple Silicon only. No Intel/universal compilation or model
downloads are included. Installers are published for the user to install; this
work does not replace an installed application.
Version 1.8.6, web cache v18600, Android version code 35.

Android APK compilation succeeds with Java 21 and SDK 36: package
`com.keepvocab.app`, version 1.8.6, version code 35, **7.74 MB**. All 81 bundled
web files match source. APK signature verification passes and its SHA-256 signing
certificate matches the published 1.8.3 debug APK, preserving update compatibility.
Android instrumentation tests compile; no Android device or emulator was available
to execute them. The Android unit-test Gradle task completes.
