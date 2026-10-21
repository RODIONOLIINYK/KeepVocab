# KeepVocab 1.8.4: review, cleanup, and adaptive practice

## Practice behavior

The daily goal now measures progress without limiting available exercises. Today
and completed workouts offer **Continue practice** while words still need review.
Each workout stays within the configured 5–50 word batch size, with one meaning
per spelling and no filler repetitions.

Selection considers review dates, unresolved mistakes, recall strength, independent
recall on separate days, hints, response time, and selection history. All exercise
modes observe the same review cooldowns. Reliably recalled words rest until due;
recent successful retrieval also protects against stale imported schedules.
Mistakes return at their scheduled retry time. Weak Words excludes resolved
lifetime mistakes and no longer repeats words to fill a small session.

Library shows the last successful unaided recall date/time and the next eligible
review. Recognition, hints, mistakes, and older answers cannot overwrite that
recall date. Older records recover dates only when explicit unaided evidence
exists. Drive keeps the latest learning snapshot independently of later edits and
selection events, preserving factual recall dates without summing overlapping
answer counts.

## Cleanup and macOS size

The review covered application routes, exercise selection/result recording, local
persistence and Drive merging, reminders, speech lifecycle, assets/styles, offline
packaging, and desktop installers/updating.

Removed confirmed unused icons, Android launcher backgrounds, legacy scheduler
wrappers, sentence-tile utilities, obsolete styles, image/example lookup wrappers,
the retired dashboard coach controller, and a placeholder Android test. About
1.04 MB of unused web icons are excluded from every new app package. Historical
local build archives (about **5.53 GB**) were also removed; these were generated distribution files,
not saved vocabulary or application data.

The default Mac build now produces separate Apple Silicon and Intel applications,
with English and Ukrainian Electron locales. Measurements against the previous
universal app show approximately **516 MB → 247 MB installed**, a **52% reduction**.
DMG downloads shrink from about **222 MB to 112–114 MB**. Final builds measure:

| Build | Installed app | DMG download |
| --- | ---: | ---: |
| Previous universal | 515.66 MB | 221.67 MB |
| Apple Silicon | 247.23 MB | 112.13 MB |
| Intel | 246.94 MB | 114.10 MB |

These are regular-file
byte sizes, rounded to decimal megabytes; Finder's disk usage can differ.

The updater selects the matching architecture, detects Apple Silicon under
Rosetta, retains universal fallback compatibility, and removes a downloaded DMG
after staging its replacement. Releases serving installed versions through 1.8.3
still need the universal migration installer described in [App updates](updates.md).

The review also fixed Android text-to-speech initialization failures: failed
engines are released, later requests can retry, and stale callbacks cannot revive
a destroyed engine. Reminders and Library now use the same readiness rules as
practice selection.

## Validation

- **318 automated tests pass** with `npm test`; `git diff --check` passes.
- **30 Electron renderer checks pass** using an isolated temporary profile. They
  cover practice beyond the daily goal across multiple batches, accurate extra
  progress, duplicate-submit protection, resting reliable words, mistake retry
  cooldowns, no filler workouts, recall timestamps, and layouts at 360, 390, 768,
  and 1280 pixels. Desktop and mobile screenshots were visually inspected.
- Native Apple Silicon and Intel DMG/ZIP builds complete with publishing disabled.
  Packaged source, app version, binary architectures, and retained locales are
  checked against the final workspace.
- Android application and instrumentation-test Java compilation passes. The three
  new speech lifecycle tests compile; they have not been run on an Android device.

Version: **1.8.4**, web cache **v18400**, Android version code **33**. Installers
are local build outputs; no release was published and no installed app was replaced.
