# Image screening and the current personal ranker — 1.12.9

The live chooser now encodes up to 30 candidate photos with frozen MobileCLIP S0
(FP16 text, FP32 vision). It keeps a photo only when selected-meaning similarity
is **at least 0.19** and unwanted-content similarity is **below 0.20**. These are
cosine-based signals, not probabilities. This operating point was selected on the
older corpus validation split and explicitly retained by the user before the new
UI evaluation. New labels did not change it.

The personal MLP then orders the surviving photos. It cannot bring a rejected
photo back. Until a personal model passes the existing held-out acceptance check,
the app uses its CLIP ranking. Diversity ordering and near-duplicate removal
remain. A failed enabled screening pass returns no unverified photos; the
explicitly disabled local-model path remains manual metadata search.

The current MLP is `meaning-preference-32-16-v3`: 1,027 inputs, hidden layers of
32 and 16 ReLU units, and 33,441 dense parameters. Its inputs are 512 image
coordinates, 512 target-meaning coordinates, and three CLIP signals. The explicit
image×meaning feature block has been removed. Its raw learned output determines
personal ordering, without the former 50/50 fusion or residual cap. The target
meaning still allows contextual preferences. An MLP may learn useful nonlinear
relationships in these embeddings, but it cannot recover visual information the
frozen encoder failed to represent.

Old weight layouts are not applied to new inputs. Saved feedback remains in the
history and can be used for retraining. Public semantic examples are not the
user’s personal taste: no public semantic head is activated as a personal model.
Historical v1/v2 research code is isolated in
`scripts/lib/image-personalizer-v2.mjs`; its saved results and fixtures retain
their original dimensions. Batch normalization remains an offline experiment.

## What the UI data contains

A **gallery** is one exact target meaning and one particular candidate set.
Another search or “Find more” can produce another gallery for the same meaning.
It is not every image ever associated with that word.

Two independent GPT-6 Luna agents reviewed actual rendered image candidates in
an isolated localhost app. The installed app and its study statistics were not
used. Agent B saw the images and exact meaning without Agent A’s labels, chosen
image, or CLIP scores. Only unanimous fit/wrong judgments become binary semantic
labels: **1 means depicts this meaning; 0 means does not depict this meaning**.
Uncertainty and disagreement remain recorded with a null label.

The configured-Pexels pilot contains 60 observations in eight galleries: run,
stand, carry, beside, pour, drink, open, and closed. There are 19 unanimous fits,
21 unanimous wrong images, and 20 excluded observations. All 60 have verified
pixel hashes and finite 512-coordinate image and meaning embeddings. Twenty-one
semantic clarity comparisons use an actually clicked, unanimously suitable photo
against a unanimously wrong alternative. A comparison’s target 1 means “rank the
chosen photo higher”; it does not invent a zero label for an unchosen photo.

These examples are retained as **evaluation-only**, despite the export filename
`training-examples.json`; no MLP or CLIP was fitted on them. They are not personal
preference labels. The older datasets and exclusions are preserved.

## Fixed-threshold CLIP results

| Source | Suitable kept | Wrong images accepted | Correctly rejected wrong images | Suitable rejected |
|---|---:|---:|---:|---:|
| Older keyless UI, 86 consensus photos | 4 / 5 | 9 / 81 | 72 / 81 | 1 / 5 |
| Configured-Pexels UI, 40 consensus photos | 16 / 19 | 6 / 21 | 15 / 21 | 3 / 19 |
| Same pilot, excluding photos in older UI | 16 / 18 | 6 / 13 | 7 / 13 | 2 / 18 |

The new pilot includes Pexels and existing public-catalog fallbacks; it is not a
Pexels-only comparison. Eleven of its 60 pixel hashes also occur in the old UI
pilot, and none occur in the threshold-calibration corpus. Removing the repeated
photos leaves 31 consensus observations. AUROC using continuous selected-meaning
similarity is 0.773 for older UI, 0.799 for the full new consensus set, and 0.718
for the subset excluding older photos. These small grouped samples do not prove
a stable improvement or establish that all displayed images will be suitable.
In particular, difficult action/relationship distinctions still produce false
positives. We kept the requested threshold rather than optimizing it on these
evaluation answers.

On the original corpus, the frozen 0.19 gate keeps 70/133 suitable validation
images while accepting 4/475 wrong ones. Its original test result is 79/120
suitable kept and 6/456 wrong accepted. The discrepancy with direct UI results
is evidence that corpus performance does not describe the app domain reliably.
The earlier report’s `currentAppThresholds` field refers to the pre-change
0.30/0.38 values, not the new screen.

