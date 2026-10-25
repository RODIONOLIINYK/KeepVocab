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
without network permission. The small pretrained personalization layers are bundled; the large CLIP encoders still require the optional download.
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

Each confirmed choice has a decision ID. Duplicate callbacks for that same save
are ignored. Corrections remain in the archive; the latest direction for a
meaning/photo pair is used during fitting. Missing pixels do not fabricate
examples. When local suggestions are off, hiding still updates search exclusions.

## Meaning-aware personalization (1.11.0)

The production ranker uses a 1,539 → 32 → 16 → 1 MLP with 49,825 parameters.
Its input contains the image embedding, exact word/meaning embedding, their
coordinate-wise products, and CLIP's selected-meaning, contrast-margin and
unwanted-content scores. Saved Gemini scene descriptions and the actual custom
search query reach CLIP, including when an empty scenes array is passed.
Optional Gemini contrast descriptions depict the same subject with a different
action or attribute; they are comparison texts, not alternative search requests.

Each candidate is scored separately with the same meaning. A normal choice
trains the difference between those two resulting scores using a pairwise
logistic loss. It does not require either candidate's individual score to be 0
or 1. For example, preferring scores 0.46 over 0.41 is consistent with both
photos fitting. The comparison record's legacy `label: 0` field identifies a
losing side; `kind: comparison` selects this relative loss. Only a deliberate
hide is an absolute negative. A saved positive alone is retained but does not
inflate every candidate's score through positive-only classification.

The network adds at most ±0.08 to the semantic score. It cannot positively boost
an image whose competing-meaning margin is negative. A new output layer starts
at zero, so installing it leaves the semantic ranking exactly unchanged. This
score is a ranking value, not a calibrated probability of correctness.

CLIP processes a proportional thumbnail of the complete available photo,
letterboxed to 256×256 with neutral gray padding. It never enlarges small source
photos or intentionally crops away edges. Full candidate URLs are tried before
provider previews, with download and pixel budgets and preview fallback.
Some provider URLs already represent resized/cropped photos; absent original
pixels cannot be restored. Cache keys identify the preprocessing version.
Legacy cropped/meaning-less records remain archived but do not train this head.

## History, background training and acceptance

Image choices live in IndexedDB without the old 256-record archive cap. Startup
reads counts, not the whole history. A chunked localStorage fallback preserves
all acknowledged records until storage is exhausted; failed writes do not delete
older choices. Reset markers prevent old backup records resurrecting a reset.
When Google Drive backup is connected, separate versioned per-device files hold
100 events per chunk, merge by event ID, and preserve offline choices/corrections.
The full history stays out of the regular settings snapshot. Derived weights
stay local. Old clients safely ignore the new archive format.

After 30 seconds without new photo feedback a background worker can fit a
candidate, with a 20-second compute budget and 45-second controller timeout.
Fitting uses decision-weighted minibatches and validation early stopping. It
needs at least 24 training, 8 validation and 12 test decisions. Whole meanings,
with all their photos/pairs/corrections, stay in one chronological 60/20/20
partition. At least four independent test meanings are required. Sparse or
repeated same-meaning feedback therefore cannot force activation.

A candidate must improve held-out pairwise loss over both the current model and
plain CLIP, without worsening choice agreement or explicit-rejection errors.
A bootstrap resamples whole meanings. Training, validation and test IDs already
used by an accepted model cannot serve as its later evaluation answers again.
New choices arriving during fitting discard the stale candidate. Turning the
feature off or resetting cancels its worker. Prequential scores are stored before
new labels are used, allowing later evaluation against real user decisions.

The pretrained hidden layers initialize personal learning. With these layers,
personal fitting changes only the final 17 parameters, reducing the capacity to
overfit a small personal history. A worse candidate never replaces the active
ranker. There are no training counters, confidence warnings, manual fitting
buttons, or new questionnaires in regular screens.

## Real-photo pretraining and evaluation

I visually inspected COCO128 photographs and curated 90 two-photo choices over
30 meanings: 54 training choices/18 meanings, 18 validation choices/6 meanings,
and 18 test choices/6 meanings. Photos, SHA-256 hashes and meaning groups are
disjoint across partitions. Three choices for one meaning share their preferred
photo, so they are correlated. Several alternatives also fit; their labels are
relative preferences, not fabricated negative suitability labels. The dataset
includes action distinctions such as flying versus parked and sitting versus
standing. It contains no fox photos.

The same pinned quantized MobileCLIP text/image encoders, thumbnail bounds,
full-frame preprocessing, semantic scoring and MLP ranking ran on actual pixels.
Search-provider retrieval and paid Gemini calls were not evaluated. Node's Sharp
resize/native CPU backend can differ slightly from browser canvas/WASM.

| Partition | Choices | CLIP first-choice matches | Trained MLP matches |
| --- | ---: | ---: | ---: |
| Training | 54 | 20 | 53 |
| Validation | 18 | 5 | 12 |
| Test | 18 | 13 (72%) | 9 (50%) |

The fixed 30-epoch recipe overfit this small dataset. Test loss worsened from
0.6650 to 0.7610 and its bootstrap improvement lower bound was negative. The
acceptance check rejected this head. The shipped initialization retains its
trained hidden layers but zeroes the final layer; the generic ranking head is
**disabled**, leaving CLIP's ranking active until personal learning passes its
own acceptance check. No real-photo improvement from this MLP is claimed.

The initial test was excluded from fitting/early stopping. It has now been
inspected; subsequent implementation checks are not new independent benchmarks.
On the same test photos, full-frame CLIP matched 13/18 choices versus 11/18 with
center cropping. Validation favored cropping (8/18 versus 5/18); this small result
does not establish universal preprocessing superiority.

I also used the actual picker component to save 12 visually chosen photos in an
isolated browser origin: 24 persisted events, including 12 comparisons and zero
implicit explicit negatives. Its real browser worker correctly declined to
activate a model from insufficient history. Automated tests additionally exercise
real worker training/promotion, stale-candidate rejection, resets, full history
backup/restoration, preprocessing and opposite meaning-conditioned preferences.
Synthetic controlled tests prove mechanics, not recommendation quality.

The personalization weights occupy 199,300 bytes. A Mac arm64 Node benchmark of
1,000 images took about 1.02 ms/image for this head including decoding and model
checks; it excludes CLIP, image fetching and physical-phone measurement.

Reproduce without shipping raw photographs:

```sh
python3 scripts/prepare-image-pretraining.py
node scripts/evaluate-image-pipeline.mjs work/image-pretraining/cases.json --download-model --output=work/image-pretraining/encoded-report.json
node scripts/pretrain-image-personalizer.mjs work/image-pretraining/encoded-report.json
```

The initial encoder download is explicit; subsequent runs use the pinned local
cache. `tests/fixtures/image-pretraining` contains the reviewed manifest and real
embeddings, with source URLs and photo hashes. Raw photos remain under ignored
`work/`. See `image-pretraining-report.json`, `image-pipeline-evaluation.json`,
and `image-personalizer-benchmark.json` for machine-readable results.
