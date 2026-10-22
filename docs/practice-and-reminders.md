# Practice and reminders

The Practice tab and Today’s Start workout button open the same session, using
**only the month selected in Library** in the active language. Switching months
changes the vocabulary pool; an empty month never falls back to another month.
Old all-months preferences are ignored, including restored backups. Manual
exercise modes use this same month selection.

The default daily goal is **20 exercises**, and it is a progress target. Each
workout contains up to the configured session size (5–50), even when the daily
goal is already complete. Submitted answers count immediately, including
mistakes and unfinished sessions; extra practice remains visible in daily
progress. Today and session results offer **Continue practice** whenever more
words need review. When no words are ready, Practice shows “All caught up”.
Settings → Routine & sound lets users adjust the goal and batch size separately.
Each word appears once per workout; small libraries are never padded with
repeats. Today displays the actual workout size and selected month.

Due reviews fill the session first. Meanings reviewed with FSRS-6 wait for their
actual due date; useful extra practice remains available when other meanings are
due. Unreviewed legacy words may fill remaining places after the existing learning
cooldown. Recently recalled reliable words rest until scheduled. Manual modes use
these same readiness rules. Weak Words prioritizes unresolved mistakes, respects
retry times and assigns each spelling once; lifetime errors alone cannot keep a
recovered word in that mode. One meaning per spelling is selected.

Ranking uses unresolved mistakes, recent error rate, successful recall days,
recall strength, response time, lateness and predicted forgetting risk. A validated
personal calibration can adjust priority using prior review context. A bounded priority share and saved
selection history rotate the remaining words, including when a session is
abandoned. Starting a session records selections separately from answer counts;
dashboard previews write nothing. Sessions read the latest results and schedules.

Each answer stores lifetime correct/missed counts, consecutive outcomes, per-mode
counts, independent recall attempts and successes, successful recall days, hints,
recognition successes, assisted successes, and timing totals. A bounded history
of the latest 20 outcomes supplies recent error rates; it does not store raw
answers. Library shows independent recall counts, recall days and average recall
time, the last successful unaided recall date/time, and the next review. Recognition,
hints, and later mistakes never overwrite that successful recall date. These fields
stay on the vocabulary records and use the existing Drive backup. Sync chooses the
latest learning snapshot separately from later metadata edits and selections, so
those actions cannot erase newer recall dates or schedules. Answer counts are
never blindly summed across overlapping snapshots. Old records retain their
counts and schedules; their successful-review
baseline is preserved without inventing historical independent recall days.

FSRS-6 replaces box intervals with a memory model. See [FSRS scheduling](fsrs-scheduling.md)
for stream separation, local fitting, backup and validation limits.
New words earn progressively longer intervals through independent recall on
separate days. Repeating an answer several times on one day does not establish
long-term retention. Recognition and hinted answers supply weaker evidence;
misses schedule an earlier retry. Existing established review evidence remains
usable. Every submitted answer counts once as study activity, and one exercise
protects the calendar-day streak.

With enough images among the selected words, the session uses approximately 70%
typed answers from saved descriptions and 30% Visual Match. The mix does not
change the words selected. Missing or broken images fall back to typing. The
main Practice session retains its compact card layout. Specialized exercise
modes remain optional manual choices.

## Android reminders

Reminders are opt-in in Settings → Android notifications → Set up notifications
(also available from Routine & sound). The Settings card shows whether reminders
are on and whether notification access is blocked. The dialog shows notification
permission/channel problems, pending reminder count and timing access. “Test
notification” sends an immediate device notification and verifies that Android
displays it, without cancelling the routine. “Test with app closed” saves a test
for one minute later; press Home or swipe KeepVocab away to check native background
delivery. Without precise timing, Android can delay that test. “Android settings”
opens the app’s notification settings. “Allow precise timing” opens Android’s
Alarms & reminders setting and refreshes the schedule
when the user returns. Blocked setup leaves the dialog open with actionable
feedback instead of claiming reminders were set successfully.

A dedicated Practice reminders channel supplies sound/vibration and allows users
to control this category in Android settings. The scheduler checks both app and
channel access and verifies that Android saved the pending alarms. With exact
alarm access, reminders use precise idle-safe alarms. Without it, they explicitly
use idle-safe inexact alarms; automatic refreshes do not open a permission screen.
Android may delay these inexact alarms. This uses Capacitor Local Notifications
8.3’s exactness controls, described in the [official plugin documentation](https://capacitorjs.com/docs/apis/local-notifications).
On Android 7/7.1, channel APIs are unavailable; those calls are skipped so
notifications still work on the app’s supported API 24–25 devices.

Smart timing uses the median of recent study starts, rounded to 15 minutes and
limited to 08:00–21:30. With at least three samples in each group, weekdays and
weekends use their own medians. Fixed timing uses the chosen time instead.

The app schedules seven dated daily nudges ahead and refreshes them after
activity, settings changes, focus/resume, and local midnight. After any exercise,
today’s pending and delivered reminders are removed. If a streak is still alive,
one additional evening rescue is scheduled for the next unprotected day, between
20:30 and 22:00 and at least 90 minutes after the primary reminder where possible.
Late primary times do not get a second alarm. Future nudges avoid stale streak
counts or guilt. There are at most two routine reminders per day. After seven
days without opening the app, scheduled nudges stop until the next refresh.

Reminders are Android-only. macOS and browser versions keep practice, goal and
sound preferences and hide notification controls. Delivery while closed remains
subject to Android permissions and battery/force-stop behavior. The immediate
test checks visible notification access; actual scheduled/background delivery
must also be checked on an installed Android device.

Validation covers default and custom session sizes, a 107-word backlog, practice
beyond the daily goal, progress across local days, selected and empty months, retired preference
compatibility, language isolation, distinct words, early learning cooldowns,
legacy history, recognition/hints vs independent recall, same-day repetition,
mistake retries, notification/channel denial, exact-alarm fallback, saved alarm
verification, notification test actions and Android-only controls. Renderer
checks complete a 20-word workout and confirm month selection, persistent recall
history, further useful practice after the daily goal, and resting-word states at
mobile and desktop widths.

The 1.8.0 native validation also exercises the actual Capacitor plugin on an
Android 16 emulator, including the OS permission prompt, notification visibility,
blocked channels, approximate/precise alarms, paused WebView delivery, and
notification navigation. Separate checks confirm delivery after process death
and reboot, and background delivery without exact-alarm access. See
[Android notification validation](android-notifications-1.8.0.md).
