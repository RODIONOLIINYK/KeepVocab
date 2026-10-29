# FP16 text and FP32 vision — 1.12.2

The app now uses the pinned MobileCLIP-S0 FP16 text tower with FP32 vision.
A controlled text-only precision study held image vectors, source images,
token IDs, meaning/scene prompts and scoring fixed. No MLP training was involved.

| Text | Native validation | Native test | Browser GPU test | Text file |
| --- | ---: | ---: | ---: | ---: |
| Q8 | 117/133 | 107/120 | 107/120 | 42.80 MB |
| FP16 | 126/133 | 113/120 | 113/120 | 84.97 MB |
| FP32 | 126/133 | 113/120 | 113/120 | 169.81 MB |

FP16 and FP32 selected identical first photos in all 253 native galleries and all
120 browser test galleries on the tested CPU/WASM/WebGPU combinations. With
GPU text inference, medians were 65.7 ms (Q8), 3.4 ms (FP16), and 4.0 ms (FP32).
WASM FP16 and FP32 were essentially equal at about 48 ms/prompt. Each browser
variant made 95 uncached text forward passes; the native study used 193 prompts
and 700 distinct photos. Detailed counts and timings are in
[the frozen summary](image-text-fp16-summary.json).

These are desktop measurements of the existing, previously inspected,
agent-reviewed regression fixture. They are not physical-phone timings, a new
blind acceptance study, calibrated confidence or all-wrong rejection evidence.
File sizes are not peak runtime RAM. FP16 text plus FP32 vision totals 130.51 MB
of weights; runtime/tokenizer/configs are additional. Installation copy estimates
about 180 MB including those files and overhead.

The encoder identity changes to `text-fp16-vision-fp32`. Old Q8-vision and
Q8-text histories remain archived and syncable under their own tags. Their cached
meaning vectors and trained heads cannot be reused as FP16 representations.
The rejected generic MLP remains disabled. Historical pretraining reproduction
uses tag `v1.12.0`; current pixel evaluation uses the new encoder.

Installed files warm after two animation frames and an idle opportunity in the
dedicated worker. The worker is retained for the app session. An enabled device
with saved download approval can prepare missing upgrade files on that same
schedule, without waiting for a first image search. Background downloads skip
offline, cellular and data-saver states and recheck policy at idle start. Full
caches remain usable offline without download permission. Explicit off is
preserved, and stale initialization/results cannot revive a disabled worker.

The new FP16 text file is pinned to revision
`757d59c9c6870a76a4b0306f05f5061bca15c39f`, SHA-256
`2f74b7b3abd9f3a70dcc60115f627bbadb9534606ac841400f9841f49bf980cc`.
No production picker UI or labeling task was added.
