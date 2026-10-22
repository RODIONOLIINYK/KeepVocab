# Image picking implementation

The non-ML portions of the supplied `image_picking_plan.md` are implemented in
1.8.6. Version 1.8.8 adds optional local MobileCLIP matching and a personal
preference model. No confidence-based automatic acceptance is included.

## Saved scenes and fewer repeated requests

`prepareImageScenes` saves a typed `imageScenes` record on each exact meaning:
source-sense fingerprint, generator version, source, up to three scenes, and
generation date. Records survive restart and Drive backup. Rewording a learner
explanation preserves the original source identity; selecting a different meaning
invalidates scenes, previous image choices, and sense-specific feedback.

Concrete object senses and narrowly validated curated matches skip Gemini. A
generic fallback is not treated as a curated match. Uncached meanings batch in
groups of 12 (maximum 20), with stable request IDs, per-item validation, one partial
retry, shared in-flight requests, and a short failure cooldown. Successful items
remain cached when other items fail. Add Word, Library, and Visual Match use this
pipeline. Library prioritizes saved/generated scenes instead of hiding them behind
three generic built-in suggestions. Permanent no longer matches ephemeral scenes.

## Candidate search and small previews

Search retains a bounded pool of up to 40 candidates before lexical ranking.
Ranking uses sense-specific Good/Wrong feedback, suppresses repeated URLs/source
pages/normalized titles, and balances sources and scenes. No ignored image is
counted as a negative label.

Pexels uses medium previews, Wikimedia requests 640-pixel thumbnails, and other
providers prefer available thumbnails. Preview loading is bounded. **Compare
images with Gemini** in the Library editor explicitly enables the optional
ambiguity-gated vision fallback. It sends at most four decoded thumbnails, each
at most 384 pixels and 128 KB, with bounded source downloads and cache memory.
Actual browser canvas resizing is verified. CORS/decode failures retain lexical
results; full originals are never substituted into the vision request. Rankings
are cached by exact sense, model, and candidate list. Other saved meanings of the
same word are supplied as contrast for this explicit comparison.

## Explicit review and evaluation

Add Word and Library expose a grid with Keep, Next image, and Skip. Keep all
proposed images is explicit confirmation; Next requires another confirmation.
Only Apply persists choices. Library merges only image fields into current words,
so newer practice answers are preserved; changed meanings or independently
changed images are skipped. Scene-cache writes may occur during preparation.

Run `node scripts/evaluate-image-picking.mjs path/to/fixtures.json` for an offline
evaluation of explicitly checked candidate IDs. The fixture format is documented
in that script. Selected/Good/Wrong labels are kept separate from ranker inputs;
unlabeled candidates are not negatives. No fixtures means zero evaluated cases
and no accuracy claim. Synthetic regression results do not establish real-world
image-picking accuracy.

The original plan's model sizes, speed, token savings, and accuracy estimates are
planning assumptions, not measurements of this implementation.

## Local pixels and meaning matching (1.8.8)

Enable Settings → Local image learning to download about 85 MB once. Quantized
MobileCLIP-S0 image/text encoders produce normalized 512-dimensional vectors.
The model revision is pinned to `757d59c9c6870a76a4b0306f05f5061bca15c39f`;
tokenizer/config URLs are pinned too. Transformers.js 4.3.1 and its exact ONNX
runtime version are bundled/pinned; notices are included in `js/ml/`.

The app bundles browser JavaScript only, not model weights, native ML libraries,
or WASM binaries. WebGPU is attempted when supported; a failed GPU initialization
retries in a fresh CPU/WASM worker. A worker stops after two idle minutes. Model
files persist in a separate cache through app-shell upgrades. Cached models work
in a cold CPU worker without external network access. Automatic downloads respect
metered/save-data hints; the explicit Settings download button overrides them.
Android is compiled but native device inference still needs device testing.

At most 40 candidates are decoded in chunks of four small thumbnails. Direct
meaning similarity, up to three concrete scenes, alternative senses, and a
text/logo/diagram penalty contribute to ranking. Vector cosine above 0.97 removes
near duplicates; a bounded diversity term keeps alternatives. CLIP similarity is
not a calibrated probability that an image teaches the correct sense. CORS,
unsupported hardware, timeout or inference failure retains metadata results.

## Personal preference learning

The frozen encoders feed a degree-one logistic model:
`sigmoid(b + w · x)`. Features are the 512 image coordinates plus selected-sense
similarity, competing-sense margin, and text/logo similarity: 515 features and
516 parameters including bias. No quadratic/cubic expansion is used. The feature
record is quantized to signed 8-bit values before private Drive backup; model
weights are derived locally. The enabled/download state is device-specific.

Good and Wrong ratings save immediately. Confirmed Keep choices teach positive
labels only after Apply succeeds; changed rows skipped by the Library do not
teach. Cancel, Skip, Next and More like this are not negative labels. Repeated
identical image/sense ratings do not add training weight. Corrected labels replace
the old target. Unavailable pixels never produce fabricated labels.

Training requires eight distinct image/sense labels, including at least two of
each class. Subsequent fits wait for four changed labels. Corrections/removals of
already trained records trigger a refit immediately so contradictory targets do
not remain active. Each fit starts from zero and replays up to 256 recent labels,
with class-balanced loss, L2 penalties (0.2 weights/0.05 bias), 40 gradient steps
and learning rate 0.4. This reduces sensitivity to the last click; it is not proof
against overfitting. Preference influence grows gradually through 64 labels and
is capped at ±0.06; a negative competing-sense margin cannot receive a positive
preference bonus. Reset markers prevent old synced labels from resurrecting.

Training diagnostics show queued labels, revision, changed parameter count,
actual L2 weight delta, and before/after fingerprints. Unit tests inspect numeric
weight changes and batches. Real-model browser verification also checked 12
explicit fixture ratings: training at label 8, unchanged revisions for labels
9–11, a second nonzero update at label 12, reload persistence, and offline CPU
inference. This verifies the pipeline, not real-world recommendation accuracy.
The existing offline evaluator measures the metadata baseline only; a broader
human-labelled image/sense corpus is still needed to compare model quality.
