# Current-encoder retraining snapshot

`embeddings.json.gz` contains freshly computed FP16-text / FP32-vision MobileCLIP
features from the 1,736 SHA-256-verified photographs in
[`../image-pretraining-v2/cases.json`](../image-pretraining-v2/cases.json).
Neither old Q8 text vectors nor old trained layers were reused or retagged.

The manifest, agent-reviewed semantic labels, exclusions and disjoint meaning/
family/photo splits are unchanged. These labels measure meaning correctness;
they are not observations of an individual user's taste. The benchmark has
already been inspected and is a regression set, not a fresh blind holdout.

`candidate.json.gz` is the trained 1,539→32→16→1 semantic MLP. It is saved for
inspection and reproducibility; it is not active in the app. Its SHA-256 and
the complete results are in [`../../../docs/image-mlp-fp16/`](../../../docs/image-mlp-fp16/).

Reproduce with current source:

```sh
node scripts/retrain-image-personalizer.mjs tests/fixtures/image-pretraining-fp16/embeddings.json.gz --manifest=tests/fixtures/image-pretraining-v2/cases.json --output-dir=work/mlp-fp16-reproduction
python3 scripts/verify-image-training.py tests/fixtures/image-pretraining-fp16/embeddings.json.gz tests/fixtures/image-pretraining-fp16/candidate.json.gz tests/fixtures/image-pretraining-v2/cases.json work/mlp-fp16-reproduction work/mlp-fp16-reproduction/independent-verification.json
python3 scripts/plot-image-training.py work/mlp-fp16-reproduction work/mlp-fp16-reproduction/figures
```

The Python checks require NumPy and Matplotlib. The JS trainer uses no Python
training implementation; the numerical fitter is shared with production.

To independently re-encode pixels, use `scripts/prepare-image-dataset.py` and
`scripts/evaluate-image-pipeline.mjs` as documented by the original manifest.
Download consent is explicit via `--download-model` if the pinned files are
not already cached. Raw photographs/model weights are not bundled in releases.

The fixed protocol is [`../../../docs/image-mlp-fp16-protocol.json`](../../../docs/image-mlp-fp16-protocol.json).
Test curves are computed after validation has selected a checkpoint. Bootstrap
training resamples only training families; validation/test never enter its fits.
The small-batch memorization check deliberately reuses eight training galleries
and cannot authorize a production model. Its nonzero loss floor comes from the
unchanged ±0.08 semantic score bound.
