# Reviewed image crop augmentation

This fixture holds image and meaning embeddings for reviewed train-only crop
pairs. It is intended for the image semantic personalizer; it is **not** text
classifier augmentation. Each pair label means that an image depicts the
associated meaning text. Approved original/crop pairs share the same parent
photo and meaning groups so training can balance their weights.

## Reproduce the draft crops

The crop builder reads the pinned source cases and exact local source photos. It
does not download images. The selected parent JPEGs must already be present at
`work/mlp-fp16-retrain/photos/images/` with hashes matching the fixture. If that
local photo cache is absent, prepare it first (this fetches the pinned source
photos):

```sh
python3 scripts/prepare-image-dataset.py \
  tests/fixtures/image-pretraining-v2/cases.json \
  work/mlp-fp16-retrain/photos
```

Pillow is available in the bundled Python libraries. Generate the deterministic
crops, review manifest, and contact sheets with:

```sh
PYTHONPATH=work/mlp-fp16-retrain/python-libs \
  python3 scripts/prepare-image-crops.py
```

The outputs are local working artifacts under `work/image-crop-augmentation/`.
They are generated from the pinned fixture and local photos; the raw source
photos are not committed here.

## Review and encode

The review decisions in `review-decisions.json` record AI visual review, not
human-expert ground truth. The encoder verifies that file's source, draft
manifest, and meaning taxonomy hashes; all 385 decisions; selected-parent hashes;
and image and taxonomy split boundaries. It uses the pinned local MobileCLIP
model with downloads disabled. It encodes only approved crops and accepted
original parents, and stores one meaning text vector per unique meaning using
the original prompt:

```text
A photo illustrating <word> (<part of speech or "word">): <definition>
```

No review labels or reasons are included in the text prompt. Run the encoder
after the local image model and parent photos are available:

```sh
node scripts/encode-image-crops.mjs
```

The outputs are `manifest.json`, `embeddings.json.gz`, and
`docs/meaning-taxonomy-training/diagnostics/crops.json`. Excluded crop decisions
are not treated as verified negatives; their original legacy positive labels
are marked as needing separate re-audit before clean training use.

## Reviewed result and limits

All 385 proposed crops were inspected against the exact definitions, with
original/crop contact sheets. 355 passed all checks; 24 were excluded for
unclear/incorrect evidence and six more for connected-meaning split quarantine. The accepted
subset contains 355 originals plus 355 crops: **710 positive image–meaning
pairs**, 136 meanings and still only **355 independent photos**. Each crop
retains 80% or slightly more of the source area; width and height each retain
roughly 89.4%. This doubles the eligible positive subset, not the entire
positive/negative corpus and not the number of independently sampled photos.

Every accepted original and crop has a separately pixel-encoded 512-coordinate
vector. Mean parent/crop cosine is 0.96458 (range 0.80696–0.99245). This is an
embedding-diversity check, not evidence that crop training improves accuracy.
Meaning vectors use the same pinned encoder and label-free original definition
prompt. The current text classifier does not receive these image vectors.

The generator used Pillow 13.0.0 (`scripts/requirements-image-crops.txt`). The
saved `draft-manifest.json` preserves the reviewed metadata; raw source photos
and generated crops remain in the local `work/` cache. Rebuilding variants with
a different image-library/compression version may require another hash-bound
review. Do not silently edit review hashes to pass validation.

Excluded rows include a cat labeled puppy, an empty toilet labeled sit, unclear
action cues, and crops losing peripheral subjects. They are withheld positives,
not new negative labels. The legacy corpus itself stays frozen so its old
reports remain reproducible. Before adapter training, resolve flagged parent
labels, add verified near-miss negatives, and keep real uncropped evaluation
images untouched. Sample original and crop at half the original parent's weight
each to retain the positive/negative balance. No adapter was trained by this
preparation step, and no personal-taste labels were created.
