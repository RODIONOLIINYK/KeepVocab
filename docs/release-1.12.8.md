# KeepVocab 1.12.8

Adds a reproducible four-way MLP experiment: baseline, true L2, batch
normalization, and both together. CLIP stays frozen; hidden layers remain 32/16,
batch 8 and gradient clipping 1. Every run trains 600 epochs with patience stopping
disabled, while selected and final checkpoints are reported separately.

Validation pilots select L2=0.0001. All 32 full fits and four tiny memorization
checks are preserved. BatchNorm alone retains 20/21 familiar-meaning test choices
through epoch 600 across all three seeds, versus 17/21 for the final baseline.
The selected baseline already achieves 20/21; the experiment does not establish
a general first-choice improvement over that model. L2 does not improve the
BatchNorm result in this study.

Includes full training/validation/post-hoc test curves, the unchanged original
data, true zero-centered L2 checks, 40 sampled gradient checks, exact replay of six
historical baseline weight sets, and independent JavaScript verification of
144 split/checkpoint evaluations. Native and folded BatchNorm inference rankings
agree. Experimental heads remain inactive; this is a small retrospective
semantic benchmark, not a fresh personal-preference acceptance test.

Adds separate input-standardization/LR-search and product-feature-removal
follow-ups. Training-only scaling does not beat the selected baseline/BatchNorm
ranking results. Removing the 512 products leaves 1,027 inputs and 33,441 dense
parameters; selected familiar BatchNorm results remain 20/21 in all seeds.
Preserves all 28 normalization and 24 compact-input fits. Each follow-up passes
144 independent native/folded inference checks and all tiny-fit checks.

A training-only spike diagnosis shows both minibatch optimization instability
and running-statistic mismatch in BatchNorm+L2. All curves and hyperparameters
are recorded without test-driven retuning. Active app models are unchanged.

Validation: 644 automated tests; web, macOS arm64 DMG/ZIP and Android debug APK
(version code 58). No Intel or universal build was performed.

[Full experiment](https://github.com/RODIONOLIINYK/KeepVocab/blob/v1.12.8/docs/image-regularization.md).
[Input follow-ups](https://github.com/RODIONOLIINYK/KeepVocab/blob/v1.12.8/docs/image-input-followups.md).
