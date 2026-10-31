# Controlled dropout and grouped early-stopping experiment

Completed offline on 2026-11-01, released with KeepVocab 1.12.17.
**The current classifier was retained.** Dropout did not provide a consistent
improvement under the predeclared multi-metric rules. This describes the tested
settings and pilot, not a claim that dropout never helps. No production
classifier, image filter, adapter or personal MLP is activated.

## Fixed data and architecture

The network remains **512 inputs → 32 tanh units → six independent sigmoid
probabilities**, with 16,614 learned parameters. Inverted hidden dropout applies
only during training. No masks, extra parameters or runtime dependencies are
added on devices. All six continuous outputs remain available without softmax
or argmax.

The exact labels, weights, groups, embeddings and current classifier are frozen.
890 training rows represent 750 meaning units; the 140 paraphrases share a
unit-weight budget with their originals. The same 48-example development
validation set is reused for every model. The old 120-example and newer
48-example tests are both already inspected **retired regression cohorts**,
not independent fresh tests. Each reported table uses an identical cohort.

## Training protocol and verification

The initial grid crosses dropout 0%, 10%, 20%, 30% with L2 0, 0.001, 0.0106707
and 0.0377165: 16 settings. Four local dropout settings and their exact
zero-dropout controls add eight, for **24 configurations**. Learning rate 0.003,
batch size 64, positive weighting power 0.6873864, weighted BCE, standardization,
initialization, Adam implementation and minibatch order are shared. L2 is coupled
into the loss gradient and penalizes weights only, never biases. Dropout uses a
separate RNG from minibatch shuffling, preserving the matched control's order.

Five finalist settings (two dropout settings, exact controls and the strongest
zero-dropout setting) repeat with seeds 7919, 104729 and 130363. This produces
34 grouped CV runs and 136 outer-fold fits.

Each outer fit chooses its epoch using an **inner** group holdout from that
outer-training portion. It then refits the whole outer-training portion for
that epoch. The outer validation fold never supplies early-stopping scores.
Monitors score natural originals once each, excluding paraphrase rows, using
deterministic unweighted BCE every five epochs. Patience is 35 epochs, minimum
stopping epoch 30, maximum 400. 0 inner CV fits reached the 400-epoch ceiling.

Thresholds and temperature/global-bias calibration are fitted on training OOF
predictions only with the same recipe for every model. Mean development
validation F1 ranks the within-family finalists. Dropout must improve mean CV
F1 over its exact control by at least 0.003 and pass all validation margins.
The fixed seed 7919 is exported; the best observed seed is never selected.
Candidates freeze before either regression cohort is evaluated.

A capacity test fits a synthetic 16-example multilabel batch exactly.
The separate [real-batch capacity check](capacity-check.json) also fits 24 actual
training meanings (four anchors per category) exactly after ten epochs with
dropout/L2 disabled. This establishes capacity, not generalization accuracy.
Numerical finite differences check weighted gradients with normal, fixed-dropout and
all-zero masks; zero dropout matches the existing weighted L2 objective.
Additional tests check mask expectation, repeatability, deterministic inference
and group exclusion. The primary assistant reviewed the implementation,
source/hash binding, grouping, exports and label-audit flags. JavaScript
independently reproduces Python probabilities and confusion counts for all five
reported models on both regression cohorts.

## Cross-validation and development validation

CV F1 is mean ± sample standard deviation across three seeds. Development
validation metrics are means over three separately trained heads, not an
ensemble. Every row evaluates the same 48 validation meanings.

| Dropout | L2 | Grouped CV F1 | Validation F1 | Validation exact | Validation precision | Validation recall |
|---|---:|---:|---:|---:|---:|---:|
| 25% | 0.012368 | 85.16% ± 0.25 pp | 84.73% | 66.67% | 86.22% | 83.33% |
| 0% | 0.012368 | 84.61% ± 0.20 pp | 85.34% | 68.75% | 88.52% | 82.26% |
| 20% | 0.010671 | 84.98% ± 0.38 pp | 84.96% | 68.06% | 87.18% | 82.80% |
| 0% | 0.010671 | 84.68% ± 0.34 pp | 85.59% | 69.44% | 89.94% | 81.72% |
| 0% | 0.037716 | 84.96% ± 0.24 pp | 82.97% | 67.36% | 89.05% | 77.96% |

The 25% dropout setting has the highest repeated CV F1 (85.16% versus 84.61%
for its exact control), but validation F1 falls from 85.34% to 84.73%. The 20%
setting wins within-dropout validation selection: CV F1 rises from 84.68% to
84.98%, while validation precision falls from **89.94% to 87.18%** and validation
F1 falls from 85.59% to 84.96%. Recall improves modestly. This is a tradeoff,
not a uniform gain.

The frozen L-BFGS head scores 84.98% CV F1 on the same outer folds and 86.03%
validation F1 / 92.59% precision. Comparing it with Adam changes optimizer,
stopping and potentially L2; only the matched Adam pairs isolate dropout.
The rule selects the zero-dropout Adam control as the experimental candidate,
and it fails eligibility to replace the current head before regression checks.

