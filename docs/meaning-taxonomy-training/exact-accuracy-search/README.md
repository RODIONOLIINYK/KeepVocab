# Architecture search for more than 90% exact accuracy

Completed on 2026-11-01 for KeepVocab 1.12.20. The user explicitly selected
**exact label-set accuracy: every label must be correct for a meaning** as the
target. **The target was not achieved.** No tested configuration reaches 90%
exact accuracy in the reported validation or test comparisons. The original
policy, all labels, source definitions, embedding vectors and splits stay fixed.
The current offline reference remains the original 32-unit L2 head. No new
architecture or classifier is activated in production.

## The 89.94% result and the actual target

The referenced [no-dropout result](../dropout/README.md) is **89.94% mean micro
precision on the reused 48-meaning validation set**, across three seeds. Its
mean exact accuracy is **69.44%**. It uses 512 → 32 tanh → 6 sigmoids, Adam,
batch size 64, learning rate 0.003, L2=0.0106707 and grouped inner early stopping.
It was not 89.94% exact accuracy or independent test accuracy.

Every test-table row below uses the same cohort with unchanged original labels.
An output with five correct memberships and one incorrect membership is an
incorrect meaning under this target. Precision, per-label Hamming accuracy and
top-label correctness are reported separately and never satisfy this target.

## Search coverage

**204 configurations**, then three-seed finalist confirmation and two ensemble
methods, totaling **237 CV runs / 948 outer-fold fits**:

| Cases | Coverage |
|---|---|
| Independent-label MLPs | 108 configurations after refinements |
| Joint-label models | 36 configurations; softmax over all 64 fixed label sets, returning six marginal memberships |
| RBF-feature logistic heads | 48 configurations; 64/128/256/512 training-only centers |
| Weighted cosine neighbors | 12 configurations; 3/5/9/15 neighbors and temperatures 10/30/70 |
| Hidden widths | 16, 32, 64, 128, 256 |
| Depth | One, two or three hidden layers |
| Activations | tanh, ReLU, SiLU |
| Binary-label losses | BCE or focal loss, gamma 1/2; optional smoothing 0.02/0.05 |
| Other tuning | L2, class/label-set weights, learning rate, batch size 32/64/128, constant/cosine schedule, input scaling |
| Decoders | Global or six per-class thresholds, fitted only within training data |
| Ensembles | Uniform average of three validation-selected families, or three seeds of the best family |

These are sampled combinations, not an exhaustive Cartesian grid. No dropout
or batch normalization is used. Broad search has 132 settings; two progressively
narrower local stages add 36 each. Best broad/local outer exact accuracy moves
from 77.07% to 77.33%; neither refinement approaches 90%.

The nine architecture groups retain their strongest configuration, plus the
three strongest overall (duplicates removed): 11 finalist configurations.
Their original search epochs are capped at250/350. Before test access, all
neural finalists repeat all four folds and full fits with a fixed 700-epoch
budget across seeds 7919/104729/130363. The cosine schedule uses that configured
horizon. Every final exported single model uses seed 7919; no lucky-seed choice.

Training remains 890 rows / 750 original meaning units. Paraphrase pairs share
one unit of loss weight, remain in their parent's family, and do not inflate
the number of scored original meanings. The 48 validation examples and the
120/48 tests have prior exposure; none is a new blind confirmation set.

## Preventing decoder leakage

For each outer training portion, a separate grouped inner monitor supplies
epoch selection, calibration and threshold fitting. The fitted decoder is then
applied to untouched outer predictions. RBF/neighbor models also fit a separate
inner-training model for their inner-monitor predictions. Ensembles align the
same inner/outer groups, fit thresholds on averaged inner predictions, and score
averaged outer predictions. No outer labels fit that fold's decoder.

The full final model instead fits its decoder from original-meaning OOF
training predictions. Its `oofTuning` metrics are explicitly distinct from
outer-fold `cv` assessment. Global/per-class variants are compared on reused
validation before any test check. Six continuous probabilities remain available;
joint-label models return marginals without collapsing to one class/set.

This nests decoder fitting, **not architecture selection**. Many configurations
are ranked on the same outer folds, so the selected CV score remains adaptively
selected and optimistic. Reused validation also has selection bias. These
results cannot establish 90% generalization on real app usage.

## Frozen selection and original-label tests

Selection ranks validation exact accuracy, then macro F1 and BCE. The chosen
candidate is the **three-family ensemble**: seed 7919 of each:

- 512 → 256 → 64 → 6, ReLU, focal gamma2, smoothing 0.05, L2=0.0000590126.
- 512 → 128 → 6, SiLU, BCE, L2=0.00171068.
- 512 → 32 → 64 joint-label softmax, ReLU, smoothing 0.02, L2=0.0226662;
  return six marginal probabilities.

