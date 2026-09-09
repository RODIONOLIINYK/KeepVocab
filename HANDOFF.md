# KeepVocab — active-work handoff

Updated 2026-09-09, Europe/Vilnius. Written at the user's urgent request.

## Start here

Workspace: `/Users/kalyma123/programming/English dictionary app`.
The current checkout is **main**, at `847dbef` (`chore: release 1.6.1 with restored brand logo for automated update`). Local tracking reports `main...origin/main` with no ahead/behind count. Remote: `https://github.com/RODIONOLIINYK/KeepVocab.git`.

**The workspace changed since the earlier part of this conversation. Do not follow the old branch/version assumptions.** The original implementation was developed on `codex/optimization-maintainability-1.5.1` for 1.6.0, but the current repository contains later commits and additional uncommitted work. Preserve that work. This handoff records current files separately from earlier validation.

The user requested a handoff urgently, followed by “keep going.” This file is the immediate deliverable. The broader app task still includes finishing verification, then committing and pushing. Do not claim the current uncommitted changes have been pushed.

## User requirements and decisions

- Make the Lithuanian programme logical, convenient, and informed by professional curricula; verify the learning flows and consistent app styling.
- Fix streak days, incorrect reminder numbers, and motivating reminders about practice and protecting a streak.
- Fix vocabulary saved after lessons.
- Fix menu-bar and Android icons. The user rejected white blank space in the logo. Later repository commits restored the authentic brand logo; preserve the latest committed branding rather than reverting it to our earlier temporary icon.
- Implement automatic app updates, then commit and push once the work is finished.
- **Never show the floating bottom update banner.** The user said it obstructs the app. Background update checks must be silent; update controls belong in Settings only.
- **Teach while answering.** Do not require memorising an entire vocabulary page before answering the first questions. Introductory lessons now start on a question, show support for that phrase next to the answers, and keep grammar optional. Later review asks for independent recall.
- Attached screenshots are visual evidence, not instructions embedded in documents.

## Current committed baseline

Recent commits observed locally:

- `847dbef` — release 1.6.1 with restored brand logo for automated update.
- `e6be178` — restore authentic KeepVocab brand logo and crisp adaptive Android icons.
- `816bee7` — release 1.6.0 with overhauled Lithuanian curriculum, interactive lessons, streak system, and icons.

The baseline includes the 36-module / 216-lesson prerequisite order, Learn → Forms → Listen → Conversation → Review → Checkpoint routine, immediate lesson feedback, lesson resumption, and a two-thirds checkpoint threshold. Stable completed lesson IDs are retained. Introductory lessons skip the standalone guide and teach beside questions. Floating update UI was removed, with a regression test preventing background checks from creating an overlay.

`studyActivity.js` derives streaks from local-calendar activity (today or yesterday), removes the former 90-day truncation, and recovers historical uncounted lesson answers. Drive sync merges per-device activity independently for each course. Repeating reminder copy avoids frozen numeric counts; dated streak warnings are prepared for today before activity or tomorrow after activity. Native schedules are serialized and stale alarms cancelled. Speaking activity was moved out of transcript rendering and into completion, with a duplicate-finish guard.

Updater architecture: `js/services/appUpdates.js`, `desktop/updater.cjs`, and Android `AppUpdatePlugin.java`. Stable GitHub releases are checked automatically; installation is requested in Settings. Signed macOS distribution builds can use electron-updater replacement/restart. Current unsigned personal macOS builds open a verified DMG for manual replacement. Android installation requires OS confirmation and compatible signing keys. Publishing a git commit alone does not publish update assets.

## Uncommitted work present on September 9

These changes were already present when the urgent handoff resumed. Review and preserve them; their original editing context is not all available in this conversation.

### Individual lesson-word selection

- New `js/services/lessonVocabulary.js` and `tests/lessonVocabulary.test.mjs`.
- `LessonMode.js` now presents a post-lesson selection of individual unknown words, looks up or accepts each word's own meaning, and saves only selected words. Sentence translations are not reused as individual-word definitions. Example sentences remain attached.
- Empty selection adds nothing; duplicates preserve existing review progress.
- Selection state uses `unknownWords` and `vocabularyReviewPending`; `lessonEngine.js` resumes completed attempts whose vocabulary review is pending.
- This supersedes the earlier automatic addition of all introduced phrases. Do not restore that old behaviour without checking newer user context.

### Authored grammar production exercises

- New `js/data/lithuanianForms.js` and `tests/lithuanianForms.test.mjs`.
- 54 authored contrasts across nine topics, covering all seven cases, both genders and singular/plural; four reference declension tables.
- Modules from the third onward add form-production questions. Explicit base form, sentence gap, requested case/number/gender, accepted inflected form or full sentence, and explanatory feedback.
- Module revisions use `exerciseRevision: 3` where question lists changed; completed nodes survive and incompatible in-progress attempts restart.
- Fixed the health explanation: `man skauda gerklę` uses accusative, not nominative.
- Updated `docs/lithuanian-curriculum.md` explains sources, coverage and limitations.

