# KeepVocab 1.12.9

The image chooser now screens up to 30 candidate photos before displaying a
shortlist. It uses the user-selected frozen CLIP cutoff: selected-meaning
similarity ≥0.19 and unwanted-content similarity <0.20. Personal ranking applies
only to survivors; failed screening does not backfill unverified photos.

The personal MLP now has 1,027 inputs and 33,441 parameters (32/16 hidden units).
The explicit image×meaning feature block and 50/50 CLIP fusion are removed from
the live model. Feedback history is preserved; incompatible old weights are
excluded while the new personal model relearns and passes validation. Historical
research remains reproducible through an offline-only legacy implementation.

Fresh installations use public catalogs without a key. Configured Pexels searches
fill the larger pool first, avoiding unnecessary fallback calls when sufficient
photos are available.

Adds direct-app semantic evaluation with two independent Luna reviewers, frozen
CLIP predictions, complete input vectors and a 24-photo augmentation diagnostic.
At the fixed gate, the new consensus set keeps 16/19 suitable photos and accepts
6/21 wrong ones. Eleven of 60 observed photos repeat the older UI pilot; the
separate nonoverlapping consensus subset is also reported. No evaluation answers
were used to retrain a model or retune the threshold. The standalone dataset
explorer now includes the new UI source, current inputs and diagnostics.

Validation: 649 automated tests; successful web, macOS arm64 DMG/ZIP and Android
debug APK builds (version code 59). All 117 packaged web files match the tested
source. An isolated actual-UI selection/save passed with the local model ready.
The installed app and personal study statistics were not used.

[Full results and limitations](https://github.com/RODIONOLIINYK/KeepVocab/blob/v1.12.9/docs/image-screening.md).
