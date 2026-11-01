# Batch normalization with the original label policy

Completed on 2026-11-01 for KeepVocab 1.12.19. The user selected the original
policy that produced **72.50%**. No source labels, meanings, vectors or splits
were changed. That original 32-unit L2 head is restored as the current offline
reference. New heads remain experimental; production inference is unchanged.

## Experiment

**76 configurations**, four grouped training folds each; 10 finalists repeated
across three seeds, for **96 CV runs / 384 outer-fold fits**. Adam outer fits
each include a separate inner stopping fit and a full-portion refit.

| Dimension | Cases |
|---|---|
| Optimizer / architecture | L-BFGS-B logistic regression / 32-unit MLP; matched Adam MLPs |
| Adam widths | 16, 32, 64 hidden tanh units |
| Normalization | none versus hidden BatchNorm, 30 exact matched pairs |
| Batch sizes | 16, 32, 64, 128 |
| Learning rate | broad log-random 0.00050–0.010; local refinement |
| L2 | log-random strengths and local refinement; dense biases and gamma/beta free |
| Class weighting | training-derived positive weights with tuned exponent |
| Input scaling | training-only standardization versus centered sqrt(512) scaling |
| Seeds | 7919, 104729, 130363; export always 7919 |
| Calibration / threshold | global temperature/bias and global threshold fitted from training OOF only |

The broad stage has 16 L-BFGS-B controls/random configurations and 24 Adam
plain/BN pairs. Six paired local settings refine the strongest Adam areas.
These are sampled combinations, not an exhaustive Cartesian grid. Every pair
shares all settings except BN/trial ID, including initialization, batch order
and inner group splits. The fixed baseline recipe is included. No dropout.

Training uses the unchanged 890 rows: 750 original meanings and 140 known
paraphrases. Each augmented family has total weight one. Connected meanings
and paraphrases stay together in outer folds and inner monitors. Five-fold
grouped inner stopping monitors originals only, selects epochs by BCE, then
refits the entire training portion for that fixed epoch count. Outer-fold,
validation and test examples never choose epochs.

The 48 validation meanings and both test cohorts have historical exposure.
This is a **regression experiment, not fresh blind confirmation**. No test
result selected architecture, seed, calibration, threshold or fallback model.
No test labels were revised. Candidate selection uses three-seed mean
validation F1, then exact match and BCE. Linear wins only within every declared
practical-equivalence margin; it did not pass here.

## Results on identical original labels

All experimental rows use fixed seed7919, never the best observed seed.

| Original 120-meaning test | Exact accuracy | Macro F1 | Micro precision | Micro recall | BCE ↓ |
|---|---:|---:|---:|---:|---:|
| Previous original-policy head | 72.50% (87/120) | 84.44% | 87.50% | 82.64% | 0.1554 |
| Validation-selected BN candidate | 74.17% (89/120) | 86.45% | 86.90% | 87.50% | 0.1436 |
| Plain Adam finalist selected by validation | 71.67% | 85.53% | 85.03% | 86.81% | 0.1371 |
| Logistic-regression finalist | 70.83% | 84.58% | 84.83% | 85.42% | 0.1475 |
| Historical v2 head, scored against original labels | 63.33% | 83.30% | 79.35% | 85.42% | 0.1966 |

| Other original-policy 48-meaning test | Exact accuracy | Macro F1 | Micro precision | Micro recall | BCE ↓ |
|---|---:|---:|---:|---:|---:|
| Previous original-policy head | 68.75% | 80.01% | 87.04% | 77.05% | 0.2046 |
| Validation-selected BN candidate | 70.83% | 84.00% | 87.72% | 81.97% | 0.1717 |
| Plain Adam finalist selected by validation | 64.58% | 79.62% | 81.67% | 80.33% | 0.1844 |
| Logistic-regression finalist | 62.50% | 80.61% | 80.65% | 81.97% | 0.1933 |

Plain and BN finalists in these tables need not be the same matched pair;
they are independently selected by validation. The controlled BN effect is
below. Brier, per-class counts and all probabilities remain in
[report.json](report.json).

## BatchNorm is not a reliable fix in this search

- BN improves first-seed grouped-CV F1 in **1 of 30 matched pairs**. Mean
  difference is **−1.49 percentage points**, median **−1.47**. These shared-fold,
  adaptively searched comparisons are descriptive, not independent trials.
