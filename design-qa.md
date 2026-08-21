# Shared exercise UI and Today preservation QA

- Visual source for canonical Use It: `/Users/kalyma123/Desktop/Screenshot 2026-08-21 at 13.13.49.png`
- Visual source for the reported Weak Words failure: `/Users/kalyma123/Desktop/Screenshot 2026-08-21 at 13.12.58.png`
- Canonical shared-component capture: `/tmp/keepvocab-useit-shared-mobile.png`
- Preserved Today capture: `/tmp/keepvocab-today-preserved-mobile.png`
- Tested browser viewport: 431 × 747 CSS pixels
- Source Use It image: 858 × 1410 pixels
- Source Weak Words image: 820 × 1536 pixels

## Full-view comparison

The shared component keeps the canonical manual Use It hierarchy from the approved reference: thinking Sprig, `Make it yours`, the word prompt, saved definition, large rounded textarea, full-width green `Check sentence` action, secondary `Speak instead` action, and Gemini evaluation status. Weak Words mounts this exact component rather than rebuilding its own sentence field or feedback card.

Today’s Workout remains on the separate `daily-session-shell` visual preset. Its phone capture retains the circular icon-only exit control, centered `Today's Workout` progress, right-aligned score, compact progress line, mascot, exercise label, and full-width stacked choice cards. No canonical Use It CSS or wrapper was applied to Today.

The live test library currently has zero weak words, so opening the Weak Words route would only show the empty state. The rendered Weak Words Use It surface was verified through the exact shared component used by the live manual route, plus an automated source-ownership regression that requires both routes to mount `UseItExercise`.

## Focused-region comparison

- Canonical textarea: 367 × 126 CSS pixels at a 431px viewport.
- Canonical Check button: 371px wide.
- Document width: 431px scroll width and 431px client width; no horizontal overflow.
- The textarea receives focus on entry and remains editable.
- Mobile action ordering remains `Check sentence` followed by `Speak instead`, matching the reference.
- The status copy reports that Gemini checks meaning, grammar, and naturalness.

## Behavior and code ownership

- Manual Use It and Weak Words Use It both mount `UseItExercise`.
- Manual, Weak Words, and Today Use It all call `evaluateUseItSentence`.
- Recall and recognition variants share `exerciseEvaluation` helpers instead of maintaining separate normalization/equality rules.
- Gemini evaluation is always attempted for a non-empty sentence when configured, even when a local form matcher does not recognize the spelling.
- Cross-part-of-speech forms are explicitly supported, including noun `cuddle` used as verb `cuddled`.
- Without Gemini, a non-empty sentence is saved locally and never produces an exact-headword error.
- Gemini feedback that asks for the exact word is replaced with meaning-focused guidance.

## Runtime checks

- Canonical Use It rendered nonblank at `#useit` with the expected component hierarchy.
- Today rendered nonblank at `#daily` with class `spec-card daily-session-shell` and `Today's Workout / 1 of 10 / 0 correct`.
- No horizontal overflow was found at the tested phone width.
- Browser diagnostics contained zero console warnings or errors.
- All 153 automated tests passed.
- Production web build passed.
- PWA cache and changed module URLs were advanced together to v86.

## Findings

No actionable P0, P1, or P2 issue remains in the requested Use It validation path, Weak Words component ownership, or preserved Today visual preset.

final result: passed
