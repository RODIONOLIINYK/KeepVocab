# KeepVocab handoff

KeepVocab is a local-first browser vocabulary trainer with automatic, reinstall-safe Google Drive backup. Dictionary lookup presents distinct senses so the learner saves the exact intended meaning. Vocabulary and Leitner progress are grouped by the real month and year in which each word was added.

## AI Speaking

The Speak route contains 84 goal-based lessons across everyday life, travel, work, social, academic, and advanced tracks, including 58 B2 lessons plus adaptive free conversation. Every preview shows a five-stage Warm up → Build → Challenge → Resolve → Improve plan, role-specific questions, a realistic complication, and target phrases. Live sessions use Gemini's native-audio WebSocket API only after an explicit Start action, stream microphone audio, play the coach response, display both transcriptions, allow typed replies, and store completion progress locally. Mira opens every lesson herself, keeps turns moving with specific follow-up questions, and sends a scaffolded rescue prompt after nine seconds of learner silence.

Gemini credentials are never committed or included in Drive backups. For a private localhost installation, save a personal key through **Speak → Gemini setup**; it remains in that browser's local storage. A public deployment must replace direct-key authentication with server-issued ephemeral tokens.

## Google Drive backup contract

After the learner connects Google Drive, the app creates a visible `KeepVocab Dictionary Backup` folder in My Drive. It only lists and reads files created by this app and marked with its private Drive `appProperties` metadata.

The folder contains:

- `Dictionary Month YYYY.json` — one complete vocabulary archive for each adding month, including exact meaning, part of speech, example, media metadata, original creation time, and learning progress.
- `KeepVocab Settings.json` — current month selection, daily goal, streak, and review activity.
- deletion tombstones inside the relevant monthly file so a word deleted on one installation does not return from an older backup on another.

The browser database is a responsive local cache. Google Drive is the durable copy used after reinstall: connect the same Google account, and the app merges every app-owned monthly file back into the library. OAuth uses the restricted `drive.file` scope. A valid short-lived access token can survive a reload; an expired session waits for an explicit reconnect instead of contacting Drive during page startup. Local edits mark the backup as dirty, background sync is capped to one run per minute, and neither automatic nor manual sync rebuilds the active screen. Disconnecting removes the saved token. The public OAuth client ID is also saved locally.

New words always use the device's current calendar month even if an older month is being viewed. Editing a card preserves its stable record identity, and the next sync updates the same monthly record instead of creating another sense.

When several dictionary meanings are selected, each meaning is saved as a separate card with its own definition, example, image, and review schedule. Choose Word and Visual Match remove duplicate spellings from each option set; Match Sprint uses at most one meaning for a spelling in a round. This lets the learner study every sense without seeing indistinguishable answer buttons.

## Run and test

```bash
python3 -m http.server 8085 --bind 127.0.0.1
node --test
```

Open `http://127.0.0.1:8085`. Keep this exact origin in the Google OAuth authorized JavaScript origins. The installed PWA keeps the same origin (including port 8085), while the service worker keeps the interface available offline.

## Main files

- `index.html`: app shell, Drive backup controls, and learning-mode launchers.
- `js/app.js`: routing, study interactions, Google Drive connection, and automatic sync scheduling.
- `js/services/driveSync.js`: local persistence, dedicated-folder Drive API access, monthly merge/restore, settings backup, and deletion tombstones.
- `js/services/dictionaryApi.js`: validated dictionary lookup, distinct senses, timeouts, offline cache, and automatic example enrichment.
- `js/services/exampleSearch.js`: sense-checked Tatoeba example assignment with source and license metadata. Multi-sense words require definition evidence, known cross-sense contradictions are rejected, and the musical `augment` sense repairs the recurring augmented-reality mismatch with a purpose-written example.
- `js/services/srsEngine.js`: Leitner scheduling and streak persistence.
- `js/components/LibraryView.js`, `ReviewView.js`, `StatsView.js`: editable monthly library, review, status lists, and box explorer.
- `js/components/PracticeModes.js`, `VisualMatchMode.js`, `MatchSprintMode.js`: active learning modes.
- `js/services/imageSearch.js`: definition-specific visual concepts, a per-meaning custom interpretation saved in `imageCustomConcept`, optional Pexels stock-photo search with a device-only personal key, no-key Openverse fallback, strict semantic relevance ranking, exclusion of images already attached to another card, duplicate/text-heavy-result rejection, and attribution metadata. The Library shows selectable concept chips; a custom concept is tried alone and first so a slower stale generated search cannot overwrite its results.
- `js/services/syncPolicy.js`: one-minute Drive sync throttle used by the background scheduler.
- `js/data/speakingLessons.js`: the structured 36-lesson speaking curriculum and Gemini coaching instructions.
- `js/components/SpeakingMode.js`, `js/services/geminiLive.js`: the responsive speaking hub, live lesson lifecycle, transcript/progress UI, and native-audio WebSocket transport.
- `icons/keepvocab-mark-v2*.png`: the shared generated logo used by the header and installed PWA.
- `assets/fonts`: local Inter and Outfit webfonts for consistent cross-platform typography.
- `sw.js`: same-origin offline caching.
