# KeepVocab 1.9.6

KeepVocab is now more comfortable on phones, with larger readable practice tiles and touch targets, a solid bottom navigation surface, safe-area spacing, and layouts that wrap without page overflow. The main actions use a fresher green with dark, high-contrast labels. Today no longer includes the scheduling explanation disclosure.

## Mobile improvements

- Practice removes large fixed-height gaps. Short landscape screens place the clue beside the answer form, keeping the controls above navigation.
- Touch users see the clue before the keyboard opens. Explicit Next and Edit actions resume typing; desktop autofocus remains available. Recall fields disable autocorrect and provide the appropriate keyboard action.
- Software keyboard handling accounts for visual-viewport resizing, Android layout resizing, switching fields, pinch zoom, and rotation. Navigation gets out of the way while the keyboard is open, and dialogs fit within the available viewport.
- Library months scroll as readable chips, card actions have 44-pixel touch targets, and search, filters, editors, Settings, and Add Word fit narrow screens. Inputs use at least 16-pixel text to avoid iOS focus zoom.
- Flashcards size the visible face naturally, ratings use two columns on phones, and speaking controls flow above transcript content.
- Offline precaching includes the mobile stylesheet and viewport helper while omitting native-only menu-bar images from web precaching. Native menu-bar assets remain packaged.

Validation: 502 tests passed, including viewport and touch-focus regressions. Browser checks covered Today, practice, Library, Add Word, Settings, and flashcard reveal; widths included 320/360/390/430, 768-pixel tablet, and 667×375 landscape. These are browser viewport and simulated keyboard-event checks, not a claim of physical-device keyboard testing.

Includes the FSRS-6 scheduling corrections from 1.9.5: same-day steps remain pending until due, later-today reviews stay in the plan, and tomorrow's forecast counts words across their saved meanings separately from deferred backlog.
