# Compact joint heads: hyperparameters, losses and calibration

Completed on 2026-11-01 for KeepVocab 1.12.21. This refinement keeps the original
six-label policy, all labels/definitions, embedding vectors and splits fixed.
The primary target remains **more than 90% exact label-set accuracy**. It was
not achieved. There is a small improvement in original-test F1 and probability
loss, with unchanged exact accuracy. No classifier, registry, routing cache,
CLIP adapter or production preference model is activated or replaced.

## What was varied without growing the head

**128 training configurations**: 80 broad/control settings and 48 local
refinements. Six configurations repeat three seeds, for **140 CV runs**, each
with four outer fits and four separate inner fits: 560 outer / 560 inner model
fits, plus final full-data fits. Each PCC model fit comprises six conditionals.
All recorded model optimizers and inner calibrators succeeded.

| Lever | Tested |
|---|---|
| Unary L2 | Base strength plus separate relation/state multipliers |
| Pairwise L2 | Base strength plus relation/state edge multipliers |
| Training weights | None, label-frequency weighting, rare label-set weighting; clipped factors |
| Auxiliary objective | Joint NLL plus 0 / 0.25 / 0.5 / 1.0 weighted label-wise BCE |
| Class weighting | Positive-label powers 0 / 0.5 / 1.0 in the auxiliary term |
| Couplings | All edges, relation edges fixed to zero, or nonnegative interactions |
| Scaling | Training-only standardization or centered sqrt(dimension) scaling |
| PCC | Linear/RBF features, regularization, orders, label scale and kernel width |
| Joint calibration | None, temperature, temperature+6 unary offsets, temperature+6 unary+15 pairwise offsets |
| Calibration L2 | 0.01 / 0.1 / 1.0 for finalist offsets |
| Compact ensembles | Uniform joint-probability mixture; coefficient average folded into one CRF |

No hidden layers or dropout are added. The CRF retains 512×6 unary weights,
6 biases and 15 couplings: **3,093 inference classifier parameters**.
Graph constraints change fitted coefficients, not the stored head shape.
Constrained CRFs do not use pairwise-offset calibration, preserving their
zero/nonnegative edge restrictions.

Source/paraphrase base weights still share one unit per meaning. Intentional
loss reweighting applies the same factor to both, learned only from the current
training portion. Preprocessing always uses the base family weights; weighting
does not silently change both the loss and input scaling. The auxiliary loss
uses exact label-event probabilities and stable log-space calculations.

## Assessment and frozen selection

The same original 890 rows / 750 original meaning units train every family.
Four outer folds keep connected families/paraphrases together. Each outer fit
has a separate grouped inner monitor; its predictions fit joint calibration.
The outer targets never fit calibration. Broad/local configurations are ranked
with **one predeclared calibration: unary offsets, penalty 0.1**. Other outer
calibration modes are diagnostic and do not choose the reported search score.

Final full-data calibrators use 750 original-meaning OOF predictions only.
Validation compares calibration modes/penalties across three seeds. Candidate
selection prioritizes exact accuracy, then F1/BCE, while requiring mean and
fixed-seed precision/recall/BCE/Brier/worst-class margins against the reference.
If no candidate qualifies it remains explicitly ineligible. Near-equivalent
candidates prefer smaller tensor storage. Seed7919 is always exported.

CV architecture/hyperparameter selection is adaptive across many trials and
reused validation is selection-biased. Both old test cohorts are historically
exposed regression checks, not new blind confirmation. Each is evaluated only
after the candidate/configuration/calibration is frozen. No label corrections,
test-based candidate substitutions or extra threshold tuning follow evaluation.

Linear CRFs use fixed features and deterministic initialization, so changing
the fit seed does not create independent solutions or evidence. RBF PCC seeds
can change sampled training centers. Auxiliary marginal likelihood need not
share the convexity of the plain joint-NLL objective; convergence flags alone
do not establish a global optimum.

## Selected configuration and results

Validation selects **trial 0: the previous CRF training configuration with new
joint unary calibration**. Alternative training weights, auxiliary losses,
regularizers and compact ensembles do not win the declared validation rule.

- Unary L2: **0.1693051542**, pairwise L2: **0.0001452993**.
- Original 512-D features, standardized using training base weights.
- No auxiliary BCE, loss reweighting, or relation/state penalty multiplier.
- Calibration: temperature **0.7984161** and six unary offsets; L2 **0.1**.
- Calibration fit: training OOF only, **750** original meanings.
- Calibrated temperature/offsets are folded into existing CRF coefficients.

Validation exact accuracy stays at 77.08%. Validation macro F1 improves from
86.87% to 88.07%. The following tests use identical original labels and meanings:

| Cohort / CRF | Exact accuracy | Macro F1 | Micro precision | Micro recall | BCE ↓ | Brier ↓ |
|---|---:|---:|---:|---:|---:|---:|
| Original 120, previous | 78.33% | 84.91% | 88.81% | 82.64% | 0.1510 | 0.04197 |
| Original 120, refined | 78.33% | 85.46% | 88.89% | 83.33% | 0.1419 | 0.04056 |
| Other 48, previous | 72.92% | 77.35% | 88.24% | 73.77% | 0.1864 | 0.05351 |
| Other 48, refined | 72.92% | 77.35% | 88.24% | 73.77% | 0.1830 | 0.05308 |

