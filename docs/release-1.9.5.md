# KeepVocab 1.9.5

Today now uses a quieter leaf-green palette that matches the existing book-and-sprout identity. A compact mascot supports the main action, and three equal plan cards consistently show icons, counts, and labels. Daily goal progress and vocabulary health use the same typography, spacing, and restrained surfaces. Phone layouts keep the mascot beside the heading rather than in a separate oversized panel.

The design was checked against actual product screenshots in Duolingo’s [2026 core-tab design refresh](https://blog.duolingo.com/core-tabs-redesign/), using its emphasis on clear hierarchy and intentional whitespace as reference. KeepVocab retains its own logo and character.

## Scheduling corrections

- Correct answers preserve FSRS-6 learning steps due later in the same study day. Today and session results distinguish ready practice, pending reviews, and a completed plan; pending screens refresh when the next review opens.
- Plans reserve reviews due later today without starting them early. A saved meaning stays selected through its short learning steps, and recognition or assisted answers lead to typed recall in the next regular workout.
- Revise tomorrow is an actual saved-due-date forecast for the next local 8 AM–8 AM study day. Deferred backlog has a separate count. Day boundaries preserve 8 AM over daylight saving changes.
- Existing plans recompute once under snapshot version 2. Stored vocabulary and FSRS memory remain intact; the pinned FSRS-6 algorithm and parameters are unchanged.

The selected Library month supplies up to the configured 5–50 distinct words (20 by default). When both groups are available, roughly 30% of plan places go to new words and the rest to revision; unused places flow to the other group. Urgency considers due status, predicted recall, mistakes, and lateness. The exercise goal remains separate from plan size. See [FSRS scheduling](fsrs-scheduling.md) for details.

## Icons and validation

The Font Awesome Free bundle now includes every icon used in the app, including Learn today and Revise tomorrow. Maintenance fails for missing or Pro-only icons, with regression checks for mappings, free styles, and offline fonts.

Validation: 485 automated tests passed; web assets built; Today checked at desktop and phone widths, including visible plan icons, the schedule disclosure, and launching the scheduled workout. macOS distribution is Apple Silicon (`arm64`) only; Android retains the existing debug signing identity.
