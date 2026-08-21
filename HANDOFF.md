# KeepVocab handoff

KeepVocab is a local-first browser vocabulary trainer with automatic, reinstall-safe Google Drive backup. Dictionary lookup presents distinct senses so the learner saves the exact intended meaning. Vocabulary and Leitner progress are grouped by the real month and year in which each word was added.

## AI Speaking

The Speak route contains 84 goal-based lessons across everyday life, travel, work, social, academic, and advanced tracks, including 58 B2 lessons plus adaptive free conversation. Every preview shows a five-stage Warm up → Build → Challenge → Resolve → Improve plan, role-specific questions, a realistic complication, and target phrases. Live sessions use Gemini's native-audio WebSocket API only after an explicit Start action, stream microphone audio, play the coach response, display both transcriptions, allow typed replies, and store completion progress locally. Mira opens every lesson herself, keeps turns moving with specific follow-up questions, and sends a scaffolded rescue prompt after nine seconds of learner silence.

Gemini credentials are never committed. For a private installation, save a personal key through **Speak → Gemini setup**; the centralized Google AI Studio configuration is included in the user's private app-owned Drive settings backup so it can be restored on that user's other devices. A public deployment should replace direct-key authentication with server-issued ephemeral tokens.

## Google Drive backup contract

After the learner connects Google Drive, the app creates a visible `KeepVocab Dictionary Backup` folder in My Drive. It only lists and reads files created by this app and marked with its private Drive `appProperties` metadata.

The folder contains:

- `Dictionary Month YYYY.json` — one complete vocabulary archive for each adding month, including exact meaning, part of speech, example, media metadata, original creation time, and learning progress.
- `KeepVocab Settings.json` — current month selection, daily goal, streak, review activity, learning metrics, and the private Google AI Studio configuration.
- deletion tombstones inside the relevant monthly file so a word deleted on one installation does not return from an older backup on another.

The browser database is a responsive local cache. Google Drive is the durable copy used after reinstall: connect the same Google account, and the app merges every app-owned monthly file back into the library. OAuth uses the restricted `drive.file` scope and a built-in public web client ID, so users only see the connect/synchronize action. A valid short-lived access token can survive a reload; an expired session waits for an explicit reconnect instead of contacting Drive during page startup. Local edits mark the backup as dirty, background sync is capped to one run per minute, and neither automatic nor manual sync rebuilds the active screen. Disconnecting removes the saved token.

Exercise activity is stored as per-device, per-day counters. Drive sync merges each device shard with a maximum counter and then rebuilds the aggregate `reviewActivity`, today count, and streak. This makes multi-device totals additive while repeated synchronization remains idempotent, and it migrates older unsharded `reviewActivity` into a legacy shard.

New words always use the device's current calendar month even if an older month is being viewed. Editing a card preserves its stable record identity, and the next sync updates the same monthly record instead of creating another sense.

When several dictionary meanings are selected, the Library groups them into one word card while each meaning keeps its own definition, example, image, and review schedule. Practice sessions contain at most 10 questions, prioritize weak and overdue meanings, and use at most one meaning for a spelling in a session so answer choices stay unambiguous.

Use It and workout sentence checks accept normal grammatical forms of the dictionary headword, including plurals, possessives, verb tense/participles, comparison, and common irregular forms. They do not enforce an arbitrary four-word minimum, so concise sentences such as `He's a lush.` and `I like cuddling.` are accepted. Weak Words uses the same compact answer field as the other workout exercises and gives sentence-specific feedback instead of the generic `Answer: word` response. Successful lookups always display and save the canonical spelling returned by the dictionary API; manual definitions remain an explicit fallback when no dictionary entry is available.

KeepVocab does not use an in-app notification center. When Android system notifications are enabled, it schedules the adaptive daily reminder plus an optional late streak safeguard only if the learner still has zero exercise activity that day. Completing an exercise refreshes the schedule and removes the unnecessary safeguard. Reminder preferences are ordinary settings and therefore travel through the private Drive settings backup.

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
- `js/services/imageSearch.js`: Pexels is the primary stock-photo source when a personal key is configured under Settings; the Library editor contains no credential controls. Saved provider settings are read automatically, Pexels results keep the API's relevance order, and three-word queries avoid over-specific searches. Openverse, Wikimedia Commons, Library of Congress, and NASA Images remain concurrent keyless fallbacks, with up to 10 results deduplicated and round-robin mixed by provider. The Pexels provider/key record is included in `KeepVocab Settings.json` and restored through Drive alongside Google AI Studio settings. Concrete physical-object senses use the object name itself (`wrench`, `laptops`) as the query; non-object Gemini scenes remain constrained to 5–7 concrete words showing a visible subject + action + setting, and outputs that repeat an abstract word or paraphrase its definition are discarded. The Library searches only the highlighted concept, so suggested and custom text have identical behavior; the saved image remains in a separate preview and is never injected into fresh query results. More images cycles the three visible concepts before requesting successive provider pages. The Library's single Edit flow also accepts an HTTPS image link or optimized JPEG/PNG/WebP upload; a per-meaning custom interpretation is saved in `imageCustomConcept` and searched first.
- `js/services/syncPolicy.js`: one-minute Drive sync throttle used by the background scheduler.
- `js/data/speakingLessons.js`: the structured 36-lesson speaking curriculum and Gemini coaching instructions.
- `js/components/SpeakingMode.js`, `js/services/geminiLive.js`: the responsive speaking hub, live lesson lifecycle, transcript/progress UI, and native-audio WebSocket transport.
- `icons/keepvocab-mark-v2*.png`: the shared generated logo used by the header and installed PWA.
- `assets/fonts`: local Inter and Outfit webfonts for consistent cross-platform typography.
- `sw.js`: same-origin offline caching.
