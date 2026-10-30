# Frozen UI screening and augmentation snapshots

These are diagnostic/evaluation records, not active app training or personal
preferences. No credentials or app storage are included. Photo pixels and model
files stay outside this fixture; public URLs and pixel SHA-256 hashes identify
the reviewed inputs. Upstream availability and licensing still apply.

- `keyless-predictions.json.gz`: 86 older, pixel-ready unanimous semantic labels
  with frozen FP16-text/FP32-vision CLIP predictions and image vectors. Excludes
  six screenshot-only and 16 uncertain/disputed observations.
- `pexels-primary-review.json`: actual UI gallery observations and selections.
- `pexels-independent-review.json`: a second, blinded agent's visual judgments.
- `pexels-photo-inventory.json`: downloaded pixel hashes for all 60 candidates.
- `pexels-predictions.json.gz`: all 60 label-free predictions and both 512-vectors,
  captured before the reviews were merged. Exact definitions and available custom
  open/closed-door concepts are recorded; missing generated scenes are explicit.
- `pexels-labels.json`: all 60 observations, unanimous labels (19 fit, 21 wrong,
  20 null), actual selections and 21 semantic clarity comparisons. Target 1 is
  an ordering preference for a meaning; alternative suitability 0 is independently
  justified by unanimous wrong judgments. This file is evaluation-only.
- `augmentation-selection.json` and `augmentation-vectors.json.gz`: 24 distinct
  train-split original/variant photos, parent hashes and re-encoded vectors.
  One brightness .85 / saturation .90 transform per photo; not independent data.

`node scripts/audit-image-screening-ui.mjs` independently joins the raw reviews
and frozen predictions, checks all image/meaning vector dimensions and raw
cosines, and recomputes the fixed selected ≥ .19 / unwanted < .20 confusion
counts and AUROC. No CLIP/MLP training, downloads or API key are needed.

The new UI source includes Pexels and public-catalog fallbacks. Eleven photo
hashes overlap the older UI pilot; none overlap the original threshold-calibration
corpus. Reports therefore also evaluate the consensus subset excluding older
photos (31 records). Results are small, grouped and agent-labeled; they do not
establish user taste or universal semantic correctness.
