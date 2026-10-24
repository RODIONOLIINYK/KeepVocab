# v1.9.6 design restoration and regression check

Source visual truth: user-provided `Screenshot 2026-10-24 at 13.56.35.png` (Library, 389 × 789 pixels), and committed v1.9.6 sources at `eeef4ff`.

Implementation: `http://127.0.0.1:8086/#library`, isolated local sample storage (16 meanings / 15 words, four saved photos, new/due/future schedules). No preview fixtures are included in the application release.

Evidence:
- `work/design-review/restored-library-mobile-final.jpg`: Library at CSS viewport 390 × 805; host capture 375 ×774, normalized to 390 × 805 for comparison.
- `work/design-review/restored-snapshot-comparison.png`: original snapshot and restored implementation in one comparison input. The original is normalized to 390 × 805. Content differs intentionally: sample vocabulary versus the user's 92-word archive.
- `work/design-review/restored-library-tools-mobile.jpg`: Tools visible above the archive/vocabulary cards; browser hit testing reaches the menu button.
- `work/design-review/archive-counts-regression.jpg`: the exact 92/115 and 68/87 count strings fit within their buttons at 390px; measured widths 174.36px and 171.63px. A temporary harness used the real styles and archive markup, then was removed.
- `work/design-review/local-learning-enabled-fixed.jpg`: enabled learning reports “Local learning is on” while scoring is unavailable; no false off message.

Fidelity surfaces:
- Typography: original Inter / Outfit font faces and weights restored; no new icon font.
- Layout: original header, bottom navigation, cards, Today, Library, Speaking and Progress layouts restored. Archive chips keep their 146px minimum and grow to fit longer counts.
- Colors: original theme retained; the only palette change is white text on green action buttons. Browser computed text color is rgb(255,255,255).
- Images: original logo, installed icons and Sprig artwork restored. New generated artwork is excluded from the app.
- Copy: original product copy and scheduling behavior retained; image-learning status distinguishes enabled/readiness/error states.

Comparison history / fixes:
- [P2, fixed] Monthly counts overflowed fixed-width chips in the source snapshot. Chips now use intrinsic width and the exact long strings fit.
- [P1, fixed] Library Tools could paint beneath later cards / be clipped. Visible overflow and a positioned title layer keep it usable; verified in browser.
- [P1, fixed] An unverified model installation was presented as learning disabled. Service/component regressions and browser evidence confirm the corrected state.
- [P2, fixed] Overlapping entrance delays and 320ms menu expansion felt slow. Menus now open in 180ms, and one short route entrance plus touch press/navigation feedback replaces stacked delays. Reduced-motion behavior remains supported.

Validation: 507 tests pass; primary navigation, daily practice entry, Library Tools, image review selection/cancel, and populated mobile layouts checked. Browser errors were checked during the flow; the expected unavailable local-model status is handled in the chooser.

final result: passed
