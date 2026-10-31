# Frozen meaning classifier error analysis

This is a deterministic replay of the original 91-meaning validation and 77-meaning test splits using the frozen artifacts and each artifact’s own threshold. No weights, splits, or labels were changed; no model selection or retraining was performed. The test split has already been inspected in earlier diagnostics, so this report reuses it diagnostically and does not use it for model selection.

Targets are AI-pilot annotations. **Annotation accuracy is unknown**; these results measure agreement with the current labels, not verified semantic truth. For follow-up, collect new independent examples and review them independently; do not copy held-out examples into training.

## Test metrics

| Frozen model | Threshold | Micro P | Micro R | Micro F1 | Macro P | Macro R | Macro F1 | Exact label set | Bitwise accuracy |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Logistic regression | 0.325 | 82.47% | 87.91% | 85.11% | 84.36% | 84.47% | 83.74% | 74.03% | 93.94% |
| MLP | 0.450 | 82.18% | 91.21% | 86.46% | 82.39% | 89.04% | 85.30% | 76.62% | 94.37% |

The logistic model’s test exact label-set match is **74.03%** and macro-F1 is **83.74%**, reflecting agreement with the pilot labels only.

## Per-class test errors

### Logistic regression

| Category | Support | TP | FP | FN | Precision | Recall | F1 |
|---|---:|---:|---:|---:|---:|---:|---:|
| entity | 36 | 36 | 3 | 0 | 92.31% | 100.00% | 96.00% |
| place | 7 | 7 | 0 | 0 | 100.00% | 100.00% | 100.00% |
| action | 10 | 7 | 1 | 3 | 87.50% | 70.00% | 77.78% |
| state | 12 | 9 | 4 | 3 | 69.23% | 75.00% | 72.00% |
| relation | 15 | 12 | 9 | 3 | 57.14% | 80.00% | 66.67% |
| abstract | 11 | 9 | 0 | 2 | 100.00% | 81.82% | 90.00% |

Largest weaknesses by F1: **relation** (66.67%, 9 FP / 3 FN), **state** (72.00%, 4 FP / 3 FN).

### MLP

| Category | Support | TP | FP | FN | Precision | Recall | F1 |
|---|---:|---:|---:|---:|---:|---:|---:|
| entity | 36 | 36 | 3 | 0 | 92.31% | 100.00% | 96.00% |
| place | 7 | 7 | 0 | 0 | 100.00% | 100.00% | 100.00% |
| action | 10 | 8 | 1 | 2 | 88.89% | 80.00% | 84.21% |
| state | 12 | 10 | 5 | 2 | 66.67% | 83.33% | 74.07% |
| relation | 15 | 12 | 7 | 3 | 63.16% | 80.00% | 70.59% |
| abstract | 11 | 10 | 2 | 1 | 83.33% | 90.91% | 86.96% |

Largest weaknesses by F1: **relation** (70.59%, 7 FP / 3 FN), **state** (74.07%, 5 FP / 2 FN).

Full per-meaning predictions, probabilities, FP/FN memberships, and high-confidence errors are in [`diagnostics/errors.json`](diagnostics/errors.json). A high-confidence wrong membership is defined as an incorrect binary decision with probability at least 0.8 or at most 0.2.
