# KeepVocab ML correctness review — November 13, 2026

Reviewed local `main` at `0180a869` / package `1.12.35`, including the existing workspace source. This is a review, not an implementation change. Existing uncommitted research files and user annotations were preserved. Two reviewers were assigned through Antigravity using `gemini-4-hydrogen`; the primary reviewer independently traced and reproduced the findings below.

The main risks are feedback failing to reach training, old features being attached to a new image, and trained models being bypassed or remaining active after reset. These are integration problems; they do not establish that the encoder itself is inaccurate.

## Confirmed findings

### 1. High: image replacement can associate old pixels with a new URL

**Code:** `js/services/driveSync.js:911–965`, `js/components/LibraryView.js:703–720`, `js/services/imageLearning.js:566–575`.

`updateWord()` never accepts `imageMl`. Both replacing the metadata and clearing it are silently ignored. A word that already has metadata keeps it when its image URL changes. `recordImagePreference()` trusts supplied metadata when its model, sense and preprocessing match; the metadata has no check binding those features to the supplied image URL.

**Independent reproduction:** saved old image metadata, replaced the image using the real `DriveSyncService.updateWord()`, then recorded a positive choice. The resulting history event had the new image URL and the old image feature vector. Clearing the image also retained its metadata. This can contaminate subsequent training, rather than merely lose a diagnostic field.

**Correction:** validate and persist current image metadata, clear it on image/meaning changes, and bind cached evidence to the exact source image or hash before reusing it. Add an integration regression using the real persistence layer.

### 2. High: Visual Match replacement comparisons never reach the training history

**Code:** `js/components/VisualMatchMode.js:131–139`, `js/services/imageChoicePolicy.js:59–75`, `js/services/imageLearning.js:559–561`.

`imageReplacementLabels()` emits a positive and a relative comparison, with `preferredImage` and a shared `decisionId`. Visual Match forwards only the first three arguments to `recordImagePreference()`. Every `less-preferred` record therefore fails the required `preferredImage.url` check. The positive is assigned a separate decision ID. Other feedback callers forward these options correctly.

**Independent reproduction:** with image learning enabled and valid features for both images, the three-argument call returned `{ recorded: false, reason: 'No training choice.' }`; forwarding the options recorded the comparison successfully.

**Correction:** forward `preferredImage`, `decisionId` and applicable feedback reasons, and exercise the actual Visual Match handler in a regression test.

### 3. Medium: an active invariant head suppresses the personal ranking model

**Code:** `js/services/imagePersonalizerTraining.js:19–24`, `js/services/imageLearning.js:419–431`, `js/ml/imageTrainer.worker.js:8–17`.

When both a valid personal MLP and an invariant head exist, the final score is `invariantScore ?? personalizerScore(...)`. Valid invariant evidence makes the first branch win every time. Pairwise preferences train the MLP, while invariant fitting explicitly excludes comparisons. Consequently, the app can save and promote personal learning whose ranking effect is then bypassed.

**Independent reproduction:** two distinct personalizer scores became identical invariant probabilities after attaching a valid invariant head. The personal model still existed; its scores were not used for ranking. The bundled invariant seed is currently null, so this condition requires an accepted locally learned head.

**Correction:** specify and validate the intended scoring composition so accepted pairwise preference learning still affects eligible-image order. Keep semantic eligibility checks separate. Revalidate selection thresholds if final score units change from the current personal/semantic score to invariant probabilities; existing fixed margins alone do not establish equivalent calibration.

### 4. Medium: a reset received through sync leaves the old invariant head active

**Code:** `js/services/imageLearningHistory.js:106–123`, `js/services/imagePersonalizerTraining.js:10–24`, `js/services/driveSync.js:1213`.

The history merge updates `resetAt` and filters old events. `personal()` rejects an MLP from an earlier reset generation, but `current()` loads `invariantHead` without checking any reset generation. Local reset explicitly clears that state; the remote reset path does not.

**Independent reproduction:** wrote an invariant head, merged a newer reset timestamp with no events, and queried the trainer. `personal()` returned null; `current()` returned an active `wInv` from before the reset.

**Correction:** invalidate all learned image state when accepting a newer reset and store a generation/reset marker with each independently saved head. Test both local reset and reset received via the real sync merge path.

### 5. Medium: corrected labels remain contradictory examples in invariant training

**Code:** `js/ml/imageTrainer.worker.js:8`, `js/services/imagePersonalizer.js:124–135`, `js/services/imageLearning.js:586–599`.

Image history deliberately archives events. The MLP path resolves those events to the latest valid judgment per key through `activeImageExamples()`. The invariant worker instead filters the raw archive only for non-comparisons and valid ranking evidence. A prior positive and its later negative correction are both retained. Repeated corrections can therefore influence fitting and validation multiple times.

