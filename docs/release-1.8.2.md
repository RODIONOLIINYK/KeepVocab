# KeepVocab 1.8.2

KeepVocab 1.8.2 upgrades the smart notification and streak reminder system to a Duolingo-style
readiness and streak-protection flow across Android and synced profiles.

## Highlights

- **Practice Mode readiness reminders (`PRACTICE_READY_ID = 73004`)**: Schedules a dedicated
  notification at the exact timestamp when vocabulary exercises become ready in Practice Mode
  (either when SRS review cards come due or when the 24-hour Practice Mode top-up cooldown
  completes).
- **Late-evening Final Call escalation**: When the daily goal is still incomplete after 20:30 local
  time, KeepVocab schedules an urgent Final Call streak rescue reminder before midnight so active
  streaks do not expire silently.
- **Default-on reminders & cross-device sync preservation**: Reminders now default to enabled on new
  installs (`reminderEnabled: true`) and track explicit opt-out (`reminderExplicitlyDisabled`) so
  syncing with a desktop browser never wipes out Android reminder preferences.
- **Native Android alarm resilience (`KeepVocabReminderReceiver`)**: Restores and reschedules daily
  study and streak rescue alarms across APK updates (`MY_PACKAGE_REPLACED`), device reboots
  (`BOOT_COMPLETED`, `LOCKED_BOOT_COMPLETED`), and clock/timezone changes (`TIME_SET`,
  `TIMEZONE_CHANGED`), and syncs reminder prefs to native `SharedPreferences`.
- **Self-healing permission & status flow**: Automatically requests notification permission on first
  study session or word addition when reminders are enabled, and verifies actual native pending
  alarms when displaying reminder status in Settings.

## Release verification

- 299 automated tests pass (`npm test`); `git diff --check` passes.
- Android `assembleDebug` and `lintDebug` succeed; package version 1.8.2, `versionCode 31`.
- Universal macOS DMG/ZIP build succeeds (`KeepVocab-1.8.2-macOS-universal.dmg` and
  `KeepVocab-1.8.2-universal-mac.zip` with `latest-mac.yml`).
