# KeepVocab 1.12.13

Adds the reviewed six-category meaning dataset and an offline classifier-training
pipeline. A three-stage random/refined search tests 152 configurations with
grouped cross-validation, then selects on a separate validation split.

The validation-selected 512 → 32 → 6 tanh/sigmoid classifier scores 85.30%
macro-F1 and 59/77 exact label-set matches on the held-out test meanings. The
tuned logistic-regression alternative scores 83.74% macro-F1. Both retain all
six category estimates. The small sample does not establish a reliable nonlinear
advantage or deployment readiness; labels are AI-reviewed pilot annotations.

Preserves the existing app's CLIP filter and personal model. The new classifier
is an offline artifact, not automatically enabled. No CLIP adapters are trained.
The project plan records image/text adapter comparisons, category-aware prompts,
valid hard negatives, personalization, and a reviewed mild-crop experiment.

Includes gradient checks, portable JS/Python inference parity, provenance and
family-isolation audits, and full experiment records. macOS release builds remain
arm64 only. Android version code: 63.

Validation: 663 automated tests pass; web, macOS arm64 DMG/ZIP and Android debug
APK builds succeed. Release asset SHA-256 checksums were verified.

See [the training report](https://github.com/RODIONOLIINYK/KeepVocab/blob/v1.12.13/docs/meaning-taxonomy-training/README.md) for metrics,
hyperparameters, stopping criteria, reproducibility and limitations.