**Independent reproduction:** two valid events sharing the same key produced `[0]` through latest-label normalization and `[1, 0]` through the exact invariant worker predicate.

**Correction:** define the active training view once, including reset/version/task checks and correction precedence, then use it consistently for fitting and validation without deleting the historical events.

### 6. Medium: positive-only decisions pass the data checks and then throw

**Code:** `js/services/imagePersonalizer.js:148–160`, `185–189`, `288–291`, `351–367`; `js/ml/imageTrainer.worker.js:17–19`.

The train/validation/test minimums count decisions. A standalone positive contributes no training observation: `observations()` returns only pairwise comparisons or explicit negatives. Sixty positive-only meanings satisfy the 36/12/12 decision split but produce no usable training observations, so fitting throws. The worker returns an error instead of its independently computed invariant result. Several callers then hide the failure behind a background catch.

**Independent reproduction:** `trainImagePersonalizer(imageChoiceHistory().map(r => ({ ...r, kind: 'label', label: 1 })), null)` threw `No usable training observations.` before any optimization step.

**Correction:** count usable observations and supported decision types before fitting, return an explicit waiting status for insufficient support, and isolate the result of each independently trained head so one unsupported task does not discard another task's result. This does not imply that positives must become fabricated pairwise preferences.

### 7. Medium: re-splitting the cumulative history can stall further personalization

**Code:** `js/services/imagePersonalizer.js:148–160`, `354–356`.

Every attempt reorders meanings by their latest decision and creates a new 60/20/20 split. The incumbent model records all previously used train, validation and test decision IDs. The leakage guard rejects any attempt in which one of those IDs appears in the new validation or test sets. Ordinary additions and revisiting an old meaning can move those old IDs into the held-out slices.

**Independent reproduction:** constructed an incumbent with the 36/12/12 partitions from 60 meanings, added 20 later independent meanings, and called the real training entry point. It returned `Waiting for later choices unseen by the current model.` before fitting.

**Correction:** retain the leakage guard and design a deliberate update/evaluation protocol with stable provenance and genuinely fresh held-out evidence. Reusing old evaluation labels or deleting the guard is not an acceptable repair. This is a progress/eligibility problem; the reproduction does not demonstrate unsafe model promotion.

### 8. Medium: meaning-equivalence model learning is disconnected from normal UI capture and grouping

**Code:** `js/components/MeaningPairReview.js:27–30`, `js/services/meaningEquivalenceLearning.js:35–46`, `js/services/localSenseGrouping.js:183–259`.

The UI explicitly passes `encodeDefinitionTexts: async () => null`, preserving responsiveness but collecting no embedding evidence for a new pair. Only records with such evidence enter fitting. No later feature-enrichment path was found. Also, grouping reads the exact manual labels but does not use `learning.head` or call `equivalenceProbability()`; runtime calls to that scorer are confined to the learning/validation module.

**Independent reproduction:** the same null-encoder option used by the UI saved a manual label with no `evidence` and returned `trained: false`. Call-site inspection confirmed the inference disconnection.

**Interpretation:** manual same/different judgments still work for their exact pair. This is an inactive generalization capability, not loss of the explicit manual override. Some disabled behavior is intentional: the generic pretrained head has no autonomous merge threshold. Do not enable automatic merging merely to make the saved model execute.

**Correction:** either document this as manual pair correction, or collect evidence asynchronously and deliberately connect a validated head to the intended review/ranking behavior. Preserve conservative automatic-merge safeguards.

### 9. Medium: scoring a thumbnail bypasses validation of the actual display image

**Code:** `js/services/imageThumbnails.js:26–34`, `js/services/imageSearch.js:73–110`, `js/services/imageLearning.js:510–545`.

Thumbnail preparation prefers `thumbnailUrl`; the candidate retains its original `url`. `filterLoadableImages()` skips the browser loader whenever the candidate has an `ml` object. Successful decoding of a thumbnail therefore causes the unverified display URL to be accepted. The check does not require current model metadata or prove which URL supplied the scored bytes.

**Independent reproduction:** a synthetic browser loader rejected the display URL, but it was never called for the same candidate with an ML marker. Removing that marker made validation reject the candidate. No network request was made.

**Correction:** validate the exact display URL or persist and display the verified image as a fallback. Carry verified-source provenance rather than treating the presence of any ML metadata as proof of loadability.

### 10. Medium: prompt cleanup deletes defining absence conditions

**Code:** `js/services/imageLearning.js:346–364`, especially `stripNegatedClauses()` and the selected prompt passed to `rpc('texts', ...)` at line 477.

The cleanup treats clauses beginning with `without`, `not`, or `never` as removable contrasting material when preceded by a comma, semicolon, or dash. Those clauses can be the essential condition of the meaning, rather than an irrelevant competing meaning. The cleaned prompt also supplies the meaning embedding used by personal learning (`meaningFeatures = encodeMeaning(texts[0])`).

