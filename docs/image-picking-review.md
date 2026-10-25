# Image choices and local learning

Normal Add Word, bulk add, Library, and Visual Match use public image providers
and optional local ranking. When Gemini is configured, missing concrete scenes
are prepared for the exact selected meaning and cached for reuse. Scene prompts
preserve visible actions and distinguishing details. Choosing a ready photo
requires no extra image search or AI request.

## Installation

On startup the app checks for all pinned MobileCLIP and runtime files in its
separate device cache without downloading or starting inference. Complete installs
are enabled by default unless the user previously turned learning off. If files
are missing, a one-time prompt offers an approximately 115 MB download (including
the runtime). Skipping, dismissing, or closing the prompt prevents repeat prompts.
Settings → Image suggestions can install or re-enable it later. Every remote
model/runtime fetch requires saved consent; scoring can load a complete cache
without network permission. No model weights are currently bundled in the project.
Model files survive app-shell cache upgrades and stay on this device.

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

A repeated identical choice has no extra weight. A corrected rating replaces its
old target; reversing a comparison replaces that pair’s previous direction.
Missing pixels do not fabricate examples. When local learning is off, explicit
rejections still update search preferences without training weights.

The frozen encoder creates 512 image coordinates. The preference model combines
those with sense similarity, contrast margin, and unwanted-text similarity:
515 features and 516 parameters including the intercept. Explicit ratings train
balanced logistic classification. Comparisons train a pairwise logistic objective
on winner-minus-loser features, with no intercept contribution. If there are fewer
than two explicit negatives, only the pairwise objective is fitted; positive-only
classification cannot inflate suitability for every image.

Training starts with eight saved examples, including at least two positive
choices and two comparisons or explicit rejections. Later fits wait for four
changed examples; corrections to fitted records trigger a refit immediately.
Training replays up to 256 examples with L2 regularization. Preference influence
is capped at ±0.06 and cannot positively reward a competing sense.

Records sync through private Drive backup; derived weights stay local. Pairwise
records use a distinct record-model tag so older clients ignore them rather than
mistaking a lower preference for an explicit rejection. Settings exposes download and on/off controls, without training diagnostics or
weights. Tests cover persistence, gradients, ordinary-choice learning without
hard negatives, visibility, rejection scope, stale meanings, and save/cancel
boundaries. They do not establish real-world recommendation accuracy.
