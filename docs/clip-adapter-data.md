# Current-encoder adapter data preparation

`scripts/prepare-clip-adapter-data.mjs` converts the reviewed semantic image corpus into paired adapter examples. It does not fit or activate an adapter, use user preference records, or fetch image/model files.

## Run after selecting the classifier

Pass the selected, valid six-output classifier explicitly. The script deliberately has no classifier default or historical fallback:

```sh
node scripts/prepare-clip-adapter-data.mjs \
  --classifier tests/fixtures/meaning-taxonomy/regularized-expansion/classifier-regularized-selected.json
```

The selected classifier must satisfy the current `meaning-category-v1` schema, six category order, 512-D current `CLIP_TAG`, and the original-definition-only prompt protocol. The tool validates its weights/config, captures file and model hashes and provenance, and saves the raw six sigmoid outputs. It does not threshold, argmax, or softmax them. Router weights are `p / sum(p)`; if all six probabilities sum to zero, it records a uniform fallback while retaining the all-zero probability vector.

This converter should only be run once the explicitly selected expanded taxonomy classifier exists and has been chosen. It fails before writing outputs if required sources or that classifier are absent or inconsistent.

## Source-to-example mapping

The sources are:

- `tests/fixtures/image-pretraining-fp16/embeddings.json.gz` and `tests/fixtures/image-pretraining-v2/cases.json`: the current FP16-text/FP32-vision vectors and 638 reviewed case records.
- `tests/fixtures/meaning-taxonomy/dataset.json` and `embeddings.json.gz`: exact original-definition prompt checks and source quarantine case IDs.
- `tests/fixtures/image-crops/manifest.json`, `embeddings.json.gz`, and `review-decisions.json`: approved train-only crop pairs, parent mappings, and review provenance.
- The explicit `--classifier` artifact.

Every source image/text event is required to be `task: semantic`, `kind: comparison`, and the reviewed wrong-label encoding (`label: 0`). The stored `features`, `preferredFeatures`, and `meaningFeatures` each contain 512 FP32 CLIP coordinates plus three legacy MLP score signals. The converter calls `decodeFeatures`, checks for exactly 515 values, strips the three tails, and L2-normalizes the first 512 values. It maps the wrong candidate and selected positive by case ID, candidate ID, source URL, and source SHA-256. It also verifies every text vector against the base taxonomy's exact word/POS/definition prompt vector with cosine at least `1 - 1e-6`.

Each valid event becomes a target-meaning triplet containing the positive image, wrong image, meaning vector, and all six classifier probabilities derived only from that meaning vector. Repeated selected-positive references remain repeated in the triplet objective, but their per-gallery weights sum to one. A separate positive point-pair table deduplicates exact image-hash/meaning-prompt pairs. The crop fixture adds only approved cropped positives. Original parents are deduplicated against the main positive table and share a total point-pair weight of one with their crop (0.5 each). Crops never inherit negative labels, add negative comparisons, or enter validation/test.

If a selected positive is invalid, has no usable comparison event, mismatches its context/source identity, or belongs to the 30 crop-review-rejected parent cases, the converter excludes the entire case and records why. It excludes all case IDs quarantined by the original taxonomy. Other malformed source vectors or irreconcilable source metadata fail conversion rather than being silently relabeled.

## Leakage groups and outputs

Every triplet/point pair carries group IDs for meaning family, normalized headword, and all involved photo SHA-256 values. Crop rows also carry the original parent-photo group. The converter takes the transitive closure across these links. Components contained in one source split keep that split; a component joining train/validation/test is assigned `quarantine` as a whole and retains its original split(s) for inspection. No row is moved into train. It reports component counts, cross-split components, exclusions, and post-quarantine split counts.

The generated directory `tests/fixtures/clip-adapter-training/` contains:

- `manifest.json`: source hashes, selected classifier file/model hashes and provenance, task/category contract, triplets, deduplicated positive pairs, weights, group IDs, components, exclusions, and summary counts.
- `vectors.json.gz`: a content-bound store of deduplicated unit 512-D image vectors (keyed by SHA-256) and exact-prompt meaning vectors.

No accuracy claim follows from converting these examples. The old image corpus has already been used to select/inspect a prior semantic MLP, so its test partition is retired for model selection and is not a fresh blind confirmation set. Adapter selection needs new independently reviewed meaning/image groups. The category model is a separate text pilot, is not an image-label source, and its six outputs are not calibrated probabilities. Its text-training meanings can overlap the adapter corpus’s existing word/definition prompts; using the frozen head to route those meanings is an explicit conditioning feature, not fresh evidence of category generalization or image accuracy. This dataset is not personalization: no real user preferences are included.

## Converted result

The conversion retained 599 of 638 source galleries and 2,241 explicit
positive-versus-wrong comparisons: 1,344 train, 475 legacy validation, and 422
legacy test. The 39 excluded galleries are the union of 15 taxonomy-quarantined
galleries and 30 crop-review-rejected positives; six occur in both lists.

The separate point-pair table has 954 positives: 710 train (355 originals plus
355 crops), 133 legacy validation, and 111 legacy test. The vector store has
2,063 image vectors and 229 exact-prompt meaning vectors. The image count
includes crop derivatives, not additional independent photos. Nineteen connected
components remain isolated by split (nine train, five validation, five test);
none crosses splits. These image evaluation partitions remain retired for
adapter selection. The fresh 120-text classifier test does not provide a fresh
image–meaning test.

Exactly **one meaning category classifier** supplies the six routing outputs.
The selected regularized 32-unit head is recorded in
`tests/fixtures/meaning-taxonomy/current-classifier.json`. Each triplet uses the
same target-meaning probabilities for its positive and negative images. There
is no image category classifier in this conversion.

The routing cache was regenerated after the targeted text expansion and L1/L2
comparison. The image/meaning vectors, semantic labels, crop choices, groups,
and record counts are unchanged; the six conditioning probabilities and their
classifier provenance now refer to the selected regularized head. Neither the
48-text confirmation nor the earlier 120-text test supplies a fresh image test.

The category classifier's weights and future CLIP transform weights serve
different jobs. The classifier maps a text vector to six memberships. Future
image/text residual matrices map CLIP vectors into better matching features,
conditioned on those memberships. The MLP's old weights cannot simply be
reshaped into those matrices. Its retained **examples** can train them with a
pairwise/contrastive objective, initialization near the identity, and
regularization against collapse. Category-aware prompting and genuinely
reviewed hard negatives remain planned comparisons. Low-confidence routing
must retain an unchanged-CLIP path; normalized routes alone are not a validated
uncertainty policy. No adapter matrices have been trained or activated here.