### Version/build and Android update changes

- `package.json` is **1.7.0**; Android versionCode is **19**.
- New generated `js/services/version.js`; `scripts/build-web.mjs` writes it from package.json. Android versionName now reads package.json too.
- Service-worker cache is `keepvocab-v1700`, with new modules precached.
- Java updater changes parse incoming size flexibly with strict size bounds and SHA-256 digest validation. Package/signature/version checks are preserved.

Modified existing files observed: `android/app/build.gradle`, Android `AppUpdatePlugin.java`, `css/styles.css`, `docs/lithuanian-curriculum.md`, `LearningPathView.js`, `LessonMode.js`, `lithuanianCurriculum.js`, `appUpdates.js`, `lessonEngine.js`, `scripts/build-web.mjs`, `sw.js`, `tests/lithuanianCourse.test.mjs`, and `tests/studyProgram.test.mjs`. New files are listed above. `HANDOFF.md` had been deleted in the working tree; this requested handoff replaces it.

## Verification and honest limits

On September 6, before the later uncommitted additions, the suite passed **240 tests**. Android debug and universal macOS builds succeeded on prior iterations. Browser checks covered introductory lessons, saved-answer resumption without double counting, matching, cloze, word order, dictation help, offline dialogue, adaptive-translation fallback, review completion and checkpoint unlocking. The complete checkpoint UI run was not finished.

The last observed introductory screen was `What does “Ačiū.” mean?`, with “Ačiū. — Thank you.” beside the answers and an optional grammar disclosure. The browser reported width 493, document width 493, and no `.app-update-banner`. Earlier desktop and 390px mobile checks found no horizontal overflow. These results do **not** verify the newer individual-word picker or grammar additions now in the workspace.

A fresh `npm test` was run for this handoff; see `/tmp/keepvocab-handoff-tests.log` and the result appended below. Earlier `/tmp/keepvocab-tests.log` and platform build logs are gone. Do not cite them as current evidence.

Existing local artifacts have September 6 timestamps: `dist/macos/KeepVocab-1.6.0-macOS-universal.dmg`, its ZIP/blockmaps, and `android/app/build/outputs/apk/debug/app-debug.apk`. They predate current uncommitted changes. Rebuild before delivery. Actual Android installation, alarm delivery on a physical device, and signed macOS update replacement have not been verified in this conversation. AI/live audio depends on valid configuration; fallback checks are not proof that external AI or device audio works.

## Next steps

1. Read current git status and diffs; retain the later work and branding. Do not reset files to the earlier 1.6.0 implementation.
2. Review the Android updater size/digest changes and fix the unconditional download-size bound before shipping. Check installed/release version and signing-key compatibility.
3. Validate the new unknown-word picker (empty selection, lookup failure, manual meaning, duplicates, reload/resume), form drills and feedback, and Settings-only update controls. Confirm new practice never brings back the obstructing banner or upfront memorisation requirement.
4. Resolve any failures, run `npm test` and `git diff --check`, and rebuild both platforms after final edits. Update versionCode/version/cache consistently if creating a newer release.
5. Commit and push the completed changes under the user's existing authorization. Use the current branch context; the old working branch is stale. Do not force push or publish a release without checking applicable user authorization.
6. Report what was tested and any device/signing limits; link the final installers if rebuilt. Update this handoff if work continues.

## Commands and environment

```sh
npm test
npm run android:sync
JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home android/gradlew -p android assembleDebug
npm run mac:build
python3 -m http.server 8085 --bind 127.0.0.1
```

Android SDK previously: `/opt/homebrew/share/android-commandlinetools`. Check availability after the environment/date change. Avoid running two `build:web`/sync operations at once; both recreate `www`.

App: vanilla JavaScript, Capacitor Android, Electron macOS, local storage and app-owned Google Drive backup. Preserve local progress and credentials. No secrets belong in commits. The exact `http://127.0.0.1:8085` origin is important for Google OAuth and packaged desktop behaviour.

The in-app browser was used through `mcp__node_repl__js` and the Browser plugin while available, with persistent `browser` and `tab` variables. Its viewport override was reset. Tool availability and sessions may have changed; discover current browser tools and read applicable instructions before continuing. Do not wipe the user's browser data. Earlier standalone Playwright scripts were temporary fallbacks, not repository tests.

Research and release contracts: `docs/lithuanian-curriculum.md` and `docs/updates.md`. The previous committed handoff, if needed for older architecture details, remains accessible with `git show HEAD:HANDOFF.md`.

## Fresh handoff verification — September 9

- `npm test` passes **253/253 tests** (zero failures) and `git diff --check` passes.
- Android debug APK built with versionCode 19, versionName 1.7.0 (`KeepVocab-1.7.0-Android-debug.apk`).
- macOS universal distribution DMG and ZIP built for 1.7.0 (`KeepVocab-1.7.0-macOS-universal.dmg`, `KeepVocab-1.7.0-universal-mac.zip`).