- For the selected candidate's exact pair, three-seed CV F1 is **84.34%** with
  BN versus **85.05%** without it. The fixed baseline recipe reaches **85.67%**.
  The candidate's CV is **1.33 points below** that recipe even though the small
  validation set selects it.
- It gains only **two correct meanings** on the original test and **one** on
  the second test. This does not establish a population gain after many trials
  on historically exposed evaluation sets.
- On the 48-meaning test, entity F1 falls from **83.33% to 75.00%**, failing
  the maximum five-point per-class regression margin. Aggregate gains remain
  visible; this failing check is retained.
- The selected seeds fit training at 100%, 100% and 99.33% exact accuracy,
  while mean CV F1 is 84.34%. The generalization gap remains; this is not an
  inability to fit the training data.

**Do not replace the original-policy head with this candidate yet.** The
registry is restored to the original model because the user selected that
policy. V2 artifacts and their policy-specific results remain intact. Further
improvement needs independently reviewed original-policy examples, balanced
hard negatives for entity/relation and a new untouched grouped confirmation
set. The 97% target is not achieved.

The candidate is **512 → 64 → 6**, tanh/sigmoid, 33,222 inference parameters
versus 16,614 for the baseline. L2=0.0005099972, batch size128, Adam learning
rate0.0048498274, weighting exponent0.4276143, centered sqrt(512) scaling. Full
seed7919 refit uses epoch15 chosen by its inner monitor. No claim of measured
phone battery life or latency is made.

## Why v2 scored lower

The [post-selection diagnostic](policy-change-diagnostic.json) partitions the
original 120 meanings by whether v2 changed their targets. Both models are
scored against original v1 labels throughout:

| Original test subset | Previous head correct | V2 head correct |
|---|---:|---:|
| 94 meanings with unchanged labels | 69 | 73 |
| 26 meanings whose labels were revised | 18 | 3 |
| All 120 | 87 | 76 |

Four additional exact predictions on unchanged meanings and fifteen fewer on
revised meanings explain the net loss of eleven descriptively. This does not
prove one ontology universally correct. The user selected the original rules.
Normalization cannot reconcile different target definitions.

## Implementation and verification

BN normalizes hidden preactivations using training mini-batch moments, learns
gamma/beta, and retains EMA means/unbiased variances. It precedes tanh with
epsilon1e-5 and momentum0.1. BCE honors family weights; moments use uniform
rows, so augmented rows also affect BN moments. Validation/test never update
statistics. Running-stat normalization and gamma/beta are folded algebraically
into the preceding dense layer for inference. The portable evaluator needs no
additional mobile normalization operation. The original
[Batch Normalization paper](https://arxiv.org/abs/1502.03167) describes this
mechanism; its results do not imply gains for this small frozen-embedding task.

Python checks cover numerical gradients, objective parity, tiny-batch fitting,
reproducibility, singleton-tail handling, explicit-versus-folded BN parity,
single-example inference, family splits and validation-statistics exclusion.
JavaScript reproduces every Python test probability/confusion count for the
baseline, BN, plain, linear and historical v2 heads. `experimentalSelected` and
`batchnorm` deliberately refer to the same artifact. All L-BFGS-B folds
converged. Two Adam inner fits reached their epoch cap; stopping traces retain
this status.

A post-run review added a singleton-batch guard for the synthetic n=3,
batchSize=2 case. The [implementation review](implementation-review.json)
binds the exact [training source](trainer-source.py) and corrected library.
All 656 actual fit partitions have at least 526 rows and batch size16; their
batch partitions are unchanged by the guard. No model, choice or test result
was recomputed after this correction.

Adapter routing is regenerated with the restored baseline. Image/text vectors,
semantic labels, crop choices, pairs, groups and weights are unchanged. No
CLIP adapters or personal preference models are trained or activated.

## Replay

Use `scripts/requirements-meaning-taxonomy.txt`. In an isolated copy with these
experiment outputs removed:

```sh
python scripts/test-meaning-batchnorm.py
python scripts/train-meaning-normalization.py --phase select --workers 6
python scripts/train-meaning-normalization.py --phase evaluate
node --test tests/meaningNormalization.test.mjs
```

[Protocol](protocol.json), [broad trials](broad-trials.json), [all trials](trials.json),
[selection](selection.json) and [OOF predictions](oof-predictions.json.gz)
preserve hashes/configurations, seeds, splits and stopping histories. Scripts
refuse to overwrite frozen selection/evaluation. Selection never reads test
labels; evaluation changes neither the registry nor the chosen candidate.
