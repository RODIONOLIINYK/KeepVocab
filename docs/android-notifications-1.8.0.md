# Android notifications — 1.8.0

## Setup

Install the 1.8.0 APK over the previous version, open Settings → Android
notifications → Set up notifications, choose a time, and save. Allow the Android
notification prompt. Precise timing is optional; its shortcut opens the system’s
Alarms & reminders access screen. Test notification checks immediate display.
Test with app closed schedules a separate notification for one minute later.
Press Home or swipe the app away; approximate timing can take longer.

The setup card makes the opt-in and current access visible. Tests preserve the
daily routine. Android 7/7.1 no longer aborts setup on unsupported channel calls.
The scheduler reports the plugin’s approximate-alarm fallback instead of claiming
precise timing when Android downgraded it.

Reminders use the existing local notification plugin and work offline. There is
no Firebase or push server requirement. The seven-day reminder horizon, study
cancellation, and opt-in preferences are unchanged.

## Platform sources

- [Capacitor Local Notifications](https://capacitorjs.com/docs/apis/local-notifications): native scheduling, permission APIs, channels, exactness controls, and idle delivery.
- [Android notification permission](https://developer.android.com/develop/ui/compose/notifications/notification-permission): Android 13+ runtime permission.
- [Android alarm scheduling](https://developer.android.com/develop/background-work/services/alarms): separate exact-alarm access and approximate fallback.
- [Android stopped-package behavior](https://developer.android.com/about/versions/15/behavior-changes-all#stopped-state): Force stop cancels pending intents; opening the app allows it to restore scheduling. Ordinary backgrounding and process death were tested separately.

## Validation

The release was tested with Android 16 / API 36, AOSP ARM64, in a dedicated
emulator. The Java instrumentation test executes the packaged JavaScript through
the real Capacitor bridge, without a notification mock. It verifies:

- denied access, the OS permission prompt, and immediate notification visibility;
- the Practice reminders channel, high importance, and system sound;
- seven saved approximate alarms without exact access, then precise scheduling
  after access is granted;
- scheduled delivery while the actual Activity and WebView are stopped;
- tapping the notification opens Practice;
- cancellation and actionable blocked-channel status.

Eight host-side checks verify real native delivery after the app process is killed
and after Android reboots, including the boot receiver restoring the alarm. Four
additional checks verify background delivery with exact-alarm access denied.
These checks inspect Android’s notification and alarm services, not JavaScript
timers. Logs and results are saved locally in `work/release-1.8.0/qa/`.

Other validation: 316 Node tests, 40 renderer checks each for macOS and simulated
Android, 16 notification UI checks plus the macOS platform exclusion check,
Android build/unit tests/lint, and packaged-source comparison for both installers.
The legacy Android 7 channel case has a unit regression test; it was not run on
an Android 7 device. Manufacturer-specific physical-device power restrictions
were not tested. Use the built-in background test on the intended phone.

The native instrumentation test is at
`android/app/src/androidTest/java/com/keepvocab/app/AndroidRemindersTest.java`.
Run it on a fresh dedicated emulator installation with notification and exact
alarm access initially denied. With Java 21 and the Android SDK configured:

```sh
npm test
npm run android:sync
android/gradlew -p android :app:assembleDebug :app:lintDebug :app:testDebugUnitTest
android/gradlew -p android :app:connectedDebugAndroidTest
```

Kotlin test dependencies use a BOM matching the notification plugin, resolving
duplicate standard-library classes in the previously unused instrumentation build.
The daily-budget regression test now uses the current activity day when reading
settings, so it does not fail merely because the release date has passed.

## Installers

Android version 1.8.0 has version code 29. Its signing certificate SHA-256 matches
the published 1.7.10 APK:

```text
28678699d967dc3ec933e0187870259f7966db9296c4c8af908cf552bbfa46cd
```

The universal macOS DMG/ZIP contain arm64 and x86_64 code and retain the existing
unsigned personal-build convention. Both packages contain the final notification
sources and shorter goal/month captions. The web cache is `keepvocab-v18000`.