Each member has its own training-only calibration. Calibrated memberships are
averaged uniformly. Ensemble thresholds, learned from training OOF, are
entity0.40 / place0.68 / action0.60 / state0.60 / relation0.60 / abstract0.42.
There are **233,132 dense parameters**, about 14 times the baseline head's
16,614. No phone latency, battery or deployment advantage is claimed.

| Candidate | Original 120 exact | Original 120 macro F1 | Other 48 exact | Other 48 macro F1 |
|---|---:|---:|---:|---:|
| Previous 32-unit reference | 72.50% | 84.44% | 68.75% | 80.01% |
| Historical no-dropout 89.94%-validation-precision run, fixed seed | 75.83% | 86.73% | 66.67% | 81.97% |
| Preselected three-family ensemble | **76.67%** | **86.72%** | **75.00%** | **82.81%** |
| Two-hidden-layer tanh finalist, diagnostic | 79.17% | 86.22% | 68.75% | 79.98% |

The tanh row is the highest individual score seen on original 120 **after**
evaluation, not the validation-selected winner. It is 512 → 64 tanh → 32 tanh
→ 6 sigmoids. Its other 48 result does not improve exact accuracy over the old
reference. It was not substituted for the chosen candidate after seeing tests.

| Preselected ensemble | Exact | Precision | Recall | Macro F1 | BCE ↓ |
|---|---:|---:|---:|---:|---:|
| Reused validation48 | 77.08% | 96.08% | 79.03% | 86.52% | 0.1352 |
| Decoder-nested outer CV750 | 76.40% | 90.09% | 84.89% | 86.37% | 0.1325 |
| Original 120 regression test | 76.67% (92/120) | 92.97% | 82.64% | 86.72% | 0.1156 |
| Other 48 regression test | 75.00% (36/48) | 89.29% | 81.97% | 82.81% | 0.1589 |

Precision above 90 does not make exact accuracy above 90. The ensemble improves
five exact predictions on original 120 and three on other 48 versus the old
reference. It passes the existing regression margins on both cohorts, but is
larger, misses the requested target, and lacks independent fresh confirmation.
It remains experimental and does not change the registry or routing cache.

## Remaining errors and interpretation

The ensemble has **28 exact errors on original 120 and 12 on other 48**.
On original 120, relation F1 is70.27%, with recall65%; action recall is70.37%.
On other 48, relation F1 is46.15%, with recall30%. A meaning with one omitted
relation remains an exact-match error even if its other five labels are right.
The [post-selection error list](errors.json) retains definitions, memberships
and probabilities. It is diagnosis only: no labels, thresholds or selection
were changed after inspection.

More layers, capacity, losses and nonlinear models did not establish a route
to 90% with these inputs/data. This finite search does not prove90% impossible,
or identify a single cause. The next defensible step is new independently
reviewed original-policy examples for ambiguous label combinations, especially
relation/action and state, followed by a new untouched grouped confirmation
set. If performance still plateaus, compare alternative text representations
or learned CLIP adapters as an explicit feature-contract experiment. Do not
change labels, omit difficult classes or rename another metric to claim 90%.

## Verification and reproduction

Python tests check finite-difference gradients for every activation, focal loss,
smoothing and joint-label loss; tiny-batch fitting, serialization/repeatability,
correct six-class marginals, training-only RBF centers and monitor separation.
ReLU numerical tests avoid nondifferentiable exact-zero kinks. Nearest-neighbor
ties use stable source ordering for portable parity. JavaScript independently
reproduces every test probability/confusion count for all nine families,
ensemble and frozen comparators, and checks inner/outer group isolation.

All RBF optimizer folds succeeded. 37 neural inner fits in the search/finalist
history reached their epoch cap; stopping histories retain those limits.
The primary assistant reviewed a Luna audit that identified decoder reuse
in an initial draft; it was corrected **before the real search started**.
No outer targets fit calibration/thresholds in the recorded experiment.

[Protocol](protocol.json), [compressed trials](trials.json.gz),
[OOF/inner-decoder predictions](oof-predictions.json.gz), [selection](selection.json)
and [test report](report.json) bind source/dataset/embedding/model hashes,
configurations, IDs, seeds and stopping traces. Large model/trace artifacts
are compressed losslessly. Existing data and historical experiments stay intact.

Using `scripts/requirements-meaning-taxonomy.txt`, replay in an isolated copy
with this experiment's outputs removed:

```sh
python scripts/test-meaning-architectures.py
python scripts/train-meaning-exact-search.py --phase select --workers 6
python scripts/train-meaning-exact-search.py --phase evaluate
node --test tests/meaningExactSearch.test.mjs
```

Selection/evaluation refuse to overwrite frozen results. The target remains
unmet; no inference, personal preference, adapter weights or app model is changed.
