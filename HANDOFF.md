# KeepVocab

Vanilla JavaScript vocabulary app with local storage, optional Google Drive backup,
Capacitor Android, and Electron macOS. The active course is English. Settings offers
English definitions by default and optional Ukrainian translation hints. Switching
hint languages preserves the English definitions, examples, vocabulary IDs, and
review progress. Saved language settings travel with the Drive backup.

The routed dashboard and practice components own the interface. `index.html` contains
the shared navigation and persistent modals; avoid restoring a second static dashboard.
`courseProfiles.js` migrates older installations to the supported course and strips retired
lesson state. Removed vocabulary receives deletion records so older backups cannot
reintroduce it. English speaking progress and per-device activity are merged separately.

Translation lookup and cache live in `dictionaryApi.js`; the composer is shared by the
main window and macOS Quick Add. AI, image providers, and backup remain optional.
Updates run silently and installation controls belong in Settings. Never add an update
overlay over practice. Android alone supports scheduled notifications.

The installed desktop app uses `http://127.0.0.1:8085` for Google OAuth; preserve that origin.

Validate with `npm test`, `git diff --check`, and `npm run build:web`. Release instructions
and artifact naming are in `docs/updates.md`. Use Java 21 and the configured Android SDK
for Android builds. `npm run mac:build` builds the universal macOS DMG and ZIP.
Builds are personal unsigned/debug distribution artifacts unless signing is configured;
updates must retain the installed Android signing key. Do not publish credentials.
