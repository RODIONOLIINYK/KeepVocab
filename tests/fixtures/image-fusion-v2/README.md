# Unrestricted equal-fusion MLP checkpoints

`candidate.json.gz` contains the checkpoint selected by validation first-choice
accuracy and loss; `last-candidate.json.gz` contains the final fitted checkpoint.
Both use `meaning-mlp-32-16-fusion-v2` and the same FP16-text / FP32-vision encoder.
They are retained for offline evaluation; neither is an active generic app head.

Features are shared with
[`../image-pretraining-fp16/embeddings.json.gz`](../image-pretraining-fp16/embeddings.json.gz).
These are the actual verified current-encoder features; the old bounded head
stored beside them is not reused. The manifest/semantic labels remain
[`../image-pretraining-v2/cases.json`](../image-pretraining-v2/cases.json).

Run from tag **v1.12.6** for exact reproduction:

```sh
node scripts/tune-image-fusion.mjs --output-dir=work/fusion-reproduction
python3 -m pip install -r scripts/requirements-image-training.txt
python3 scripts/verify-image-training.py tests/fixtures/image-pretraining-fp16/embeddings.json.gz work/fusion-reproduction/candidate.json.gz tests/fixtures/image-pretraining-v2/cases.json work/fusion-reproduction work/fusion-reproduction/verification.json
python3 scripts/verify-image-training.py tests/fixtures/image-pretraining-fp16/embeddings.json.gz work/fusion-reproduction/last-candidate.json.gz tests/fixtures/image-pretraining-v2/cases.json work/fusion-reproduction work/fusion-reproduction/last-verification.json
python3 scripts/plot-image-fusion.py work/fusion-reproduction work/fusion-reproduction/figures
```

The original run continued its diagnostic/bootstrap stage with
`scripts/finish-image-fusion-benchmark.mjs`, after checking Float32 finite-
difference perturbation sizes. It uses the same recipe and fixed data, not new
hyperparameters chosen from test results. `--replay` verifies the production
entry point against both recorded weights. Two independent eight-model segments
(`--start=0 --count=8`, `--start=8 --count=8`) can run concurrently, followed by
`--aggregate`; each segment checks data and recipe hashes.

See the [complete report](../../../docs/image-fusion-v2.md) for all settings,
training/validation/test plots, regularization controls, same-pipeline proof and
the empirical bias–variance limits. This is semantic regression data, not a
new blind benchmark or observations of an individual's personal taste.
