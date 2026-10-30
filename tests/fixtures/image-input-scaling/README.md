# Input normalization without BatchNorm

Models use the preserved same-meaning split and frozen FP16-text/FP32-vision
features. `models/` contains all 28 fixed/tuned/pilot native and folded fits.
The parent exact initial weights/reference are in `../image-regularization/prepared.json.gz`.
Every experimental folded model has `genericValidation.accepted:false`.

Input scaling is training-only per-feature mean/std, with minimum std 0.001.
The first layer is reparameterized to preserve the initial CLIP-matching
function. Both families have all 1,539 inputs, including products; neither has
BatchNorm. One family has true L2=0.0001. All train 600 epochs without early
stopping, batch 8, gradient norm clip 1. Fixed LR is 0.0002; validation-only
search over 0.00002/0.0001/0.0002 selects 0.00002 without L2 and 0.0001 with L2.

Reproduce from `v1.12.8`, after the parent preparation described in
[`../image-regularization/README.md`](../image-regularization/README.md):

```sh
python3 scripts/verify-image-input-scaling.py
python3 scripts/benchmark-image-input-scaling.py --lane=0
python3 scripts/benchmark-image-input-scaling.py --lane=1
python3 scripts/benchmark-image-input-scaling.py --lane=2
python3 scripts/benchmark-image-input-scaling.py --select
python3 scripts/benchmark-image-input-scaling.py --final-lane=0
python3 scripts/benchmark-image-input-scaling.py --final-lane=1
python3 scripts/benchmark-image-input-scaling.py --final-lane=2
python3 scripts/benchmark-image-input-scaling.py --tiny
python3 scripts/benchmark-image-input-scaling.py --aggregate
node scripts/verify-regularization-inference.mjs work/image-input-scaling
python3 scripts/plot-image-input-scaling.py work/image-input-scaling/figures
```

The parent report file `work/image-regularization/report.json.gz` is recorded
as provenance; complete the parent reproduction first, or copy its frozen
report from `docs/image-regularization/report.json.gz`. Test scoring requires
all 24 fixed/tuned final fits frozen. Unselected pilots are not test-tuned.
`docs/image-input-scaling/` preserves full metrics, preflight, normalization
statistics, selection, curves and independent inference proof.

This is a user-requested exploratory follow-up after parent test results were
inspected. It does not establish blind acceptance or personal preference
quality. The original dataset and prior models are unchanged.

See the [combined report](../../../docs/image-input-followups.md).