## Fixed regression checks

These are fixed-seed 7919 results, not seed means. The dropout alternative and
its exact Adam control use L2 0.0106707. No candidate was reselected from these
scores. The linear head is a frozen low-resource comparator, not a newly
selected architecture.

### retired-new-48

| Model | Exact label set | Macro F1 | Micro precision | Micro recall | BCE ↓ | Brier ↓ |
|---|---:|---:|---:|---:|---:|---:|
| Current L-BFGS / L2 head | 68.75% | 80.01% | 87.04% | 77.05% | 0.2046 | 0.0588 |
| Adam control, no dropout | 66.67% | 81.97% | 83.33% | 81.97% | 0.1915 | 0.0540 |
| Adam, 20% dropout | 64.58% | 83.48% | 80.30% | 86.89% | 0.1865 | 0.0527 |
| Frozen regularized linear comparator | 62.50% | 81.06% | 81.97% | 81.97% | 0.1832 | 0.0540 |

### retired-original-120

| Model | Exact label set | Macro F1 | Micro precision | Micro recall | BCE ↓ | Brier ↓ |
|---|---:|---:|---:|---:|---:|---:|
| Current L-BFGS / L2 head | 72.50% | 84.44% | 87.50% | 82.64% | 0.1554 | 0.0450 |
| Adam control, no dropout | 75.83% | 86.73% | 88.57% | 86.11% | 0.1386 | 0.0390 |
| Adam, 20% dropout | 67.50% | 84.97% | 79.39% | 90.97% | 0.1421 | 0.0415 |
| Frozen regularized linear comparator | 71.67% | 85.75% | 86.11% | 86.11% | 0.1463 | 0.0422 |


Dropout lowers accuracy and precision on the original 120 meanings. On the
newer 48 it improves F1/recall but lowers accuracy/precision. The no-dropout Adam
control improves old-cohort metrics but regresses on newer-cohort accuracy and
precision. A general improvement is not established; the current head remains.
Group-bootstrap intervals are retained in [report.json](report.json). No 97%
result is established.

Replacement requires CV gain ≥0.003 versus the frozen head, mean and fixed-seed
validation checks, then checks on both regression cohorts. Margins are F1
-0.01, accuracy/precision/recall -0.02, BCE +0.01, Brier +0.003 and no per-class
F1 drop >0.05. These are engineering tolerances, not statistical equivalence.
Eligibility failed; the current registry and adapter routing cache are unchanged.
Fresh independently reviewed confirmation is still required before deployment.

## Label-policy audit

Luna inspected all 280 new-meaning definitions/labels and relevant old training
counterparts. The primary assistant individually checked all **15 flagged
cases** and every cited counterpart, recording assessments in
[label-audit.json](label-audit.json). No labels changed and no ground-truth
error rate was established. Agent label proposals are suggestions, not gold.

Two substantive policy issues need a separate versioned annotation revision:

- **Process versus result:** shatter/erode/evaporate are action+state, while
  splinter/corrode/solidify are action-only. A persistent aftermath must not
  automatically add state to every transformation; the rule needs consistency.
- **Structure, setting and arrangement:** greenhouse is entity+place, gazebo
  place-only; bridge is entity+place+relation, causeway place-only. Mezzanine
  and cloister have defining spatial layouts. Some differences are plausible;
  others are strong revision candidates. Hatchery permits a building or a site,
  so an omitted entity label cannot simply be declared wrong.

Dropout cannot reconcile inconsistent targets. Define and apply consistent
process/result and structural-place rules independently of model mistakes,
then annotate new confirmation groups. More paraphrases alone do not resolve
these issues. Integrity audits establish source/group consistency, not true
semantic label accuracy.

## Reproduce and inspect

[Protocol](protocol.json), [trials](trials.json), [frozen selection](selection.json),
[report](report.json), [predictions](test-predictions.json) and
[OOF predictions](oof-predictions.json.gz) retain the evidence. Models are in
`tests/fixtures/meaning-taxonomy/dropout/`. NumPy 2.3.5 and SciPy 1.16.3 are pinned
by `scripts/requirements-meaning-taxonomy.txt`; no new training library is needed.
The implementation follows the training-only mechanism in the
[original dropout paper](https://jmlr.org/papers/v15/srivastava14a.html).

```sh
python scripts/test-meaning-dropout.py
node --test tests/meaningDropout.test.mjs
# Replay in an isolated copy, preserving the frozen outputs:
python scripts/train-meaning-dropout.py --phase select --workers 6
python scripts/train-meaning-dropout.py --phase evaluate
```

Selection/evaluation refuse overwriting frozen decisions. Source hashes, seeds,
fold IDs, stopping epochs and monitor losses are recorded. Images, CLIP vectors,
existing classifier weights and production personalization are unchanged.
