# Image dataset expansion and CLIP/MLP comparison — 28 October 2026

This is the historical Q8-text/FP32-vision experiment from 1.12.0. Since 1.12.2,
the app uses FP16 text. The archived vectors and rejected head retain their old
encoder identity and cannot train or initialize the current model. Reproduce the
historical encoded comparison from tag `v1.12.0`; current pixel evaluation produces
new FP16 representations. See [the current text-precision comparison](image-text-fp16.md).

The larger experiment does **not establish that adding the MLP improves the app's
image choices**. After fixing an encoder precision bug, the app's CLIP ranker
picked a verified matching photo in 107/120 unseen test galleries; adding the
32/16 MLP achieved 105/120. Raw image–meaning cosine achieved 101/120.

| Ranker | Training (385 galleries) | Validation (133) | Test (120) |
| --- | ---: | ---: | ---: |
| Raw CLIP image–meaning cosine | 338 (87.8%) | 113 (85.0%) | 101 (84.2%) |
| App CLIP ranker with fixed scene/content scoring | 347 (90.1%) | 117 (88.0%) | **107 (89.2%)** |
| App CLIP plus 32→16 semantic MLP | 367 (95.3%) | 113 (85.0%) | 105 (87.5%) |

The MLP's four extra matches over raw cosine are not a reliable improvement at
this sample size. A paired bootstrap over whole meaning families includes zero
for the difference against raw CLIP (approximately −0.4 to +8.7 percentage points)
and against the app baseline (−5.6 to +3.0 points). These intervals average whole
families, so their estimates differ slightly from gallery-weighted percentage
point differences. Distractors can be shared within a split; bootstrap families
do not account for every possible cross-family correlation.

The candidate improved test pairwise loss from 0.4039 to 0.2788, but it made two
fewer correct first choices. Improving average separation from all distractors
does not guarantee that the highest-scored candidate is better. The activation
check requires reliable first-choice improvement over both baselines as well as
the existing loss/accuracy checks. This candidate failed and remains disabled.
The app also no longer initializes personal learning from a rejected head's
hidden layers.

## The precision bug that invalidated the earlier comparison

