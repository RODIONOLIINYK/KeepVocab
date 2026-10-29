# KeepVocab 1.12.5

Adds reproducible MLP retraining and diagnostics for the current FP16-text /
FP32-vision MobileCLIP encoder. All 1,736 original public photographs were
SHA-256 verified and re-encoded; historical Q8 features were not retagged.

The fixed 1,539→32→16→1 MLP was trained on 1,459 comparisons in 385 galleries.
Validation contains 475 comparisons/133 galleries; test contains 456/120.
Validation loss selected epoch 12, and early stopping ended training at epoch 16.
CLIP plus MLP matches 110/120 reviewed test choices versus 113/120 for the app
CLIP ranker, so the candidate remains disabled and is not used for personal
initialization. This is a semantic-correctness regression benchmark, not an
individual user's taste or a new blind evaluation.

The numerical fitter is shared between production and offline diagnostics;
default fitting reproduces the unmodified 1.12.4 trainer's weights bit-for-bit.
Production split/minimum-data/acceptance guards remain in place. The small-batch
check memorizes eight initially misranked training galleries and all 28 pairs,
with loss reaching the bounded-score floor. Sampled finite-difference checks
cover all three layers and explicitly record nondifferentiable boundaries.

Includes training/validation/post-hoc test curves, exact hyperparameters, a
24-training-family-bootstrap empirical Brier decomposition, independent NumPy
metric verification, current feature/candidate snapshots and reproduction tools.
True Bayes bias and irreducible label noise are not identifiable from the fixed
labels. No technical picker UI or user labeling tasks were added.

Validation: 623 automated tests, web build, macOS arm64 DMG/ZIP and Android debug
APK (version code 55). Local desktop results do not establish phone performance.

[Full experiment and plots](https://github.com/RODIONOLIINYK/KeepVocab/blob/v1.12.5/docs/image-mlp-fp16.md).
