# KeepVocab 1.8.3

KeepVocab 1.8.3 synchronizes practice progress, daily completed exercise counts, and daily goals
across devices through Google Drive backup.

## Highlights

- **Cross-device daily goal synchronization**: Daily exercise goal changes now sync reliably between
  phones, tablets, and computers. Changes preserve the most recent timestamp per setting so later
  practice on another device never reverts a newly configured goal.
- **Accurate multi-device exercise counts**: Completed reviews and exercises for the day are tracked
  per device and aggregated seamlessly into your daily progress and streak. Practicing on your phone
  immediately contributes to the progress bar and goal on desktop upon sync without double counting.
- **Background remote progress refresh**: The app automatically pulls updated goals and activity
  from Google Drive when resumed or brought to the foreground (rate-limited safely) and periodically
  while open, ensuring up-to-date counts without requiring local data mutations to trigger a sync.
- **Seamless in-place progress updates**: Synced exercise tallies, streak counters, and daily goals
  update the active Dashboard and Stats displays in place without disruptive view reloads or losing
  user interaction state.

## Release verification

- 303 automated tests pass (`npm test`); `git diff --check` passes.
- Android `assembleDebug` succeeds; package version 1.8.3, `versionCode 32`.
- Universal macOS DMG/ZIP build succeeds (`KeepVocab-1.8.3-macOS-universal.dmg` and
  `KeepVocab-1.8.3-universal-mac.zip` with `latest-mac.yml`).