The previous implementation explicitly forced `dtype: q8` on both CLIP towers.
The pinned model author's configuration requires **fp32 vision**; only the text
tower should remain q8. The model author documents vision sensitivity to
quantization in the [official model change](https://huggingface.co/Xenova/mobileclip_s0/discussions/3/files)
and [pinned configuration](https://huggingface.co/Xenova/mobileclip_s0/blob/757d59c9c6870a76a4b0306f05f5061bca15c39f/config.json).

A controlled sanity check used four training photos, identical text embeddings,
image bytes and preprocessing, changing only vision precision. Correct prompt
ranking was 1/4 with q8 vision and 4/4 with fp32 vision. The broader corrected
benchmark was run afterward using the author's prescribed setting; precision
was not selected by comparing variants on test examples.

The earlier 9/18 versus 13/18 experiment and the initial v2 q8 probe both used
invalid vision representations for this task. Their results remain historical
artifacts, but they cannot establish the benefit or harm of the MLP architecture
with a correctly configured encoder. The old 90 examples also included personal
photo preferences, whereas v2 evaluates semantic correctness, so their percentages
are not directly comparable even apart from the precision bug.

The app worker and offline evaluator now use the same pinned model revision,
q8 text, fp32 vision, and proportional full-frame preprocessing. The new encoder
tag prevents old image/text cache entries, old personalization weights and old
feature records being used with the corrected representation. Existing feedback
is retained with its original encoder identity; incompatible records remain
archived rather than silently relabeled as new embeddings. Reuse fails closed
when current pixels cannot be embedded. The optional complete model/runtime
download estimate is approximately 150 MB; an existing cache can reuse unchanged
files. Raw model files are not bundled in the app release.

## Dataset construction and independent visual review

The source is COCO val2017 with five original human captions per image, object
annotations, recorded original source links and image-license IDs. A pinned
mirror and SHA-256 checks make downloads reproducible. Generic word definitions
and scene descriptions were fixed before selecting photographs or calculating
model scores. Caption agreement proposed positives; absence from captions did
not by itself create a negative label.

The candidate pool contained 973 galleries over 244 proposed meanings, each with
up to five photos in randomized order. Three resumed Luna agents classified the
remaining 552 original galleries; a further Luna pass inspected 93 extension
galleries. Earlier completed blind reviews cover the other 328. Reviewers saw only
photos and exact definitions, without proposed answers or CLIP/MLP scores.

Their rubric was:

- The target object must be visibly identifiable.
- An action must actually be shown; standing beside an object is not using it.
- An attribute or spatial relation must visibly apply to the depicted subject.
- Several photos may fit. Beauty, composition and personal taste do not decide
  semantic correctness.
- Tiny, blurred, occluded, incidental or inferred evidence is uncertain.

A Terra agent independently checked 80 galleries and the root agent checked 24
more. Disagreements became uncertain; they were not resolved by choosing the
label that favored a model. In the Terra sample, 45/400 candidate labels differed
from the primary review, including disagreements involving uncertainty. This is
agent-curated ground truth with known ambiguity, not a professional human-label
study.

A caption-proposed reference had to be verified visually or its gallery was
excluded. Other valid photos and uncertain candidates were removed from the
correct-versus-wrong comparison rather than mislabeled. This excluded 335 galleries.

The retained data contains:

- **2,390 comparisons in 638 galleries**, covering **237 meanings and 19 domains**.
- **1,736 distinct photos**, with a different reference in every retained gallery.
  A photo appears in at most four retained galleries, including distractor uses.
- Training: 1,459 comparisons, 385 galleries, 141 meanings, 1,036 photos.
- Validation: 475 comparisons, 133 galleries, 49 meanings, 355 photos.
- Test: 456 comparisons, 120 galleries, 47 meanings, 345 photos.
- 35 action meanings in 89 galleries, plus objects, visible attributes, food,
  transport, clothing, nature, household items, sports and scenes.
- 55 retained explicit hard action/object contrasts. Many other distractors are
  substantially different from the target, so this is not a comprehensive test
  of fine action understanding. There is no running-fox/standing-fox benchmark.

Whole meaning families, source photo IDs, canonical URLs and byte hashes remain
in one split. Exclusions preserve the original split assignments. A conservative
128-bit difference-hash and aspect-ratio screen found no cross-split near duplicate
pairs; it excluded one low-quality source photo. This screen cannot prove that
all photos are perceptually unrelated. Deliberately related contrast examples
should remain similar in subject while differing in the relevant action.

## Training protocol and what ships

The fixed experiment uses the selected 1,539→32→16→1 architecture, 49,825
parameters, a bounded semantic residual of ±0.08, batch size 8, at most 30 epochs,
regularization, and validation early stopping. It stopped after 12 epochs and
about 24 seconds of local CPU training. Test labels did not select the number of
epochs, learning rate or architecture. Raw pixels and texts were encoded using
the real pinned models; provider retrieval and Gemini generation were not called
in this benchmark. Desktop Node/Sharp inference is not a physical-phone benchmark.

Generic examples now carry an explicit `semantic` task. Ordinary app choices carry
`preference`, including older user records without a task marker. The two tasks
cannot silently train each other's weights. If a future semantic head passes its
benchmark, it stays fixed while personal learning fits a separate small bounded
correction. The validated semantic features can initialize that correction with
zero output and only 17 trainable final-layer parameters. Without an accepted
semantic head, the app continues using CLIP and its existing guarded personal
learning path.

This release includes the corrected encoder configuration, task separation and
reproducible dataset/evaluation tooling. It does **not** activate this rejected
generic MLP. The existing regular picker UI gains no labeling tasks, technical
counters or uncertainty explanations.

Artifacts:

- [Dataset and reproduction instructions](../tests/fixtures/image-pretraining-v2/README.md)
- [Complete benchmark and per-gallery results](image-pretraining-v2-report.json)
- [Model packaging decision](image-pretraining-v2-summary.json)
- [Encoder precision diagnostic](image-encoder-precision-check.json)

The held-out set has now been inspected. Any further architecture, loss or
hyperparameter selection needs new independent evaluation examples. The next
useful experiment would emphasize more hard same-subject action/attribute
contrasts and select candidates on validation first-choice ranking, rather than
assuming that more layers or lower average pairwise loss guarantees better picks.
