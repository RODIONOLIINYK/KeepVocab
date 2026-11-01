# Six-category classifier: training and tuning

The reviewed meaning-category classifier was trained and evaluated offline on
2026-10-31. It is not wired into the app's image gate, adapters or personal MLP.
KeepVocab 1.12.13 preserves the current app model while making this experiment
reproducible. See [the full plan](../meaning-conditioning-plan.md) for integration
and image/text adapter work that remains to be done.

Follow-up: [multi-metric comparison and historical label audit](COMPARISON.md)
adds precision/recall, the frozen 8-unit finalist, and the exact reasons earlier
four-class logistic-regression results cannot be compared directly. The original
selection below was F1-first, not a universal model ranking.

The [capacity/confidence and augmentation follow-up](diagnostics/README.md)
records real-batch fitting, learning curves, the 97% precision target search,
frozen-model error analysis, mobile inference cost, a reviewed text training
extension, and reviewed image crops. Original results below remain frozen.

The later [1,000-example experiment](expanded-1000/README.md) adds balanced
training, fresh grouped evaluation, and an explicit cheaper-linear replacement
rule. Its current selected artifact is recorded separately; the original models
and results below remain frozen.

The [targeted expansion and L1/L2 experiment](regularized-expansion/README.md)
adds 280 reviewed meanings and 140 training-only paraphrases, compares exact L1,
L2 and elastic-net, and records a new frozen comparison against the 1,000-row
head. The current offline head is the stronger-L2 32-unit candidate from that
experiment. Historical numbers below use different evaluation cohorts.

The subsequent [dropout and early-stopping comparison](dropout/README.md) keeps
labels fixed and compares matched Adam controls with dropout across three seeds.
It does not replace the current stronger-L2 head: improvements are inconsistent
across precision, recall and the two fixed regression cohorts.

The [policy-v2 revision](policy-v2/README.md) applies consistent category
rules, reviews every original meaning unit, adds 360 meanings and confirms on
a fresh grouped 120-example cohort. All comparisons in that report use identical v2 gold labels; older
policy scores below remain historical snapshots.

The latest [original-policy normalization experiment](normalization-original/README.md)
tests 76 configurations including 30 matched BN/plain pairs. The user selected
the original labeling policy and its 72.50% benchmark. That original 32-unit L2
head is restored as the current offline reference. The 74.17% BN candidate stays
experimental because grouped-CV and per-class checks are mixed.

The [exact-accuracy architecture search](exact-accuracy-search/README.md) tests
204 configurations, three-seed finalists and two ensembles against the user's
explicit target of more than 90% **exact label-set accuracy**. The preselected
ensemble reaches 76.67% / 75.00% on the unchanged original120 / other48 tests.
The [internet-research follow-up](joint-label-search/README.md) adds 78 PCC,
pairwise-CRF and matched-control configurations plus joint-decoding comparisons.
The selected compact CRF reaches 78.33% / 72.92%, with a relation-class regression.
Neither reaches the target or replaces the original offline reference.

## Result and interpretation

| Validation-selected model | Validation macro-F1 | Test macro-F1 | Test exact label-set match | Parameters |
|---|---:|---:|---:|---:|
| Tuned logistic regression | 82.83% | 83.74% | 57/77 (74.03%) | 3,078 |
| Selected 512 → 32 → 6 classifier | 84.01% | 85.30% | 59/77 (76.62%) | 16,614 |

The selected classifier uses a tanh hidden layer and **six independent sigmoid
outputs**. It retains overlapping categories and all membership estimates;
there is no argmax or softmax collapse. This is the **meaning-category head**,
not the separate personal image-preference MLP discussed in the project plan.
The 0.45 decision threshold is only for binary evaluation; it does not discard
the continuous outputs or replace the app's 0.19 image-similarity threshold.

The nonlinear model won on validation before test metrics were computed. Its
test advantage over tuned logistic regression is only 1.56 percentage points.
A paired bootstrap over 74 test groups gives a 95% interval for that difference
of **−2.29 to +5.83 points**. This pilot does not establish a reliable advantage
over the smaller linear model. Both artifacts are saved. No claim is made that
this model is ready for automatic app routing.

| Test category | Positive support | Precision | Recall | F1 |
|---|---:|---:|---:|---:|
| Entity | 36 | 92.31% | 100.00% | 96.00% |
| Place | 7 | 100.00% | 100.00% | 100.00% |
| Action | 10 | 88.89% | 80.00% | 84.21% |
| State | 12 | 66.67% | 83.33% | 74.07% |
| Relation | 15 | 63.16% | 80.00% | 70.59% |
| Abstract | 11 | 83.33% | 90.91% | 86.96% |

The main remaining weaknesses are state/relation distinctions. Seven correct
places do not establish perfect place recognition. The selected model's test
micro-F1 is 86.46%, unweighted BCE is 0.1771 and Brier score is 0.04333. The
group-bootstrap interval for test macro-F1 is approximately 77.35–91.68%.
These uncertainty estimates inherit the small sample and AI-label limitations.

