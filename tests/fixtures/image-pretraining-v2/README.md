# Diverse semantic image dataset, version 2

This fixture measures whether a photograph visibly depicts a fixed word meaning.
It does not represent a user's personal taste.

- 973 candidate galleries were inspected without model scores or proposed labels.
- The retained dataset contains 638 galleries, 2,390 correct-versus-wrong
  comparisons, 237 meanings, 19 domains and 1,736 distinct source photos.
- Each retained reference photo is different. Candidate order was randomized.
- Train: 1,459 comparisons / 385 galleries / 141 meanings / 1,036 photos.
- Validation: 475 comparisons / 133 galleries / 49 meanings / 355 photos.
- Test: 456 comparisons / 120 galleries / 47 meanings / 345 photos.
- Source photos, byte hashes, target meanings and declared meaning families are
  disjoint across splits. A difference-hash screen found no cross-split near
  duplicates. This screen cannot prove universal perceptual independence.
- Repeated distractors are limited; a retained photo appears in at most four
  galleries. Comparisons from one gallery are not independent observations.

`cases.json` contains the fixed definitions/scenes, source URLs and image hashes,
original human-caption evidence, license IDs, declared splits and visual-review
provenance. Captions only proposed examples; caption absence never established a
negative. Other valid photos and uncertain photos were removed. The original
caption-proposed reference had to be confirmed visually or its gallery was
excluded. Of the 973 galleries, 335 were excluded.

`audit/reviews` preserves every primary visual classification. `audit/blind-index.json`
is the index shown to reviewers and has no proposed answer. The root spot-check
and Terra independent check cover 104 galleries in total. Disagreement becomes
uncertain rather than a majority vote. `audit/draft-manifest.json.gz` preserves
the pre-exclusion source data and exact source-quality audit. Ordering dates are
stable dataset metadata, not actual app-user answer times.

The source is [COCO val2017](https://cocodataset.org/#home), using human captions
and object annotations from a [pinned mirror](https://huggingface.co/datasets/merve/coco/tree/9e50abcdc1361852f34841af4939cbcd2d37c92f).
Image licenses and original Flickr source links are recorded in the manifest.
Raw photographs are not committed or shipped in the app.

`embeddings.json.gz` contains the actual pinned MobileCLIP image/text features
with full-frame preprocessing. The image tower uses the author's required fp32
configuration; text uses q8. `candidate.json.gz` preserves the rejected semantic
MLP for reproducibility. It is not an active app model.

Download and independently rerun the pixels:

```sh
python3 scripts/prepare-image-dataset.py tests/fixtures/image-pretraining-v2/cases.json work/image-pretraining-v2-reproduction
node scripts/evaluate-image-pipeline.mjs work/image-pretraining-v2-reproduction/cases.json --download-model --output=work/image-pretraining-v2-reproduction/encoded-report.json
```

Repeat the frozen training recipe from the saved real embeddings:

```sh
node scripts/benchmark-image-personalizer.mjs tests/fixtures/image-pretraining-v2/embeddings.json.gz --manifest=tests/fixtures/image-pretraining-v2/cases.json --output=work/reproduced-benchmark.json --candidate-output=work/reproduced-candidate.json
```

The fixed recipe is at most 30 epochs, batch 8, with validation early stopping.
The recorded run stopped after 12 epochs. No test results selected hyperparameters.
The corrected representation was mandated by the encoder author's configuration
and confirmed on training photos, not selected by evaluating test variants.

See [the experiment report](../../../docs/image-pretraining-v2.md) for measured
results and limitations. This dataset is now inspected; future model selection
needs fresh held-out data. Many distractors differ substantially from the target.
Only 55 retained comparisons are explicitly designated hard action/object
contrasts. The set contains no running-fox versus standing-fox benchmark.
