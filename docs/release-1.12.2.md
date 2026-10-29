# KeepVocab 1.12.2

Image suggestions now use FP16 text and FP32 vision. In the controlled comparison,
FP16 text matched FP32's first choices in every tested gallery, improving the
current model's GPU-path result from 107/120 to 113/120 while halving the FP32 text
file size. The two towers total about 130.5 MB of weights; installation copy now
estimates about 180 MB including tokenizer/config files, runtime and overhead.

- Opening the app renders first, then schedules model preparation after two
  animation frames and an idle opportunity. Graph loading and inference remain
  in a dedicated worker, with one WASM thread on the CPU path.
- The prepared worker stays available for the app session and is reused by
  image picking. There is no two-minute idle unload.
- Previously approved, enabled installations prepare missing upgrade files on
  that same background schedule. Shared cached assets are reused. Offline,
  cellular, data-saver and disabled states are respected; complete caches need
  no download permission.
- Old Q8-text and Q8-vision feedback remains archived and syncable under its
  original encoder identity. Incompatible vectors and saved personal heads are
  excluded from current fitting. The rejected generic MLP remains disabled.
- No technical picker UI, labeling task or extra user rating step was added.

Validation: **613/613 automated tests passed**, web build, macOS arm64 DMG/ZIP
and Android debug APK (version code 52). Actual production-worker smoke checks
covered an approved missing-FP16-file upgrade on WebGPU and a complete cached
WASM start with downloads blocked. Both reached the new encoder identity and
reused a single worker for photo scoring. Buttons/typing remained usable and
the test page recorded no main-thread long tasks.

The upgrade test remapped the one missing model URL to local disk; it does not
measure internet download time. The WASM photo check reused persistent image/text
vectors, so its scoring time is not an uncached inference benchmark. These are
desktop smoke checks, not physical-phone memory, battery, thermal or p95 claims.

[Text-precision results and limits](https://github.com/RODIONOLIINYK/KeepVocab/blob/v1.12.2/docs/image-text-fp16.md).
