# Image choices and local learning

Normal Add Word, bulk add, Library, and Visual Match use public image providers
and optional local ranking. When Gemini is configured, missing concrete scenes
are prepared for the exact selected meaning and cached for reuse. Scene prompts
preserve visible actions and distinguishing details. Choosing a ready photo
requires no extra image search or AI request.

## Installation

On startup the app checks for all pinned MobileCLIP and runtime files in its
separate device cache without downloading. Complete installs
are enabled by default unless the user previously turned learning off. If files
are missing, a one-time prompt offers an approximately 150 MB download (including
the runtime). Skipping, dismissing, or closing the prompt prevents repeat prompts.
Settings → Image suggestions can install or re-enable it later. Every remote
model/runtime fetch requires saved consent; scoring can load a complete cache
without network permission. The current generic MLP failed its comparison check and is disabled. The optional CLIP encoders use q8 text and full-precision vision as prescribed by the model author.
Model files survive app-shell cache upgrades and stay on this device.

For an enabled, complete install, startup schedules cached-only model preparation
after two animation frames and an idle callback. Hidden pages defer that start
until visible. Browsers without idle callbacks use a background scheduler task
or a short timer fallback. The callback only starts the dedicated worker; model
loading, ONNX graph compilation and inference stay off the UI thread, with one
WASM thread. Startup does not await preparation. Foreground searches reuse the
same worker, including a worker that is still loading. There is no two-minute
idle eviction; disabling suggestions, clearing downloads, backend changes,
worker failure or closing/reloading the app can release it. Browser/OS memory
pressure can still discard the app. This design reduces main-thread work; it is
not a measured guarantee of responsiveness on physical phones.

The bundled software notice is separate from Apple's model-weight license.
Current upstream model cards identify the weights as Apple AMLR; the research-only
model notice is included separately. See [the research review](image-model-next-steps.md)
for the deployment implications and pending alternatives.

## Choosing and changing images

Add Word fetches up to six candidates per meaning and displays them together.
The gallery fills the composer, uses the app typography, and shows every available
option without an inner scrolling card. Choosing another ready option makes no
search request. Save can leave unselected
meanings without an image; there is no mandatory approval for every word. During
bulk preparation, **Save without waiting for images** cancels the image stage and
saves all prepared meanings and translations immediately. Late results are ignored. Source and license metadata remain attached to chosen photos. For a new single word,
**Save without image** saves immediately, including during a pending search.
Batch review uses **No image**, and existing vocabulary uses **Keep current image**.
These choices alone create no training labels. Browsing more results preserves a chosen
image and adds to the gallery instead of replacing it. The picker shows photos and the controls needed to choose, find more, or save
without an image. It contains no training progress, model explanations, confidence
messages, or extra labeling task. Temporary candidate pools are removed before vocabulary is saved. Library secondary tools, custom search,
and upload controls are collapsed; recall statistics are kept out of word cards.

Local ranking normally scores a metadata shortlist of twelve photos rather than
forty serial inferences. It retains metadata results if inference is unavailable.
The frozen quantized MobileCLIP encoders generate normalized 512-dimensional
vectors. Scoring combines the exact meaning, available concrete scenes, competing
senses, and a text/logo penalty. Near duplicates are removed and diversity helps
show alternatives.

Automatic suggestions use exact-meaning similarity, a positive competing-sense
margin when alternatives exist, low unwanted-text similarity, and a score lead
over all other displayed candidates. Every displayed candidate needs valid local
scores. A sole dictionary sense uses a stronger direct-similarity threshold.
Preference learning contributes a small bounded ranking adjustment; its sigmoid
output is not a calibrated confidence and is not required to exceed 0.90. Clear
semantic matches do not require a label count or deliberate negative ratings.
These gates are heuristics, not measured accuracy claims. Automatic selections
never teach themselves as human choices.

## Normal choices now teach comparisons

A confirmed photo choice records a positive for the selected image and up to three
relative comparisons against loaded alternatives that were at least half visible
in the viewport when a choice was made. Unseen, unloaded, conflicting, and avoided
photos are not used as implicit alternatives. A comparison means “this photo was
preferred for this meaning,” not “the other photo is wrong.” Both photos can remain
valid search results. Replacing an existing photo likewise never automatically
marks the old photo as wrong.

The ordinary gallery has no comparison game, suitability questionnaire, or
training counters. Library’s optional **Hide this photo** removes only that photo
and leaves the prompt, page, and other results intact. Known Pexels and Unsplash
resize aliases share identity so the same hidden photo cannot return at a
different size. Hiding is an ordinary search action; its negative evidence is
recorded silently when local suggestions are enabled.