Reports: [replayed audit](image-screening-1.12.9/screening-audit.json),
[validation selection](image-screening-1.12.9/validation-thresholds.json),
[older UI diagnostic](image-screening-1.12.9/clip-keyless-ui.json), and
[new UI diagnostic](image-screening-1.12.9/pexels-ui.json).

## Sources and access

Fresh installations default to the existing keyless public catalogs. Configured
Pexels searches now get the first opportunity to fill the candidate pool; public
catalog requests are skipped when at least 30 distinct, non-rejected Pexels
photo URLs are available. Otherwise public sources fill the remaining pool.

We did not find and verify a new broad keyless stock-photo source. Wikimedia
Commons, already integrated, returned HTTP 200 with plausible results for four
browser queries; its anonymous CORS API is documented by
[Wikimedia](https://www.mediawiki.org/wiki/API:Cross-site_requests). Openverse
documents [anonymous API access](https://docs.openverse.org/packages/js/api_client/index.html),
but all four browser requests timed out after seven seconds in this environment.
That is a local availability observation, not a claim of global unavailability.
Flickr’s public feed failed browser fetch; iNaturalist worked but was animal-only
and free-text queries returned unrelated taxa. See the
[provider investigation](image-screening-1.12.9/provider-research.json).
The supplied Pexels key was used only in the isolated test origin, and is absent
from source, data exports, and release assets.

## Augmentation: measured sensitivity, no accuracy claim

We generated one deterministic variant for each of 24 distinct original
training-split reference photos and meanings: brightness ×0.85, saturation ×0.90,
with no crop, rotation, or transform resize. Caption-grounded selection and an
agent visual review excluded meanings whose correctness depends on color,
weather, lighting, or time of day. No validation/test photo was augmented.

Original/variant CLIP image-vector cosine had median **0.9961**, with range
0.9717–0.9983. Direct target-text similarity changed by −0.00644 to +0.00914
(median +0.00040). The vectors are usually close, supporting the user’s concern
that these variants add limited new information to a frozen-feature MLP. This
does not establish whether they help or hurt training; no model was trained in
this diagnostic. Variants stay linked to their original photo and split, and are
not counted as independent observations.

Darkening is not a reliable way to change sunny weather into cloudy weather.
It can invalidate lighting/color meanings and personal aesthetic preferences.
Any changed pixels must be encoded again. A controlled training comparison could
test mild, label-preserving augmentation; copying the original embedding would
only duplicate the same training input. Pixel augmentation can also be tested
when adapting the encoder, but this small app sample does not justify deploying
a fine-tuned CLIP. Encoder changes would require fresh embeddings and another
evaluation of the personal ranker.

Randomly swapping meanings is not automatically a zero: a drinking photo can
also depict a person, cup, holding, sitting, or a kitchen. Verify the mismatch
first and include difficult wrong actions/relationships, rather than mostly
obvious unrelated objects. A sensible first experiment would sample 1–3 checked
negatives per positive, or use balanced training batches. Class weights should
come from the **training split only**, and apply to an explicit semantic binary
objective. Do not assign semantic zeros to ordinary unchosen photos or use these
weights as if the current pairwise personal-preference loss were a binary
classifier. Repeated photo/meaning combinations do not multiply independent
visual evidence.

[Augmentation results](image-screening-1.12.9/augmentation.json),
[transform provenance](image-screening-1.12.9/augmentation-provenance.json), and
[visual reference review](image-screening-1.12.9/augmentation-review.json).

## Verification and replay

`npm test`: 649 passed. `npm run build:web`, macOS arm64 DMG/ZIP, and Android
debug APK builds succeeded (version code 59). All 117 web asset files match the
macOS ASAR and Android APK byte for byte; updater SHA-512 values match. The
isolated post-change UI showed the local model ready, displayed a bicycle gallery,
and saved a selected photo without a practice session. The origin served version
1.12.9; the rendered Settings text itself did not expose a version number.
[UI smoke evidence](image-screening-1.12.9/postfilter-ui.json) and
[package verification](image-screening-1.12.9/release-verification.json).

Run `node scripts/audit-image-screening-ui.mjs` to recompute frozen-gate counts,
AUROC, reviewer agreement, input-vector integrity, and pixel overlap from the
retained snapshots. It performs no downloads, training, or app-storage access.
The fixture [README](../tests/fixtures/image-screening-ui/README.md) describes the
snapshot files and their limitations. The standalone dataset explorer in
`work/dataset-explorer.html` includes all four sources, exact input values,
explicit labels, comparisons, filters, sorting, exports, and these diagnostics.