**Independent reproduction:** `A container, without anything inside.` became `A photo illustrating empty (adjective): A container.` Two constructed definitions for the same headword, `free` — `A person, without physical restraint.` and `A person, without obligations.` — produced identical selected model text. The definitions remain distinct in their sense identity, but the selected embedding request loses that distinction. The headword and any separately supplied scenes still provide some evidence; no claim of measured encoder or image-ranking error is made from this input-only reproduction.

**Correction:** retain the exact definition as an encoding anchor. If a positive visual description or competing-meaning cleanup is needed, encode it separately and preserve essential absence, state and relation conditions. Add cases where a negated clause defines the target, alongside cases where it merely excludes a different sense.

## Verified contracts and intentional inactive models

- The shipped encoder is pinned compact SigLIP2 with 768-value embeddings. The personalizer combines image and meaning vectors plus three scalar image signals. Feature/version validation is present; this review did not establish a general embedding-dimension or feature-order swap in that live path.
- `getPretrainedImageModel()` and `getPretrainedInvariantHead()` deliberately return null. A rejected public experiment is not silently used as the live default.
- The six-class taxonomy and class-conditioned W research are outside this app inference path. The research plan explicitly says that the playground is not activation in KeepVocab. Their absence from live ranking should not be treated as an accidental dropped feature or repaired by importing experimental weights.
- The low-priority reports about missing `trainedLabels` metadata and session-position differences were not elevated here. The neural ranking branch directly uses its score, and scheduling before a session has no definite current position. Those deserve a separate contract decision before calling them user-facing defects.

## Validation

Run the ten independent synthetic reproductions from any working directory:

```sh
node /Users/kalyma123/programming/keepvocab/docs/ml-code-review-2026-11-13/reproduce.mjs
```

They use fresh in-process storage and fabricated basis vectors. They make no network requests, download no models, save no model weights to disk, and stop before optimizer steps in the two training-eligibility reproductions. They reproduce the defects; their assertions intentionally pass while those defects exist.

Primary review: **272 tests passed, 0 failed**, across these 24 existing suites:

```sh
node --test \
  tests/imageLearningFeedback.test.mjs tests/imageLearningHistory.test.mjs \
  tests/imagePersonalizer.test.mjs tests/imagePersonalizerTraining.test.mjs \
  tests/imagePreferences.test.mjs tests/imageChoicePolicy.test.mjs \
  tests/imageReview.test.mjs tests/learnedImageHeads.test.mjs \
  tests/libraryImages.test.mjs tests/visualMatchImages.test.mjs \
  tests/imageSemanticPreference.test.mjs tests/imageSearch.test.mjs \
  tests/imageSearchOptimizations.test.mjs tests/imageThumbnails.test.mjs \
  tests/imagePreprocessing.test.mjs tests/imageWorkerBatching.test.mjs \
  tests/imageModelCache.test.mjs tests/localSenseGrouping.test.mjs \
  tests/meaningComparison.test.mjs tests/meaningPersistence.test.mjs \
  tests/adaptiveRecall.test.mjs tests/fsrsLearning.test.mjs \
  tests/wordSelection.test.mjs tests/driveSync.test.mjs
```

An additional **53 tests passed, 0 failed**, in six disjoint installation/startup suites, bringing the primary review total to **325 tests across 30 files**:

```sh
node --test tests/imageLearningSetup.test.mjs tests/imageModelStartup.test.mjs \
  tests/imageLearningWarmup.test.mjs tests/imageEncoderMigration.test.mjs \
  tests/imageLearningStatus.test.mjs tests/compactModelDownload.test.mjs
```

These passing tests do not cover all of the integration defects above. The reproduction harness covers actual service calls where practical; it does not execute the Visual Match DOM handler, a live encoder, or a live Google Drive round trip.

The audit itself did not build or publish a release and did not change application behavior. Its authored changes were the subagent preference in root `AGENTS.md` and this report/reproduction harness. After completing the audit, the user explicitly requested committing/pushing these changes and compiling/publishing releases; release `1.12.36` packages the existing app with the required version/cache updates. The ML findings above remain unfixed.

## Review completion

The learning/feedback Gemini review completed and was checked independently. The image-inference Gemini reviewer failed during provider context summarization with `HTTP/1.0 502 Bad Gateway`; it produced no completed findings report. Its terminal state and partial activity were inspected, but its unfinished work is not counted as an independent completed review. The primary reviewer completed the remaining source inspection of worker embedding/cache handling, preprocessing, candidate mapping, model installation/consent, and inference inputs, and ran the additional installation/startup suites above.

The source-level audit is complete within the stated limits. Live ONNX execution, pixel-quality benchmarking, native-device behavior, and real external-service round trips remain outside this audit. No replacement subagent or different model was launched.
