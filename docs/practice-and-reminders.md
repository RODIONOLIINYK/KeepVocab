# Practice and reminders

The Practice tab and Today’s Start workout button open the same session, using
**only the month selected in Library** in the active language. Switching months
changes the vocabulary pool; an empty month never falls back to another month.
Old all-months preferences are ignored, including restored backups. Manual
exercise modes use this same month selection.

The default daily goal is **20 exercises**. Each workout takes the smaller of the
configured session size (5–50) and today's remaining daily goal. Submitted
answers count immediately, including mistakes and unfinished sessions. Once the
goal is reached, Today and Practice show “Daily goal complete”; optional manual
modes remain available. The daily allowance resets at local midnight and is
shared across months within each language. Settings → Routine & sound lets users
adjust their goal. Each word appears once per workout; small libraries are never
padded with repeats. Today displays the actual workout size and selected month,
rather than presenting the full overdue backlog as today's assignment.

Due reviews fill the session first. If fewer words are due, still-learning words
can fill remaining places after at least 24 hours without an answer, provided
there are fewer than three successful recall days (including the established
legacy review baseline). Recent answers, pending mistake retries and mastered
words are never used as early filler. One meaning per spelling is selected.

Ranking uses unresolved mistakes, recent error rate, successful recall days,
recall strength, response time and lateness. A bounded priority share and saved
selection history rotate the remaining words, including when a session is
abandoned. Starting a session records selections separately from answer counts;
dashboard previews write nothing. Sessions read the latest results and schedules.

Each answer stores lifetime correct/missed counts, consecutive outcomes, per-mode
counts, independent recall attempts and successes, successful recall days, hints,
recognition successes, assisted successes, and timing totals. A bounded history
of the latest 20 outcomes supplies recent error rates; it does not store raw
answers. Library shows independent recall counts, recall days and average recall
time. These fields stay on the vocabulary records and use the existing Drive
backup. Old records retain their counts and schedules; their successful-review
baseline is preserved without inventing historical independent recall days.

The scheduler no longer forces a 3/7/14/30-day gap just because a box advanced.
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

Reminders are opt-in in Settings → Routine & sound. The dialog shows notification
permission/channel problems, pending reminder count and timing access. “Test
notification” sends an immediate device notification without cancelling the
routine. “Android settings” opens the app’s notification settings. “Allow precise
timing” opens Android’s Alarms & reminders setting and refreshes the schedule
when the user returns. Blocked setup leaves the dialog open with actionable
feedback instead of claiming reminders were set successfully.

A dedicated Practice reminders channel supplies sound/vibration and allows users
to control this category in Android settings. The scheduler checks both app and
channel access and verifies that Android saved the pending alarms. With exact
alarm access, reminders use precise idle-safe alarms. Without it, they explicitly
use idle-safe inexact alarms; automatic refreshes do not open a permission screen.
Android may delay these inexact alarms. This uses Capacitor Local Notifications
8.3’s exactness controls, described in the [official plugin documentation](https://capacitorjs.com/docs/apis/local-notifications).

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

Validation covers default and custom session sizes, a 107-word backlog, remaining
daily allowance, local-day reset, selected and empty months, retired preference
compatibility, language isolation, distinct words, early learning cooldowns,
legacy history, recognition/hints vs independent recall, same-day repetition,
mistake retries, notification/channel denial, exact-alarm fallback, saved alarm
verification, notification test actions and Android-only controls. Renderer
checks complete a 20-word workout and confirm month selection, persistent recall
history, and the daily completion state at mobile and desktop widths.
