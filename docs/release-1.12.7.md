# KeepVocab 1.12.7

Adds a reproducible, photo-disjoint test of the same-meaning hypothesis. Both
MLP arms share 170 background galleries and use 21 matched additional meaning
examples each. Validation and test each contain 21 identical target galleries
for both arms; each target meaning occurs in the seen arm's training data.

Luna/Terra review records preserve 807 candidate judgments across 168 galleries.
Twenty-one of 51 proposed target/control groups pass strict confirmation.
All original source records, split assignments and encoder datasets remain
unchanged and available for reproduction/future training; disagreements are
stored separately for adjudication.

CLIP and both validation-selected MLP arms score 20/21 test choices in all three
seeds. Final fitted heads score 17–18/21. Same-meaning overlap did not improve
selected ranking here; the small retrospective sample cannot identify the
principal cause of real-app failures or establish equivalence.

CLIP stays frozen. The 32/16 MLP architecture and shared optimizer recipe are
unchanged. No experimental head is activated or shipped. Includes full curves,
paired uncertainty, saved offline weights and independent NumPy verification
of all 36 split/checkpoint evaluations.

Validation: 634 automated tests; web build, macOS arm64 DMG/ZIP and Android debug
APK (version code 57). No Intel or universal build was performed.

[Full experiment](https://github.com/RODIONOLIINYK/KeepVocab/blob/v1.12.7/docs/image-meaning-shift.md).
