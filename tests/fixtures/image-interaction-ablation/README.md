# Remove explicit image×meaning products

All 24 fits are retained in `models/`, with selected and epoch-600 native
states, folded runtime weights and provenance. Native input is 1,027 numbers:
512 image, 512 target meaning, three CLIP semantic signals. Hidden layers stay
32/16; dense parameter count is 33,441 (+96 for BatchNorm). The retained initial
weights are copied from the parent; initial CLIP-matching scores are preserved.

The four families are baseline, L2, BatchNorm and both. Settings stay LR=0.0002,
L2=0.0001 where applicable, batch 8, gradient norm clip 1 and 600 epochs without
early stopping. This isolated ablation uses raw inputs; input standardization
is studied separately. Compact runtime verification expands zero columns for
the removed products, while native training really has 1,027 inputs.

Reproduce from `v1.12.8`, after parent preparation/requirements in
[`../image-regularization/README.md`](../image-regularization/README.md):

```sh
python3 scripts/verify-image-interaction-ablation.py
python3 scripts/benchmark-image-interaction-ablation.py --lane=0
python3 scripts/benchmark-image-interaction-ablation.py --lane=1
python3 scripts/benchmark-image-interaction-ablation.py --lane=2
python3 scripts/benchmark-image-interaction-ablation.py --tiny
python3 scripts/benchmark-image-interaction-ablation.py --aggregate
node scripts/verify-regularization-inference.mjs work/image-interaction-ablation
node scripts/summarize-image-regularization.mjs work/image-interaction-ablation
python3 scripts/plot-image-regularization.py work/image-interaction-ablation work/image-interaction-ablation/figures
```

The parent frozen report is part of provenance; reproduce it first or copy
`docs/image-regularization/report.json.gz` to the corresponding `work/` path.
All 24 models must be complete before aggregate test scoring. The original
photo/meaning split and source data are preserved. The same tiny/full fitting
kernel passes every eight-gallery memorization check.

This follow-up was requested after parent test results were inspected. It is
not a fresh blind evaluation or a physical-phone benchmark. Removing features
also reduces parameter count and the number of L2 terms. No experimental head
is active. See the [combined report](../../../docs/image-input-followups.md).
