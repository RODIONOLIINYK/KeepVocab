# L2 / BatchNorm research artifacts

This separate experiment preserves every original dataset and model. It uses
the photo-disjoint `image-meaning-shift/split.json`; no photos are downloaded or
CLIP models retrained. `prepared.json.gz` records exact JavaScript initial
weights, gradients and reference updates. `models/` stores all 32 pilot/final
fits with selected and epoch-600 native states, running statistics, folded
ordinary runtime weights and provenance. These are offline artifacts; none is
an active generic or personal app head.

The four final families use the same hidden 32/16 architecture, batch 8,
gradient-norm clip 1, learning rate 0.0002 and fixed 600 epochs. True L2 coefficients
are chosen from the validation pilot before test scoring. BatchNorm has learned
gain/shift and frozen evaluation statistics; the linear output is unrestricted.
See the [full report](../../../docs/image-regularization.md) for interpretation
and the limitations of the small retrospective test set.

Reproduce from tag **v1.12.8**, in the repository root, with the pinned NumPy and
Matplotlib versions in `scripts/requirements-image-training.txt`:

```sh
python3 -m pip install -r scripts/requirements-image-training.txt
node scripts/prepare-image-regularization.mjs
python3 scripts/verify-image-regularization.py
python3 scripts/check-regularization-invariants.py
python3 scripts/benchmark-image-regularization.py --pilot-lane=0
python3 scripts/benchmark-image-regularization.py --pilot-lane=1
python3 scripts/benchmark-image-regularization.py --pilot-lane=2
python3 scripts/benchmark-image-regularization.py --select
python3 scripts/benchmark-image-regularization.py --final-lane=0
python3 scripts/benchmark-image-regularization.py --final-lane=1
python3 scripts/benchmark-image-regularization.py --final-lane=2
python3 scripts/benchmark-image-regularization.py --tiny
python3 scripts/benchmark-image-regularization.py --aggregate
node scripts/verify-regularization-inference.mjs
node scripts/summarize-image-regularization.mjs
python3 scripts/plot-image-regularization.py work/image-regularization work/image-regularization/figures
python3 scripts/diagnose-bn-spikes.py --plot-dir work/image-regularization/figures
```

Each three-lane stage can instead run concurrently, then join before selection
or aggregation. On macOS the recorded runs set `VECLIB_MAXIMUM_THREADS=1` to
limit CPU use per process. The numerical checks establish baseline replay and
BN derivatives; exact reproduction still depends on the documented numerical
environment. The model is never fitted on validation/test examples, and all
24 final weights must be frozen before aggregate test evaluation.

`docs/image-regularization/curves/` contains all 32 complete training/validation
trajectories. Only final-family runs have post-hoc test trajectories; unselected
pilot test outcomes are not used for tuning. Test curves are sampled every ten
epochs plus selected checkpoints. Full transient snapshots can be regenerated
under ignored `work/`; raw photos and CLIP weights are not included here.

Models carry `genericValidation.accepted:false`. BatchNorm inference can be
folded into ordinary dense parameters, but that algebraic compatibility is not
evidence of independent semantic acceptance or physical-phone performance.
