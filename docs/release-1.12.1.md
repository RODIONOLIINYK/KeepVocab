# KeepVocab 1.12.1

Installed image models now prepare after the first screen can paint and the page
has an idle opportunity. Model loading and inference remain in the dedicated
worker, and opening the app does not wait for preparation. Hidden pages defer
the start. Startup preparation uses cached files only and respects disabled
suggestions and existing download consent.

The loaded worker stays available for the app session, replacing the former
two-minute idle unload. Image picking reuses it, including while initialization
is recovering from WebGPU to WASM. Disabling suggestions or changing backends
cancels stale work; delayed downloads and results cannot restart a disabled
worker or overwrite its state.

Added the separate upstream model-weight license notice and a
[review of the supplied model research](image-model-next-steps.md). No new model,
cloud verifier, training task or technical picker UI is enabled by this release.

Validation: **609/609 automated tests passed**, web build, macOS arm64 DMG/ZIP
and Android debug APK (version code 51).

An isolated real-model browser check seeded the pinned model/runtime files from
local disk, blocked external requests and used the production initialization
and ranking services. With one worker in each run:

| Single desktop cached-file trial | WebGPU | WASM |
| --- | ---: | ---: |
| `initializeImageLearning` returned | 10.1 ms | 9.8 ms |
| Actual model ready after start | 2,572 ms | 454.8 ms |
| External fetch attempts | 0 | 0 |

Buttons and typing remained usable; the page recorded no main-thread long tasks
in either run. On WASM, a subsequent actual-photo scoring request returned valid
local output in 364.3 ms using the same worker. WebGPU also remained ready beyond
the former two-minute unload limit. These are individual desktop smoke checks,
not backend comparisons, phone measurements, full-app startup timings or p95
claims. Browser compilation caches may influence successive trials. No physical
phone memory, thermal, battery or responsiveness result is claimed.