Original 120 still has 94 completely correct meanings; other 48 still has 35.
The original-test relation true-positive count rises from 13 to 14, but that
extra correct label does not make another whole meaning fully correct.

Other pre-test candidates, retained without replacing the winner after tests:

| Candidate | Validation exact | Original 120 exact / F1 | Other 48 exact / F1 |
|---|---:|---:|---:|
| Selected calibrated CRF | 77.08% | 78.33% /85.46% | 72.92% /77.35% |
| Best PCC by validation, ineligible on validation margins | 71.53% mean | 75.00% /83.31% | 70.83% /77.54% |
| Compact probability mixture | 72.92% | 78.33% /85.63% | 72.92% /80.38% |
| Single-CRF coefficient average | 72.92% | 78.33% /85.19% | 72.92% /80.38% |

The ensembles have better other 48 F1 after evaluation but substantially worse
validation accuracy; they are not substituted after seeing these tests.
The PCC comparison row is the highest-validation PCC, not the globally selected
head. The separately eligible linear PCC also remains a validation finalist;
the selected CRF beats it under the declared rule.

The refined CRF passes all regression tolerances relative to the **previous
CRF** on both tests. Relative to the retained original 32-unit reference, it
still fails other 48 macro F1, recall and worst-class checks. Relation F1 stays
at 30.77% versus 50.00% for that reference. This is why improved confidence/F1 on
one cohort does not justify activation or a claim of a large general improvement.

## Compute and implementation checks

The selected CRF keeps **3,093 classifier coefficients** and about **16.08 KiB**
of estimated FP32 numeric inference tensors, including preprocessing statistics.
Calibration learns seven post-fit quantities but folds them into those existing
coefficients; it adds no separate inference pass or stored runtime parameters.

| Preloaded head, Apple M5 | Estimated FP32 tensors | Measured median batch1 |
|---|---:|---:|
| Previous CRF | same compact head | 7.53 µs |
| Selected calibrated CRF | 16.08 KiB | 7.57 µs |
| Best-validation calibrated RBF PCC | 260.08 KiB | 46.60 µs |
| Three-CRF probability mixture | 48.25 KiB | 24.27 µs |
| Coefficient average, one CRF | 16.08 KiB | 7.56 µs |

Timings use float64 NumPy on arm64, one BLAS thread, batch 1, 20 warmups and the
median of 7×100 calls. Models are converted before timing. Joint/marginal/decision
work is included; CLIP encoding, loading, app RPC and network are excluded.
FP32 storage is an estimate; timings are not phone latency or battery evidence.
See [resources](resources.json). Search selection elapsed 96.82 seconds with six
worker processes; this includes search/refits/output work, not one model's fit.

Coefficient averaging first converts models with different scalings into common
raw embedding coordinates. It reproduces the normalized geometric joint pool;
naively averaging standardized weights would be incorrect. Calibration uses
exact finite log-joint probabilities, avoiding clipping that could break folding
for very rare states. The primary assistant reviewed Luna's audit and corrected
CV mode ranking and coordinate averaging before the recorded search.

Python tests check all new gradients, extreme-score stability, family-weight
invariance, fixed preprocessing, graph constraints, exact log probabilities,
calibration folding and averaging across different scalings. JavaScript
independently reproduces Python's 64-state distributions, six marginals and
confusion counts for each reported candidate. Group checks verify that no outer
family fits its calibrator. Recorded model/inner-calibrator statuses are retained;
no unsuccessful fit was used as an eligible selected candidate.

## Interpretation and replay

Architecture changes are not the only improvement lever. This run produces
better probability loss and a small F1/recall improvement with the **same head
structure and inference cost**. It does not produce a major precision gain or
increase exact accuracy. The finite search does not prove other tuning cannot
help, but it does not establish a route to 90% either.

The next higher-value tests are independently reviewed original-policy examples
for difficult relation/action/state combinations and separately versioned text
representations, with a new untouched grouped confirmation set. Neither the
data nor the representation has been proven the sole cause of this plateau.

[Protocol](protocol.json), [trials](trials.json.gz), [compact search OOF evidence](search-oof-summary.json.gz),
[full finalist OOF log probabilities](finalist-oof.json.gz), [selection](selection.json),
[test report](report.json) and [post-selection errors](errors.json) retain all
source/data/model hashes, IDs, configurations and evidence. The error list is
diagnosis only and never feeds relabeling or tuning. The older experiments remain
intact; source labels and the offline reference registry are unchanged.

Using `scripts/requirements-meaning-taxonomy.txt`, replay in an isolated copy
with this experiment's outputs removed:

```sh
python scripts/test-meaning-joint-tuning.py
python scripts/train-meaning-joint-tuning.py --phase select --workers 6
python scripts/train-meaning-joint-tuning.py --phase evaluate
node --test tests/meaningJointTuning.test.mjs
```

Selection/evaluation refuse to overwrite frozen outputs. No new external model
weights or runtime dependencies were installed.