This design follows research on relative preferences from implicit feedback:
[Joachims et al.](https://dl.acm.org/doi/10.1145/1076034.1076063) and
[BPR](https://arxiv.org/abs/1205.2618). The specific UI and thresholds are design
choices, not measured improvements in engagement or accuracy.

## Which actions train the local model?

With image suggestions enabled and image pixels available:

- **Hide this photo** records an explicit negative and suppresses only that
  image for this meaning. There is no separate rating task.
- **Saving a chosen photo** records a positive and bounded relative preferences
  over actually viewed alternatives, after the save succeeds.
- Browsing, Cancel, unselected automatic picks, and saving without a photo
  create no implicit labels.

Each confirmed choice has a decision ID. Duplicate callbacks for that same save
are ignored. Corrections remain in the archive; the latest direction for a
meaning/photo pair is used during fitting. Missing pixels do not fabricate
examples. When local suggestions are off, hiding still updates search exclusions.

## Meaning-aware personalization (1.12.0)

The ranker can use a 1,539→32→16→1 MLP with 49,825 parameters. It receives
image and exact-meaning embeddings, their coordinate-wise products, and three
CLIP semantic scores. Public semantic correctness and private photo preferences
are separate tasks and cannot silently train one another's weights.

A future accepted semantic head remains frozen; personal learning adds a separate
bounded correction. Generic influence is at most ±0.08, personal influence at most
±0.04, and neither can positively boost a competing-sense match. These ranking
values are not calibrated correctness probabilities. The generic head from this
experiment is disabled, including its rejected hidden-layer initialization.

The corrected MobileCLIP configuration uses full-precision vision and q8 text.
Forcing q8 vision in earlier releases damaged the representation; see the linked
precision diagnostic and experiment below. The worker and evaluator use the same
pinned files and explicit tower precision. Model file URLs and encoder-tagged
cache keys prevent reuse of incompatible q8 vision vectors. Older feedback stays
archived under its original encoder identity, excluded from current training.

Saved scene descriptions, actual search queries and optional scene contrasts
reach CLIP. CLIP processes a proportional thumbnail of the complete available
photo, letterboxed to 256×256 with neutral gray padding. Provider originals are
tried before previews, within mobile download/pixel budgets; absent pixels cannot
be restored. Tiny inputs are not enlarged and edges are not intentionally cropped.

A saved choice scores the preferred and alternative images separately for the
same meaning, then trains their relative ranking. A comparison's legacy numeric
zero does not mean the alternative is an absolute unsuitable image. Only an
explicit hide supplies that user judgment. Positive-only saves are retained
without pushing all photos toward suitable.

## History and guarded background updates

IndexedDB retains complete image feedback without the old 256-record archive
cap; startup reads counts, not all records. A chunked fallback preserves prior
acknowledged history on quota failure. Connected Google Drive backup uses
separate versioned per-device files with 100 events per chunk, merging by event
ID. Reset markers block resurrection of old records. Derived personal weights
remain local.

After 30 seconds of inactivity a worker may fit personal preferences, with a
20-second compute budget and 45-second controller timeout. Training needs at
least 24 training, 8 validation and 12 test decisions, with whole meanings kept
in chronological partitions and at least four test meanings. New updates require
fresh later evidence; answers used to select prior models cannot be recycled as
unseen evaluation data. New feedback during fitting invalidates a stale candidate.

Personal candidates must improve independent loss over the current model, CLIP,
and any accepted semantic base, without worsening choice agreement or explicit
rejection errors. Generic pretraining also requires a reliable first-choice
advantage over raw CLIP and the app's CLIP ranker. Failed candidates do not replace
an active model.

## Real-photo results

The expanded dataset contains 2,390 visually reviewed comparisons across 237
meanings, 638 galleries and 1,736 photos, with frozen disjoint source/meaning
partitions. Luna performed blind image classification; Terra and the root agent
independently checked 104 galleries. Ambiguities and disagreements were excluded.

On 120 corrected-encoder test galleries, raw CLIP matched 101, the app CLIP ranker
matched 107, and the semantic MLP matched 105. This does not demonstrate an MLP
improvement; its generic head stays disabled. The earlier small q8-vision scores
are superseded by the precision diagnosis, not evidence of a useful initializer.

Read [the detailed experiment and limits](image-pretraining-v2.md),
[dataset reproduction instructions](../tests/fixtures/image-pretraining-v2/README.md),
and [encoder precision proof](image-encoder-precision-check.json). No physical-phone
performance, real-user taste, or population-wide accuracy improvement is claimed.
