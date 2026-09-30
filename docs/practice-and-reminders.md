# Workouts and reminders

Today’s Workout selects up to 10 distinct words from the active Library month
and presents each twice. The first round blends word, meaning, and available
image recognition. The second asks for typed recall, listening, or a gap in a
saved example. Gaps only appear when the example contains the target word or
one of its forms; they request the saved base word. Words without images or
usable examples fall back to supported exercises. A single-word library has
two recall exercises rather than a multiple-choice question with one answer.
Later workouts vary the skill a word used on its last visit.

Use It and Weak Words remain standalone choices in Manual practice. The workout
still gives due vocabulary and recent mistakes priority when selecting words.
Each submitted answer counts as one study activity; rapid repeat clicks cannot
count it twice. One exercise is enough to protect the calendar-day streak.

Reminders are opt-in in Settings → Routine & sound, or Today → Set a reminder on Android. macOS has goal and sound settings only.
Smart timing uses the median of recent study starts, rounded to 15 minutes and
limited to 08:00–21:30. With at least three samples in each group, weekdays and
weekends use their own medians. Fixed timing uses the chosen time instead.

The app schedules seven dated daily nudges ahead and refreshes them after
activity, settings changes, focus/resume, and local midnight. After any exercise,
today’s pending and delivered reminders are removed. If a streak is still alive,
one additional evening rescue is scheduled for the next unprotected day, between
20:30 and 22:00 and at least 90 minutes after the primary reminder where possible.
Late primary times do not get a second alarm, and an already-passed rescue time
is not repeatedly rescheduled. The rescue opens practice and asks for one
exercise before midnight. Weekly milestone copy encourages the next small win.
Future nudges use gentle comeback copy without stale streak counts or guilt.
There are at most two reminders per day. Reopening the app refreshes the rolling
seven-day schedule; after seven days without opening it, scheduled nudges stop.

Android uses Capacitor Local Notifications and can deliver while the app is
closed, subject to system permissions and alarm/battery restrictions. Reminders
are Android-only. macOS contains no notification scheduling, permission request,
or reminder controls; its routine dialog keeps goal and sound preferences.
The browser version also hides reminder controls.

Validation covers two-pass scheduling, exercise variation, tiny libraries,
unusable clues, weekday/weekend timing, suppression after activity, native alarm
replacement, Android-only availability and cancellation. Device-level
notification delivery requires checking an installed build on the target OS.
