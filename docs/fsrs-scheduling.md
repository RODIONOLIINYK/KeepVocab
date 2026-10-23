# FSRS-6 review scheduling

KeepVocab uses the 21-parameter FSRS-6 implementation from
[ts-fsrs 5.4.2](https://github.com/open-spaced-repetition/ts-fsrs/tree/v5.4.2).
The pinned, licensed browser bundle is about 21 KB. No model download or API is
needed to schedule a review or fit personal memory parameters.

## Evidence and intervals

Each meaning has separate recall, recognition and assisted memory states.
Recognition and correct answers with hints do not extend established unaided
recall intervals. Failures bring practice forward. Flashcard ratings use the same
stream and configuration for their interval previews and actual answers; image
prompts count as assistance. Automatic correct answers usually receive Good;
speed alone cannot earn Easy. Flashcard timing ends when the answer is revealed.

Existing memory estimates and saved due dates migrate without inventing dated
reviews. Newly reviewed meanings follow their FSRS due date rather than arbitrary
daily top-ups. The daily goal remains a progress target: continue whenever more
words need review. Workouts show the most urgent reviews first; recent answers
with future due dates rest until scheduled. Recall statistics stay saved without
cluttering the Library cards.

Settings → Review timing controls desired retention (80–97%, initially 90%),
automatic fitting and manual fitting. Higher targets generally mean more reviews.
Changed targets affect future scheduling; fitting preserves current due dates.

## How Today chooses words

The study day runs from **8:00 AM to the next local 8:00 AM**. Its first evaluation
locks up to the configured session size (5–50 distinct spellings, initially 20)
from the month selected in Library. It reserves reviews due later that study day,
but practice starts only at their saved due times. When both reviewed and new
words are available, the plan reserves about 30% of places for new words and uses
the rest for revision, filling unused places from the other group. Priority uses
due status, predicted recall, unresolved mistakes, recent errors and lateness;
ties use due time, previous answer time and a stable word ID. The daily exercise
goal records activity separately and does not change an FSRS due date.

Learn today means a planned spelling without prior practice history. Revise today
means a planned spelling with earlier practice, or a new word missed today.
Only ready words become exercises. Words on a short learning cooldown stay
pending in the plan, with the next available time shown on Today and the session
result. **A correct answer does not finish the word for today if FSRS still needs
another step before 8:00 AM.** A new word rated Good normally returns in 10
minutes; Again normally returns in 1 minute, and a failed established review has
a 10-minute relearning step. Later intervals come from FSRS memory state and
desired retention. Recognition or hinted success still needs unaided recall and
cannot extend an established recall interval. These short steps follow the
[pinned upstream defaults](https://github.com/open-spaced-repetition/ts-fsrs/blob/v5.4.2/packages/fsrs/src/constant.ts).
After a recognition or assisted answer, the next regular workout uses typed
recall for that meaning rather than repeatedly selecting another image prompt.

Revise tomorrow counts distinct spellings with at least one practiced meaning due
in the **next** 8:00 AM–8:00 AM study day. It checks all saved meanings, even when
today's plan chose a different meaning of that word. This forecast changes with future answers; it
does not assume every successful word returns tomorrow. Untouched overflow and
overdue words outside today's bounded plan appear as a separate deferred count,
ready for a later plan. Finishing a word does not silently replace it with that
backlog. Calendar boundaries preserve local 8:00 AM through daylight saving changes.

## Local personal fitting

This is KeepVocab's bounded coordinate-search fitter around the official FSRS
equations, **not** the upstream Rust optimizer. All 21 coefficients are eligible
for fitting within official bounds, with four decreasing-step passes and an L2
anchor to current parameters. Same-day answers update memory state but do not
count as independent spaced prediction observations. Day differences match the
library's UTC calendar-day convention.

Each stream needs at least 400 spaced observations, 50 distinct meanings and 30
examples of each remembered/forgotten outcome. Whole histories for at most 1,000
meanings and 6,000 events bound worker CPU use. The earliest 80% of observations
train the candidate; later observations validate it. Validation needs at least
60 observations with five of each outcome. Adoption requires log loss to improve
by at least 1% (and 0.002 absolute), with Brier score worsening by no more than
0.001. The uncalibrated memory predictions must pass this gate separately, so
priority calibration cannot hide a regression in interval predictions. Otherwise
current parameters remain active.

A separate regularized linear logistic residual can use 23 pre-answer features:
word/phrase length, four part-of-speech flags, previous errors and consecutive
outcomes, prior unaided success and hints, past response times/confidence,
recognition/assistance history, confusions, recall days, elapsed time, local time
of day, session position and a bias. Current-answer outcomes never enter their
own prediction. The residual has a bounded logit contribution, must pass its own
held-out improvement gate, and adjusts priority only; FSRS determines intervals.
We do not arbitrarily add features to FSRS's 21 memory parameters.

Every answer is recorded immediately. Automatic fitting runs after 30 seconds of
inactivity once at least 100 new events exist since the previous attempt. A worker
keeps fitting off the interface thread, with a 60-second timeout. Settings exposes
revision, changed coefficient count, actual L2 delta and held-out loss.

## Storage and sync

IndexedDB retains up to 50,000 dated review events, loaded only for training,
backup or diagnostics rather than held in RAM at startup. Records include dates,
grades, recall channel, hints, timing, confidence when available, session context,
source-meaning fingerprint and memory transitions. They exclude raw learner
answers and API keys. If IndexedDB is unavailable, a visible warning explains the
limited 1,000-event fallback. Current word schedules still use normal storage.

Private Google Drive backups use device-owned review-history files. Sync unions
event IDs across devices and replays matching meaning histories chronologically;
metadata edits and answers arriving during backup are retained. Historical
aggregate practice counters still use the existing snapshot merge policy.

## Validation limits

Tests compare scheduling to the pinned library, check separate streams,
idempotency, restarts, offline sync and rejection of insufficient or worse fits.
On a controlled synthetic population of 4,200 events, 15 coefficients changed
(L2 delta 4.699219), with later-review log loss 0.303532 → 0.269374 and Brier score
0.088464 → 0.082150. A real browser worker reproduces and persists that result.
These checks demonstrate a functioning fitting pipeline; they do not establish
better retention on the user's actual vocabulary. That needs future real reviews.
