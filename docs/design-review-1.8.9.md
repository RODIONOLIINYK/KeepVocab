# KeepVocab 1.8.9 design review

Reviewed the actual app in Codex's in-app browser using public vocabulary fixtures
and fresh local storage, at 390 × 900 and 1280 × 900. All fourteen routes have
stable screenshots at both widths; final DOM measurements show no page-wide
horizontal overflow. Empty-library screens were separately captured at 390 px.
The report artifact contains the screenshots, comparisons and numbered notes.

## Route coverage

| Step | Screen | Result |
| --- | --- | --- |
| 1 | Today | Clear primary workout action; shortened the mobile mascot area and named the Settings icon. |
| 2 | Library | Widened cards, clarified meaning actions, labeled search, improved empty-month guidance and first-word action. |
| 3 | Progress | Balanced six outcome tiles, readable metadata contrast and wider interval labels. |
| 4 | Practice | Clear prompt, input and feedback; completed five exercises with a goal of three, then continued with three due words. |
| 5 | Weak Words | Checked choice and image prompts, resting and empty states; no layout issue found. |
| 6 | Listen & Spell | Checked input and listening controls; replaced obsolete Box 1 feedback. |
| 7 | Choose Word | Checked four choices and empty state; no layout issue found. |
| 8 | Visual Match | Checked preparation, image question and empty state; source credits remain available. |
| 9 | Match Sprint | Checked the full board at both widths and empty state; no layout issue found. |
| 10 | Flashcards | Checked reveal, four FSRS rating previews, navigation and empty state. |
| 11 | Context | Checked missing-key guidance, offline saved-example questions and correct feedback. |
| 12 | Use It | Checked input, focus visibility and empty state; no layout issue found. |
| 13 | Speaking | Wrapped mobile category filters; checked catalog, lesson preview, startup failure and completion fixture. |
| 14 | Settings | Inspected every disclosure; fixed stretched training checkbox and routine dialog copy. |

## Additional flows and fixes

15. Word editor and image chooser: checked fields, image source, custom scene and
    feedback controls. Simplified technical search instructions into learner actions.
16. Routine dialog: added dialog semantics and keyboard focus management. Verified
    initial focus, Tab wrapping, Escape and focus restoration. Corrected the false
    claim that practice stops at the daily goal. Checked desktop and mobile layouts.
17. Drive dialog: checked mobile layout and added dialog semantics. No account was
    connected during this review.
18. Add Word: checked the complete form and added a persistent accessible input name.
19. Word list: checked the bulk composer and disabled saving state.
20. Context question: verified the saved-example fallback with a simulated provider
    failure and a test key; no live Gemini request was sent.
21. Context feedback: checked the selected answer and next-sentence action.
22. Speaking preview: checked roles, expressions, lesson plan and start actions.
23. Speaking failure: found that the hidden setup button and disconnected-session
    exit path left users stuck. Setup is now visible; pending-audio copy is cleared;
    the microphone is disabled and Back to lesson returns to the preview. Verified
    with simulated microphone failure, without accessing the microphone.
24. Speaking completion: inspected a fixture transcript, summary metrics, phrases
    and navigation using the app's actual completion renderer.
25. Delete confirmation: checked the confirmation and cancelled without deleting.
26. Search with no matches: checked the filter guidance, separately from an empty month.
27. Flashcard ratings: verified Again/Hard/Good/Easy interval display at mobile width.
28. Practice feedback: checked correct-answer feedback and next-word navigation.
29. Practice completion: checked the five-answer result and Continue practice action.
30. Extra practice: verified the next three due words remain available past the goal.
31. Standalone Quick Add: inspected the separate compact composer.

Every Settings panel was opened: Review timing, AI features, Vocabulary images,
Local image learning and App updates. Shared icons now load from a pinned local
Font Awesome asset instead of a CDN, including in standalone Quick Add. Only used
icon mappings and WOFF2 fonts are retained; no new production dependency is added.
Keyboard outlines and previously faint metadata now use stronger contrast.

The meaning guide also has isolated Electron checks at 390/1280 px: concrete
situation, example and explanation, saving without altering review history,
offline reopening without another call, and useful inline provider errors.

## Evidence limits

This covers all route templates and the principal reachable states above, not
every possible combination of vocabulary, permissions and network behavior.
Screenshots do not prove full screen-reader/WCAG compliance. Live microphone,
real Gemini conversation, native Android permissions/notifications and OS update
installation were not exercised in this visual audit. The Android APK was built
and its assets and existing signing certificate were verified. The approved live
meaning test could not identify a configured key; no request was sent. Synthetic
fixtures verify UI and control behavior, not provider output quality or real-world
learning effectiveness. Fixed headers/navigation appear at the current viewport
offset in full-page screenshots; ordinary viewport captures were also inspected.
