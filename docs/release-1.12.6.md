# KeepVocab 1.12.6

The current 32/16 MLP now uses an unrestricted output with **50% CLIP / 50% MLP
score fusion**. Removes the small semantic/personal residual caps and the
competing-sense positive-output clamp from current heads. Retired bounded heads
remain readable offline, but cannot initialize or replace current personal
models. Saved feedback remains intact.

Adds a shared training recipe for production, full-data training and the
small-batch check: Adam LR 0.0002, batch 8, no regularization, global gradient
norm clipping at 1, up to 600 epochs, patience 20 and minimum improvement 0.00001.
Production retains its separate 20-second worker scheduling budget. A tiny
final minibatch is merged into the preceding batch. Validation ranking now
selects checkpoints before using pairwise loss as a tie-breaker. Promotion also
requires no regression in complete held-out choice accuracy against the current
model and the baselines.

Compared eleven learning-rate/batch/regularization configurations. Larger
batches 32/64 did not improve validation first-choice accuracy in this grid.
The full unrestricted model memorizes all 385 training galleries; its final
fused training loss is 0.000788. The small batch uses identical settings and
fits all eight galleries / 28 comparisons, with loss 0.002083. Production replay
reproduces both saved checkpoints bit-for-bit.

The validation-selected checkpoint ties CLIP at 113/120 test choices; the later
overfit checkpoint achieves 111/120. The generic head remains disabled because
no first-choice improvement was established. Semantic pretraining is not an
individual user's personal-taste evaluation.

Includes complete curves/hyperparameters, sampled gradient checks, gradient-
norm monitoring, independent NumPy verification, both saved checkpoints and
separate selected/last-checkpoint empirical Brier decompositions from 16
resampled training fits. True Bayes bias and label noise remain unidentified.
No technical picker UI or labeling work was added.

Validation: 630/630 automated tests, web build, macOS arm64 DMG/ZIP and Android
debug APK (version code 56). Desktop checks do not establish phone performance.

[Full experiment and plots](https://github.com/RODIONOLIINYK/KeepVocab/blob/v1.12.6/docs/image-fusion-v2.md).
