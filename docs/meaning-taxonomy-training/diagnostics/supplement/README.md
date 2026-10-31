# Training supplement diagnostic

This fixed-configuration diagnostic refits the original tuned linear and 32-unit models on either the original 244 training meanings or the expanded 301 (244 + 57 supplement). Both versions are evaluated on the same 91 original validation meanings, at the original fixed thresholds (linear 0.325; 32-unit 0.45). No hyperparameter search, threshold selection, or calibration was performed. The fitting seed is 7919, matching the original final fits; the original-training refits reproduce the frozen artifacts to within 1e-10 validation probability. Exact IDs and source hashes are recorded in [protocol.json](protocol.json); predictions and validation targets are in [validation-predictions.json](validation-predictions.json).

Validation is reused development data, not an independent test. No test targets or predictions were used. AI-reviewed labels are not human-expert ground truth; these results do not establish a generalization gain or guarantee a target score.

## Linear model

| Metric | Train 244 | Train 301 | Change |
|---|---:|---:|---:|
| macroF1 | 0.828 | 0.820 | -0.008 |
| microF1 | 0.826 | 0.823 | -0.002 |
| exactMatch | 0.637 | 0.659 | +0.022 |
| bce | 0.277 | 0.271 | -0.006 |
| brier | 0.060 | 0.057 | -0.003 |
| macroAveragePrecision | 0.888 | 0.888 | +0.000 |

Per-category F1:

| Category | Train 244 | Train 301 | Change |
|---|---:|---:|---:|
| entity | 0.965 | 0.941 | -0.024 |
| place | 1.000 | 0.933 | -0.067 |
| action | 0.889 | 0.897 | +0.008 |
| state | 0.545 | 0.611 | +0.066 |
| relation | 0.654 | 0.692 | +0.038 |
| abstract | 0.917 | 0.846 | -0.071 |

## 32-unit model

| Metric | Train 244 | Train 301 | Change |
|---|---:|---:|---:|
| macroF1 | 0.840 | 0.828 | -0.012 |
| microF1 | 0.840 | 0.835 | -0.005 |
| exactMatch | 0.659 | 0.692 | +0.033 |
| bce | 0.255 | 0.241 | -0.014 |
| brier | 0.060 | 0.056 | -0.004 |
| macroAveragePrecision | 0.905 | 0.910 | +0.005 |

Per-category F1:

| Category | Train 244 | Train 301 | Change |
|---|---:|---:|---:|
| entity | 0.929 | 0.929 | +0.000 |
| place | 0.875 | 0.875 | +0.000 |
| action | 0.929 | 0.897 | -0.032 |
| state | 0.629 | 0.667 | +0.038 |
| relation | 0.720 | 0.720 | +0.000 |
| abstract | 0.960 | 0.880 | -0.080 |

## What changed

On the linear model, state and relation F1 rose (+0.066 and +0.038), while entity, place, and abstract F1 fell; macro-F1 declined slightly (-0.008). Exact match, BCE, and Brier improved. On the 32-unit model, state F1 rose (+0.038), relation F1 was unchanged, and action and abstract F1 fell; macro-F1 declined (-0.012). Exact match, BCE, Brier, and macro average precision improved. These are mixed movements on a small reused validation set, not evidence that the supplement improves overall model quality.
