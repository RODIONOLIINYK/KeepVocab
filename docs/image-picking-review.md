# Image choices and local learning

Normal Add Word, bulk add, Library, and Visual Match searches use public image
providers and the optional local model. They do not request Gemini scenes or
vision comparisons. Existing saved scenes are reused. The scene-generation and
small-thumbnail vision services remain available to explicit callers, but are
not invoked by the normal picker. Difficult dictionary wording can still be
simplified by Gemini; bulk rewrites share requests for selected meanings, use a
compact response, and are never repeated during save. Missing examples alone do
not trigger a paid repair or block adding/editing words.

## Installation

On startup the app checks for all pinned MobileCLIP and runtime files in its
separate device cache without downloading or starting inference. Complete installs
are enabled by default unless the user previously turned learning off. If files
are missing, a one-time prompt offers an approximately 115 MB download (including
the runtime). Skipping, dismissing, or closing the prompt prevents repeat prompts.
Settings → Local image learning can install or re-enable it later. Every remote
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
These choices create no training labels. Browsing more results preserves a chosen
image and adds to the gallery instead of replacing it. The picker explains whether
local learning is off, still learning (fewer than 32 trained examples), or has no
clear winning image. Enough training does not guarantee automatic selection. Temporary candidate pools are removed before vocabulary is saved. Library secondary tools, custom search,
and upload controls are collapsed; recall statistics are kept out of word cards.

Local ranking normally scores a metadata shortlist of twelve photos rather than
forty serial inferences. It retains metadata results if inference is unavailable.
The frozen quantized MobileCLIP encoders generate normalized 512-dimensional
vectors. Scoring combines the exact meaning, available concrete scenes, competing
senses, and a text/logo penalty. Near duplicates are removed and diversity helps
show alternatives.

Automatic selection is deliberately conservative: at least 32 trained human
labels, a preference score of at least 0.90, strong selected-meaning similarity,
a positive competing-sense margin when alternatives exist, low text/logo similarity,
and a score lead over every other displayed candidate are required. Every shown
candidate must have valid local scores. A sole dictionary sense uses a stronger
direct-similarity threshold instead of a nonexistent competing-sense margin.
These thresholds are heuristics, not calibrated correctness probabilities or a
measured accuracy claim. Otherwise the learner chooses or saves without a photo.
Automatic picks never create their own positive training examples.

## Which actions train the logistic model?

With Local image learning enabled and image pixels available:

- **Good image** records a positive image/meaning label immediately.
- **Wrong meaning** records a negative label immediately and suppresses that image
  in future searches for this meaning.
- **Saving a different image** records a negative for the previous image and a
  positive for the chosen replacement, after the save succeeds.
- **Choosing/keeping a photo while adding words** records a positive only after
  the words are saved successfully.
- **More like this** changes preferred search concepts. It does not train the
  logistic model. Browsing, Skip, Cancel, and automatic picks create no labels.

A repeated identical label has no extra weight; correcting a label replaces its
old target. Missing pixels do not fabricate examples. When local learning is off,
explicit Library ratings still update search preferences, but do not train weights.

The preference model is degree-one logistic regression, `sigmoid(b + w · x)`,
using 512 image coordinates plus sense similarity, contrast margin and unwanted
text similarity: 515 features and 516 parameters. It starts after eight distinct
labels including at least two positive and two negative examples. Later fits wait
for four changed labels; corrections to trained labels refit immediately. Training
replays up to 256 labels with class balancing and L2 regularization. Preference
influence grows gradually through 64 labels and is capped at ±0.06; taste cannot
positively reward an image matching a competing sense better.

Labels sync in private Drive backup; derived model weights stay local. Settings
contains training diagnostics and reset controls. Synthetic tests verify consent,
label persistence, batching, corrections, safe automatic selection, and save
boundaries; they do not establish real-world recommendation accuracy.
