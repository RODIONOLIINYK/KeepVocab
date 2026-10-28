# KeepVocab 1.12.0

Fixed an image recognition bug: MobileCLIP's vision tower now uses the full
precision required by its author. The text tower stays quantized. Earlier builds
forced 8-bit vision and damaged image/text alignment. Old feedback is retained,
while incompatible cached vectors and weights are excluded from new learning.

- Expanded semantic pretraining data to 2,390 comparisons across 237 meanings,
  638 galleries, 1,736 distinct photos and 19 domains. Luna agents reviewed all
  resumed/extended galleries blindly; Terra and the root agent independently
  checked 104 galleries. Ambiguous and conflicting labels were excluded.
- Compared raw CLIP, the app CLIP ranker and CLIP plus the selected 32/16 MLP on
  120 frozen test galleries: **101, 107 and 105 correct choices**, respectively.
  The MLP did not show a reliable improvement and remains disabled. Rejected
  hidden layers are no longer used to initialize personal learning.
- Separated public meaning-correctness training from private photo preferences.
  Accepted semantic weights stay fixed while a separate personal correction learns
  from ordinary saved choices. No new labeling tasks or technical UI were added.
- Added reproducible source hashes, blind review records, disjoint source/meaning
  partitions, independent precision checks and regression tests.

Validation: all 587 automated tests passed, actual corrected CLIP encoders on the reviewed photo
fixture, fixed-recipe MLP training, Apple Silicon-only macOS DMG/ZIP and Android
debug APK. Android version code: 50. No physical-phone performance claim.

[Detailed results and limits](image-pretraining-v2.md).
