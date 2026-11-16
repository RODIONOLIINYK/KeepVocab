# Local meaning merge inference

The app uses the selected `minilm-l6-v7-prefix-idf-bs16` reference for dictionary
meaning comparison. The encoder is independent of SigLIP image scoring.

Public merge model: https://huggingface.co/Rodion228huyfogdrun/KeepVocab-meaning-merge-minilm-l6-v7

Pinned download revision:
https://huggingface.co/Rodion228huyfogdrun/KeepVocab-meaning-merge-minilm-l6-v7/tree/be8ee3e1076958149ee7a1e0ace8615d2c43ee86

Direct ONNX download:
https://huggingface.co/Rodion228huyfogdrun/KeepVocab-meaning-merge-minilm-l6-v7/resolve/be8ee3e1076958149ee7a1e0ace8615d2c43ee86/onnx/model_fp16.onnx

Source and releases: https://github.com/RODIONOLIINYK/KeepVocab/releases

App release: https://github.com/RODIONOLIINYK/KeepVocab/releases/tag/v1.12.38

Apple Silicon installer:
https://github.com/RODIONOLIINYK/KeepVocab/releases/download/v1.12.38/KeepVocab-1.12.38-macOS-arm64.dmg

Android installer:
https://github.com/RODIONOLIINYK/KeepVocab/releases/download/v1.12.38/KeepVocab-1.12.38-Android-debug.apk

SigLIP upstream model: https://huggingface.co/onnx-community/siglip2-base-patch16-256-ONNX

KeepVocab compact SigLIP assets:
https://github.com/RODIONOLIINYK/KeepVocab/tree/v1.12.29/models/siglip2-compact-v1

## Installation and lifecycle

Settings has separate download/remove controls for the merge model (about
47 MB) and SigLIP. The merge download requires an explicit Settings action;
startup and lookups never download it. SHA-256 and byte lengths are checked
before downloaded files become usable. An installed merge model is preloaded
after startup and its worker remains alive for the session. Both models share
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

Automatic merges use the original validation-selected conservative threshold
`0.9874299168586731`. It had 0 validation and 4 test false merges; it is not a
guarantee. Scores at or above the reference best-F1 threshold
`0.6957939863204956` are eligible for review suggestions. User judgments override
the model; parts of speech remain separate; complete linkage prevents a chain
of individually similar meanings from collapsing distinct meanings. Missing,
failed, or removed models leave deterministic/user grouping and Gemini fallback
available. Cache identities include the encoder checksum and preprocessing
version, so legacy SigLIP scores cannot become reference-model merge scores.

The exported checkpoint is the seed-42 zero-smoothing control that exactly
reproduces the selected reference's epoch 4 and validation PR-AUC. No training
or recalibration was performed for promotion. See
[reference.json](definition-equivalence-training/reference.json) for the full
research record and limitations. The app export uses FP16 weights with FP32
inputs/outputs; labels remain agent-reviewed, not human-verified.

## Promotion verification

All 390 saved validation pairs were replayed without fitting or recalibration.
Transformers.js native CPU FP16 changed no merge decisions; maximum absolute
score error versus saved research scores was 0.001565. The actual Electron
browser worker with WASM FP16, native model storage, and network access blocked
also changed no merge decisions (maximum score error 0.000993). Removal cleared
the installed model and subsequent preload did not fetch or initialize it.
This checks deployment parity, not accuracy on a new independent dataset.

Verification runners: `scripts/verify-meaning-reference.mjs` and
`scripts/verify-meaning-worker.cjs`. Inputs come from the existing dictionary-only
validation export and saved predictions, kept outside the app. Export runner:
`scripts/export-meaning-reference.py`. The installed-model budget is 350 MB,
including both model downloads, one runtime, and all bundled JavaScript.
