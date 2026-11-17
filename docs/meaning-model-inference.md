# Local meaning merge inference

The app uses the selected `minilm-l6-v7-prefix-idf-bs16` reference for dictionary
meaning comparison. The encoder is independent of SigLIP image scoring.

Public merge model: https://huggingface.co/Rodion228huyfogdrun/KeepVocab-meaning-merge-minilm-l6-v7

Pinned download revision:
https://huggingface.co/Rodion228huyfogdrun/KeepVocab-meaning-merge-minilm-l6-v7/tree/be8ee3e1076958149ee7a1e0ace8615d2c43ee86

Direct ONNX download:
https://huggingface.co/Rodion228huyfogdrun/KeepVocab-meaning-merge-minilm-l6-v7/resolve/be8ee3e1076958149ee7a1e0ace8615d2c43ee86/onnx/model_fp16.onnx

Source and releases: https://github.com/RODIONOLIINYK/KeepVocab/releases

App release: https://github.com/RODIONOLIINYK/KeepVocab/releases/tag/v1.12.41

Apple Silicon installer:
https://github.com/RODIONOLIINYK/KeepVocab/releases/download/v1.12.41/KeepVocab-1.12.41-macOS-arm64.dmg

Android installer:
https://github.com/RODIONOLIINYK/KeepVocab/releases/download/v1.12.41/KeepVocab-1.12.41-Android-debug.apk

SigLIP upstream model: https://huggingface.co/onnx-community/siglip2-base-patch16-256-ONNX

KeepVocab compact SigLIP assets:
https://github.com/RODIONOLIINYK/KeepVocab/tree/v1.12.29/models/siglip2-compact-v1

## Installation and lifecycle

Settings → Local models contains both models with separate download/remove
controls and the same streamed byte-progress display, followed by verification
and preparation stages. The merge model is about 47 MB; SigLIP is about 208 MB.
The merge download requires an explicit Settings action;
startup and lookups never download it. SHA-256 and byte lengths are checked
before downloaded files become usable. An installed merge model is preloaded
immediately after the initial app render and its worker remains alive for the session. Both models share
one bundled ONNX runtime. No Hugging Face token is needed to download them.

On packaged macOS installations, downloaded files live in
`KeepVocab.app/Contents/Resources/model-cache/`. Removing the app removes the
files. Automatic updates move this directory into the replacement bundle and
restore it on rollback, without leaving a second copy in the retained backup.
Run the app from a writable installation folder rather than a mounted DMG.
Development builds use a separate `development-model-cache` in userData.

On Android, files live in private `noBackupFilesDir/models/`, are excluded from
system backup, and are removed by uninstall. Web installations use the app
origin's CacheStorage; clearing site data removes those browser downloads.
Existing native SigLIP profile downloads migrate into the native folder when
checked/used; successful moves delete the old cache entries. The native
service worker does not duplicate the bundled runtime in profile storage.

## Scoring and safeguards

Production preprocessing is `meaningEmbeddingText(sourceDefinition)`: retain
semantic qualifiers, strip editorial labels, lowercase, and truncate at 96
tokens. Do not introduce a headword/POS prefix absent from the reference's
training inputs. The first-colon token mask also applies to colons already in
dictionary definitions. Pool the full attention-masked sequence, including
special tokens, then L2-normalize. Token matching excludes special tokens and
the prefix through the first colon, with the reference's empty-mask fallback.
The five features, scorer weights, and training-only IDF values are unchanged.

Automatic merges use `0.6916793788299911`, the user-selected best-F1 operating
point with precision above 60% on the provenance-checked validation cohort.
It is the midpoint of the optimal validation interval
`(0.6875979386818168, 0.6957608189781654]`, chosen before test evaluation to avoid
an FP16 score boundary. Review suggestions start at `0.5`. User judgments override
the model; parts of speech remain separate; complete linkage prevents a chain
of individually similar meanings from collapsing distinct meanings. Missing,
failed, or removed models leave deterministic/user grouping and Gemini fallback
available. Cache identities include the encoder checksum and preprocessing
version, so legacy SigLIP scores cannot become reference-model merge scores.

Entries larger than 24 definitions are scored in bounded batches. Merged cards
display one member's definition and retain all originals. Unmerge is available
in Add Word and the Library. Explicit merge/unmerge corrections persist as an
append-only local journal alongside each pair's latest judgment. Events retain
the exact available definitions/provenance, action, timestamp, previous label,
model identity/threshold, and score when available. Settings → Local models →
Export merge corrections exports both records and events. Missing dictionary
extraction receipts must be quarantined before any future training; a user
correction alone does not establish dictionary provenance.

The exported checkpoint is the seed-42 zero-smoothing control that exactly
reproduces the selected reference's epoch 4 and validation PR-AUC. No training
was performed for this release; only the app operating threshold changed. See
[reference.json](definition-equivalence-training/reference.json) for the full
research record and limitations. The app export uses FP16 weights with FP32
inputs/outputs; labels remain agent-reviewed, not human-verified.

## Promotion verification

Both original reported splits were replayed through the actual WASM worker with
network access blocked. At the selected cutoff, all 390 validation and 384 test
decisions matched saved research scores (maximum absolute score errors 0.000993
and 0.001046). Native CPU FP16 also preserved decisions at this cutoff.

| Original-cohort replay | Validation precision / recall | Test precision / recall |
|---|---:|---:|
| Original conservative `0.9874299168586731` | 100.0% / 14.8% | 84.0% / 17.4% |
| Published best F1 `0.6957939863204956` | 66.9% / 64.8% | 69.4% / 56.2% |
| Selected app `0.6916793788299911` | 66.9% / 64.8% | 68.7% / 56.2% |

Re-extracting and verifying the original dictionary sources under the current
provenance rules retains 376 validation and 372 test pairs. On those cohorts,
the selected point yields **67.5% precision / 64.8% recall** in validation
(79 TP / 38 FP), and **68.4% precision / 55.8% recall** in test (67 TP / 31 FP).
No validation threshold achieves both 80% recall and precision above 60%.
These previously inspected, agent-reviewed cohorts do not establish fresh
generalization accuracy; pair metrics also differ from complete-linkage group
metrics. The original research record is preserved unchanged.

Browser verification without a Gemini key grouped 57 raw definitions for
“work” into 39 groups, exercised Unmerge and review corrections across reloads,
and verified both downloads' byte progress and installed-model startup preload.
Removal clears the installed model; a later preload does not download it.

Verification runners: `scripts/verify-meaning-reference.mjs` and
`scripts/verify-meaning-worker.cjs`. Inputs come from the existing dictionary-only
validation export and saved predictions, kept outside the app. Export runner:
`scripts/export-meaning-reference.py`. The installed-model budget is 350 MB,
including both model downloads, one runtime, and all bundled JavaScript.

Android's native storage plugin also passes `:app:lintDebug` for minSdk 24.
`scripts/verify-android-model-storage.py` exercises the actual plugin with real
JSONObject parsing, normal JSON integer offsets/sizes, chunked file round trips,
atomic commit, incomplete-download rejection, traversal rejection, and removal.
Only the Android/Capacitor bridge is replaced by test doubles for that JVM check.
