# KeepVocab 1.8.8

Optional local image learning is available in Settings. MobileCLIP compares actual
photo pixels with the intended meaning, saved scenes, and competing senses. Small
thumbnails, cached embeddings and vector duplicate removal bound the work. Model
weights and runtime download once (about 85 MB) instead of increasing every app
installer. WebGPU falls back to CPU/WASM; cached models can run offline.

Good/Wrong and applied Keep choices feed a personal degree-one logistic model
with 516 parameters. Each explicit label is retained immediately. Training starts
at eight image/sense labels with at least two of each class, then batches four
changed labels. Balanced replay and L2 regularization limit click sensitivity;
early preference influence is small and cannot positively reward a competing
sense. Corrected labels replace prior targets. Skip, Next and Cancel do not teach
negative labels. Private Drive backup merges learning records; encoders stay
frozen and model downloads remain device-local.

Settings exposes queued labels, training revision, changed parameter count,
actual L2 weight delta, and before/after fingerprints. Separate controls turn off
scoring, remove downloaded models/vectors, or reset learned preferences.

Validation: 406 automated tests pass. Real MobileCLIP browser checks on arm64
verify WebGPU inference, competing-sense scoring on a cat photo, duplicate-click
handling, training at labels eight/twelve, weight persistence after reload, and
cold CPU inference with external network blocked. Responsive Settings checks
cover 390/1280-pixel widths. These are pipeline checks; they do not establish
real-world ranking accuracy. Android is built, but native device inference is
not tested because no Android device/emulator is configured.

This release retains the adaptive review scheduler. FSRS is a separate proposed
upgrade; image preference learning does not change vocabulary intervals.

macOS: Apple Silicon arm64 only. Android version code: 37. Web cache: v18800.

Artifact verification: all 88 web files match in the macOS ASAR and Android APK;
all 15 Mach-O executables/libraries are arm64. The ASAR contains no ONNX weights,
WASM binaries, Transformers development dependencies, or native ML libraries.
The DMG is 112,324,421 bytes (170,446 bytes larger than 1.8.7); the Android APK is
7,942,291 bytes and retains the existing debug signing certificate. Optional
model downloads account for the separate on-device model storage.