## Coarse-to-fine search

The fixed data split has 244 training meanings, 91 validation meanings, 77 test
meanings and 5 quarantined meanings. No quarantined meaning enters fitting or
evaluation. Connected headword/family groups stay together. The classifier reads
only pinned frozen MobileCLIP S0 original-definition embeddings (512-D, FP16
text model); category names, rationales and evidence annotations are excluded.

Six worker processes each use one BLAS thread. Fits use full-batch analytic
gradients and SciPy L-BFGS-B. The Python/NumPy/SciPy versions, seeds, IDs, folds
and exact fixture hashes are recorded in `protocol.json`.

| Search stage | New configurations | Best grouped CV macro-F1 |
|---|---:|---:|
| Broad random exploration | 72 | 85.51% |
| Local refinement around six strongest regions | 48 | 85.99% |
| Narrow refinement | 32 | 85.99% |

This tested **152 configurations plus one fixed default baseline**, using four
training-only grouped folds. The broad space included linear and tanh models
with 8/16/32 hidden units, unit/scaled/standardized inputs, centering, log-uniform
L2 strength, and positive-class weighting power. Refinement perturbed the best
regions by 0.7 then 0.25 in log10 L2, also narrowing positive weighting.

The four strongest linear and four strongest nonlinear candidates were checked
with another grouped fold assignment. Three finalists per family then competed
on validation, including one global binary threshold from 0.25–0.75. Selection
maximized validation macro-F1; BCE, smaller size and trial ID break ties. This
is a bounded search, not proof of a global optimum. The fine stage had no CV
gain, so the declared search stopped rather than repeatedly tuning on test.

The selected settings are:

- Hidden units: 32, tanh.
- Inputs: training-mean centered, multiplied by sqrt(512).
- L2 coefficient: 0.0001228156082236678.
- Positive weighting power: 1.0, with weights computed from each fit's training
  labels and capped at 8.
- Optimizer: L-BFGS-B, maxiter 400, maxfun 1200, maxls 30, gtol 1e-7, ftol 1e-11.
- Binary diagnostic threshold: 0.45. Full six-dimensional outputs remain intact.

The fixed default baseline in `report.json` underfits strongly (19.61% test
macro-F1). That default is not a fair stand-in for logistic regression's
capability; use the **tuned linear** comparison above.

## Verification and limitations

Both models and their thresholds were selected without using test performance.
The source audit reads split/label integrity; only train/validation arrays are
passed into search. The decision is written to `selection.json` before test
metrics. A selection-only replay did not evaluate test targets. A complete
reproducibility replay selected exactly the same configuration/threshold,
weights, preprocessing, and all 412 non-quarantined output vectors. Test metrics
were recomputed for verification, not used to alter selection.

The gradient finite-difference check covered 80 coordinates across linear/tanh
models with maximum absolute error below 1.5e-11. A small separable batch was
fit exactly. Portable JavaScript inference reproduces Python probabilities and
independently verifies the test TP/FP/FN counts for both saved models.

There were 113 primary-search and one confirmation CV fits that reached the
optimizer limit. Their settings/results remain in the audit trail; no claim is
made that every explored configuration reached its unconstrained optimum. All
four first-CV fits of the selected configuration and its final training fit
converged; the final fit used 226 iterations. Refinement and confirmation were
budgeted to keep the comparison tractable, not to guarantee optimality.

This dataset is an AI-authored/reviewed English-definition pilot. It needs an
independent real-app test and broader supports before deployment. Positive
class reweighting can affect probability calibration; outputs are explicitly
marked `calibrated: false`. This experiment establishes neither better image
suitability nor personal preference ranking, and does not train CLIP adapters.

## Reproduce

Use an arm64 Python with the pinned scientific packages available. For an
isolated install, rather than changing the app's dependencies:

```sh
python3 -m pip install --target work/meaning-taxonomy-training/python-libs -r scripts/requirements-meaning-taxonomy.txt
node scripts/audit-meaning-taxonomy.mjs
node scripts/encode-meaning-taxonomy.mjs
python3 scripts/train-meaning-taxonomy.py --self-test
python3 scripts/train-meaning-taxonomy.py --workers 6
node --test tests/meaningCategoryClassifier.test.mjs
```

The export command uses only cached pinned CLIP files; downloads are disabled.
Use `--selection-only --output work/meaning-taxonomy-training/replay` to replay
search without test evaluation or replacing the saved classifier. Only restart
training to reproduce or perform a predeclared new experiment; do not choose
further settings by repeatedly inspecting this test set.

Saved evidence: `protocol.json`, `trials.json`, `stages.json`, `selection.json`,
`report.json`, `predictions.json`, and `reproducibility.json`. The models live in
`tests/fixtures/meaning-taxonomy/classifier.json` and `classifier-linear.json`.

Optimizer documentation: [official SciPy L-BFGS-B reference](https://docs.scipy.org/doc/scipy/reference/optimize.minimize-lbfgsb.html).
The installed 1.16.3 signature was checked locally against the used options.
