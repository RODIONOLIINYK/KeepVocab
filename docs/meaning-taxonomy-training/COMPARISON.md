# Multi-metric comparison and the historical label change

The original selection maximized validation macro-F1 and used BCE as a tie
breaker. It was an **F1-first selection**, not a demonstration that one model
dominates all objectives. The comparison below preserves that original result
and adds the other relevant measures. No hyperparameters or thresholds were
retuned on test data.

## Current models on the same 77 test meanings

Each uses its own validation-selected threshold: linear 0.325, 32-unit 0.45,
8-unit 0.65. Threshold-dependent precision/recall comparisons describe these
operating points. AP, BCE and Brier use the unthresholded membership estimates.

| Metric | Tuned linear | F1-selected 32-unit | Additional 8-unit candidate |
|---|---:|---:|---:|
| Macro precision ↑ | 84.36% | 82.39% | 87.27% |
| Macro recall ↑ | 84.47% | 89.04% | 80.40% |
| Macro F1 ↑ | 83.74% | 85.30% | 83.30% |
| Micro precision ↑ | 82.47% | 82.18% | 87.36% |
| Micro recall ↑ | 87.91% | 91.21% | 83.52% |
| Micro F1 ↑ | 85.11% | 86.46% | 85.39% |
| Exact label-set accuracy ↑ | 57/77 (74.03%) | 59/77 (76.62%) | 57/77 (74.03%) |
| Macro average precision ↑ | 89.28% | 90.33% | 90.15% |
| Binary cross-entropy ↓ | 0.2019 | 0.1771 | 0.1845 |
| Brier score ↓ | 0.05191 | 0.04333 | 0.04696 |
| Parameters ↓ | 3,078 | 16,614 | 4,158 |

The 32-unit model gains recall with slightly lower precision than linear; it
does not win every category. For example, abstract F1 is 86.96% versus linear's
90.00%. State precision is 66.67% versus linear's 69.23%. Action AP is 91.06%
versus linear's 94.33%. Relation F1 improves from 66.67% to 70.59% but remains
weak. Place F1 is 100% for both with only seven positive test cases.

The 8-unit model was already a frozen finalist in the original search. It had
better **validation** BCE (0.2093 vs 0.2549), Brier (0.05726 vs 0.05976), exact
label-set accuracy (68.13% vs 65.93%) and AP (90.56% vs 90.51%) than the 32-unit
model, at slightly lower macro-F1 (83.72% vs 84.01%). This makes it a relevant
soft-routing candidate. A disclosed post-hoc policy selected it from finalists
within one validation F1 point of the best, preferring BCE/Brier/AP and size.
Its unchanged configuration and threshold were saved before computing its test
metrics. This is additional diagnosis on an already-used test, not a fresh
confirmatory evaluation or a reason to keep tuning the test set.

For hard membership detection, the 32-unit model is the current F1/recall
candidate. For precision or smaller models, the alternatives matter. For soft
routing, probability quality and calibration need explicit evaluation; no model
is claimed calibrated. Do not combine unlike metrics into an arbitrary average
or claim a universal winner. The earlier paired group-bootstrap interval for
the 32-unit minus linear F1 difference includes zero (−2.29 to +5.83 points).

## Why the earlier logistic regression score was higher

The historical result was for a different target and evaluation protocol:

| Property | Historical run | Current run |
|---|---|---|
| Categories | action/place/thing/attribute | entity/place/action/state/relation/abstract |
| Target | Exactly one category | One or several memberships |
| Meanings | 237 legacy meanings | 237 legacy + 180 new definitions |
| Reference labels | Domain/POS mapping rules | Reviewed definition-based evidence labels |
| Evaluation | 96 combined validation/test meanings, plus 5-fold row-index CV | Separate 91 validation / 77 test, with training-only grouped CV |
| Family protection | Unique definitions; modulo-index CV did not group families | Connected families/paraphrases together; 5 old cross-split meanings quarantined |

The earlier vector-only four-class logistic regression had **94.88% macro-F1
in five-fold CV**, but **90.74% macro-F1 / 92.71% accuracy** on its separate
96-meaning holdout. Those are not equivalent to current six-output test F1 or
exact label-set accuracy. A multi-output row can have one correct category but
still fail exact match because it misses another valid category or adds one.

The previous rule labeled every verb or `actions`-domain item action. It labeled
all `nature`, `structures`, and `street` items place, even when the selected
definition described a particular object. `attributes` and `weather` mapped to
attribute. These labels were not independent expert annotations. The model's
high agreement with those rules did not establish that the rules were the best
visual-evidence taxonomy.

The reviewed scheme intentionally changes that policy:

| Exact selected meaning | Old rule | Reviewed labels |
|---|---|---|
| stand: be upright supported by the feet | action | state |
| hold: support/grasp with a body part | action | relation |
| tree: large plant with trunk/branches | place | entity |
| parking meter: street payment device | place | entity |
| rain: water falling from clouds | attribute | entity + action |

After treating the simple thing→entity and attribute→state renamings as
equivalent, **33/237 primary assignments changed** and **55/237 label sets
changed**. Of those legacy meanings, 28 now have multiple labels; the complete
417-meaning set has 101 multilabel rows. The new supplement adds many spatial,
temporal, social, and nonvisual examples absent from the original classifier
task. The changes include both clear old mismatches and reasonable policy
choices about overlapping evidence; the new labels are still AI-reviewed pilot
annotations rather than objective human-expert truth.

These facts explain why a direct “94.88% fell to 83.74%” interpretation is
invalid. They do not quantify which modification caused how much of the score
difference. Labels, class count, objective, data, partitions, optimizer, and
hyperparameters all changed. A controlled same-input/same-split ablation would
be required for that causal attribution; it was not performed here.

## Evidence and reproduction

`comparison.json` contains the independently recomputed metrics, all 55 label
transitions, task definitions, frozen candidate probabilities and caveats.
`previous-run-reference.json` preserves the historical saved classification
results and their source hash; it is not a claim that the historical training
was rerun. `comparison-decision.json` records the post-hoc policy before the
additional candidate was evaluated. All original models/results remain intact.

```sh
python3 scripts/compare-meaning-classifiers.py
node --test tests/meaningCategoryClassifier.test.mjs
```

No model is activated by this comparison. A new prospective, independently
reviewed evaluation is needed to resolve small model differences and validate
the final soft-routing selection policy.
