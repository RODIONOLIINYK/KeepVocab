# Practice and reminders

The Practice tab and Today’s Start workout button open the same session. The
compact card design from 1.7.4 is restored, including the keyboard icon, saved
definition block, plain answer field, progress row, and compact feedback. Practice
restores the previous due-word eligibility rule with a ten-word limit. Each
word appears once per session; a small due pool makes a shorter session rather
than being padded with repeats. A correct answer postpones the word according to
its review statistics and strength of recall. A missed answer schedules an earlier
review, but it cannot return before that time. The next session reads the latest
saved results and review dates.

Among due words, recent unresolved mistakes, error rate, recall strength and
lateness set priority. Earlier mistakes lose influence after successful answers.
A bounded priority share and persisted selection history rotate the remaining
due words, including when a session is abandoned. Starting a session records
selections separately from answer counts; dashboard previews write nothing.
Typing and visual answers both update the same Practice mode statistics. Legacy
review results and schedules remain usable. Only one meaning per spelling is
selected, and the Library course/month still bounds the pool. When no words are
due, Today and Practice show “All caught up” rather than repeating completed words.

With enough saved images available among the selected words, a ten-task session
contains seven typed answers from the saved descriptions and three Visual Match
questions. The exercise mix never changes which words were selected. Missing or
unloadable images fall back to typing the word from its description. The main
practice session includes no listening, context gaps, meaning choices, Use It,
or Weak Words exercises. Specialized modes remain optional manual choices.

The streak message and routine controls are in Settings. Today retains its
compact progress and streak counters. Each submitted answer counts once as
study activity, and one exercise protects the calendar-day streak.

Reminders are opt-in on Android in Settings → Routine & sound. macOS has goal
and sound settings only.
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

Validation covers the restored word selection, description and visual task mix,
tiny libraries, missing or broken images, weekday/weekend timing, suppression after activity, native alarm
replacement, Android-only availability and cancellation. Device-level
notification delivery requires checking an installed build on the target OS.
